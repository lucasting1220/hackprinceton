import asyncio
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest

from layer2 import settings
from layer2.worker.jobs import JobRunner, JobSpec


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "JOB_RESTART_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "JOB_STOP_GRACE_S", 1.0)


def python_job(tmp_path: Path, name: str, code: str) -> JobSpec:
    folder = tmp_path / name
    folder.mkdir(exist_ok=True)
    return JobSpec(name=name, command=(sys.executable, "-c", code), folder=folder)


SLEEPER = "import pathlib, time; pathlib.Path('started').touch(); time.sleep(60)"


def run(test: Callable[[], Awaitable[None]]) -> None:
    asyncio.run(asyncio.wait_for(test(), 20))


async def wait_for(condition: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.02)


def test_starts_a_job_in_its_folder_and_logs_its_output(tmp_path: Path) -> None:
    spec = python_job(tmp_path, "fall_model", "print('hello from the job', flush=True); " + SLEEPER)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {"LAYER2_NODE_ID": "node-uuid"})
        await runner.start(spec)
        await wait_for(lambda: (spec.folder / "started").exists())
        assert runner.states() == {"fall_model": "running"}
        await runner.stop_all()
        assert runner.states() == {}

    run(test)
    assert "hello from the job" in (tmp_path / "logs" / "fall_model.log").read_text("utf-8")


def test_the_job_sees_its_environment(tmp_path: Path) -> None:
    code = (
        "import os, pathlib, time; "
        "env = os.environ['LAYER2_JOB'] + ' ' + os.environ['LAYER2_NODE_ID']; "
        "pathlib.Path('env').write_text(env); "
        "time.sleep(60)"
    )
    spec = python_job(tmp_path, "care_rules", code)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {"LAYER2_NODE_ID": "node-uuid"})
        await runner.start(spec)
        await wait_for(lambda: (spec.folder / "env").exists())
        await runner.stop_all()

    run(test)
    assert (spec.folder / "env").read_text("utf-8") == "care_rules node-uuid"


def test_a_job_that_exits_is_restarted(tmp_path: Path) -> None:
    code = (
        "import pathlib; p = pathlib.Path('runs'); "
        "p.write_text(p.read_text() + 'x' if p.exists() else 'x')"
    )
    spec = python_job(tmp_path, "speech_to_text", code)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {})
        await runner.start(spec)
        await wait_for(
            lambda: (
                len((spec.folder / "runs").read_text("utf-8")) >= 3
                if (spec.folder / "runs").exists()
                else False
            )
        )
        assert runner.states()["speech_to_text"] in ("restarting", "starting", "running")
        assert runner.restarts()["speech_to_text"] >= 2
        await runner.stop_all()

    run(test)


def test_a_command_that_cannot_start_is_retried_not_fatal(tmp_path: Path) -> None:
    folder = tmp_path / "capture"
    folder.mkdir()
    spec = JobSpec(name="capture", command=(str(tmp_path / "no-such-program"),), folder=folder)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {})
        await runner.start(spec)
        await wait_for(lambda: runner.states().get("capture") == "restarting")
        await runner.stop("capture")
        assert runner.states() == {}

    run(test)


def test_stop_ends_the_process_within_the_grace_period(tmp_path: Path) -> None:
    ignores_terminate = (
        "import signal, pathlib, time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "pathlib.Path('started').touch(); time.sleep(60)"
    )
    spec = python_job(tmp_path, "stubborn", ignores_terminate)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {})
        await runner.start(spec)
        await wait_for(lambda: (spec.folder / "started").exists())
        loop = asyncio.get_running_loop()
        began = loop.time()
        await runner.stop("stubborn")
        assert loop.time() - began < settings.JOB_STOP_GRACE_S + 2
        assert runner.states() == {}

    run(test)


def test_starting_a_running_job_again_does_not_restart_it(tmp_path: Path) -> None:
    code = (
        "import pathlib, time; p = pathlib.Path('runs'); "
        "p.write_text(p.read_text() + 'x' if p.exists() else 'x'); time.sleep(60)"
    )
    spec = python_job(tmp_path, "fall_model", code)

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {})
        await runner.start(spec)
        await wait_for(lambda: (spec.folder / "runs").exists())
        await runner.start(spec)
        await asyncio.sleep(0.5)
        await runner.stop_all()

    run(test)
    assert (spec.folder / "runs").read_text("utf-8") == "x"


def test_starting_with_a_new_command_replaces_the_old_process(tmp_path: Path) -> None:
    first = python_job(
        tmp_path, "fall_model", "import pathlib, time; pathlib.Path('one').touch(); time.sleep(60)"
    )
    second = JobSpec(
        name="fall_model",
        command=(
            sys.executable,
            "-c",
            "import pathlib, time; pathlib.Path('two').touch(); time.sleep(60)",
        ),
        folder=first.folder,
    )

    async def test() -> None:
        runner = JobRunner(tmp_path / "logs", {})
        await runner.start(first)
        await wait_for(lambda: (first.folder / "one").exists())
        await runner.start(second)
        await wait_for(lambda: (first.folder / "two").exists())
        assert list(runner.states()) == ["fall_model"]
        await runner.stop_all()

    run(test)


def test_stopping_an_unknown_job_does_nothing(tmp_path: Path) -> None:
    async def test() -> None:
        await JobRunner(tmp_path / "logs", {}).stop("nothing")

    run(test)


def test_an_unwritable_log_folder_is_retried_not_fatal(tmp_path: Path) -> None:
    blocker = tmp_path / "logs"
    blocker.write_text("a file where the log folder should be", encoding="utf-8")
    spec = python_job(tmp_path, "fall_model", SLEEPER)

    async def test() -> None:
        runner = JobRunner(blocker, {})
        await runner.start(spec)
        await wait_for(lambda: runner.states().get("fall_model") == "restarting")
        blocker.unlink()
        await wait_for(lambda: (spec.folder / "started").exists())
        assert runner.states() == {"fall_model": "running"}
        await runner.stop_all()

    run(test)
