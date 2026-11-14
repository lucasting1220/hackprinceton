from datetime import UTC, datetime, timedelta, timezone, tzinfo

import pytest

from layer4.alerts import AlertKind
from layer4.rules import decide
from layer4.settings import RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal, Signal

EST = timezone(timedelta(hours=-5))
AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
DEFAULTS = RuleThresholds()
FALL = FallSignal(confidence=0.9, detected_at=AT)
HELP = HelpSignal(is_call_for_help=True, detected_at=AT)
HEART = HeartRateSignal(bpm=142, measured_at=AT)
STOPPED = MonitoringSignal("kitchen camera", stopped_at=AT, checked_at=AT + timedelta(minutes=2))


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


@pytest.mark.parametrize(
    ("signal", "kind", "title", "body"),
    [
        (FALL, AlertKind.FALL, "Possible fall", "Possible fall detected at 10:12 PM"),
        (HELP, AlertKind.HELP, "Call for help", "Call for help heard at 10:12 PM"),
        (
            HEART,
            AlertKind.HEART_RATE,
            "Heart rate alert",
            "Heart rate of 142 recorded at 10:12 PM on Nov 13",
        ),
        (
            STOPPED,
            AlertKind.MONITORING,
            "Monitoring degraded",
            "Monitoring is degraded: kitchen camera",
        ),
    ],
    ids=["fall", "help", "heart_rate_states_the_date", "monitoring_time_is_when_it_stopped"],
)
def test_alert_text(signal: Signal, kind: AlertKind, title: str, body: str) -> None:
    alert = decide(signal, DEFAULTS, EST)
    assert alert is not None
    assert alert.kind is kind
    assert (alert.title, alert.body, alert.detected_at) == (title, body, AT)


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
