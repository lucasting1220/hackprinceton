import json
import logging
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fakes import FakeEventLog, FakeModel, FakePhone

from layer2.job_client import Layer2Error
from layer4 import settings
from layer4.health_check import HealthCheck, LatestHealth
from layer4.jobs.health_check import send_status, take_one, take_request
from layer4.live_status import heart_trend, live_status
from layer4.ports import PortError, Quality
from layer4.requests import RequestHandler, parse_request
from layer4.signals import HeartRateSignal
from layer4.upper_tier import UpperTier
from layer4.watch import SleepRecord, StepsCount

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def contract(name: str) -> dict[str, object]:
    loaded: dict[str, object] = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    return loaded


def at(text: str) -> datetime:
    return datetime.fromisoformat(text)


def heart(bpm: int, when: str = "2026-11-14T03:12:45Z") -> HeartRateSignal:
    return HeartRateSignal(bpm=bpm, measured_at=at(when))


EXAMPLE = LatestHealth(
    heart_rate=heart(72),
    heart_rate_before=heart(70, "2026-11-14T03:02:45Z"),
    sleep=SleepRecord(
        night_of=date(2026, 11, 13),
        asleep_minutes=412,
        bedtime_at=at("2026-11-14T03:40:00Z"),
        wake_at=at("2026-11-14T11:05:00Z"),
        interruptions=2,
    ),
    steps=StepsCount(measured_at=at("2026-11-14T11:20:00Z"), steps_today=230),
    last_received_at=at("2026-11-14T11:30:00Z"),
)
SOON_AFTER = at("2026-11-14T03:20:00Z")


def test_live_status_is_exactly_contracts_live_status_json() -> None:
    assert live_status(EXAMPLE, SOON_AFTER) == contract("live-status.json")


@pytest.mark.parametrize(
    ("before", "trend"), [(None, None), (70, "steady"), (60, "rising"), (90, "falling")]
)
def test_heart_trend_compares_with_the_reading_before(
    before: int | None, trend: str | None
) -> None:
    earlier = None if before is None else heart(before, "2026-11-14T03:00:00Z")
    assert heart_trend(heart(72), earlier) == trend


def test_no_heart_data_with_no_reading_or_an_old_one() -> None:
    assert live_status(LatestHealth(), SOON_AFTER)["no_heart_data"] is True
    stale = SOON_AFTER + settings.NO_HEART_DATA_AFTER
    assert live_status(EXAMPLE, stale)["no_heart_data"] is True
    assert live_status(LatestHealth(), SOON_AFTER)["heart_rate"] is None


def test_the_contract_request_reads_as_a_check_now() -> None:
    request = parse_request(contract("phone-request.json"))
    assert (request.request_id, request.kind, request.text) == ("req-7c1e2a", "check_now", "")


def test_a_request_without_schema_version_and_type_still_reads() -> None:
    bare = {"request_id": "r1", "device_id": "d1", "kind": "ask", "text": "Did she sleep?"}
    assert parse_request(bare).kind == "ask"


def ask(text: str = "How did she sleep?", request_id: str = "req-1") -> dict[str, object]:
    return {**contract("phone-request.json"), "request_id": request_id, "kind": "ask", "text": text}


