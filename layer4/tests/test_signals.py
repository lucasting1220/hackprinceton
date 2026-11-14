from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from layer4.settings import RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal

AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
NAIVE = datetime(2026, 11, 14, 3, 12)


@pytest.mark.parametrize("confidence", [1.2, -0.1, float("nan")])
def test_fall_confidence_outside_zero_to_one_is_rejected(confidence: float) -> None:
    with pytest.raises(ValueError, match="confidence"):
        FallSignal(confidence=confidence, detected_at=AT)


@pytest.mark.parametrize("confidence", [0.0, 1.0])
def test_fall_confidence_at_the_ends_is_accepted(confidence: float) -> None:
    assert FallSignal(confidence=confidence, detected_at=AT).confidence == confidence


def test_fall_confidence_bool_is_rejected() -> None:
    with pytest.raises(ValueError, match="confidence"):
        FallSignal(confidence=True, detected_at=AT)


@pytest.mark.parametrize("bpm", [0, -5])
def test_heart_rate_not_above_zero_is_rejected(bpm: int) -> None:
    with pytest.raises(ValueError, match="bpm"):
        HeartRateSignal(bpm=bpm, measured_at=AT)


def test_heart_rate_bool_is_rejected() -> None:
    with pytest.raises(ValueError, match="bpm"):
        HeartRateSignal(bpm=True, measured_at=AT)


def test_monitoring_empty_what_stopped_is_rejected() -> None:
    with pytest.raises(ValueError, match="what_stopped"):
        MonitoringSignal(what_stopped="  ", stopped_at=AT, checked_at=AT)


def test_monitoring_checked_before_stopped_is_rejected() -> None:
    with pytest.raises(ValueError, match="checked_at"):
        MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=AT - timedelta(seconds=1))


@pytest.mark.parametrize(
    "build",
    [
        lambda: FallSignal(confidence=0.9, detected_at=NAIVE),
        lambda: HelpSignal(is_call_for_help=True, detected_at=NAIVE),
        lambda: HeartRateSignal(bpm=80, measured_at=NAIVE),
        lambda: MonitoringSignal(what_stopped="camera", stopped_at=NAIVE, checked_at=AT),
        lambda: MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=NAIVE),
    ],
    ids=["fall", "help", "heart_rate", "monitoring_stopped_at", "monitoring_checked_at"],
)
def test_naive_time_is_rejected(build: Callable[[], object]) -> None:
    with pytest.raises(ValueError, match="time zone"):
        build()


def test_default_thresholds_are_the_proposed_values() -> None:
    thresholds = RuleThresholds()
    assert thresholds.fall_confidence_min == 0.8
    assert thresholds.heart_rate_high_bpm == 130
    assert thresholds.heart_rate_low_bpm == 40
    assert thresholds.monitoring_stopped_after == timedelta(seconds=30)


@pytest.mark.parametrize(("low", "high"), [(130, 130), (140, 130)])
def test_thresholds_low_not_below_high_is_rejected(low: int, high: int) -> None:
    with pytest.raises(ValueError, match="heart_rate_low_bpm"):
        RuleThresholds(heart_rate_low_bpm=low, heart_rate_high_bpm=high)


@pytest.mark.parametrize("minimum", [1.1, -0.1, float("nan")])
def test_thresholds_fall_minimum_outside_zero_to_one_is_rejected(minimum: float) -> None:
    with pytest.raises(ValueError, match="fall_confidence_min"):
        RuleThresholds(fall_confidence_min=minimum)


@pytest.mark.parametrize("wait", [timedelta(0), timedelta(seconds=-1)])
def test_thresholds_wait_not_positive_is_rejected(wait: timedelta) -> None:
    with pytest.raises(ValueError, match="monitoring_stopped_after"):
        RuleThresholds(monitoring_stopped_after=wait)
