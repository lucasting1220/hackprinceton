"""Layer 4's ports carried by Layer 2, through its job client (contracts/README.md, jobs).

Every Layer2Error becomes a PortError. Event log entries Layer 4 cannot read, for example
another writer's, are skipped with a warning.
"""

import logging
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Literal, Protocol

from layer2.job_client import Layer2, Layer2Error
from layer4.events import Event
from layer4.ports import PortError, Quality
from layer4.records import from_record, to_record

logger = logging.getLogger(__name__)


class _Answer(Protocol):
    @property
    def text(self) -> str: ...


class JobClient(Protocol):
    """The part of layer2.job_client.Layer2 that Layer 4 uses."""

    def log_event(self, event: dict[str, object]) -> None: ...

    def read_log(self, since: datetime | None = None) -> Sequence[Mapping[str, object]]: ...

    def ask(self, prompt: str, quality: Literal["quick", "deep"] = "quick") -> _Answer: ...


class Layer2EventLog:
    def __init__(self, client: JobClient) -> None:
        self._client = client

    def append(self, event: Event) -> None:
        try:
            self._client.log_event(to_record(event))
        except Layer2Error as err:
            raise PortError(f"event log write failed: {err}") from err

    def read_since(self, since: datetime) -> Sequence[Event]:
        try:
            rows = self._client.read_log(since=since)
        except Layer2Error as err:
            raise PortError(f"event log read failed: {err}") from err
        events: list[Event] = []
        for row in rows:
            record = row.get("event")
            if not isinstance(record, Mapping):
                logger.warning("L4 event log: skipped an entry with no event object")
                continue
            try:
                events.append(from_record(record))
            except ValueError as err:
                logger.warning("L4 event log: skipped an entry Layer 4 cannot read: %s", err)
        return events


class Layer2Model:
    def __init__(self, client: JobClient) -> None:
        self._client = client

    def ask(self, prompt: str, quality: Quality) -> str:
        level: Literal["quick", "deep"] = "quick" if quality is Quality.QUICK else "deep"
        try:
            return self._client.ask(prompt, quality=level).text
        except Layer2Error as err:
            raise PortError(f"model request failed: {err}") from err


def from_environment() -> tuple[Layer2EventLog, Layer2Model]:
    """The ports for a job Layer 2's worker started. Raises PortError outside such a job."""
    try:
        client: JobClient = Layer2.from_env()
    except Layer2Error as err:
        raise PortError(str(err)) from err
    return Layer2EventLog(client), Layer2Model(client)
