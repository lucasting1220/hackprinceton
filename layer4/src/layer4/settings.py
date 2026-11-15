"""Layer 4 settings: the rule thresholds and the signal time range.

The thresholds are the Layer 4 doc's proposed defaults, not medical guidance, and still need
the team's review. Rules read them through RuleThresholds, never as literals. The signal time
range is a platform limit, not a tuning value.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from layer4._checks import is_number, is_whole_number

FALL_CONFIDENCE_MIN = 0.8
HEART_RATE_HIGH_BPM = 130
HEART_RATE_LOW_BPM = 40
MONITORING_STOPPED_AFTER = timedelta(seconds=30)

# Signal times must fall in this range. Alert text turns each time into the laptop's local
# zone through the operating system's clock functions, which fail outside it on Windows.
EARLIEST_SIGNAL_TIME = datetime(1970, 1, 2, tzinfo=UTC)
LATEST_SIGNAL_TIME = datetime(2999, 12, 31, tzinfo=UTC)

# Fall detection: one signal per window carries the window's highest confidence; frames older
# than the age limit are skipped; no reading for the gap means fall detection has stopped.
FALL_SIGNAL_WINDOW = timedelta(seconds=1)
FALL_FRAME_MAX_AGE = timedelta(seconds=2)
FALL_DETECTION_GAP = timedelta(seconds=5)

# Alert rewrite: how much of the event log the quick model sees (proposed in the Layer 4 doc),
# and the longest rewrite the phone is sent; a longer one is dropped and the template stands.
REWRITE_CONTEXT = timedelta(minutes=10)
REWRITE_MAX_CHARS = 300

# Help check: the longest transcript tail the quick model reads, and how long the check may
# keep failing before it counts as stopped.
HELP_TRANSCRIPT_MAX_CHARS = 2000
HELP_CHECK_GAP = timedelta(seconds=5)


@dataclass(frozen=True)
class RuleThresholds:
    """The thresholds the rules compare signals with. Raises ValueError if they make no sense."""

    fall_confidence_min: float = FALL_CONFIDENCE_MIN
    heart_rate_high_bpm: int = HEART_RATE_HIGH_BPM
    heart_rate_low_bpm: int = HEART_RATE_LOW_BPM
    monitoring_stopped_after: timedelta = MONITORING_STOPPED_AFTER

    def __post_init__(self) -> None:
        if not is_number(self.fall_confidence_min) or not 0.0 <= self.fall_confidence_min <= 1.0:
            raise ValueError(
                f"fall_confidence_min must be a number from 0 to 1, "
                f"got {self.fall_confidence_min!r}"
            )
        for name, bpm in (
            ("heart_rate_high_bpm", self.heart_rate_high_bpm),
            ("heart_rate_low_bpm", self.heart_rate_low_bpm),
        ):
            if not is_whole_number(bpm):
                raise ValueError(f"{name} must be a whole number, got {bpm!r}")
        if self.heart_rate_low_bpm >= self.heart_rate_high_bpm:
            raise ValueError(
                f"heart_rate_low_bpm ({self.heart_rate_low_bpm}) must be below "
                f"heart_rate_high_bpm ({self.heart_rate_high_bpm})"
            )
        if not isinstance(
            self.monitoring_stopped_after, timedelta
        ) or self.monitoring_stopped_after <= timedelta(0):
            raise ValueError(
                f"monitoring_stopped_after must be a positive timedelta, "
                f"got {self.monitoring_stopped_after!r}"
            )
