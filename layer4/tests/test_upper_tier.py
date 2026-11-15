from datetime import UTC, datetime, timedelta, timezone

import pytest
from fakes import FakeEventLog, FakePhone

from layer4.events import new_event, occurred_at
from layer4.settings import RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal
from layer4.upper_tier import UpperTier

EST = timezone(timedelta(hours=-5))
AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


def make(
    calls: list[str], *, log_fails: bool = False, phone_fails: bool = False
) -> tuple[UpperTier, FakeEventLog, FakePhone]:
    log = FakeEventLog(calls, fail=log_fails)
    phone = FakePhone(calls, fail=phone_fails)
    return UpperTier(RuleThresholds(), log, phone, EST), log, phone


def test_urgent_signal_sends_the_alert_before_writing_the_event() -> None:
    calls: list[str] = []
    tier, log, phone = make(calls)
    handled = tier.handle(FallSignal(confidence=0.9, detected_at=AT))
    assert calls == ["phone", "log"]
    assert handled.alert is not None and handled.alert_sent and handled.event_logged
    assert phone.alerts == [handled.alert]
    assert log.events == [handled.event]
    assert handled.event.alert_id == handled.alert.alert_id
    assert handled.event.urgent


def test_signal_below_threshold_is_logged_only() -> None:
    calls: list[str] = []
    tier, log, phone = make(calls)
    handled = tier.handle(FallSignal(confidence=0.5, detected_at=AT))
    assert calls == ["log"]
    assert handled.alert is None and not handled.alert_sent and handled.event_logged
    assert phone.alerts == []
    assert log.events == [handled.event]
    assert handled.event.alert_id is None
    assert not handled.event.urgent


def test_a_failed_log_write_does_not_stop_the_alert() -> None:
    tier, log, phone = make([], log_fails=True)
    handled = tier.handle(HelpSignal(is_call_for_help=True, detected_at=AT))
    assert handled.alert_sent and not handled.event_logged
    assert len(phone.alerts) == 1


def test_a_failed_send_is_still_logged_and_reported(caplog: pytest.LogCaptureFixture) -> None:
    tier, log, phone = make([], phone_fails=True)
    handled = tier.handle(HeartRateSignal(bpm=150, measured_at=AT))
    assert handled.alert is not None and not handled.alert_sent and handled.event_logged
    assert log.events[0].alert_id == handled.alert.alert_id
    assert "not sent" in caplog.text


def test_the_next_signal_is_handled_after_a_failure() -> None:
    tier, log, phone = make([], phone_fails=True)
    tier.handle(FallSignal(confidence=0.9, detected_at=AT))
    handled = tier.handle(FallSignal(confidence=0.95, detected_at=AT + timedelta(seconds=1)))
    assert handled.event_logged
    assert len(log.events) == 2


@pytest.mark.parametrize(
    ("signal", "expected"),
    [
        (FallSignal(confidence=0.9, detected_at=AT.astimezone(EST)), AT),
        (HelpSignal(is_call_for_help=False, detected_at=AT), AT),
        (HeartRateSignal(bpm=80, measured_at=AT), AT),
        (
            MonitoringSignal(
                what_stopped="camera", stopped_at=AT, checked_at=AT + timedelta(minutes=1)
            ),
            AT,
        ),
    ],
    ids=["fall", "help", "heart_rate", "monitoring_uses_stopped_at"],
)
def test_event_time_is_when_it_happened_in_utc(
    signal: FallSignal | HelpSignal | HeartRateSignal | MonitoringSignal, expected: datetime
) -> None:
    assert occurred_at(signal) == expected
    assert occurred_at(signal).utcoffset() == timedelta(0)


def test_two_events_get_different_ids() -> None:
    signal = FallSignal(confidence=0.5, detected_at=AT)
    assert new_event(signal, None).event_id != new_event(signal, None).event_id
