"""ask(): a job's model request, answered by its own worker's Ollama."""

import asyncio
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest
from conftest import closed_port

from layer2 import settings
from layer2.job_client import Answer, Layer2, Layer2Error
from layer2.worker.gateway import Gateway, Relay


class _FakeGenerate(BaseHTTPRequestHandler):
    seen: list[dict[str, Any]] = []
    reply: bytes = b""

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).seen.append({"path": self.path, **json.loads(body)})
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.reply)))
        self.end_headers()
        self.wfile.write(self.reply)

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def fake_ollama() -> Iterator[tuple[str, type[_FakeGenerate]]]:
    class handler(_FakeGenerate):
        seen: list[dict[str, Any]] = []
        reply = json.dumps(
            {"model": "m", "response": "Fall in the kitchen.", "done": True}
        ).encode()

    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", handler
    server.shutdown()
    server.server_close()
    thread.join()


def asking(ollama_url: str | None, *calls: tuple[str, str]) -> list[Answer | str]:
    """Start a gateway, send each (prompt, quality) ask from a client thread, and return the
    answers (or the error text). Goes through the client's raw call so a bad quality can be
    sent too."""

    async def scenario() -> list[Answer | str]:
        gateway = Gateway(Relay(), ollama_url)
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


def test_quick_is_answered_by_the_quick_model(
    fake_ollama: tuple[str, type[_FakeGenerate]],
) -> None:
    url, handler = fake_ollama

    async def through_ask() -> Answer:
        gateway = Gateway(Relay(), url)
        await gateway.start()
        try:
            client = Layer2(f"127.0.0.1:{gateway.port}", gateway.token)
            return await asyncio.to_thread(client.ask, "Rewrite: fall detected")
        finally:
            await gateway.close()

    answer = asyncio.run(through_ask())
    assert answer == Answer(text="Fall in the kitchen.", quality="quick")
    assert handler.seen == [
        {
            "path": "/api/generate",
            "model": settings.QUICK_MODEL,
            "prompt": "Rewrite: fall detected",
            "stream": False,
        }
    ]


def test_deep_is_answered_by_quick_and_says_so(
    fake_ollama: tuple[str, type[_FakeGenerate]],
) -> None:
    url, _ = fake_ollama
    [answer] = asking(url, ("Write the daily report", "deep"))
    assert answer == Answer(text="Fall in the kitchen.", quality="quick")


def test_errors_are_explained(
    fake_ollama: tuple[str, type[_FakeGenerate]], monkeypatch: pytest.MonkeyPatch
) -> None:
    url, handler = fake_ollama
    monkeypatch.setattr(settings, "ASK_MAX_PROMPT_CHARS", 10)
    too_long, bad_quality = asking(url, ("x" * 11, "quick"), ("hi", "best"))
    assert too_long == "a prompt may be at most 10 characters"
    assert bad_quality == "ask needs a prompt and a quality of quick or deep"
    assert handler.seen == []
    handler.reply = b'{"error": "model not found"}'
    [no_text] = asking(url, ("hi", "quick"))
    assert no_text == f"Ollama's answer from {settings.QUICK_MODEL} had no text"


def test_ollama_down_or_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    [down] = asking(f"http://127.0.0.1:{closed_port()}", ("hi", "quick"))
    assert isinstance(down, str) and down.startswith("Ollama could not answer")
    [absent] = asking(None, ("hi", "quick"))
    assert absent == "this worker has no model service"
