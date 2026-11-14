import asyncio
import json
import logging
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.contracts import MissingItem
from layer2.worker.client import WorkerState, run_worker

TOKEN: str = contract("hello.json")["token"]


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)


class Coordinator:
    def __init__(self, tmp_path: Path) -> None:
        folder = tmp_path / "coordinator"
        folder.mkdir()
        self.config_path = write_coordinator_config(folder)
        self.config = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.running: Running | None = None

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.config['listen_port']}/ws"

    def start(self) -> None:
        self.running = Running(self.config_path)
        wait_until_serving(self.config["dashboard_port"])

    def stop(self) -> None:
        if self.running is not None:
            Path(self.config["stop_file"]).touch()
            assert self.running.wait(settings.STOP_DEADLINE_S) == 0
            self.running = None

    def laptops(self) -> list[dict[str, Any]]:
        port = self.config["dashboard_port"]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2) as reply:
            laptops: list[dict[str, Any]] = json.load(reply)["laptops"]
        return laptops


@pytest.fixture
def coordinator(tmp_path: Path) -> Iterator[Coordinator]:
    running = Coordinator(tmp_path)
    yield running
    running.stop()


def write_worker_config(tmp_path: Path, coordinator_url: str, token: str = TOKEN) -> Path:
    folder = tmp_path / "worker"
    folder.mkdir(exist_ok=True)
    token_file = folder / "worker-token"
    token_file.write_text(token, encoding="utf-8")
    data = {
        **contract("worker.json"),
        "coordinator_url": coordinator_url,
        "token_file": str(token_file),
        "ollama_url": f"http://127.0.0.1:{closed_port()}",
        "python": str(folder / "python"),
        "status_file": str(folder / "worker-status.json"),
        "stop_file": str(folder / "worker.stop"),
        "state_dir": str(folder),
    }
    path = folder / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class Reports:
    """Every state the client reported, in order."""

    def __init__(self) -> None:
        self.seen: list[tuple[WorkerState, list[MissingItem]]] = []

    async def __call__(self, state: WorkerState, missing: list[MissingItem]) -> None:
        self.seen.append((state, missing))

    def states(self) -> list[WorkerState]:
        return [state for state, _ in self.seen]


async def wait_for(condition: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.05)


async def run_until(
    config: Path, reports: Reports, done: Callable[[], bool], token: str = TOKEN
) -> tuple[str, float]:
    """Run the client until `done()`, then stop it; return its outcome and stop time."""
    stop = asyncio.Event()
    task = asyncio.create_task(run_worker(config, token, reports, stop))
    try:
        await wait_for(lambda: done() or task.done())
    finally:
        stop.set()
    loop = asyncio.get_running_loop()
    started = loop.time()
    outcome = await asyncio.wait_for(task, settings.STOP_DEADLINE_S)
    return outcome, loop.time() - started


def test_joins_and_reports_load(tmp_path: Path, coordinator: Coordinator) -> None:
    coordinator.start()
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url)

    def reported_twice() -> bool:
        laptops = coordinator.laptops()
        return bool(laptops) and len(reports.seen) >= 1

    async def scenario() -> None:
        outcome, stop_took = await run_until(config, reports, reported_twice)
        assert outcome == "stopped"
        assert stop_took < 2.0

    asyncio.run(scenario())
    state, missing = reports.seen[0]
    assert state == "connected"
    assert [item.id for item in missing] == ["ollama"]
    [laptop] = coordinator.laptops()
    assert laptop["node_id"] == contract("accepted-workers.json")["workers"][0]["node_id"]


def test_unknown_token_is_rejected(tmp_path: Path, coordinator: Coordinator) -> None:
    coordinator.start()
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url, token="f" * 64)

    async def scenario() -> None:
        outcome = await asyncio.wait_for(run_worker(config, "f" * 64, reports, asyncio.Event()), 10)
        assert outcome == "rejected"

    asyncio.run(scenario())
    assert reports.states() == ["rejected"]


def test_waits_for_a_late_coordinator(tmp_path: Path, coordinator: Coordinator) -> None:
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url)

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, reports, stop))
        await wait_for(lambda: reports.states().count("disconnected") >= 2)
        await asyncio.to_thread(coordinator.start)
        await wait_for(lambda: "connected" in reports.states())
        stop.set()
        assert await asyncio.wait_for(task, settings.STOP_DEADLINE_S) == "stopped"

    asyncio.run(scenario())
    assert reports.states()[0] == "disconnected"


def test_reconnects_after_the_coordinator_restarts(
    tmp_path: Path, coordinator: Coordinator
) -> None:
    coordinator.start()
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url)

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, reports, stop))
        await wait_for(lambda: reports.states() == ["connected"])
        await asyncio.to_thread(coordinator.stop)
        await wait_for(lambda: "disconnected" in reports.states())
        await asyncio.to_thread(coordinator.start)
        await wait_for(lambda: reports.states().count("connected") == 2)
        stop.set()
        assert await asyncio.wait_for(task, settings.STOP_DEADLINE_S) == "stopped"

    asyncio.run(scenario())


def test_rereads_the_coordinator_url_before_each_try(
    tmp_path: Path, coordinator: Coordinator
) -> None:
    coordinator.start()
    reports = Reports()
    config = write_worker_config(tmp_path, f"ws://127.0.0.1:{closed_port()}/ws")

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, reports, stop))
        await wait_for(lambda: "disconnected" in reports.states())
        data = json.loads(config.read_text(encoding="utf-8"))
        config.write_text(json.dumps({**data, "coordinator_url": coordinator.url}), "utf-8")
        await wait_for(lambda: "connected" in reports.states())
        stop.set()
        assert await asyncio.wait_for(task, settings.STOP_DEADLINE_S) == "stopped"

    asyncio.run(scenario())


def test_bad_config_while_running_counts_as_disconnected(
    tmp_path: Path, coordinator: Coordinator
) -> None:
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url)
    config.write_text("{", encoding="utf-8")

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(config, TOKEN, reports, stop))
        await wait_for(lambda: reports.states().count("disconnected") >= 2)
        stop.set()
        assert await asyncio.wait_for(task, settings.STOP_DEADLINE_S) == "stopped"

    asyncio.run(scenario())


def test_token_never_reaches_the_log(
    tmp_path: Path, coordinator: Coordinator, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    coordinator.start()
    reports = Reports()
    config = write_worker_config(tmp_path, coordinator.url)

    async def scenario() -> None:
        await run_until(config, reports, lambda: "connected" in reports.states())

    asyncio.run(scenario())
    assert TOKEN[:16] not in caplog.text
