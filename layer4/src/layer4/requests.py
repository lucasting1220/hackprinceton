"""Layer 4 caregiver requests (contracts/phone-request.json): check now, and questions.

check_now is silent: a fresh live status goes to the phones, and no reply. ask is answered
by the deep model from the live status only (the Layer 4 doc: questions are answered only from
what is happening right now). The model is told to state the readings and their times only,
never to judge them or give medical advice. If the model fails or says nothing, the reply is a
plain summary of the latest readings, so a question is never left unanswered. A request's
text and the answer are never logged.
"""

import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from typing import Literal, Protocol

from layer4 import settings
from layer4.alerts import format_date, format_time
from layer4.fall import Activity
from layer4.health_check import LatestHealth
from layer4.live_status import live_status
from layer4.ports import Model, PortError, Quality

logger = logging.getLogger(__name__)

_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_FIELDS = {"request_id", "device_id", "kind", "text"}
_OPTIONAL = {"schema_version", "type"}
_TEXT_MAX_CHARS = 1000
_ACTIVITY_WORDS = {
    Activity.WALKING: "up and about",
    Activity.SITTING: "sitting",
    Activity.LYING_DOWN: "lying down",
    Activity.NOT_IN_VIEW: "not in view of the camera",
}


@dataclass(frozen=True)
class PhoneRequest:
    request_id: str
    kind: Literal["ask", "check_now"]
    text: str


def parse_request(message: Mapping[str, object]) -> PhoneRequest:
    """The request in one message. Raises ValueError if it breaks the contract."""
    names = set(message)
    if not names >= _FIELDS or not names <= _FIELDS | _OPTIONAL:
        raise ValueError(
            f"request has missing fields {sorted(_FIELDS - names)} "
            f"and unknown fields {sorted(names - _FIELDS - _OPTIONAL)}"
        )
    request_id, kind, text = message["request_id"], message["kind"], message["text"]
    if not isinstance(request_id, str) or not _ID.match(request_id):
        raise ValueError("request_id is not an ID")
    if not isinstance(text, str) or len(text) > _TEXT_MAX_CHARS:
        raise ValueError(f"text must be text of at most {_TEXT_MAX_CHARS} characters")
    if kind == "check_now":
        return PhoneRequest(request_id=request_id, kind="check_now", text=text)
    if kind == "ask":
        if not text.strip():
            raise ValueError("an ask needs a question")
        return PhoneRequest(request_id=request_id, kind="ask", text=text)
    raise ValueError(f"kind must be ask or check_now, got {kind!r}")


def facts(latest: LatestHealth, tz: tzinfo | None = None) -> list[str]:
    """The latest readings in plain words, one per line; what the model and a summary use."""
    lines: list[str] = []
    if latest.activity is not None and latest.activity_since is not None:
        lines.append(
            f"Activity: {_ACTIVITY_WORDS[latest.activity]} since "
            f"{format_time(latest.activity_since, tz)} on {format_date(latest.activity_since, tz)}."
        )
    heart = latest.heart_rate
    if heart is not None:
        lines.append(
            f"Heart rate {heart.bpm} bpm at {format_time(heart.measured_at, tz)} "
            f"on {format_date(heart.measured_at, tz)}."
        )
    sleep = latest.sleep
    if sleep is not None:
        hours, minutes = divmod(sleep.asleep_minutes, 60)
        lines.append(
            f"Slept {hours} h {minutes} min, from {format_time(sleep.bedtime_at, tz)} "
            f"to {format_time(sleep.wake_at, tz)}, waking {sleep.interruptions} times."
        )
    steps = latest.steps
    if steps is not None:
        lines.append(
            f"{steps.steps_today} steps today, as of {format_time(steps.measured_at, tz)}."
        )
    return lines


def question_prompt(question: str, latest: LatestHealth, tz: tzinfo | None = None) -> str:
    known = facts(latest, tz) or ["No readings from the watch yet."]
    return (
        "You answer a family caregiver's question about an older person living at home.\n"
        "Use only the facts below: state the readings that answer the question, with their\n"
        "times. Do not say whether a reading is normal, high, low or worrying, do not give\n"
        "medical advice, and do not guess. If the facts do not answer the question, say so\n"
        "and give the latest readings. Answer in at most three short sentences.\n\n"
        "Facts:\n" + "\n".join(f"- {line}" for line in known) + f"\n\nQuestion: {question}\n"
    )


def summary(latest: LatestHealth, tz: tzinfo | None = None) -> str:
    known = facts(latest, tz)
    return " ".join(known) if known else "No readings from the watch yet."


class CarePhone(Protocol):
    def send_status(self, status: dict[str, object]) -> None: ...

    def send_reply(self, reply: dict[str, object]) -> None: ...


def _now() -> datetime:
    return datetime.now(UTC)


class RequestHandler:
    def __init__(
        self,
        latest: Callable[[], LatestHealth],
        phone: CarePhone,
        model: Model,
        tz: tzinfo | None = None,
        clock: Callable[[], datetime] = _now,
        body_max_chars: int = settings.REPLY_BODY_MAX_CHARS,
    ) -> None:
        self._latest = latest
        self._phone = phone
        self._model = model
        self._tz = tz
        self._clock = clock
        self._body_max_chars = body_max_chars
        self.refused = 0

    def handle(self, message: Mapping[str, object]) -> None:
        try:
            request = parse_request(message)
        except ValueError as err:
            self.refused += 1
            logger.warning("L4 requests: request refused: %s", err)
            return
        try:
            if request.kind == "check_now":
                self.send_status()
            else:
                self._answer(request)
        except PortError as err:
            logger.error("L4 requests: no answer delivered for %s: %s", request.request_id, err)

    def send_status(self) -> None:
        """Send the live status now. Raises PortError if it cannot be delivered."""
        self._phone.send_status(live_status(self._latest(), self._clock()))

    def _answer(self, request: PhoneRequest) -> None:
        latest = self._latest()
        try:
            answer = self._model.ask(question_prompt(request.text, latest, self._tz), Quality.DEEP)
        except PortError as err:
            logger.warning("L4 requests: model unavailable, sending the latest readings: %s", err)
            answer = ""
        body = answer.strip()[: self._body_max_chars] or summary(latest, self._tz)
        self._phone.send_reply(
            {
                "schema_version": 1,
                "type": "reply",
                "request_id": request.request_id,
                "title": settings.REPLY_TITLE,
                "body": body,
            }
        )
        logger.info("L4 requests: answered %s", request.request_id)
