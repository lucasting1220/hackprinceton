"""Language model requests through the Ollama server already running at `ollama_url` (never one
of our own): the worker's ask() and the coordinator's planner. Blocking: from async code,
call through `asyncio.to_thread`."""

import http.client
import json
import urllib.request

from layer2 import settings

_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ModelError(Exception):
    """Ollama is unreachable, timed out, or did not answer with text."""


def generate(
    ollama_url: str,
    model: str,
    prompt: str,
    timeout: float | None = None,
    json_only: bool = False,
) -> str:
    """One complete (non-streamed) answer from `model`, within `timeout` (ASK_TIMEOUT_S by
    default). `json_only` asks Ollama to constrain the answer to JSON."""
    limit = settings.ASK_TIMEOUT_S if timeout is None else timeout
    fields: dict[str, object] = {"model": model, "prompt": prompt, "stream": False}
    if json_only:
        fields["format"] = "json"
    body = json.dumps(fields).encode("utf-8")
    request = urllib.request.Request(
        ollama_url.rstrip("/") + "/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _NO_PROXY.open(request, timeout=limit) as response:
            answer = json.load(response)
    except TimeoutError:
        raise ModelError(f"model {model} did not answer within {limit} s") from None
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise ModelError(f"Ollama could not answer with {model}: {type(error).__name__}") from None
    text = answer.get("response") if isinstance(answer, dict) else None
    if not isinstance(text, str):
        raise ModelError(f"Ollama's answer from {model} had no text")
    return text
