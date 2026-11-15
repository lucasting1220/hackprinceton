from datetime import UTC, datetime, timedelta, timezone

import pytest
from fakes import FakeEventLog, FakeModel, FakePhone

from layer4.alerts import Alert
from layer4.events import describe, new_event
from layer4.ports import Quality
from layer4.rewrite import clean_rewrite, rewrite_alert, rewrite_prompt, send_rewrite
from layer4.rules import decide
from layer4.settings import REWRITE_MAX_CHARS, RuleThresholds
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal

EST = timezone(timedelta(hours=-5))
AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
REWRITE = "A possible fall was detected at 10:12 PM after the resident was walking."


def fall_alert() -> Alert:
    alert = decide(FallSignal(confidence=0.9, detected_at=AT), RuleThresholds(), EST)
    assert alert is not None
    return alert


def log_with(*signals: FallSignal | HeartRateSignal) -> FakeEventLog:
    log = FakeEventLog()
    for signal in signals:
        log.append(new_event(signal, None))
    return log


def test_the_update_keeps_the_alert_id_and_replaces_only_the_body() -> None:
    alert = fall_alert()
    update = rewrite_alert(alert, FakeEventLog(), FakeModel(REWRITE), EST)
    assert update is not None
    assert update.alert_id == alert.alert_id
    assert update.update is True
    assert update.body == REWRITE
    assert (update.kind, update.title, update.detected_at) == (
        alert.kind,
        alert.title,
        alert.detected_at,
    )


def test_the_quick_model_sees_the_alert_and_the_last_ten_minutes() -> None:
    alert = fall_alert()
    log = log_with(
        HeartRateSignal(bpm=88, measured_at=AT - timedelta(minutes=5)),
        HeartRateSignal(bpm=70, measured_at=AT - timedelta(minutes=30)),
    )
    model = FakeModel(REWRITE)
    rewrite_alert(alert, log, model, EST)
    prompt, quality = model.prompts[0]
    assert quality is Quality.QUICK
    assert "Possible fall detected at 10:12 PM" in prompt
    assert "10:07 PM: heart rate 88 beats per minute" in prompt
    assert "70 beats" not in prompt


def test_no_model_means_the_template_stands() -> None:
    assert rewrite_alert(fall_alert(), FakeEventLog(), FakeModel(None), EST) is None


def test_an_unreadable_log_still_gets_a_rewrite() -> None:
    update = rewrite_alert(fall_alert(), FakeEventLog(fail=True), FakeModel(REWRITE), EST)
    assert update is not None


@pytest.mark.parametrize(
    ("raw", "cleaned"),
    [
        ("  A fall.\n\nCheck in. ", "A fall. Check in."),
        ("A\x00 fall\x1b[31m", "A fall [31m"),
        ("", None),
        ("   \n ", None),
        ("x" * (REWRITE_MAX_CHARS + 1), None),
    ],
    ids=["whitespace", "control_characters", "empty", "blank", "too_long"],
)
def test_model_text_is_cleaned_or_refused(raw: str, cleaned: str | None) -> None:
    assert clean_rewrite(raw) == cleaned


def test_send_rewrite_sends_the_update() -> None:
    phone = FakePhone()
    update = send_rewrite(fall_alert(), FakeEventLog(), FakeModel(REWRITE), phone, EST)
    assert phone.alerts == [update]


def test_a_failed_update_send_is_reported_not_raised() -> None:
    phone = FakePhone(fail=True)
    assert send_rewrite(fall_alert(), FakeEventLog(), FakeModel(REWRITE), phone, EST) is None


def test_an_unusable_rewrite_sends_nothing() -> None:
    phone = FakePhone()
    assert send_rewrite(fall_alert(), FakeEventLog(), FakeModel("   "), phone, EST) is None
    assert phone.alerts == []


@pytest.mark.parametrize(
    ("signal", "text"),
    [
        (FallSignal(confidence=0.913, detected_at=AT), "10:12 PM: fall model confidence 0.91"),
        (
            HelpSignal(is_call_for_help=True, detected_at=AT),
            "10:12 PM: speech heard: a call for help",
        ),
        (HeartRateSignal(bpm=88, measured_at=AT), "10:12 PM: heart rate 88 beats per minute"),
        (
            MonitoringSignal(what_stopped="camera", stopped_at=AT, checked_at=AT),
            "10:12 PM: camera stopped",
        ),
    ],
    ids=["fall", "help", "heart_rate", "monitoring"],
)
def test_each_event_is_described_in_one_line(
    signal: FallSignal | HelpSignal | HeartRateSignal | MonitoringSignal, text: str
) -> None:
    assert describe(new_event(signal, None), EST) == text


def test_an_urgent_event_says_an_alert_was_sent() -> None:
    signal = FallSignal(confidence=0.9, detected_at=AT)
    assert describe(new_event(signal, fall_alert()), EST).endswith(", urgent alert sent")


def test_the_prompt_says_when_nothing_else_happened() -> None:
    assert "(nothing else recorded)" in rewrite_prompt(fall_alert(), [], EST)
