import asyncio
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.coordinator import main as coordinator_main
from layer2.coordinator.plan import JobNeed
from layer2.worker.client import run_worker
from layer2.worker.jobs import JobControl, JobRunner, JobSpec

RULES = JobNeed("care_rules", 0.5, None)
FALL = JobNeed("fall_model", 2.0, "camera")

# End to end: the real coordinator plans a job and the real worker client runs it.

TOKEN: str = contract("hello.json")["token"]


def api_state(port: int) -> dict[str, Any]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2) as reply:
        state: dict[str, Any] = json.load(reply)
    return state


def test_the_coordinator_starts_a_planned_job_on_a_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)
    monkeypatch.setattr(coordinator_main, "_job_needs", lambda: [RULES, FALL])
    folder = tmp_path / "coordinator"
    folder.mkdir()
    config_path = write_coordinator_config(folder)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    coordinator = Running(config_path)
    wait_until_serving(config["dashboard_port"])

    job_folder = tmp_path / "care_rules"
    job_folder.mkdir()
    code = "import pathlib, time; pathlib.Path('started').touch(); time.sleep(60)"
    spec = JobSpec("care_rules", (sys.executable, "-c", code), job_folder)
    jobs = JobControl(JobRunner(tmp_path / "logs", {}), {"care_rules": spec}.get)
    (tmp_path / "worker-token").write_text(TOKEN, encoding="utf-8")
    worker_config = tmp_path / "worker.json"
    worker = {
        **contract("worker.json"),
        "camera": None,
        "mic": None,
        "coordinator_url": f"ws://127.0.0.1:{config['listen_port']}/ws",
        "token_file": str(tmp_path / "worker-token"),
        "ollama_url": f"http://127.0.0.1:{closed_port()}",
        "python": str(tmp_path / "python"),
        "status_file": str(tmp_path / "worker-status.json"),
        "stop_file": str(tmp_path / "worker.stop"),
        "state_dir": str(tmp_path),
    }
    worker_config.write_text(json.dumps(worker), encoding="utf-8")

    async def no_report(state: str, missing: object) -> None:
        return

    async def scenario() -> dict[str, Any]:
        stop = asyncio.Event()
        task = asyncio.create_task(run_worker(worker_config, TOKEN, no_report, stop, jobs))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 10
        state = api_state(config["dashboard_port"])
        while state["jobs"] != [
            {"job": "care_rules", "node_id": worker["node_id"], "state": "running"}
        ]:
            assert loop.time() < deadline, state
            await asyncio.sleep(0.05)
            state = await asyncio.to_thread(api_state, config["dashboard_port"])
        stop.set()
        await asyncio.wait_for(task, settings.STOP_DEADLINE_S)
        return state

    try:
        state = asyncio.run(scenario())
    finally:
        Path(config["stop_file"]).touch()
        assert coordinator.wait(settings.STOP_DEADLINE_S) == 0
    assert (job_folder / "started").exists()
    assert [item["work"] for item in state["dropped"]] == ["fall_model"]
