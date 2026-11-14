"""Shared test helpers for Layer 2."""

import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def contract(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    return data


def closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


class _OllamaVersion(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b'{"version": "test"}'
        self.send_response(200 if self.path == "/api/version" else 404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def ollama_url() -> Iterator[str]:
    """A local HTTP server that answers like Ollama's /api/version."""
    server = HTTPServer(("127.0.0.1", 0), _OllamaVersion)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()
