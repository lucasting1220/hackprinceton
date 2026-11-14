from datetime import UTC, datetime, timedelta, timezone, tzinfo

import pytest

from layer4.alerts import AlertKind
from layer4.rules import decide
from layer4.settings import RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal

EST = timezone(timedelta(hours=-5))
AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
DEFAULTS = RuleThresholds()


@pytest.mark.parametrize(("confidence", "fires"), [(0.79, False), (0.8, True), (1.0, True)])
def test_fall_rule_boundary(confidence: float, fires: bool) -> None:
    signal = FallSignal(confidence=confidence, detected_at=AT)
    assert (decide(signal, DEFAULTS, EST) is not None) is fires


@pytest.mark.parametrize(("is_call", "fires"), [(False, False), (True, True)])
def test_help_rule(is_call: bool, fires: bool) -> None:
    signal = HelpSignal(is_call_for_help=is_call, detected_at=AT)
    assert (decide(signal, DEFAULTS, EST) is not None) is fires


@pytest.mark.parametrize(
    ("bpm", "fires"), [(130, False), (131, True), (40, False), (39, True), (80, False)]
)
def test_heart_rate_rule_boundaries(bpm: int, fires: bool) -> None:
    signal = HeartRateSignal(bpm=bpm, measured_at=AT)
    assert (decide(signal, DEFAULTS, EST) is not None) is fires


@pytest.mark.parametrize(("seconds", "fires"), [(30, False), (31, True)])
def test_monitoring_rule_boundary(seconds: int, fires: bool) -> None:
    signal = MonitoringSignal(
        what_stopped="camera", stopped_at=AT, checked_at=AT + timedelta(seconds=seconds)
    )
    assert (decide(signal, DEFAULTS, EST) is not None) is fires


def test_rules_read_the_thresholds_not_literals() -> None:
    custom = RuleThresholds(
        fall_confidence_min=0.5,
        heart_rate_high_bpm=100,
        heart_rate_low_bpm=50,
        monitoring_stopped_after=timedelta(seconds=5),
    )
    fall = FallSignal(confidence=0.6, detected_at=AT)
    high = HeartRateSignal(bpm=110, measured_at=AT)
    low = HeartRateSignal(bpm=45, measured_at=AT)
    stopped = MonitoringSignal(
        what_stopped="camera", stopped_at=AT, checked_at=AT + timedelta(seconds=10)
    )
    for signal in (fall, high, low, stopped):
        assert decide(signal, DEFAULTS, EST) is None
        assert decide(signal, custom, EST) is not None


def test_fall_alert_text() -> None:
    alert = decide(FallSignal(confidence=0.9, detected_at=AT), DEFAULTS, EST)
    assert alert is not None
    assert alert.kind is AlertKind.FALL
    assert alert.title == "Possible fall"
    assert alert.body == "Possible fall detected at 10:12 PM"
    assert alert.detected_at == AT


def test_help_alert_text() -> None:
    alert = decide(HelpSignal(is_call_for_help=True, detected_at=AT), DEFAULTS, EST)
    assert alert is not None
    assert alert.kind is AlertKind.HELP
    assert alert.title == "Call for help"
    assert alert.body == "Call for help heard at 10:12 PM"
    assert alert.detected_at == AT


def test_heart_rate_alert_text_states_the_reading_date() -> None:
    alert = decide(HeartRateSignal(bpm=142, measured_at=AT), DEFAULTS, EST)
    assert alert is not None
    assert alert.kind is AlertKind.HEART_RATE
    assert alert.title == "Heart rate alert"
    assert alert.body == "Heart rate of 142 recorded at 10:12 PM on Nov 13"
    assert alert.detected_at == AT


def test_monitoring_alert_text_and_time_is_when_it_stopped() -> None:
    signal = MonitoringSignal(
        what_stopped="kitchen camera", stopped_at=AT, checked_at=AT + timedelta(minutes=2)
    )
    alert = decide(signal, DEFAULTS, EST)
    assert alert is not None
    assert alert.kind is AlertKind.MONITORING
    assert alert.title == "Monitoring degraded"
    assert alert.body == "Monitoring is degraded: kitchen camera"
    assert alert.detected_at == AT


def test_alert_time_is_converted_to_utc() -> None:
    local = datetime(2026, 11, 13, 22, 12, tzinfo=EST)
    alert = decide(FallSignal(confidence=0.9, detected_at=local), DEFAULTS, EST)
    assert alert is not None
    assert alert.detected_at.utcoffset() == timedelta(0)
    assert alert.detected_at == AT


def test_monitoring_wait_is_measured_in_utc_across_a_clock_change(
    clocks_go_back_zone: tzinfo,
) -> None:
    stopped = datetime(2026, 11, 1, 1, 50, fold=0, tzinfo=clocks_go_back_zone)
    checked = datetime(2026, 11, 1, 1, 10, fold=1, tzinfo=clocks_go_back_zone)
    assert checked.astimezone(UTC) - stopped.astimezone(UTC) == timedelta(minutes=20)
    signal = MonitoringSignal(what_stopped="camera", stopped_at=stopped, checked_at=checked)
    assert decide(signal, DEFAULTS, EST) is not None
