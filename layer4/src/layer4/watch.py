"""Watch readings from Layer 3 (contracts/watch-reading.json): one new reading per message.

A heart-rate reading becomes the HeartRateSignal the rules judge. Sleep and steps are kept for
live status; they never alert. A message that breaks the contract raises ValueError naming
what is wrong, so the caller can skip it and go on.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime

from layer4.settings import EARLIEST_SIGNAL_TIME, LATEST_SIGNAL_TIME
from layer4.signals import HeartRateSignal

_COMMON = {"schema_version", "type", "kind", "last_received_at"}
_FIELDS = {
    "heart_rate": {"measured_at", "bpm"},
    "sleep": {"night_of", "asleep_minutes", "bedtime_at", "wake_at", "interruptions"},
    "steps": {"measured_at", "steps_today"},
}


@dataclass(frozen=True)
class SleepRecord:
    night_of: date
    asleep_minutes: int
    bedtime_at: datetime
    wake_at: datetime
    interruptions: int


@dataclass(frozen=True)
class StepsCount:
    measured_at: datetime
    steps_today: int


WatchReading = HeartRateSignal | SleepRecord | StepsCount


@dataclass(frozen=True)
class Received:
    reading: WatchReading
    last_received_at: datetime


def _time(message: Mapping[str, object], name: str) -> datetime:
    value = message[name]
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"{name} must be a UTC time ending in Z, got {value!r}")
    try:
        moment = datetime.fromisoformat(value)
    except ValueError as err:
        raise ValueError(f"{name} is not an ISO 8601 time: {value!r}") from err
    if not EARLIEST_SIGNAL_TIME <= moment.astimezone(UTC) <= LATEST_SIGNAL_TIME:
        raise ValueError(f"{name} is out of range, got {value!r}")
    return moment


def _count(message: Mapping[str, object], name: str, lowest: int) -> int:
    value = message[name]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be a whole number, got {value!r}")
    if value < lowest:
        raise ValueError(f"{name} must be at least {lowest}, got {value!r}")
    return value


def _night(message: Mapping[str, object]) -> date:
    value = message["night_of"]
    if not isinstance(value, str):
        raise ValueError(f"night_of must be a YYYY-MM-DD date, got {value!r}")
    try:
        night = date.fromisoformat(value)
    except ValueError as err:
        raise ValueError(f"night_of must be a YYYY-MM-DD date, got {value!r}") from err
    if not EARLIEST_SIGNAL_TIME.date() <= night <= LATEST_SIGNAL_TIME.date():
        raise ValueError(f"night_of is out of range, got {value!r}")
    return night


def parse_reading(message: Mapping[str, object]) -> Received:
    """The reading in one message. Raises ValueError if it breaks the contract."""
    if message.get("schema_version") != 1 or message.get("type") != "watch_reading":
        raise ValueError("not a version 1 watch_reading message")
    kind = message.get("kind")
    if not isinstance(kind, str) or kind not in _FIELDS:
        raise ValueError(f"kind must be heart_rate, sleep or steps, got {kind!r}")
    expected = _COMMON | _FIELDS[kind]
    if set(message) != expected:
        missing = sorted(expected - set(message))
        extra = sorted(set(message) - expected)
        raise ValueError(f"{kind} reading has missing fields {missing} and unknown fields {extra}")
    reading: WatchReading
    if kind == "heart_rate":
        reading = HeartRateSignal(
            bpm=_count(message, "bpm", 1), measured_at=_time(message, "measured_at")
        )
    elif kind == "sleep":
        reading = SleepRecord(
            night_of=_night(message),
            asleep_minutes=_count(message, "asleep_minutes", 0),
            bedtime_at=_time(message, "bedtime_at"),
            wake_at=_time(message, "wake_at"),
            interruptions=_count(message, "interruptions", 0),
        )
    else:
        reading = StepsCount(
            measured_at=_time(message, "measured_at"),
            steps_today=_count(message, "steps_today", 0),
        )
    return Received(reading=reading, last_received_at=_time(message, "last_received_at"))
