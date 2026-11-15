"""The event log: the only thing the home stores (no video or audio). It lives on the coordinator.

Layer 4 writes the events; their fields are Layer 4's, so each is kept as an opaque JSON object
of at most EVENT_MAX_BYTES, wrapped with the coordinator's own `logged_at` time. Events go to
one JSON-lines file per UTC day in `<state_dir>/events/`, each line flushed to disk before
`append` returns. A torn last line (a crash mid-write) is skipped when reading. Event contents
are never written to the program's log.
"""

import json
import logging
import os
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from pydantic import JsonValue, ValidationError

from layer2 import settings
from layer2.contracts import FeedItem, LoggedEvent
from layer2.files import retry_while_busy

log = logging.getLogger(__name__)


class EventTooLargeError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(UTC)


class EventLog:
    """Blocking file access: from async code, call through `asyncio.to_thread`."""

    def __init__(self, folder: Path, now: Callable[[], datetime] = _utc_now) -> None:
        self._folder = folder
        self._now = now

    def append(self, event: dict[str, JsonValue]) -> LoggedEvent:
        logged = LoggedEvent(logged_at=self._now(), event=event)
        line = logged.model_dump_json()
        if len(line.encode("utf-8")) > settings.EVENT_MAX_BYTES:
            raise EventTooLargeError(f"an event may be at most {settings.EVENT_MAX_BYTES} bytes")
        self._folder.mkdir(parents=True, exist_ok=True)
        path = self._file_for(logged.logged_at.date())

        def write() -> None:
            with path.open("a+b") as file:
                file.seek(0, os.SEEK_END)
                prefix = b""
                if file.tell() > 0:
                    file.seek(-1, os.SEEK_END)
                    if file.read(1) != b"\n":
                        prefix = b"\n"  # end a torn line so this event is not lost with it
                file.write(prefix + line.encode("utf-8") + b"\n")
                file.flush()
                os.fsync(file.fileno())

        retry_while_busy(write)
        return logged

    def since(self, start: datetime, limit: int = settings.EVENT_READ_LIMIT) -> list[LoggedEvent]:
        """Events logged at or after `start`, oldest first, at most `limit` (the newest)."""
        start = start.astimezone(UTC)
        end = self._now().astimezone(UTC).date()
        days = (end - start.date()).days
        events = [
            event
            for offset in range(max(days, 0) + 1)
            for event in self._read(start.date() + timedelta(days=offset))
            if event.logged_at >= start
        ]
        return events[-limit:]

    def day(self, which: date, limit: int = settings.EVENT_READ_LIMIT) -> list[LoggedEvent]:
        """Events of one UTC day, oldest first, at most `limit` (the newest)."""
        return list(self._read(which))[-limit:]

    def _file_for(self, which: date) -> Path:
        return self._folder / f"{which.isoformat()}.jsonl"

    def _read(self, which: date) -> Iterator[LoggedEvent]:
        path = self._file_for(which)
        try:
            text = retry_while_busy(lambda: path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        skipped = 0
        for line in text.splitlines():
            try:
                yield LoggedEvent.model_validate_json(line)
            except (ValidationError, json.JSONDecodeError):
                skipped += 1
        if skipped:
            log.warning("L2 coordinator: skipped %d unreadable lines in %s", skipped, path.name)


_LABELS = {
    "fall": "Fall",
    "help": "Call for help",
    "heart_rate": "Heart rate",
    "monitoring": "Monitoring",
}


def feed_item(logged: LoggedEvent) -> FeedItem:
    """What the dashboard may show of an event: its time (`occurred_at` if it is a valid time,
    else when it was logged), a label from a fixed list chosen by its `kind` (Layer 4's event
    records), and whether it carries an `alert_id`. Nothing else, so no detail about the
    resident reaches a screen that judges can see."""
    event = logged.event
    kind = event.get("kind")
    label = _LABELS.get(kind, "Event") if isinstance(kind, str) else "Event"
    at = logged.logged_at
    occurred = event.get("occurred_at")
    if isinstance(occurred, str):
        try:
            parsed = datetime.fromisoformat(occurred.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo is not None:
            at = parsed
    return FeedItem(at=at, label=label, alert=bool(event.get("alert_id")))


def recent_feed(events: EventLog) -> list[FeedItem]:
    """The newest FEED_EVENTS events from the last FEED_WINDOW_S, newest first. Blocking."""
    since = datetime.now(UTC) - timedelta(seconds=settings.FEED_WINDOW_S)
    found = events.since(since, limit=settings.FEED_EVENTS)
    return [feed_item(logged) for logged in reversed(found)]
