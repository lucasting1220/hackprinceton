"""The dashboard's event feed: time, a fixed label and whether an alert went out, nothing else."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import JsonValue
from starlette.websockets import WebSocket

from layer2 import settings
from layer2.contracts import LoggedEvent
from layer2.coordinator.event_log import EventLog, feed_item, recent_feed
from layer2.coordinator.plan import Placement
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_dashboard_app

LOGGED = datetime(2026, 11, 15, 2, 0, tzinfo=UTC)


def logged(event: dict[str, JsonValue]) -> LoggedEvent:
    return LoggedEvent(logged_at=LOGGED, event=event)


def test_layer4_records_become_labelled_items() -> None:
    record: dict[str, JsonValue] = {
        "schema_version": 1,
        "type": "event",
        "event_id": "e-1",
        "kind": "heart_rate",
        "occurred_at": "2026-11-15T01:58:00Z",
        "alert_id": "a-1",
        "details": {"bpm": 131, "measured_at": "2026-11-15T01:58:00Z"},
    }
    item = feed_item(logged(record))
    assert item.model_dump(mode="json") == {
        "at": "2026-11-15T01:58:00Z",
        "label": "Heart rate",
        "alert": True,
    }
    assert "131" not in item.model_dump_json()


@pytest.mark.parametrize(
    ("event", "label", "at", "alert"),
    [
        ({"kind": "fall", "alert_id": None}, "Fall", LOGGED, False),
        ({"kind": "help"}, "Call for help", LOGGED, False),
        ({"kind": "monitoring", "alert_id": "x"}, "Monitoring", LOGGED, True),
        ({"kind": "<script>alert(1)</script>"}, "Event", LOGGED, False),
        ({"kind": 5, "occurred_at": "not a time"}, "Event", LOGGED, False),
        ({"occurred_at": "2026-11-15T01:00:00"}, "Event", LOGGED, False),  # no zone: ignored
    ],
)
def test_odd_events_fall_back_safely(
    event: dict[str, JsonValue], label: str, at: datetime, alert: bool
) -> None:
    item = feed_item(logged(event))
    assert (item.label, item.at, item.alert) == (label, at, alert)


def test_recent_feed_is_newest_first_and_capped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "FEED_EVENTS", 2)
    events = EventLog(tmp_path / "events")
    for kind in ("fall", "help", "monitoring"):
        events.append({"kind": kind})
    assert [item.label for item in recent_feed(events)] == ["Monitoring", "Call for help"]


def test_details_carry_the_feed(tmp_path: Path) -> None:
    events = EventLog(tmp_path / "events")
    events.append({"kind": "fall", "alert_id": "a-1", "details": {"confidence": 0.9}})
    app = create_dashboard_app(Registry[WebSocket](), Placement(lambda: []), events)
    body = TestClient(app, base_url="http://127.0.0.1").get("/api/details").json()
    [item] = body["events"]
    assert (item["label"], item["alert"]) == ("Fall", True)
    assert "confidence" not in json.dumps(body)
    recent = datetime.fromisoformat(item["at"].replace("Z", "+00:00"))
    assert datetime.now(UTC) - recent < timedelta(minutes=1)
