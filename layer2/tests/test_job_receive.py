"""receive() and on_request(): the bridge's messages, bridge -> coordinator -> worker -> job."""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, cast

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config
from websockets.asyncio.client import ClientConnection

from layer2 import settings
from layer2.contracts import Deliver, MissingItem
from layer2.job_client import Layer2
from layer2.worker.client import WorkerState, run_worker
from layer2.worker.gateway import Gateway, Relay

TOKEN: str = contract("hello.json")["token"]
REQUEST = {"request_id": "r-1", "device_id": "phone-1", "kind": "check_now", "text": ""}


def bridge_post(port: int, path: str, body: dict[str, Any]) -> int:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as answer:
            status: int = answer.status
    except urllib.error.HTTPError as error:
        status = error.code
    return status


async def no_report(state: WorkerState, missing: list[MissingItem]) -> None:
    return


def test_a_phone_request_reaches_the_job_that_takes_requests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)
    folder = tmp_path / "coordinator"
    folder.mkdir()
    coordinator_config = write_coordinator_config(folder)
    coordinator = json.loads(coordinator_config.read_text(encoding="utf-8"))
    running = Running(coordinator_config)
    wait_until_serving(coordinator["dashboard_port"])
    client_port = coordinator["client_port"]
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

    async def scenario() -> tuple[int, int, dict[str, Any] | None]:
        relay = Relay()
        gateway = Gateway(relay)
        await gateway.start()
        job = Layer2(f"127.0.0.1:{gateway.port}", gateway.token)
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, None, relay))
        try:
            before = await asyncio.to_thread(bridge_post, client_port, "/v1/requests", REQUEST)
            assert await asyncio.to_thread(job.receive, "requests", 0) is None  # subscribes
            accepted = 0
            for _ in range(200):  # until the worker has joined and its subscription arrived
                accepted = await asyncio.to_thread(
                    bridge_post, client_port, "/v1/requests", REQUEST
                )
                if accepted == 202:
                    break
                await asyncio.sleep(0.05)
            received = await asyncio.to_thread(job.receive, "requests", 5)
        finally:
            stop.set()
            await asyncio.wait_for(task, settings.STOP_DEADLINE_S)
            await gateway.close()
        return before, accepted, received

    try:
        before, accepted, received = asyncio.run(scenario())
    finally:
        Path(coordinator["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0
    assert before == 503  # nobody took requests yet: the bridge retries
    assert accepted == 202
    assert received == REQUEST


class FakeConnection:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send(self, text: str) -> None:
        self.sent.append(json.loads(text))


def test_subscriptions_are_sent_again_after_a_reconnect() -> None:
    async def scenario() -> list[list[dict[str, Any]]]:
        relay = Relay()
        await relay.subscribe("watch-data")  # while disconnected: remembered
        first, second = FakeConnection(), FakeConnection()
        relay.attach(cast(ClientConnection, first))
        await relay.resubscribe()
        relay.detach()
        relay.attach(cast(ClientConnection, second))
        await relay.resubscribe()
        return [first.sent, second.sent]

    subscribe = {"type": "subscribe", "schema_version": 1, "kind": "watch-data"}
    assert asyncio.run(scenario()) == [[subscribe], [subscribe]]


def test_a_full_inbox_drops_the_oldest(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "INBOX_MAX_MESSAGES", 2)

    async def scenario() -> list[Any]:
        relay = Relay()
        for n in range(3):
            relay.deliver(Deliver(type="deliver", schema_version=1, kind="requests", body={"n": n}))
        return [await relay.take("requests", 0.1) for _ in range(3)]

    assert asyncio.run(scenario()) == [{"n": 1}, {"n": 2}, None]


class Handled(Exception):
    pass


def test_on_request_calls_the_handler_with_each_request() -> None:
    async def scenario() -> list[dict[str, Any]]:
        relay = Relay()
        gateway = Gateway(relay)
        await gateway.start()
        job = Layer2(f"127.0.0.1:{gateway.port}", gateway.token)
        seen: list[dict[str, Any]] = []

        def handle(request: dict[str, Any]) -> None:
            seen.append(request)
            raise Handled  # leave the forever loop after the first one

        relay.deliver(Deliver(type="deliver", schema_version=1, kind="requests", body=REQUEST))
        try:
            with pytest.raises(Handled):
                await asyncio.to_thread(job.on_request, handle)
        finally:
            await gateway.close()
        return seen

    assert asyncio.run(scenario()) == [REQUEST]
