"""Running jobs on a worker: Layer 3's capture and Layer 4's always-on jobs.

Each job is a program started without a shell, in its own folder, with its output appended to
`<log_dir>/<name>.log`. A job that exits on its own, or cannot start, is restarted after
JOB_RESTART_DELAY_S: jobs are meant to run until the coordinator stops them. Stopping
terminates the process and kills it after JOB_STOP_GRACE_S, so the worker can still exit
within STOP_DEADLINE_S. The runner makes no decisions; the coordinator says what to run.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from layer2 import settings
from layer2.contracts import JobStatus

log = logging.getLogger(__name__)

JobState = Literal["starting", "running", "restarting"]


@dataclass(frozen=True)
class JobSpec:
    name: str
    command: tuple[str, ...]
    folder: Path


@dataclass
class _Job:
    spec: JobSpec
    state: JobState
    task: "asyncio.Task[None] | None" = None


class JobRunner:
    def __init__(self, log_dir: Path, env: dict[str, str]) -> None:
        self._log_dir = log_dir
        self._env = env
        self._jobs: dict[str, _Job] = {}

    def states(self) -> dict[str, JobState]:
        return {name: job.state for name, job in self._jobs.items()}

    async def start(self, spec: JobSpec) -> None:
        """Start the job, or do nothing if it is already running with the same spec. A
        different spec under the same name replaces the running one."""
        current = self._jobs.get(spec.name)
        if current is not None:
            if current.spec == spec:
                return
            await self.stop(spec.name)
        job = _Job(spec=spec, state="starting")
        job.task = asyncio.create_task(self._supervise(job), name=f"job {spec.name}")
        self._jobs[spec.name] = job
        log.info("L2 worker: job %s started", spec.name)

    async def stop(self, name: str) -> None:
        job = self._jobs.pop(name, None)
        if job is None or job.task is None:
            return
        job.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await job.task
        log.info("L2 worker: job %s stopped", name)

    async def stop_all(self) -> None:
        await asyncio.gather(*(self.stop(name) for name in list(self._jobs)))

    async def _supervise(self, job: _Job) -> None:
        env = {**os.environ, **self._env, "LAYER2_JOB": job.spec.name}
        while True:
            job.state = "starting"
            await self._run_once(job, env)
            job.state = "restarting"
            await asyncio.sleep(settings.JOB_RESTART_DELAY_S)

    async def _run_once(self, job: _Job, env: dict[str, str]) -> None:
        try:
            self._log_dir.mkdir(parents=True, exist_ok=True)
            output = (self._log_dir / f"{job.spec.name}.log").open("ab")
        except OSError as error:
            log.warning("L2 worker: job %s has no log file: %s", job.spec.name, error)
            return
        with output:
            try:
                process = await asyncio.create_subprocess_exec(
                    *job.spec.command,
                    cwd=job.spec.folder,
                    env=env,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=output,
                    stderr=asyncio.subprocess.STDOUT,
                )
            except OSError as error:
                log.warning("L2 worker: job %s could not start: %s", job.spec.name, error)
                return
            job.state = "running"
            try:
                code = await process.wait()
            except asyncio.CancelledError:
                await _end(process)
                raise
        log.warning("L2 worker: job %s exited with code %s; restarting", job.spec.name, code)


async def _end(process: asyncio.subprocess.Process) -> None:
    """Terminate, then kill if it has not exited after JOB_STOP_GRACE_S."""
    if process.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), settings.JOB_STOP_GRACE_S)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


Catalog = Callable[[str], JobSpec | None]
"""Finds a job by name in this laptop's job folders; None if there is no such job. May block."""


class JobControl:
    """What the coordinator's `start` and `stop` messages act on: the runner plus the catalog
    that turns a job's name into the program to run."""

    def __init__(self, runner: JobRunner, catalog: Catalog) -> None:
        self._runner = runner
        self._catalog = catalog

    async def start(self, name: str) -> None:
        try:
            spec = await asyncio.to_thread(self._catalog, name)
        except OSError as error:
            log.warning("L2 worker: cannot read job %s: %s", name, error)
            return
        if spec is None:
            log.warning("L2 worker: asked to start job %s, which this laptop does not have", name)
            return
        await self._runner.start(spec)

    async def stop(self, name: str) -> None:
        await self._runner.stop(name)

    async def stop_all(self) -> None:
        await self._runner.stop_all()

    def statuses(self) -> list[JobStatus]:
        return [JobStatus(job=name, state=state) for name, state in self._runner.states().items()]
