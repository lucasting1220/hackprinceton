"""ask() answered by Gemini when the worker has a Gemini API key, with Ollama behind it."""

import asyncio
import json
import os
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest
from conftest import closed_port

from layer2 import settings
from layer2.gemini import GeminiAccess, generate, take_access
from layer2.job_client import Answer, Layer2, Layer2Error
from layer2.ollama import ModelError
from layer2.worker.gateway import Gateway, Relay

_KEY = "test-gemini-key-not-real"


def _gemini_reply(*texts: str) -> dict[str, Any]:
    parts = [{"text": text} for text in texts]
    return {"candidates": [{"content": {"role": "model", "parts": parts}}]}


class _FakeGemini(BaseHTTPRequestHandler):
    seen: list[dict[str, Any]] = []
    status: int = 200
    reply: dict[str, Any] = {}

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).seen.append(
            {"path": self.path, "key": self.headers.get("x-goog-api-key"), **json.loads(body)}
        )
        answer = json.dumps(self.reply).encode()
        self.send_response(self.status)
        self.send_header("Content-Length", str(len(answer)))
        self.end_headers()
        self.wfile.write(answer)

    def log_message(self, format: str, *args: object) -> None:
        return


class _FakeOllama(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        self.rfile.read(int(self.headers["Content-Length"]))
        answer = json.dumps({"response": "From Ollama.", "done": True}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(answer)))
        self.end_headers()
        self.wfile.write(answer)

    def log_message(self, format: str, *args: object) -> None:
        return


def _serve(handler: type[BaseHTTPRequestHandler]) -> Iterator[str]:
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/v1beta"
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture
def fake_gemini() -> Iterator[tuple[GeminiAccess, type[_FakeGemini]]]:
    class handler(_FakeGemini):
        seen: list[dict[str, Any]] = []
        status = 200
        reply = _gemini_reply("Mum is ", "in the kitchen.")

    for url in _serve(handler):
        yield GeminiAccess(api_key=_KEY, url=url), handler


@pytest.fixture
def fake_ollama() -> Iterator[str]:
    for url in _serve(_FakeOllama):
        yield url.removesuffix("/v1beta")


def test_generate_sends_the_prompt_with_the_key_in_a_header(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]],
) -> None:
    access, handler = fake_gemini
    text = generate(access, "gemini-test", "Where is mum?")
    assert text == "Mum is in the kitchen."
    assert handler.seen == [
        {
            "path": "/v1beta/models/gemini-test:generateContent",
            "key": _KEY,
            "contents": [{"role": "user", "parts": [{"text": "Where is mum?"}]}],
        }
    ]


def test_generate_leaves_out_thought_parts(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]],
) -> None:
    access, handler = fake_gemini
    handler.reply = {
        "candidates": [
            {"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": "Fine."}]}}
        ]
    }
    assert generate(access, "gemini-test", "hi") == "Fine."


def test_generate_errors_never_carry_the_key(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]],
) -> None:
    access, handler = fake_gemini
    handler.status = 400
    handler.reply = {"error": {"message": f"API key {_KEY} not valid"}}
    with pytest.raises(ModelError) as rejected:
        generate(access, "gemini-test", "hi")
    assert str(rejected.value) == "Gemini could not answer with gemini-test: HTTP 400"
    assert _KEY not in repr(access)

    handler.status = 200
    handler.reply = {"promptFeedback": {"blockReason": "SAFETY"}}
    with pytest.raises(ModelError, match="Gemini blocked the prompt: SAFETY"):
        generate(access, "gemini-test", "hi")

    handler.reply = {"candidates": [{"content": {"parts": []}, "finishReason": "MAX_TOKENS"}]}
    with pytest.raises(ModelError, match="Gemini's answer from gemini-test had no text"):
        generate(access, "gemini-test", "hi")

    down = GeminiAccess(api_key=_KEY, url=f"http://127.0.0.1:{closed_port()}/v1beta")
    with pytest.raises(ModelError, match="Gemini could not answer with gemini-test: "):
        generate(down, "gemini-test", "hi")


def test_take_access_removes_the_key_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(settings.GEMINI_KEY_VARIABLE, f"  {_KEY}\n")
    access = take_access()
    assert access == GeminiAccess(api_key=_KEY, url=settings.GEMINI_URL)
    assert settings.GEMINI_KEY_VARIABLE not in os.environ
    assert take_access() is None
    monkeypatch.setenv(settings.GEMINI_KEY_VARIABLE, "   ")
    assert take_access() is None


def _asking(
    ollama_url: str | None, gemini: GeminiAccess | None, *calls: tuple[str, str]
) -> list[Answer | str]:
    async def scenario() -> list[Answer | str]:
        gateway = Gateway(Relay(), ollama_url, gemini)
        await gateway.start()
        client = Layer2(f"127.0.0.1:{gateway.port}", gateway.token)
        results: list[Answer | str] = []
        try:
            for prompt, quality in calls:
                try:
                    request = {"type": "ask", "prompt": prompt, "quality": quality}
                    reply = await asyncio.to_thread(client._call, request)
                    results.append(Answer(text=reply["text"], quality=reply["quality"]))
                except Layer2Error as error:
                    results.append(str(error))
        finally:
            await gateway.close()
        return results

    return asyncio.run(scenario())


def test_each_quality_goes_to_its_gemini_model(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]],
) -> None:
    access, handler = fake_gemini
    quick, deep = _asking(None, access, ("Rewrite: fall", "quick"), ("Daily report", "deep"))
    assert quick == Answer(text="Mum is in the kitchen.", quality="quick")
    assert deep == Answer(text="Mum is in the kitchen.", quality="deep")
    assert [seen["path"] for seen in handler.seen] == [
        f"/v1beta/models/{settings.GEMINI_QUICK_MODEL}:generateContent",
        f"/v1beta/models/{settings.GEMINI_DEEP_MODEL}:generateContent",
    ]


def test_gemini_failing_falls_back_to_ollama_as_quick(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]], fake_ollama: str
) -> None:
    access, handler = fake_gemini
    handler.status = 429
    [answer] = _asking(fake_ollama, access, ("Daily report", "deep"))
    assert answer == Answer(text="From Ollama.", quality="quick")


def test_gemini_failing_without_ollama_is_explained(
    fake_gemini: tuple[GeminiAccess, type[_FakeGemini]],
) -> None:
    access, handler = fake_gemini
    handler.status = 503
    [failed] = _asking(None, access, ("hi", "quick"))
    assert failed == f"Gemini could not answer with {settings.GEMINI_QUICK_MODEL}: HTTP 503"
