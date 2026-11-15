import importlib.util
import json
from collections.abc import Mapping
from pathlib import Path

import pytest
from fakes import FakeEventLog, FakePhone

from layer2.contracts import JobDescription
from layer2.job_client import Layer2Error
from layer4 import settings
from layer4.health_check import HealthCheck
from layer4.jobs.health_check import main, take_one
from layer4.upper_tier import UpperTier

JOB_FOLDER = Path(__file__).resolve().parents[1] / "jobs" / "health_check"
CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "watch-reading.json"


def build() -> tuple[HealthCheck, FakeEventLog, FakePhone]:
    log, phone = FakeEventLog(), FakePhone()
    return HealthCheck(UpperTier(settings.RuleThresholds(), log, phone)), log, phone


def reading(bpm: int) -> Mapping[str, object]:
    example: dict[str, object] = json.loads(CONTRACT.read_text(encoding="utf-8"))
    return {**example, "bpm": bpm}


def test_a_high_heart_rate_from_layer_2_alerts() -> None:
    check, log, phone = build()
    take_one(check, lambda: reading(150))
    assert [alert.kind for alert in phone.alerts] == ["heart_rate"]
    assert len(log.events) == 1


def test_a_wait_with_no_reading_does_nothing() -> None:
    check, log, phone = build()
    take_one(check, lambda: None)
    assert (log.events, phone.alerts) == ([], [])


def test_when_layer_2_cannot_be_reached_it_waits_before_asking_again() -> None:
    check, log, _ = build()
    waits: list[float] = []

    def unreachable() -> Mapping[str, object] | None:
        raise Layer2Error("cannot reach Layer 2's worker")

    take_one(check, unreachable, sleep=waits.append)
    assert waits == [settings.WATCH_RETRY_S]
    assert log.events == []


def test_outside_a_layer_2_job_main_exits_with_2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    assert main() == 2


def test_the_job_description_is_one_layer_2_accepts_and_starts_this_job() -> None:
    raw = json.loads((JOB_FOLDER / "job.json").read_text(encoding="utf-8"))
    job = JobDescription.model_validate(raw)
    assert job.name == JOB_FOLDER.name
    assert job.sensor is None
    command = job.start_command
    assert importlib.util.find_spec(command[command.index("-m") + 1]) is not None
    assert (JOB_FOLDER / command[command.index("--project") + 1] / "pyproject.toml").is_file()
