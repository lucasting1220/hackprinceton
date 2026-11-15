"""to_phone(): a job's message for phones, carried job -> worker -> coordinator -> bridge."""

import asyncio
import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.contracts import MissingItem
from layer2.coordinator.bridge import BridgeError, post
from layer2.job_client import Layer2, Layer2Error
from layer2.worker.client import WorkerState, run_worker
from layer2.worker.gateway import Gateway, Relay

TOKEN: str = contract("hello.json")["token"]
ALERT = {
    "alert_id": "a-1",
    "kind": "fall",
    "severity": "urgent",
    "title": "Fall",
    "body": "Kitchen",
}


class StandInBridge(BaseHTTPRequestHandler):
    """Stands in for Layer 1's bridge: records each POST, answers with `status`."""

    received: list[tuple[str, Any]] = []
    status = 202
    delay = 0.0

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).received.append((self.path, body))
        time.sleep(self.delay)
        try:
            self.send_response(self.status)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except OSError:
            pass

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def bridge() -> Iterator[tuple[str, type[StandInBridge]]]:
    class handler(StandInBridge):
        received: list[tuple[str, Any]] = []

    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", handler
    server.shutdown()
    server.server_close()
    thread.join()


def test_post_sends_the_body_as_is(bridge: tuple[str, type[StandInBridge]]) -> None:
    url, handler = bridge
    post(url, "alerts", ALERT)
    assert handler.received == [("/v1/alerts", ALERT)]


def test_post_reports_refusal_silence_and_absence(
    bridge: tuple[str, type[StandInBridge]], monkeypatch: pytest.MonkeyPatch
) -> None:
    url, handler = bridge
    handler.status = 503
    with pytest.raises(BridgeError, match="refused it \\(503\\)"):
        post(url, "status", {})
    handler.status, handler.delay = 202, 1.0
    monkeypatch.setattr(settings, "BRIDGE_TIMEOUT_S", 0.2)
    with pytest.raises(BridgeError, match="did not answer"):
        post(url, "reports", {})
    with pytest.raises(BridgeError, match="cannot reach"):
        post(f"http://127.0.0.1:{closed_port()}", "replies", {})
    with pytest.raises(BridgeError, match="kind must be"):
        post(url, "anything", {})


async def no_report(state: WorkerState, missing: list[MissingItem]) -> None:
    return


def test_a_job_reaches_the_bridge_through_its_worker_and_the_coordinator(
    tmp_path: Path, bridge: tuple[str, type[StandInBridge]], monkeypatch: pytest.MonkeyPatch
) -> None:
    url, handler = bridge
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)
    folder = tmp_path / "coordinator"
    folder.mkdir()
    coordinator_config = write_coordinator_config(folder, bridge_url=url)
    coordinator = json.loads(coordinator_config.read_text(encoding="utf-8"))
    running = Running(coordinator_config)
    wait_until_serving(coordinator["dashboard_port"])
    (tmp_path / "worker-token").write_text(TOKEN, encoding="utf-8")
    worker = {
        **contract("worker.json"),
        "coordinator_url": f"ws://127.0.0.1:{coordinator['listen_port']}/ws",
        "token_file": str(tmp_path / "worker-token"),
        "ollama_url": f"http://127.0.0.1:{closed_port()}",
        "python": str(tmp_path / "python"),
        "status_file": str(tmp_path / "worker-status.json"),
        "stop_file": str(tmp_path / "worker.stop"),
        "state_dir": str(tmp_path),
    }
    config = tmp_path / "worker.json"
    config.write_text(json.dumps(worker), encoding="utf-8")

    async def scenario() -> str:
        relay = Relay()
        gateway = Gateway(relay)
        await gateway.start()
        client = Layer2(f"127.0.0.1:{gateway.port}", gateway.token)
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, None, relay))
        try:
            for _ in range(200):  # until the worker has joined
                try:
                    await asyncio.to_thread(client.to_phone, "alerts", ALERT)
                    break
                except Layer2Error as error:
                    assert "not connected" in str(error)
                    await asyncio.sleep(0.05)
            handler.status = 503
            try:
                await asyncio.to_thread(client.to_phone, "status", {"activity": "sitting"})
                refused = ""
            except Layer2Error as error:
                refused = str(error)
        finally:
            stop.set()
            await asyncio.wait_for(task, settings.STOP_DEADLINE_S)
            await gateway.close()
        return refused

    try:
        refused = asyncio.run(scenario())
    finally:
        Path(coordinator["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0
    assert handler.received[0] == ("/v1/alerts", ALERT)
    assert handler.received[-1] == ("/v1/status", {"activity": "sitting"})
    assert refused == "the bridge refused it (503)"
