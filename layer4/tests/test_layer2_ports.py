import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import pytest

from layer2.job_client import Layer2Error
from layer4.alerts import Alert, AlertKind, Severity
from layer4.events import new_event
from layer4.layer2_ports import Layer2EventLog, Layer2Model, Layer2Phone, alert_message
from layer4.ports import PortError, Quality
from layer4.records import to_record
from layer4.signals import FallSignal

AT = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


@dataclass(frozen=True)
class Answer:
    text: str


class FakeClient:
    def __init__(self, *, fail: bool = False) -> None:
        self.logged: list[dict[str, object]] = []
        self.rows: list[Mapping[str, object]] = []
        self.asked: list[tuple[str, str]] = []
        self.sent: list[tuple[str, dict[str, object]]] = []
        self.failures_left = 0
        self.fail = fail

    def _check(self) -> None:
        if self.fail:
            raise Layer2Error("cannot reach Layer 2's worker")

    def log_event(self, event: dict[str, object]) -> None:
        self._check()
        self.logged.append(event)

    def read_log(self, since: datetime | None = None) -> Sequence[Mapping[str, object]]:
        self._check()
        return self.rows

    def ask(self, prompt: str, quality: Literal["quick", "deep"] = "quick") -> Answer:
        self._check()
        self.asked.append((prompt, quality))
        return Answer(text="YES")

    def to_phone(
        self, kind: Literal["alerts", "replies", "status", "reports"], message: dict[str, object]
    ) -> None:
        self._check()
        if self.failures_left:
            self.failures_left -= 1
            raise Layer2Error("the bridge did not answer")
        self.sent.append((kind, message))


def test_append_writes_the_record() -> None:
    client = FakeClient()
    event = new_event(FallSignal(confidence=0.9, detected_at=AT), None)
    Layer2EventLog(client).append(event)
    assert client.logged == [to_record(event)]


def test_read_returns_events_and_skips_entries_it_cannot_read() -> None:
    client = FakeClient()
    event = new_event(FallSignal(confidence=0.9, detected_at=AT), None)
    client.rows = [
        {"logged_at": "2026-11-14T03:12:01Z", "event": to_record(event)},
        {"logged_at": "2026-11-14T03:12:02Z", "event": {"kind": "frames", "count": 3}},
        {"logged_at": "2026-11-14T03:12:03Z"},
    ]
    events = Layer2EventLog(client).read_since(AT)
    assert [e.event_id for e in events] == [event.event_id]


@pytest.mark.parametrize("call", ["append", "read", "ask"])
def test_layer2_errors_become_port_errors(call: str) -> None:
    client = FakeClient(fail=True)
    with pytest.raises(PortError):
        if call == "append":
            Layer2EventLog(client).append(new_event(FallSignal(0.9, AT), None))
        elif call == "read":
            Layer2EventLog(client).read_since(AT)
        else:
            Layer2Model(client).ask("hi", Quality.QUICK)


@pytest.mark.parametrize(("quality", "level"), [(Quality.QUICK, "quick"), (Quality.DEEP, "deep")])
def test_ask_passes_the_quality_and_returns_the_text(quality: Quality, level: str) -> None:
    client = FakeClient()
    assert Layer2Model(client).ask("is this help?", quality) == "YES"
    assert client.asked == [("is this help?", level)]


def test_outside_a_layer2_job_the_ports_cannot_be_built(monkeypatch: pytest.MonkeyPatch) -> None:
    from layer4.layer2_ports import from_environment

    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    with pytest.raises(PortError, match="LAYER2_GATEWAY"):
        from_environment()


CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def contract_alert(update: bool = False) -> Alert:
    """The alert in contracts/alert.json, with its time in another zone and with microseconds."""
    eastern = timezone(timedelta(hours=-5))
    return Alert(
        alert_id="6f1c2a8e-3b7d-4f0a-9c55-2e8d1a4b7f90",
        kind=AlertKind.FALL,
        severity=Severity.URGENT,
        detected_at=datetime(2026, 11, 13, 22, 12, 0, 734512, tzinfo=eastern),
        title="Possible fall",
        body="A possible fall was seen at 10:12 PM",
        update=update,
    )


def test_an_alert_is_sent_exactly_as_contracts_alert_json_shapes_it() -> None:
    example = json.loads((CONTRACTS / "alert.json").read_text(encoding="utf-8"))
    assert alert_message(contract_alert()) == example


def test_a_rewrite_is_sent_as_an_update() -> None:
    assert alert_message(contract_alert(update=True))["update"] is True


def test_the_phone_retries_with_the_same_alert_until_it_is_delivered() -> None:
    client = FakeClient()
    client.failures_left = 2
    waits: list[float] = []
    Layer2Phone(client, attempts=3, retry_wait_s=0.5, sleep=waits.append).send_alert(
        contract_alert()
    )
    assert client.sent == [("alerts", alert_message(contract_alert()))]
    assert waits == [0.5, 0.5]


def test_the_phone_gives_up_after_its_attempts_with_a_port_error() -> None:
    client = FakeClient()
    client.failures_left = 5
    waits: list[float] = []
    with pytest.raises(PortError, match="alert not delivered"):
        Layer2Phone(client, attempts=3, retry_wait_s=0.5, sleep=waits.append).send_alert(
            contract_alert()
        )
    assert client.sent == []
    assert waits == [0.5, 0.5]
