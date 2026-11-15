import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import JsonValue

from layer2 import settings
from layer2.coordinator.event_log import EventLog, EventTooLargeError


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 14, 23, 58, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def events(tmp_path: Path, clock: Clock) -> EventLog:
    return EventLog(tmp_path / "events", now=clock)


FALL: dict[str, JsonValue] = {"kind": "fall", "confidence": 0.93, "nested": {"ok": [1, 2, None]}}


def test_append_keeps_the_event_as_given_with_the_coordinator_time(
    events: EventLog, clock: Clock, tmp_path: Path
) -> None:
    logged = events.append(FALL)
    assert logged.event == FALL
    assert logged.logged_at == clock.now
    [line] = (tmp_path / "events" / "2026-11-14.jsonl").read_text("utf-8").splitlines()
    assert json.loads(line) == {"logged_at": "2026-11-14T23:58:00Z", "event": FALL}


def test_since_reads_across_midnight_oldest_first(events: EventLog, clock: Clock) -> None:
    events.append({"n": 1})
    clock.now += timedelta(minutes=1)
    events.append({"n": 2})
    clock.now += timedelta(minutes=5)  # now on the next UTC day
    events.append({"n": 3})
    assert [e.event["n"] for e in events.since(clock.now - timedelta(minutes=10))] == [1, 2, 3]
    assert [e.event["n"] for e in events.since(clock.now - timedelta(minutes=4))] == [3]
    assert [e.event["n"] for e in events.day(date(2026, 11, 14))] == [1, 2]
    assert events.day(date(2026, 11, 13)) == []


def test_since_accepts_any_time_zone(events: EventLog, clock: Clock) -> None:
    events.append({"n": 1})
    est = clock.now.astimezone(datetime(2026, 1, 1).astimezone().tzinfo)
    assert len(events.since(est - timedelta(seconds=1))) == 1


def test_reads_are_capped_to_the_newest(events: EventLog) -> None:
    for n in range(5):
        events.append({"n": n})
    assert [e.event["n"] for e in events.day(date(2026, 11, 14), limit=2)] == [3, 4]


def test_a_too_large_event_is_refused_and_not_written(
    events: EventLog, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "EVENT_MAX_BYTES", 200)
    with pytest.raises(EventTooLargeError):
        events.append({"text": "x" * 300})
    assert not (tmp_path / "events" / "2026-11-14.jsonl").exists()


def test_a_torn_line_is_skipped(events: EventLog, tmp_path: Path) -> None:
    events.append({"n": 1})
    with (tmp_path / "events" / "2026-11-14.jsonl").open("a", encoding="utf-8") as file:
        file.write('{"logged_at": "2026-11-14T23:58:00Z", "ev')
    assert [e.event["n"] for e in events.day(date(2026, 11, 14))] == [1]
    events.append({"n": 2})
    assert [e.event["n"] for e in events.day(date(2026, 11, 14))] == [1, 2]
