"""layer2.job_client from a real job process: job -> worker gateway -> coordinator, all real."""

import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.contracts import MissingItem
from layer2.coordinator import main as coordinator_main
from layer2.coordinator.plan import JobNeed
from layer2.job_client import Layer2, Layer2Error
from layer2.worker.client import WorkerState, run_worker
from layer2.worker.gateway import Gateway, Relay
from layer2.worker.jobs import JobControl, JobRunner, JobSpec

TOKEN: str = contract("hello.json")["token"]

JOB = """
import json, pathlib, time
from datetime import UTC, datetime, timedelta
from layer2.job_client import Layer2, Layer2Error

layer2 = Layer2.from_env()
for _ in range(100):  # until the worker has joined
    try:
        layer2.log_event({"kind": "fall", "confidence": 0.93})
        break
    except Layer2Error:
        time.sleep(0.05)
events = layer2.read_log(since=datetime.now(UTC) - timedelta(minutes=10))
pathlib.Path("result.json").write_text(json.dumps(events))
time.sleep(60)
"""


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)
    monkeypatch.setattr(settings, "JOB_STOP_GRACE_S", 1.0)


def write_worker_config(tmp_path: Path, coordinator_port: int) -> Path:
    (tmp_path / "worker-token").write_text(TOKEN, encoding="utf-8")
    data = {
        **contract("worker.json"),
        "coordinator_url": f"ws://127.0.0.1:{coordinator_port}/ws",
        "token_file": str(tmp_path / "worker-token"),
        "ollama_url": f"http://127.0.0.1:{closed_port()}",
        "python": str(tmp_path / "python"),
        "status_file": str(tmp_path / "worker-status.json"),
        "stop_file": str(tmp_path / "worker.stop"),
        "state_dir": str(tmp_path),
    }
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


async def no_report(state: WorkerState, missing: list[MissingItem]) -> None:
    return


def test_a_job_writes_and_reads_the_event_log_through_its_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(coordinator_main, "_job_needs", lambda: [JobNeed("care_rules", 0.5, None)])
    folder = tmp_path / "coordinator"
    folder.mkdir()
    coordinator_config = write_coordinator_config(folder)
    coordinator = json.loads(coordinator_config.read_text(encoding="utf-8"))
    running = Running(coordinator_config)
    wait_until_serving(coordinator["dashboard_port"])
    job_folder = tmp_path / "care_rules"
    job_folder.mkdir()
    config = write_worker_config(tmp_path, coordinator["listen_port"])

    async def scenario() -> list[dict[str, Any]]:
        relay = Relay()
        gateway = Gateway(relay)
        await gateway.start()
        spec = JobSpec("care_rules", (sys.executable, "-c", JOB), job_folder)
        jobs = JobControl(JobRunner(tmp_path / "logs", gateway.env()), {"care_rules": spec}.get)
        stop = asyncio.Event()
        worker = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, jobs, relay))
        try:
            result = job_folder / "result.json"
            for _ in range(200):
                if result.exists():
                    break
                await asyncio.sleep(0.05)
            events: list[dict[str, Any]] = json.loads(result.read_text(encoding="utf-8"))
        finally:
            stop.set()
            await asyncio.wait_for(worker, settings.STOP_DEADLINE_S)
            await gateway.close()
        return events

    try:
        events = asyncio.run(scenario())
    finally:
        Path(coordinator["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0
    assert [item["event"] for item in events] == [{"kind": "fall", "confidence": 0.93}]
    stored = list((folder / "events").glob("*.jsonl"))
    assert len(stored) == 1


def test_the_client_checks_its_arguments_and_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    with pytest.raises(Layer2Error, match="LAYER2_GATEWAY"):
        Layer2.from_env()
    client = Layer2(f"127.0.0.1:{closed_port()}", "t")
    with pytest.raises(ValueError):
        client.read_log()
    with pytest.raises(ValueError):
        client.read_log(since=datetime(2026, 11, 14))
    with pytest.raises(Layer2Error, match="cannot reach"):
        client.read_log(since=datetime.now(UTC) - timedelta(minutes=1))
