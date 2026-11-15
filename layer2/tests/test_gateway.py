"""The worker's gateway for jobs, in front of a real coordinator, spoken to as raw JSON lines."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.contracts import MissingItem
from layer2.worker.client import WorkerState, run_worker
from layer2.worker.gateway import Gateway, Relay

TOKEN: str = contract("hello.json")["token"]


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)


async def call(gateway: Gateway, request: dict[str, Any], token: str | None = None) -> Any:
    reader, writer = await asyncio.open_connection("127.0.0.1", gateway.port)
    try:
        line = {**request, "token": gateway.token if token is None else token}
        writer.write(json.dumps(line).encode("utf-8") + b"\n")
        await writer.drain()
        return json.loads(await reader.readline())
    finally:
        writer.close()


async def no_report(state: WorkerState, missing: list[MissingItem]) -> None:
    return


def test_requests_reach_the_coordinators_event_log(tmp_path: Path) -> None:
    folder = tmp_path / "coordinator"
    folder.mkdir()
    coordinator_config = write_coordinator_config(folder)
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

    async def scenario() -> list[Any]:
        relay = Relay()
        gateway = Gateway(relay)
        await gateway.start()
        assert gateway.env() == {
            "LAYER2_GATEWAY": f"127.0.0.1:{gateway.port}",
            "LAYER2_GATEWAY_TOKEN": gateway.token,
        }
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, None, relay))
        try:
            event = {"type": "log_append", "event": {"kind": "fall"}}
            for _ in range(200):  # until the worker has joined
                answer = await call(gateway, event)
                if answer["ok"]:
                    break
                assert answer["error"] == "not connected to the coordinator"
                await asyncio.sleep(0.05)
            assert answer == {"ok": True, "truncated": False}
            since = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
            read = await call(gateway, {"type": "log_read", "since": since})
            bad = await call(gateway, {"type": "log_read"})
            wrong = await call(gateway, {"type": "log_append", "event": {}}, token="0" * 64)
            unknown = await call(gateway, {"type": "start", "job": "x"})
        finally:
            stop.set()
            await asyncio.wait_for(task, settings.STOP_DEADLINE_S)
            await gateway.close()
        return [read, bad, wrong, unknown]

    try:
        read, bad, wrong, unknown = asyncio.run(scenario())
    finally:
        Path(coordinator["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0
    assert read["ok"] and [item["event"] for item in read["events"]] == [{"kind": "fall"}]
    assert bad == {"ok": False, "error": "the request's fields are not valid"}
    assert wrong == {"ok": False, "error": "wrong or missing token"}
    assert unknown == {"ok": False, "error": "type must be log_append, log_read or ask"}
    assert len(list((folder / "events").glob("*.jsonl"))) == 1


def test_a_line_that_is_not_json_gets_an_error() -> None:
    async def scenario() -> Any:
        gateway = Gateway(Relay())
        await gateway.start()
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", gateway.port)
            writer.write(b"not json\n")
            await writer.drain()
            answer = json.loads(await reader.readline())
            writer.close()
        finally:
            await gateway.close()
        return answer

    assert asyncio.run(scenario()) == {
        "ok": False,
        "error": "each request is one JSON object per line",
    }
