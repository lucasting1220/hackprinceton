"""Layer 4 signals: what the lower tier hands the rules, one signal at a time.

Each signal checks its own values when created and raises ValueError on a bad one, wrong
types included, so the rules never see a malformed signal. Every time must carry a time zone
and fall between EARLIEST_SIGNAL_TIME and LATEST_SIGNAL_TIME. Producers pass plain Python
values: convert model output such as numpy numbers with float(), int() or bool() first.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from layer4._checks import is_number, is_whole_number
from layer4.settings import EARLIEST_SIGNAL_TIME, LATEST_SIGNAL_TIME


def _require_time_zone(name: str, value: datetime) -> None:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError(f"{name} must be a datetime with a time zone, got {value!r}")
    try:
        in_utc = value.astimezone(UTC)
    except OverflowError as err:
        raise ValueError(f"{name} is out of range in UTC, got {value!r}") from err
    if not EARLIEST_SIGNAL_TIME <= in_utc <= LATEST_SIGNAL_TIME:
        raise ValueError(
            f"{name} is out of range ({EARLIEST_SIGNAL_TIME.isoformat()} to "
            f"{LATEST_SIGNAL_TIME.isoformat()}), got {value!r}"
        )


@dataclass(frozen=True)
class FallSignal:
    """The fall model's confidence that the resident has fallen, from 0 to 1."""

    confidence: float
    detected_at: datetime

    def __post_init__(self) -> None:
        if not is_number(self.confidence) or not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence must be a number from 0 to 1, got {self.confidence!r}")
        _require_time_zone("detected_at", self.detected_at)


@dataclass(frozen=True)
class HelpSignal:
    """The help check's verdict on one transcript."""

    is_call_for_help: bool
    detected_at: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.is_call_for_help, bool):
            raise ValueError(
                f"is_call_for_help must be True or False, got {self.is_call_for_help!r}"
            )
        _require_time_zone("detected_at", self.detected_at)


@dataclass(frozen=True)
class HeartRateSignal:
    """One watch heart-rate reading, in beats per minute, with the time it was measured."""

    bpm: int
    measured_at: datetime

    def __post_init__(self) -> None:
        if not is_whole_number(self.bpm) or self.bpm <= 0:
            raise ValueError(f"bpm must be a whole number above 0, got {self.bpm!r}")
        _require_time_zone("measured_at", self.measured_at)


@dataclass(frozen=True)
class MonitoringSignal:
    """The monitoring check's finding that something stopped, and when that was checked."""

    what_stopped: str
    stopped_at: datetime
    checked_at: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.what_stopped, str) or not self.what_stopped.strip():
            raise ValueError(f"what_stopped must name what stopped, got {self.what_stopped!r}")
        _require_time_zone("stopped_at", self.stopped_at)
        _require_time_zone("checked_at", self.checked_at)
        # Compare in UTC: two times sharing one tzinfo compare by wall clock, ignoring offsets.
        if self.checked_at.astimezone(UTC) < self.stopped_at.astimezone(UTC):
            raise ValueError(
                f"checked_at ({self.checked_at.isoformat()}) is before "
                f"stopped_at ({self.stopped_at.isoformat()})"
            )


Signal = FallSignal | HelpSignal | HeartRateSignal | MonitoringSignal
