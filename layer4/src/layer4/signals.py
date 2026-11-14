"""Layer 4 signals: what the lower tier hands the rules, one signal at a time.

Each signal checks its own values when created and raises ValueError on a bad one, so the
rules never see a malformed signal. Every time must carry a time zone.
"""

from dataclasses import dataclass
from datetime import datetime


def _require_time_zone(name: str, value: datetime) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{name} must have a time zone, got a naive datetime")


@dataclass(frozen=True)
class FallSignal:
    """The fall model's confidence that the resident has fallen, from 0 to 1."""

    confidence: float
    detected_at: datetime

    def __post_init__(self) -> None:
        if isinstance(self.confidence, bool) or not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence must be a number from 0 to 1, got {self.confidence!r}")
        _require_time_zone("detected_at", self.detected_at)


@dataclass(frozen=True)
class HelpSignal:
    """The help check's verdict on one transcript."""

    is_call_for_help: bool
    detected_at: datetime

    def __post_init__(self) -> None:
        _require_time_zone("detected_at", self.detected_at)


@dataclass(frozen=True)
class HeartRateSignal:
    """One watch heart-rate reading, in beats per minute, with the time it was measured."""

    bpm: int
    measured_at: datetime

    def __post_init__(self) -> None:
        if isinstance(self.bpm, bool) or self.bpm <= 0:
            raise ValueError(f"bpm must be a whole number above 0, got {self.bpm!r}")
        _require_time_zone("measured_at", self.measured_at)


@dataclass(frozen=True)
class MonitoringSignal:
    """The monitoring check's finding that something stopped, and when that was checked."""

    what_stopped: str
    stopped_at: datetime
    checked_at: datetime

    def __post_init__(self) -> None:
        if not self.what_stopped.strip():
            raise ValueError("what_stopped must name what stopped, got an empty string")
        _require_time_zone("stopped_at", self.stopped_at)
        _require_time_zone("checked_at", self.checked_at)
        if self.checked_at < self.stopped_at:
            raise ValueError(
                f"checked_at ({self.checked_at.isoformat()}) is before "
                f"stopped_at ({self.stopped_at.isoformat()})"
            )


Signal = FallSignal | HelpSignal | HeartRateSignal | MonitoringSignal
