from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import pytest

from layer2.job_client import Layer2Error
from layer4.events import new_event
from layer4.layer2_ports import Layer2EventLog, Layer2Model
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
