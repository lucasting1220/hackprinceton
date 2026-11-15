import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fakes import FakeEventLog, FakePhone

from layer4.health_check import HealthCheck, LatestHealth
from layer4.settings import RuleThresholds
from layer4.signals import HeartRateSignal
from layer4.upper_tier import UpperTier
from layer4.watch import SleepRecord, StepsCount, parse_reading

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "watch-reading.json"
RECEIVED = "2026-11-14T11:30:00Z"


def contract_example() -> dict[str, object]:
    example: dict[str, object] = json.loads(CONTRACT.read_text(encoding="utf-8"))
    return example


def heart_rate(bpm: object = 72) -> dict[str, object]:
    return {**contract_example(), "bpm": bpm}


def sleep() -> dict[str, object]:
    return {
        "schema_version": 1,
        "type": "watch_reading",
        "kind": "sleep",
        "night_of": "2026-11-13",
        "asleep_minutes": 412,
        "bedtime_at": "2026-11-14T03:40:00Z",
        "wake_at": "2026-11-14T11:05:00Z",
        "interruptions": 2,
        "last_received_at": RECEIVED,
    }


def steps() -> dict[str, object]:
    return {
        "schema_version": 1,
        "type": "watch_reading",
        "kind": "steps",
        "measured_at": "2026-11-14T11:20:00Z",
        "steps_today": 230,
        "last_received_at": RECEIVED,
    }


def test_the_contract_example_reads_as_a_heart_rate_signal() -> None:
    received = parse_reading(contract_example())
    assert received.reading == HeartRateSignal(
        bpm=72, measured_at=datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
    )
    assert received.last_received_at == datetime(2026, 11, 14, 3, 13, tzinfo=UTC)


def test_sleep_and_steps_read_with_every_contract_field() -> None:
    assert parse_reading(sleep()).reading == SleepRecord(
        night_of=date(2026, 11, 13),
        asleep_minutes=412,
        bedtime_at=datetime(2026, 11, 14, 3, 40, tzinfo=UTC),
        wake_at=datetime(2026, 11, 14, 11, 5, tzinfo=UTC),
        interruptions=2,
    )
    assert parse_reading(steps()).reading == StepsCount(
        measured_at=datetime(2026, 11, 14, 11, 20, tzinfo=UTC), steps_today=230
    )


def without(message: dict[str, object], name: str) -> dict[str, object]:
    return {key: value for key, value in message.items() if key != name}


@pytest.mark.parametrize(
    "message",
    [
        without(contract_example(), "bpm"),
        {**contract_example(), "spo2": 98},
        {**contract_example(), "kind": "blood_pressure"},
        {**contract_example(), "type": "watch_data"},
        {**contract_example(), "schema_version": 2},
        heart_rate(0),
        heart_rate(72.0),
        heart_rate(True),
        heart_rate("72"),
        {**contract_example(), "measured_at": "2026-11-14T03:12:45+00:00"},
        {**contract_example(), "measured_at": "yesterday Z"},
        {**contract_example(), "measured_at": "1969-12-31T00:00:00Z"},
        {**sleep(), "night_of": "13/11/2026"},
        {**sleep(), "night_of": 20261113},
        {**steps(), "steps_today": -1},
        {**steps(), "steps_today": True},
        {**steps(), "measured_at": "1969-12-31T00:00:00Z"},
        {**steps(), "last_received_at": "3000-01-01T00:00:00Z"},
    ],
    ids=[
        "missing-bpm",
        "unknown-field",
        "unknown-kind",
        "wrong-type",
        "version-2",
        "bpm-zero",
        "bpm-decimal",
        "bpm-bool",
        "bpm-text",
        "time-not-Z",
        "time-not-iso",
        "time-too-early",
        "night-bad-format",
        "night-not-text",
        "steps-negative",
        "steps-bool",
        "steps-time-too-early",
        "received-too-late",
    ],
)
def test_a_message_that_breaks_the_contract_is_refused(message: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        parse_reading(message)


def build() -> tuple[HealthCheck, FakeEventLog, FakePhone]:
    log, phone = FakeEventLog(), FakePhone()
    return HealthCheck(UpperTier(RuleThresholds(), log, phone)), log, phone


@pytest.mark.parametrize("bpm", [145, 35])
def test_a_heart_rate_outside_the_limits_alerts_and_is_logged(bpm: int) -> None:
    check, log, phone = build()
    check.on_message(heart_rate(bpm))
    assert [alert.kind for alert in phone.alerts] == ["heart_rate"]
    assert str(bpm) in phone.alerts[0].body
    assert len(log.events) == 1


def test_a_normal_heart_rate_is_logged_without_an_alert() -> None:
    check, log, phone = build()
    check.on_message(heart_rate(72))
    assert phone.alerts == []
    assert len(log.events) == 1


def test_sleep_and_steps_are_kept_for_live_status_and_never_alert() -> None:
    check, log, phone = build()
    check.on_message(heart_rate(72))
    check.on_message(sleep())
    check.on_message(steps())
    latest = check.latest
    assert latest.heart_rate is not None and latest.heart_rate.bpm == 72
    assert latest.sleep is not None and latest.sleep.asleep_minutes == 412
    assert latest.steps is not None and latest.steps.steps_today == 230
    assert latest.last_received_at == datetime(2026, 11, 14, 11, 30, tzinfo=UTC)
    assert phone.alerts == []
    assert len(log.events) == 1


def test_a_bad_message_is_counted_and_the_next_one_still_read() -> None:
    check, log, phone = build()
    check.on_message(heart_rate(0))
    check.on_message(heart_rate(150))
    assert check.refused == 1
    assert [alert.kind for alert in phone.alerts] == ["heart_rate"]
    assert check.latest != LatestHealth()
