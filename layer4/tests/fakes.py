"""In-memory stand-ins for Layer 4's ports, for tests only. They never reach another layer."""

from collections.abc import Sequence
from datetime import datetime

from layer4.alerts import Alert
from layer4.events import Event
from layer4.ports import PortError, Quality


class FakeEventLog:
    def __init__(self, calls: list[str] | None = None, *, fail: bool = False) -> None:
        self.events: list[Event] = []
        self._calls = calls if calls is not None else []
        self._fail = fail

    def append(self, event: Event) -> None:
        self._calls.append("log")
        if self._fail:
            raise PortError("event log unreachable")
        self.events.append(event)

    def read_since(self, since: datetime) -> Sequence[Event]:
        if self._fail:
            raise PortError("event log unreachable")
        return [event for event in self.events if event.occurred_at >= since]


class FakePhone:
    def __init__(self, calls: list[str] | None = None, *, fail: bool = False) -> None:
        self.alerts: list[Alert] = []
        self._calls = calls if calls is not None else []
        self._fail = fail

    def send_alert(self, alert: Alert) -> None:
        self._calls.append("phone")
        if self._fail:
            raise PortError("coordinator unreachable")
        self.alerts.append(alert)


class FakeModel:
    """Answers every prompt with a fixed reply, or raises PortError when reply is None."""

    def __init__(self, reply: str | None) -> None:
        self.reply = reply
        self.prompts: list[tuple[str, Quality]] = []

    def ask(self, prompt: str, quality: Quality) -> str:
        self.prompts.append((prompt, quality))
        if self.reply is None:
            raise PortError("model unavailable")
        return self.reply
