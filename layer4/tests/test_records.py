import json
from datetime import UTC, datetime, timedelta, timezone

import pytest

from layer4.events import Event, new_event
from layer4.records import from_record, to_record
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal, Signal

EST = timezone(timedelta(hours=-5))
AT = datetime(2026, 11, 14, 3, 12, 45, 123456, tzinfo=UTC)

SIGNALS: list[Signal] = [
    FallSignal(confidence=0.91, detected_at=AT.astimezone(EST)),
    HelpSignal(is_call_for_help=True, detected_at=AT),
    HeartRateSignal(bpm=142, measured_at=AT),
    MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=AT + timedelta(seconds=31)),
]


@pytest.mark.parametrize("signal", SIGNALS, ids=["fall", "help", "heart_rate", "monitoring"])
def test_a_record_survives_json_and_comes_back_equal(signal: Signal) -> None:
    event = Event(event_id="e-1", signal=signal, occurred_at=AT, alert_id="a-1")
    record = json.loads(json.dumps(to_record(event)))
    back = from_record(record)
    assert back.event_id == event.event_id
    assert back.alert_id == event.alert_id
    assert back.occurred_at == event.occurred_at
    assert back.signal == event.signal


def test_a_record_has_the_expected_shape() -> None:
    record = to_record(new_event(HeartRateSignal(bpm=142, measured_at=AT), None))
    assert record["schema_version"] == 1
    assert record["type"] == "event"
    assert record["kind"] == "heart_rate"
    assert record["occurred_at"] == "2026-11-14T03:12:45.123456Z"
    assert record["alert_id"] is None
    assert record["details"] == {"bpm": 142, "measured_at": "2026-11-14T03:12:45.123456Z"}


def good() -> dict[str, object]:
    return to_record(new_event(FallSignal(confidence=0.5, detected_at=AT), None))


@pytest.mark.parametrize(
    "change",
    [
        {"schema_version": 2},
        {"type": "alert"},
        {"kind": "dance"},
        {"event_id": 7},
        {"alert_id": 7},
        {"details": "nope"},
        {"details": {"confidence": "0.5", "detected_at": "2026-11-14T03:12:45Z"}},
        {"details": {"confidence": 1.5, "detected_at": "2026-11-14T03:12:45Z"}},
        {"details": {"confidence": 0.5, "detected_at": "2026-11-14T03:12:45"}},
        {"details": {"confidence": 0.5}},
        {"occurred_at": "yesterday"},
    ],
    ids=[
        "schema",
        "type",
        "kind",
        "event_id",
        "alert_id",
        "details",
        "confidence_text",
        "confidence_range",
        "naive_time",
        "missing_time",
        "bad_time",
    ],
)
def test_a_bad_record_raises_value_error(change: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        from_record({**good(), **change})


def test_a_record_missing_a_field_raises_value_error() -> None:
    record = good()
    del record["kind"]
    with pytest.raises(ValueError, match="kind"):
        from_record(record)
