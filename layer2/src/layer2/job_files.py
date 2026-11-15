"""Reading the job folders Layers 3 and 4 provide (contracts/job.json).

Jobs live at `<repo>/layer3/jobs/<name>/job.json` and `<repo>/layer4/jobs/<name>/job.json`. A
file that cannot be read, does not match the contract, or whose `name` is not its folder's
name is skipped with a warning; so is a name both layers use. Nothing here ever stops the
coordinator or a worker. Blocking file reads: from async code call through
`asyncio.to_thread`.
"""

import logging
from pathlib import Path

from layer2.contracts import JobDescription
from layer2.coordinator.plan import JobNeed
from layer2.files import ConfigError, load_json_model
from layer2.worker.jobs import JobSpec

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
_JOB_LAYERS = ("layer3", "layer4")


def find_jobs(repo: Path = REPO_ROOT) -> dict[str, tuple[JobDescription, Path]]:
    """Every valid job description, with its folder, by name."""
    found: dict[str, tuple[JobDescription, Path]] = {}
    clashes: set[str] = set()
    for layer in _JOB_LAYERS:
        for path in sorted((repo / layer / "jobs").glob("*/job.json")):
            try:
                job = load_json_model(path, JobDescription)
            except ConfigError as error:
                log.warning("L2: skipped a job: %s", error)
                continue
            if job.name != path.parent.name:
                log.warning("L2: skipped %s: its name is %r, not its folder's", path, job.name)
                continue
            if job.name in found:
                clashes.add(job.name)
                continue
            found[job.name] = (job, path.parent)
    for name in sorted(clashes):
        log.warning("L2: skipped job %s: both layers have a job by that name", name)
        found.pop(name, None)
    return found


def job_needs(repo: Path = REPO_ROOT) -> list[JobNeed]:
    """What the planner places: every always-on job. Per-item jobs are for fan-out."""
    return [
        JobNeed(job.name, job.memory_gb, job.sensor)
        for job, _ in find_jobs(repo).values()
        if job.kind == "always-on"
    ]


class JobCatalog:
    """The worker's catalog: a job's name to the program to run, read when the job starts."""

    def __init__(self, repo: Path = REPO_ROOT) -> None:
        self._repo = repo

    def __call__(self, name: str) -> JobSpec | None:
        entry = find_jobs(self._repo).get(name)
        if entry is None:
            return None
        job, folder = entry
        return JobSpec(name=job.name, command=tuple(job.start_command), folder=folder)
