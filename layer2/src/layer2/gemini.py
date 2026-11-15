"""Language model requests through Google's Gemini API, for the worker's ask() when this laptop
has a Gemini API key. Blocking: from async code, call through `asyncio.to_thread`.

The key comes from the GEMINI_KEY_VARIABLE environment variable, read once when the worker
starts and then removed, so the worker's jobs never inherit it. It is sent only in the
`x-goog-api-key` header: never in a URL, a log line or an error message."""

import http.client
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from layer2 import settings
from layer2.ollama import ModelError


@dataclass(frozen=True)
class GeminiAccess:
    api_key: str = field(repr=False)
    url: str = settings.GEMINI_URL


def take_access() -> GeminiAccess | None:
    """This laptop's Gemini access, taken out of the environment; None when no key is set."""
    key = os.environ.pop(settings.GEMINI_KEY_VARIABLE, "").strip()
    return GeminiAccess(api_key=key) if key else None


def generate(access: GeminiAccess, model: str, prompt: str, timeout: float | None = None) -> str:
    """One complete (non-streamed) answer from `model`, within `timeout` (ASK_TIMEOUT_S by
    default)."""
    limit = settings.ASK_TIMEOUT_S if timeout is None else timeout
    body = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}]})
    request = urllib.request.Request(
        f"{access.url.rstrip('/')}/models/{model}:generateContent",
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": access.api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=limit) as response:
            answer = json.load(response)
    except TimeoutError:
        raise ModelError(f"model {model} did not answer within {limit} s") from None
    except urllib.error.HTTPError as error:
        error.close()
        raise ModelError(f"Gemini could not answer with {model}: HTTP {error.code}") from None
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise ModelError(f"Gemini could not answer with {model}: {type(error).__name__}") from None
    return _answer_text(answer, model)


def _answer_text(answer: Any, model: str) -> str:
    """The first candidate's text, without its thought parts."""
    if not isinstance(answer, dict):
        raise ModelError(f"Gemini's answer from {model} had no text")
    candidates = answer.get("candidates")
    if not candidates:
        feedback = answer.get("promptFeedback")
        reason = feedback.get("blockReason") if isinstance(feedback, dict) else None
        if isinstance(reason, str):
            raise ModelError(f"Gemini blocked the prompt: {reason}")
        raise ModelError(f"Gemini's answer from {model} had no text")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    texts = [
        part["text"]
        for part in parts or []
        if isinstance(part, dict) and isinstance(part.get("text"), str) and not part.get("thought")
    ]
    if not texts:
        raise ModelError(f"Gemini's answer from {model} had no text")
    return "".join(texts)
