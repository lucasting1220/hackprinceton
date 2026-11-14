from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from typing import cast

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


@pytest.mark.parametrize("bpm", [72.5, float("nan"), float("inf"), "72", None])
def test_heart_rate_not_a_whole_number_is_rejected(bpm: object) -> None:
    with pytest.raises(ValueError, match="bpm"):
        HeartRateSignal(bpm=cast(int, bpm), measured_at=AT)


def test_heart_rate_of_one_is_accepted() -> None:
    assert HeartRateSignal(bpm=1, measured_at=AT).bpm == 1


@pytest.mark.parametrize("confidence", ["0.9", None])
def test_fall_confidence_not_a_number_is_rejected(confidence: object) -> None:
    with pytest.raises(ValueError, match="confidence"):
        FallSignal(confidence=cast(float, confidence), detected_at=AT)


@pytest.mark.parametrize("verdict", ["false", 1, None])
def test_help_verdict_not_a_bool_is_rejected(verdict: object) -> None:
    with pytest.raises(ValueError, match="is_call_for_help"):
        HelpSignal(is_call_for_help=cast(bool, verdict), detected_at=AT)


def test_monitoring_what_stopped_not_a_string_is_rejected() -> None:
    with pytest.raises(ValueError, match="what_stopped"):
        MonitoringSignal(what_stopped=cast(str, None), stopped_at=AT, checked_at=AT)


def test_monitoring_checked_at_equal_to_stopped_at_is_accepted() -> None:
    signal = MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=AT)
    assert signal.checked_at == signal.stopped_at


@pytest.mark.parametrize("moment", ["2026-11-14T03:12:00Z", None])
def test_time_not_a_datetime_is_rejected(moment: object) -> None:
    with pytest.raises(ValueError, match="detected_at"):
        FallSignal(confidence=0.9, detected_at=cast(datetime, moment))


@pytest.mark.parametrize("value", [130.5, float("nan"), True])
def test_thresholds_bpm_not_a_whole_number_is_rejected(value: object) -> None:
    with pytest.raises(ValueError, match="heart_rate_high_bpm must be a whole number"):
        RuleThresholds(heart_rate_high_bpm=cast(int, value))
    with pytest.raises(ValueError, match="heart_rate_low_bpm must be a whole number"):
        RuleThresholds(heart_rate_low_bpm=cast(int, value))


def test_thresholds_fall_minimum_bool_is_rejected() -> None:
    with pytest.raises(ValueError, match="fall_confidence_min"):
        RuleThresholds(fall_confidence_min=True)


def test_thresholds_wait_not_a_timedelta_is_rejected() -> None:
    with pytest.raises(ValueError, match="monitoring_stopped_after"):
        RuleThresholds(monitoring_stopped_after=cast(timedelta, 30))


@pytest.mark.parametrize("minimum", [0.0, 1.0])
def test_thresholds_fall_minimum_at_the_ends_is_accepted(minimum: float) -> None:
    assert RuleThresholds(fall_confidence_min=minimum).fall_confidence_min == minimum


def test_thresholds_low_just_below_high_is_accepted() -> None:
    thresholds = RuleThresholds(heart_rate_low_bpm=129, heart_rate_high_bpm=130)
    assert thresholds.heart_rate_low_bpm == 129


@pytest.mark.parametrize("verdict", [True, False])
def test_help_verdict_bool_is_accepted(verdict: bool) -> None:
    assert HelpSignal(is_call_for_help=verdict, detected_at=AT).is_call_for_help is verdict


def test_monitoring_order_is_checked_in_utc_across_a_clock_change(
    clocks_go_back_zone: tzinfo,
) -> None:
    zone = clocks_go_back_zone
    stopped = datetime(2026, 11, 1, 1, 30, fold=1, tzinfo=zone)
    checked = datetime(2026, 11, 1, 1, 45, fold=0, tzinfo=zone)
    assert checked.astimezone(UTC) < stopped.astimezone(UTC)
    with pytest.raises(ValueError, match="checked_at"):
        MonitoringSignal(what_stopped="camera", stopped_at=stopped, checked_at=checked)


@pytest.mark.parametrize(
    "build",
    [
        lambda moment: FallSignal(confidence=0.9, detected_at=moment),
        lambda moment: HelpSignal(is_call_for_help=True, detected_at=moment),
        lambda moment: HeartRateSignal(bpm=80, measured_at=moment),
        lambda moment: MonitoringSignal(what_stopped="camera", stopped_at=moment, checked_at=AT),
        lambda moment: MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=moment),
    ],
    ids=["fall", "help", "heart_rate", "monitoring_stopped_at", "monitoring_checked_at"],
)
def test_time_outside_the_utc_range_is_rejected(build: Callable[[datetime], object]) -> None:
    year_one_east_of_utc = datetime.min.replace(tzinfo=timezone(timedelta(hours=5)))
    with pytest.raises(ValueError, match="out of range"):
        build(year_one_east_of_utc)


@pytest.mark.parametrize(
    "moment",
    [
        datetime(1960, 1, 1, tzinfo=UTC),
        datetime(1970, 1, 1, 12, 0, tzinfo=UTC),
        datetime(3500, 1, 1, tzinfo=UTC),
        datetime(9999, 12, 31, 23, 30, tzinfo=UTC),
    ],
    ids=["1960", "first_day_of_1970", "3500", "end_of_9999"],
)
def test_time_outside_the_signal_range_is_rejected(moment: datetime) -> None:
    with pytest.raises(ValueError, match="out of range"):
        FallSignal(confidence=0.9, detected_at=moment)
