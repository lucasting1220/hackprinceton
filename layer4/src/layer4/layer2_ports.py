"""Layer 4's ports carried by Layer 2, through its job client (contracts/README.md, jobs).

Alerts go to the phone in the shape of contracts/alert.json; a failed send is retried with the
same alert_id, which the bridge treats as the same alert.

Every Layer2Error becomes a PortError. Event log entries Layer 4 cannot read, for example
another writer's, are skipped with a warning.
"""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Literal, Protocol

from layer2.job_client import Layer2, Layer2Error
from layer4 import settings
from layer4.alerts import Alert
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

    def to_phone(
        self, kind: Literal["alerts", "replies", "status", "reports"], message: dict[str, object]
    ) -> None: ...


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


def alert_message(alert: Alert) -> dict[str, object]:
    """The alert as contracts/alert.json shapes it: UTC to whole seconds with a Z."""
    detected_at = alert.detected_at.astimezone(UTC).replace(microsecond=0)
    return {
        "schema_version": 1,
        "type": "alert",
        "alert_id": alert.alert_id,
        "kind": alert.kind.value,
        "severity": alert.severity.value,
        "detected_at": detected_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "title": alert.title,
        "body": alert.body,
        "update": alert.update,
    }


class Layer2Phone:
    def __init__(
        self,
        client: JobClient,
        attempts: int = settings.ALERT_SEND_ATTEMPTS,
        retry_wait_s: float = settings.ALERT_RETRY_WAIT_S,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = client
        self._attempts = attempts
        self._retry_wait_s = retry_wait_s
        self._sleep = sleep

    def send_alert(self, alert: Alert) -> None:
        message = alert_message(alert)
        for attempt in range(1, self._attempts + 1):
            try:
                self._client.to_phone("alerts", message)
                return
            except Layer2Error as err:
                logger.warning(
                    "L4 phone: alert %s not delivered (try %d of %d): %s",
                    alert.alert_id,
                    attempt,
                    self._attempts,
                    err,
                )
                if attempt == self._attempts:
                    raise PortError(f"alert not delivered: {err}") from err
                self._sleep(self._retry_wait_s)


def from_environment() -> tuple[Layer2EventLog, Layer2Model]:
    """The ports for a job Layer 2's worker started. Raises PortError outside such a job."""
    try:
        client: JobClient = Layer2.from_env()
    except Layer2Error as err:
        raise PortError(str(err)) from err
    return Layer2EventLog(client), Layer2Model(client)
