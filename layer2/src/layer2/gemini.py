"""Language model requests to Google's Gemini API (generateContent), made on the coordinator
only: the planner, and jobs' ask() (carried there by their worker).

The API key comes from the GEMINI_API_KEY environment variable, or else the file
GEMINI_KEY_FILE in the coordinator's state folder, read again at each use so it can be added
while the coordinator runs. It is sent only in the x-goog-api-key header to GEMINI_URL, and
never logged or put in an error message. Blocking: from async code, call through
`asyncio.to_thread`.
"""

import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from layer2 import settings

_ERROR_BODY_MAX_BYTES = 64 * 1024


class ModelError(Exception):
    """Gemini is unreachable, refused, timed out, or did not answer with text."""


def api_key(state_dir: Path) -> str | None:
    """The Gemini API key, or None when this coordinator has none."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    try:
        key = (state_dir / settings.GEMINI_KEY_FILE).read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return key or None


def generate(
    key: str,
    model: str,
    prompt: str,
    timeout: float | None = None,
    json_only: bool = False,
) -> str:
    """One complete answer from `model`, within `timeout` (ASK_TIMEOUT_S by default).
    `json_only` asks Gemini to answer with JSON only."""
    limit = settings.ASK_TIMEOUT_S if timeout is None else timeout
    fields: dict[str, Any] = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
    if json_only:
        fields["generationConfig"] = {"responseMimeType": "application/json"}
    url = (
        settings.GEMINI_URL.rstrip("/")
        + f"/v1beta/models/{urllib.parse.quote(model, safe='')}:generateContent"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(fields).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=limit) as response:
            answer = json.load(response)
    except urllib.error.HTTPError as error:
        raise ModelError(f"Gemini refused the request for {model}: {_refusal(error)}") from None
    except TimeoutError:
        raise ModelError(f"model {model} did not answer within {limit} s") from None
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise ModelError(f"Gemini could not answer with {model}: {type(error).__name__}") from None
    return _text(answer, model)


def _refusal(error: urllib.error.HTTPError) -> str:
    """The HTTP code and Gemini's status word (such as PERMISSION_DENIED): never its free text,
    which could echo the request."""
    try:
        body = json.loads(error.read(_ERROR_BODY_MAX_BYTES))
        status = body["error"]["status"]
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
        status = None
    finally:
        error.close()
    if isinstance(status, str) and status.isidentifier() and len(status) <= 40:
        return f"HTTP {error.code} {status}"
    return f"HTTP {error.code}"


def _text(answer: object, model: str) -> str:
    """The first candidate's text parts, joined; its thought parts are left out."""
    if isinstance(answer, dict):
        candidates = answer.get("candidates")
        if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
            content = candidates[0].get("content")
            parts = content.get("parts") if isinstance(content, dict) else None
            if isinstance(parts, list):
                texts = [
                    part["text"]
                    for part in parts
                    if isinstance(part, dict)
                    and isinstance(part.get("text"), str)
                    and not part.get("thought")
                ]
                if texts:
                    return "".join(texts)
        feedback = answer.get("promptFeedback")
        reason = feedback.get("blockReason") if isinstance(feedback, dict) else None
        if isinstance(reason, str) and reason.isidentifier() and len(reason) <= 40:
            raise ModelError(f"Gemini blocked the prompt for {model}: {reason}")
    raise ModelError(f"Gemini's answer from {model} had no text")
