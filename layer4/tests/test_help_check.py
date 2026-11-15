from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeModel

from layer4.help_check import HelpCheck, HelpCheckFailed, help_prompt, parse_verdict
from layer4.ports import Quality
from layer4.settings import HELP_TRANSCRIPT_MAX_CHARS

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


@pytest.mark.parametrize(
    ("answer", "verdict"),
    [
        ("YES", True),
        ("yes.", True),
        (" No\n", False),
        ("NO!", False),
        ("Yes, they need help", None),
        ("maybe", None),
        ("", None),
    ],
)
def test_only_a_plain_yes_or_no_counts(answer: str, verdict: bool | None) -> None:
    assert parse_verdict(answer) is verdict


@pytest.mark.parametrize(("answer", "verdict"), [("YES", True), ("NO", False)])
def test_the_verdict_becomes_a_help_signal(answer: str, verdict: bool) -> None:
    model = FakeModel(answer)
    signal = HelpCheck(model).check("help me I fell", T0)
    assert signal is not None
    assert signal.is_call_for_help is verdict
    assert signal.detected_at == T0
    assert model.prompts[0][1] is Quality.QUICK
    assert "help me I fell" in model.prompts[0][0]


def test_silence_is_not_checked() -> None:
    model = FakeModel("YES")
    assert HelpCheck(model).check("   ", T0) is None
    assert model.prompts == []


@pytest.mark.parametrize("reply", [None, "I think so"], ids=["no_model", "unclear_answer"])
def test_no_verdict_is_a_failure_not_a_no(reply: str | None) -> None:
    with pytest.raises(HelpCheckFailed):
        HelpCheck(FakeModel(reply)).check("help", T0)


def test_health_reports_the_help_check_stopped_after_the_gap() -> None:
    clock = Clock()
    check = HelpCheck(FakeModel(None), clock=clock)
    with pytest.raises(HelpCheckFailed):
        check.check("help", T0)
    clock.now = T0 + timedelta(seconds=10)
    with pytest.raises(HelpCheckFailed):
        check.check("help", T0)
    stopped = check.health()
    assert stopped is not None
    assert stopped.what_stopped == "help check"
    assert stopped.stopped_at == T0
    assert stopped.checked_at == clock.now


def test_a_verdict_clears_the_failure() -> None:
    clock = Clock()
    model = FakeModel(None)
    check = HelpCheck(model, clock=clock)
    with pytest.raises(HelpCheckFailed):
        check.check("help", T0)
    model.reply = "NO"
    check.check("all fine", T0)
    clock.now = T0 + timedelta(minutes=5)
    assert check.health() is None


def test_health_waits_for_the_gap() -> None:
    clock = Clock()
    check = HelpCheck(FakeModel(None), clock=clock)
    with pytest.raises(HelpCheckFailed):
        check.check("help", T0)
    clock.now = T0 + timedelta(seconds=2)
    assert check.health() is None


def test_a_long_transcript_is_cut_to_its_most_recent_part() -> None:
    transcript = "x" * HELP_TRANSCRIPT_MAX_CHARS + "help me"
    prompt = help_prompt(transcript)
    assert "help me" in prompt
    assert "x" * (HELP_TRANSCRIPT_MAX_CHARS + 1) not in prompt


def test_the_transcript_is_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    with pytest.raises(HelpCheckFailed):
        HelpCheck(FakeModel(None)).check("my secret words", T0)
    assert "my secret words" not in caplog.text
