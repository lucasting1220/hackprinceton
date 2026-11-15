"""Layer 4 live status (contracts/live-status.json): the latest readings for the care screen.

Built from the health check's latest readings. Each part carries the time its reading was
taken, so the app can show its age. The heart-rate trend compares the latest reading with the
one before it. Activity is what the fall model last logged, null until it has logged one.
"""

from datetime import UTC, datetime, timedelta

from layer4 import settings
from layer4.health_check import LatestHealth
from layer4.signals import HeartRateSignal


def _utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def heart_trend(
    latest: HeartRateSignal,
    before: HeartRateSignal | None,
    steady_bpm: int = settings.HEART_TREND_STEADY_BPM,
) -> str | None:
    """rising, falling or steady against the reading before; None with only one reading."""
    if before is None:
        return None
    change = latest.bpm - before.bpm
    if abs(change) <= steady_bpm:
        return "steady"
    return "rising" if change > 0 else "falling"


def live_status(
    latest: LatestHealth,
    now: datetime,
    no_heart_data_after: timedelta = settings.NO_HEART_DATA_AFTER,
) -> dict[str, object]:
    """The live status message for the latest readings, as of `now`."""
    heart = latest.heart_rate
    heart_part: dict[str, object] | None = None
    if heart is not None:
        heart_part = {
            "bpm": heart.bpm,
            "at": _utc(heart.measured_at),
            "trend": heart_trend(heart, latest.heart_rate_before),
        }
    sleep = latest.sleep
    sleep_part: dict[str, object] | None = None
    if sleep is not None:
        sleep_part = {
            "night_of": sleep.night_of.isoformat(),
            "asleep_minutes": sleep.asleep_minutes,
            "bedtime_at": _utc(sleep.bedtime_at),
            "wake_at": _utc(sleep.wake_at),
            "interruptions": sleep.interruptions,
        }
    steps = latest.steps
    steps_part: dict[str, object] | None = None
    if steps is not None:
        steps_part = {"steps_today": steps.steps_today, "at": _utc(steps.measured_at)}
    activity_part: dict[str, object] | None = None
    if latest.activity is not None and latest.activity_since is not None:
        activity_part = {"state": latest.activity.value, "at": _utc(latest.activity_since)}
    no_heart_data = heart is None or now - heart.measured_at > no_heart_data_after
    return {
        "schema_version": 1,
        "type": "live_status",
        "activity": activity_part,
        "heart_rate": heart_part,
        "sleep": sleep_part,
        "steps": steps_part,
        "no_heart_data": no_heart_data,
    }
