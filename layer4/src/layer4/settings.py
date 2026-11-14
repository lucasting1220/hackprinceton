"""Layer 4 settings: the rule thresholds.

The values are the Layer 4 doc's proposed defaults, not medical guidance, and still need
the team's review. Rules read them through RuleThresholds, never as literals.
"""

from dataclasses import dataclass
from datetime import timedelta

from layer4._checks import is_number, is_whole_number

FALL_CONFIDENCE_MIN = 0.8
HEART_RATE_HIGH_BPM = 130
HEART_RATE_LOW_BPM = 40
MONITORING_STOPPED_AFTER = timedelta(seconds=30)


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