@pytest.mark.parametrize(
    "message",
    [
        {k: v for k, v in contract("phone-request.json").items() if k != "text"},
        {**contract("phone-request.json"), "urgent": True},
        {**contract("phone-request.json"), "request_id": "has spaces"},
        {**contract("phone-request.json"), "kind": "call"},
        ask(text="   "),
        ask(text="x" * 1001),
    ],
    ids=["missing-text", "unknown-field", "bad-id", "unknown-kind", "empty-ask", "long-text"],
)
def test_a_request_that_breaks_the_contract_is_refused(message: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        parse_request(message)


class CarePhone:
    def __init__(self, fail: bool = False) -> None:
        self.statuses: list[dict[str, object]] = []
        self.replies: list[dict[str, object]] = []
        self.fail = fail

    def send_status(self, status: dict[str, object]) -> None:
        if self.fail:
            raise PortError("bridge unreachable")
        self.statuses.append(status)

    def send_reply(self, reply: dict[str, object]) -> None:
        if self.fail:
            raise PortError("bridge unreachable")
        self.replies.append(reply)


def handler(
    reply: str | None = "She slept almost seven hours.", phone: CarePhone | None = None
) -> tuple[RequestHandler, CarePhone, FakeModel]:
    care_phone = phone or CarePhone()
    model = FakeModel(reply)
    return (
        RequestHandler(lambda: EXAMPLE, care_phone, model, tz=UTC, clock=lambda: SOON_AFTER),
        care_phone,
        model,
    )


def test_check_now_sends_the_live_status_and_no_reply() -> None:
    requests, phone, model = handler()
    requests.handle(contract("phone-request.json"))
    assert phone.statuses == [contract("live-status.json")]
    assert phone.replies == []
    assert model.prompts == []


def test_a_question_is_answered_by_the_deep_model_from_the_latest_readings() -> None:
    requests, phone, model = handler()
    requests.handle(ask(request_id="req-7c1e2a"))
    [(prompt, quality)] = model.prompts
    assert quality is Quality.DEEP
    assert "How did she sleep?" in prompt
    assert "Slept 6 h 52 min" in prompt
    assert "Heart rate 72 bpm at 3:12 AM" in prompt
    [reply] = phone.replies
    assert set(reply) == set(contract("reply.json"))
    assert reply == {**contract("reply.json"), "body": "She slept almost seven hours."}


@pytest.mark.parametrize("model_reply", [None, "   "], ids=["model-down", "empty-answer"])
def test_without_an_answer_the_reply_is_the_latest_readings(model_reply: str | None) -> None:
    requests, phone, _ = handler(reply=model_reply)
    requests.handle(ask())
    body = phone.replies[0]["body"]
    assert isinstance(body, str)
    assert body.startswith("Heart rate 72 bpm at 3:12 AM on Nov 14.")
    assert "230 steps today" in body


def test_with_no_readings_the_reply_says_so() -> None:
    phone = CarePhone()
    requests = RequestHandler(LatestHealth, phone, FakeModel(None), tz=UTC)
    requests.handle(ask())
    assert phone.replies[0]["body"] == "No readings from the watch yet."


def test_a_long_answer_is_cut_to_the_bridge_limit() -> None:
    requests, phone, _ = handler(reply="word " * 2000)
    requests.handle(ask())
    body = phone.replies[0]["body"]
    assert isinstance(body, str)
    assert len(body) == settings.REPLY_BODY_MAX_CHARS


def test_a_refused_request_is_counted_and_an_undelivered_answer_does_not_stop_the_next() -> None:
    requests, phone, _ = handler(phone=CarePhone(fail=True))
    requests.handle({"kind": "ask"})
    requests.handle(ask())
    assert requests.refused == 1
    assert phone.replies == []


def test_questions_and_answers_are_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    requests, _, _ = handler(reply="She slept almost seven hours.")
    with caplog.at_level(logging.DEBUG):
        requests.handle(ask(text="Is my mother okay tonight?"))
        handler(reply=None)[0].handle(ask(text="Is my mother okay tonight?"))
    assert "mother" not in caplog.text
    assert "seven hours" not in caplog.text
    assert "72 bpm" not in caplog.text


def build_check() -> tuple[HealthCheck, FakePhone]:
    log, phone = FakeEventLog(), FakePhone()
    return HealthCheck(UpperTier(settings.RuleThresholds(), log, phone)), phone


def reading(bpm: int, when: str) -> dict[str, object]:
    return {**contract("watch-reading.json"), "bpm": bpm, "measured_at": when}


def test_a_late_older_reading_is_judged_but_does_not_replace_a_newer_one() -> None:
    check, phone = build_check()
    check.on_message(reading(80, "2026-11-14T03:10:00Z"))
    check.on_message(reading(150, "2026-11-14T03:00:00Z"))
    assert check.latest.heart_rate == heart(80, "2026-11-14T03:10:00Z")
    assert [alert.kind for alert in phone.alerts] == ["heart_rate"]


def test_each_new_heart_rate_keeps_the_one_before_for_the_trend() -> None:
    check, _ = build_check()
    check.on_message(reading(70, "2026-11-14T03:00:00Z"))
    check.on_message(reading(90, "2026-11-14T03:10:00Z"))
    assert check.latest.heart_rate_before == heart(70, "2026-11-14T03:00:00Z")


def test_a_new_reading_sends_a_live_status_and_a_refused_one_does_not() -> None:
    check, _ = build_check()
    sent: list[str] = []
    take_one(
        check, lambda: reading(72, "2026-11-14T03:00:00Z"), on_new=lambda: sent.append("status")
    )
    take_one(check, lambda: {"kind": "heart_rate"}, on_new=lambda: sent.append("status"))
    assert sent == ["status"]


def test_requests_from_layer_2_are_handled_and_an_outage_waits() -> None:
    requests, phone, _ = handler()
    take_request(requests, lambda: contract("phone-request.json"))
    waits: list[float] = []

    def unreachable() -> None:
        raise Layer2Error("cannot reach Layer 2's worker")

    take_request(requests, unreachable, sleep=waits.append)
    assert len(phone.statuses) == 1
    assert waits == [settings.WATCH_RETRY_S]


def test_an_undelivered_live_status_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    requests, _, _ = handler(phone=CarePhone(fail=True))
    send_status(requests)
    assert "live status not delivered" in caplog.text
