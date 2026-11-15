"""Layer 4 rules: fixed thresholds that decide, one signal at a time, whether to alert.

No language model is involved and nothing is remembered between calls. A signal below its
threshold returns None and goes to the event log only.
"""

from datetime import UTC, tzinfo
from typing import assert_never

from layer4.alerts import Alert, AlertKind, format_date, format_time, new_alert
from layer4.settings import RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal, Signal


def decide(signal: Signal, thresholds: RuleThresholds, tz: tzinfo | None = None) -> Alert | None:
    """Return the template alert for an urgent signal, or None. tz None means local time."""
    match signal:
        case FallSignal():
            if signal.confidence < thresholds.fall_confidence_min:
                return None
            time = format_time(signal.detected_at, tz)
            return new_alert(
                AlertKind.FALL,
                signal.detected_at,
                "Possible fall",
                f"Possible fall detected at {time}",
            )
        case HelpSignal():
            if not signal.is_call_for_help:
                return None
            time = format_time(signal.detected_at, tz)
            return new_alert(
                AlertKind.HELP,
                signal.detected_at,
                "Call for help",
                f"Call for help heard at {time}",
            )
        case HeartRateSignal():
            if thresholds.heart_rate_low_bpm <= signal.bpm <= thresholds.heart_rate_high_bpm:
                return None
            time = format_time(signal.measured_at, tz)
            date = format_date(signal.measured_at, tz)
            return new_alert(
                AlertKind.HEART_RATE,
                signal.measured_at,
                "Heart rate alert",
                f"Heart rate of {signal.bpm} recorded at {time} on {date}",
            )
        case MonitoringSignal():
            # Subtract in UTC: two times sharing one tzinfo subtract by wall clock.
            stopped_for = signal.checked_at.astimezone(UTC) - signal.stopped_at.astimezone(UTC)
            if stopped_for <= thresholds.monitoring_stopped_after:
                return None
            return new_alert(
                AlertKind.MONITORING,
                signal.stopped_at,
                "Monitoring degraded",
                f"Monitoring is degraded: {signal.what_stopped}",
            )
        case _:
            assert_never(signal)
