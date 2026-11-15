"""Jobs' event log requests, answered by the coordinator over a worker's connection."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import contract
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocket

from layer2 import settings
from layer2.contracts import CoordinatorConfig, LogRead, Reply
from layer2.coordinator.event_log import EventLog
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_control_app

HELLO = contract("hello.json")


@pytest.fixture
def config(tmp_path: Path) -> CoordinatorConfig:
    accepted_file = tmp_path / "accepted-workers.json"
    accepted_file.write_text(json.dumps(contract("accepted-workers.json")), encoding="utf-8")
    data = {
        **contract("coordinator.json"),
        "accepted_workers_file": str(accepted_file),
        "state_dir": str(tmp_path),
        "stop_file": str(tmp_path / "coordinator.stop"),
    }
    return CoordinatorConfig.model_validate(data)


@pytest.fixture
def events(tmp_path: Path) -> EventLog:
    return EventLog(tmp_path / "events")


def join(session: WebSocketTestSession) -> WebSocketTestSession:
    session.send_text(json.dumps(HELLO))
    assert json.loads(session.receive_text())["accepted"] is True
    return session


def ask(session: WebSocketTestSession, request: dict[str, Any]) -> Reply:
    session.send_text(json.dumps({"schema_version": 1, **request}))
    return Reply.model_validate_json(session.receive_text())


def test_append_then_read_since_and_by_day(config: CoordinatorConfig, events: EventLog) -> None:
    client = TestClient(create_control_app(config, Registry[WebSocket](), events=events))
    with client.websocket_connect("/ws") as connection:
        session = join(connection)
        event = {"kind": "fall", "confidence": 0.9}
        assert ask(session, {"type": "log_append", "id": "a1", "event": event}) == Reply(
            type="reply", schema_version=1, id="a1", ok=True
        )
        hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        reply = ask(session, {"type": "log_read", "id": "r1", "since": hour_ago})
        assert reply.ok and reply.id == "r1" and not reply.truncated
        assert [item.event for item in reply.events or []] == [event]
        today = datetime.now(UTC).date().isoformat()
        by_day = ask(session, {"type": "log_read", "id": "r2", "day": today})
        assert [item.event for item in by_day.events or []] == [event]


def test_a_reply_never_exceeds_the_budget(
    config: CoordinatorConfig, events: EventLog, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "REPLY_MAX_BYTES", 1000)
    for n in range(50):
        events.append({"n": n, "pad": "x" * 50})
    client = TestClient(create_control_app(config, Registry[WebSocket](), events=events))
    with client.websocket_connect("/ws") as connection:
        session = join(connection)
        today = datetime.now(UTC).date().isoformat()
        reply = ask(session, {"type": "log_read", "id": "r", "day": today})
    assert reply.truncated
    kept = [item.event["n"] for item in reply.events or []]
    assert kept == list(range(50 - len(kept), 50))  # the newest, oldest first
    assert sum(len(item.model_dump_json()) + 1 for item in reply.events or []) <= 1000


def test_too_large_events_and_missing_logs_get_an_error_reply(
    config: CoordinatorConfig, events: EventLog, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "EVENT_MAX_BYTES", 100)
    client = TestClient(create_control_app(config, Registry[WebSocket](), events=events))
    with client.websocket_connect("/ws") as connection:
        session = join(connection)
        big = ask(session, {"type": "log_append", "id": "b", "event": {"x": "y" * 200}})
        assert (big.ok, big.id) == (False, "b")
    no_log = TestClient(create_control_app(config, Registry[WebSocket]()))
    with no_log.websocket_connect("/ws") as connection:
        session = join(connection)
        reply = ask(session, {"type": "log_append", "id": "c", "event": {}})
        assert not reply.ok and reply.error == "this coordinator keeps no event log"


def test_a_bad_request_is_ignored_and_the_connection_stays(
    config: CoordinatorConfig, events: EventLog
) -> None:
    client = TestClient(create_control_app(config, Registry[WebSocket](), events=events))
    with client.websocket_connect("/ws") as connection:
        session = join(connection)
        session.send_text(json.dumps({"type": "log_read", "schema_version": 1, "id": "x"}))
        session.send_text(json.dumps({"type": "log_append", "schema_version": 1, "id": "../"}))
        ok = ask(session, {"type": "log_append", "id": "fine", "event": {"n": 1}})
        assert ok.ok and ok.id == "fine"


def test_log_read_needs_exactly_one_of_since_and_day() -> None:
    with pytest.raises(ValidationError):
        LogRead.model_validate({"type": "log_read", "schema_version": 1, "id": "x"})
    with pytest.raises(ValidationError):
        LogRead.model_validate(
            {
                "type": "log_read",
                "schema_version": 1,
                "id": "x",
                "since": "2026-11-14T00:00:00Z",
                "day": "2026-11-14",
            }
        )
