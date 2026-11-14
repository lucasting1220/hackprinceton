"""The coordinator's `start` and `stop` messages, acted on by a worker with real child jobs."""

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from conftest import closed_port, contract
from pydantic import ValidationError
from websockets.asyncio.server import ServerConnection, serve

from layer2 import settings
from layer2.contracts import Hello, JobStatus, StartMessage, StatusMessage
from layer2.coordinator.registry import Registry
from layer2.worker.client import run_worker
from layer2.worker.jobs import JobControl, JobRunner, JobSpec

TOKEN: str = contract("hello.json")["token"]
NODE_ID: str = contract("worker.json")["node_id"]
SLEEPER = "import pathlib, time; pathlib.Path('started').touch(); time.sleep(60)"


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.05)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)
    monkeypatch.setattr(settings, "JOB_RESTART_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "JOB_STOP_GRACE_S", 1.0)


def write_worker_config(tmp_path: Path, port: int) -> Path:
    (tmp_path / "worker-token").write_text(TOKEN, encoding="utf-8")
    data = {
        **contract("worker.json"),
        "coordinator_url": f"ws://127.0.0.1:{port}/ws",
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


class ScriptedCoordinator:
    """Welcomes the worker, sends `orders` one at a time when asked, and keeps every status."""

    def __init__(self) -> None:
        self.port = closed_port()
        self.statuses: list[StatusMessage] = []
        self.orders: asyncio.Queue[str] = asyncio.Queue()

    async def handle(self, connection: ServerConnection) -> None:
        await connection.recv()
        welcome = {"type": "welcome", "schema_version": 1, "accepted": True, "node_id": NODE_ID}
        await connection.send(json.dumps(welcome))

        async def send_orders() -> None:
            while True:
                await connection.send(await self.orders.get())

        sender = asyncio.create_task(send_orders())
        try:
            async for text in connection:
                self.statuses.append(StatusMessage.model_validate_json(text))
        finally:
            sender.cancel()

    def jobs(self) -> list[JobStatus]:
        return self.statuses[-1].jobs if self.statuses else []


def order(kind: str, job: str) -> str:
    return json.dumps({"type": kind, "schema_version": 1, "job": job})


async def wait_for(condition: object, timeout: float = 10.0) -> None:
    assert callable(condition)
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.02)


def job_control(tmp_path: Path) -> tuple[JobControl, Path]:
    folder = tmp_path / "jobs" / "fall_model"
    folder.mkdir(parents=True)
    spec = JobSpec(name="fall_model", command=(sys.executable, "-c", SLEEPER), folder=folder)
    catalog = {"fall_model": spec}
    runner = JobRunner(tmp_path / "logs", {"LAYER2_NODE_ID": NODE_ID})
    return JobControl(runner, catalog.get), folder


async def no_report(state: str, missing: object) -> None:
    return


def test_start_and_stop_a_job_and_report_it(tmp_path: Path) -> None:
    jobs, folder = job_control(tmp_path)
    fake = ScriptedCoordinator()
    config = write_worker_config(tmp_path, fake.port)

    async def scenario() -> None:
        stop = asyncio.Event()
        async with serve(fake.handle, "127.0.0.1", fake.port):
            worker = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, jobs))
            await fake.orders.put(order("start", "fall_model"))
            await wait_for(lambda: (folder / "started").exists())
            await wait_for(lambda: fake.jobs() == [JobStatus(job="fall_model", state="running")])
            await fake.orders.put(order("stop", "fall_model"))
            await wait_for(lambda: fake.statuses[-1].jobs == [] and len(fake.statuses) > 3)
            stop.set()
            assert await asyncio.wait_for(worker, settings.STOP_DEADLINE_S) == "stopped"

    asyncio.run(scenario())


def test_stopping_the_worker_stops_its_jobs(tmp_path: Path) -> None:
    jobs, folder = job_control(tmp_path)
    fake = ScriptedCoordinator()
    config = write_worker_config(tmp_path, fake.port)

    async def scenario() -> None:
        stop = asyncio.Event()
        async with serve(fake.handle, "127.0.0.1", fake.port):
            worker = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, jobs))
            await fake.orders.put(order("start", "fall_model"))
            await wait_for(lambda: fake.jobs() == [JobStatus(job="fall_model", state="running")])
            stop.set()
            await asyncio.wait_for(worker, settings.STOP_DEADLINE_S)
        assert jobs.statuses() == []

    asyncio.run(scenario())


def test_jobs_keep_running_while_the_coordinator_is_away(tmp_path: Path) -> None:
    jobs, folder = job_control(tmp_path)
    fake = ScriptedCoordinator()
    config = write_worker_config(tmp_path, fake.port)

    async def scenario() -> None:
        stop = asyncio.Event()
        worker = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, jobs))
        async with serve(fake.handle, "127.0.0.1", fake.port):
            await fake.orders.put(order("start", "fall_model"))
            await wait_for(lambda: fake.jobs() == [JobStatus(job="fall_model", state="running")])
        await asyncio.sleep(0.3)  # the coordinator is gone; the worker is retrying
        assert jobs.statuses() == [JobStatus(job="fall_model", state="running")]
        stop.set()
        await asyncio.wait_for(worker, settings.STOP_DEADLINE_S)

    asyncio.run(scenario())


def test_unknown_jobs_and_bad_messages_are_ignored(tmp_path: Path) -> None:
    jobs, folder = job_control(tmp_path)
    fake = ScriptedCoordinator()
    config = write_worker_config(tmp_path, fake.port)

    async def scenario() -> None:
        stop = asyncio.Event()
        async with serve(fake.handle, "127.0.0.1", fake.port):
            worker = asyncio.create_task(run_worker(config, TOKEN, no_report, stop, jobs))
            await fake.orders.put(order("start", "not_installed"))
            await fake.orders.put(order("start", "../../evil"))
            await fake.orders.put(json.dumps({"type": "start", "command": ["rm", "-rf", "/"]}))
            await fake.orders.put("not json")
            await fake.orders.put(order("start", "fall_model"))
            await wait_for(lambda: fake.jobs() == [JobStatus(job="fall_model", state="running")])
            stop.set()
            await asyncio.wait_for(worker, settings.STOP_DEADLINE_S)

    asyncio.run(scenario())


def test_a_start_message_names_a_job_and_nothing_else() -> None:
    StartMessage.model_validate_json(order("start", "fall_model"))
    for bad in ("../x", "Fall", "", "x" * 65):
        with pytest.raises(ValidationError):
            StartMessage.model_validate_json(order("start", bad))
    with pytest.raises(ValidationError):
        StartMessage.model_validate(
            {"type": "start", "schema_version": 1, "job": "x", "command": ["sh"]}
        )


def test_api_state_lists_the_jobs_each_laptop_reports() -> None:
    registry: Registry[str] = Registry(now=lambda: datetime(2026, 11, 14, tzinfo=UTC))
    hello = Hello.model_validate(contract("hello.json"))
    registry.join("node-1", hello, "conn")
    running = JobStatus(job="fall_model", state="running")
    message = StatusMessage(
        type="status",
        schema_version=1,
        missing=[],
        memory_free_gb=8.0,
        cpu_percent=1.0,
        jobs=[running],
    )
    registry.status("node-1", "conn", message)
    jobs = registry.api_state().model_dump(mode="json")["jobs"]
    assert jobs == [{"job": "fall_model", "node_id": "node-1", "state": "running"}]
    assert set(jobs[0]) == set(contract("api-state.json")["jobs"][0])
    registry.join("node-1", hello, "newer")
    assert registry.api_state().jobs == []
