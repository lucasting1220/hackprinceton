"""Shared test helpers for Layer 2."""

import json
import socket
import threading
import time
import urllib.request
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

from layer2.coordinator.main import main as coordinator_main

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


def write_coordinator_config(tmp_path: Path, **changes: object) -> Path:
    accepted = tmp_path / "accepted-workers.json"
    accepted.write_text(json.dumps(contract("accepted-workers.json")), encoding="utf-8")
    ports = [closed_port() for _ in range(3)]
    data = {
        **contract("coordinator.json"),
        "listen_port": ports[0],
        "dashboard_port": ports[1],
        "client_port": ports[2],
        "accepted_workers_file": str(accepted),
        "state_dir": str(tmp_path),
        "stop_file": str(tmp_path / "coordinator.stop"),
        **changes,
    }
    path = tmp_path / "coordinator.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class Running:
    """The coordinator's main() on a background thread, with its result."""

    def __init__(self, config: Path) -> None:
        self.result: list[int] = []
        self.thread = threading.Thread(
            target=lambda: self.result.append(coordinator_main(["--config", str(config)])),
            daemon=True,
        )
        self.thread.start()

    def wait(self, timeout: float) -> int | None:
        self.thread.join(timeout)
        return self.result[0] if self.result else None


def wait_until_serving(port: int, deadline_s: float = 10.0) -> None:
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError("coordinator did not start")
