import json
import logging
from pathlib import Path
from typing import Any

import pytest
from conftest import contract

from layer2.contracts import JobDescription
from layer2.coordinator.plan import JobNeed
from layer2.job_files import JobCatalog, find_jobs, job_needs
from layer2.worker.jobs import JobSpec

EXAMPLE = contract("job.json")


def test_the_contract_example_matches_the_model() -> None:
    job = JobDescription.model_validate(EXAMPLE)
    assert set(job.model_dump()) == set(EXAMPLE)


def write_job(repo: Path, layer: str, folder: str, **changes: Any) -> Path:
    path = repo / layer / "jobs" / folder / "job.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({**EXAMPLE, "name": folder, **changes}), encoding="utf-8")
    return path.parent


def test_jobs_from_both_layers_become_needs_and_runnable_specs(tmp_path: Path) -> None:
    capture = write_job(tmp_path, "layer3", "capture", memory_gb=0.5)
    write_job(tmp_path, "layer4", "care_rules", sensor=None, memory_gb=0.5)
    write_job(tmp_path, "layer4", "report_block", kind="per-item", sensor=None)
    assert sorted(job_needs(tmp_path), key=lambda need: need.name) == [
        JobNeed("capture", 0.5, "camera"),
        JobNeed("care_rules", 0.5, None),
    ]
    assert JobCatalog(tmp_path)("capture") == JobSpec(
        name="capture", command=tuple(EXAMPLE["start_command"]), folder=capture
    )
    assert JobCatalog(tmp_path)("missing") is None


@pytest.mark.parametrize(
    ("folder", "changes", "why"),
    [
        ("fall_model", {"name": "other"}, "not its folder's"),
        ("fall_model", {"kind": "sometimes"}, "is not valid"),
        ("fall_model", {"start_command": []}, "is not valid"),
        ("Bad-Name", {}, "is not valid"),
    ],
)
def test_bad_job_files_are_skipped_with_a_warning(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, folder: str, changes: dict[str, Any], why: str
) -> None:
    write_job(tmp_path, "layer4", folder, **changes)
    with caplog.at_level(logging.WARNING):
        assert find_jobs(tmp_path) == {}
    assert why in caplog.text


def test_a_name_both_layers_use_is_skipped(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    write_job(tmp_path, "layer3", "fall_model")
    write_job(tmp_path, "layer4", "fall_model")
    write_job(tmp_path, "layer4", "care_rules", sensor=None)
    with caplog.at_level(logging.WARNING):
        assert list(find_jobs(tmp_path)) == ["care_rules"]
    assert "both layers" in caplog.text


def test_no_job_folders_means_no_jobs(tmp_path: Path) -> None:
    assert find_jobs(tmp_path) == {}
