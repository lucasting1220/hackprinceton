"""Language model requests on this worker, through the Ollama server already running at
`ollama_url` (never one of our own). Blocking: from async code, call through
`asyncio.to_thread`."""

import http.client
import json
import urllib.request

from layer2 import settings

_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ModelError(Exception):
    """Ollama is unreachable, timed out, or did not answer with text."""


def generate(ollama_url: str, model: str, prompt: str) -> str:
    """One complete (non-streamed) answer from `model`, within ASK_TIMEOUT_S."""
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request(
        ollama_url.rstrip("/") + "/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _NO_PROXY.open(request, timeout=settings.ASK_TIMEOUT_S) as response:
            answer = json.load(response)
    except TimeoutError:
        raise ModelError(
            f"model {model} did not answer within {settings.ASK_TIMEOUT_S} s"
        ) from None
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise ModelError(f"Ollama could not answer with {model}: {type(error).__name__}") from None
    text = answer.get("response") if isinstance(answer, dict) else None
    if not isinstance(text, str):
        raise ModelError(f"Ollama's answer from {model} had no text")
    return text
