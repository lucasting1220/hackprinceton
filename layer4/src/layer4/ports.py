"""Layer 4 ports: what the care layer needs from the other layers, as Layer 4 sees it.

Each port is a small interface. The adapters that carry them over Layer 2's coordinator are
written once the matching contract files are on main; tests use in-memory fakes. An adapter
reports any failure to deliver as PortError, so callers catch one exception type.
"""

from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from typing import Protocol

from layer4.alerts import Alert
from layer4.events import Event


class PortError(Exception):
    """A port could not do what was asked: the other layer was unreachable, slow or refused."""


class Quality(StrEnum):
    """The model quality Layer 2 serves: quick for short requests, deep for long ones."""

    QUICK = "quick"
    DEEP = "deep"


class EventLog(Protocol):
    """The event log on the coordinator."""

    def append(self, event: Event) -> None: ...

    def read_since(self, since: datetime) -> Sequence[Event]: ...


class Phone(Protocol):
    """Messages for the caregiver's phone, carried by Layer 2's coordinator to Layer 1."""

    def send_alert(self, alert: Alert) -> None: ...


class Model(Protocol):
    """One language model request through Layer 2, answered as plain text."""

    def ask(self, prompt: str, quality: Quality) -> str: ...
