"""Layer 4 event records: how an event is stored in the event log on the coordinator.

Layer 2 stores each record as an opaque JSON object; only Layer 4 writes and reads them, so
this format is Layer 4's own. Times are ISO 8601 in UTC with a Z. A record that does not
parse raises ValueError.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import assert_never

from layer4.events import Event
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal, Signal

RECORD_SCHEMA_VERSION = 1
RECORD_TYPE = "event"


def _utc_text(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _details(signal: Signal) -> tuple[str, dict[str, object]]:
    match signal:
        case FallSignal():
            return "fall", {
                "confidence": signal.confidence,
                "detected_at": _utc_text(signal.detected_at),
            }
        case HelpSignal():
            return "help", {
                "is_call_for_help": signal.is_call_for_help,
                "detected_at": _utc_text(signal.detected_at),
            }
        case HeartRateSignal():
            return "heart_rate", {"bpm": signal.bpm, "measured_at": _utc_text(signal.measured_at)}
        case MonitoringSignal():
            return "monitoring", {
                "what_stopped": signal.what_stopped,
                "stopped_at": _utc_text(signal.stopped_at),
                "checked_at": _utc_text(signal.checked_at),
            }
        case _:
            assert_never(signal)


def to_record(event: Event) -> dict[str, object]:
    kind, details = _details(event.signal)
    return {
        "schema_version": RECORD_SCHEMA_VERSION,
        "type": RECORD_TYPE,
        "event_id": event.event_id,
        "kind": kind,
        "occurred_at": _utc_text(event.occurred_at),
        "alert_id": event.alert_id,
        "details": details,
    }


def _field(record: Mapping[str, object], name: str) -> object:
    if name not in record:
        raise ValueError(f"record has no {name}")
    return record[name]


def _text(record: Mapping[str, object], name: str) -> str:
    value = _field(record, name)
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text, got {value!r}")
    return value


def _time(record: Mapping[str, object], name: str) -> datetime:
    return datetime.fromisoformat(_text(record, name))


def _signal(kind: str, details: Mapping[str, object]) -> Signal:
    if kind == "fall":
        confidence = _field(details, "confidence")
        if not isinstance(confidence, int | float):
            raise ValueError(f"confidence must be a number, got {confidence!r}")
        return FallSignal(confidence=float(confidence), detected_at=_time(details, "detected_at"))
    if kind == "help":
        verdict = _field(details, "is_call_for_help")
        if not isinstance(verdict, bool):
            raise ValueError(f"is_call_for_help must be true or false, got {verdict!r}")
        return HelpSignal(is_call_for_help=verdict, detected_at=_time(details, "detected_at"))
    if kind == "heart_rate":
        bpm = _field(details, "bpm")
        if not isinstance(bpm, int):
            raise ValueError(f"bpm must be a whole number, got {bpm!r}")
        return HeartRateSignal(bpm=bpm, measured_at=_time(details, "measured_at"))
    if kind == "monitoring":
        return MonitoringSignal(
            what_stopped=_text(details, "what_stopped"),
            stopped_at=_time(details, "stopped_at"),
            checked_at=_time(details, "checked_at"),
        )
    raise ValueError(f"unknown event kind {kind!r}")


def from_record(record: Mapping[str, object]) -> Event:
    if _field(record, "schema_version") != RECORD_SCHEMA_VERSION:
        raise ValueError(f"unsupported schema_version {record['schema_version']!r}")
    if _field(record, "type") != RECORD_TYPE:
        raise ValueError(f"not an event record: type {record['type']!r}")
    details = _field(record, "details")
    if not isinstance(details, Mapping):
        raise ValueError("details must be an object")
    alert_id = _field(record, "alert_id")
    if alert_id is not None and not isinstance(alert_id, str):
        raise ValueError(f"alert_id must be text or null, got {alert_id!r}")
    return Event(
        event_id=_text(record, "event_id"),
        signal=_signal(_text(record, "kind"), details),
        occurred_at=_time(record, "occurred_at"),
        alert_id=alert_id,
    )
