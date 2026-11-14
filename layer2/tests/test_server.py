import contextlib
import json
import logging
from pathlib import Path
from typing import cast

import pytest
from conftest import contract
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

from layer2 import settings
from layer2.contracts import ApiState, CoordinatorConfig, Hello, StatusMessage
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import (
    BAD_HELLO,
    HELLO_TIMEOUT,
    REJECTED,
    REPLACED,
    create_control_app,
    create_dashboard_app,
)

HELLO = contract("hello.json")
APPROVED_NAME = "Kitchen laptop (approved)"


def status_message() -> str:
    return StatusMessage(
        type="status", schema_version=1, missing=[], memory_free_gb=4.0, cpu_percent=10.0
    ).model_dump_json()


@pytest.fixture
def config(tmp_path: Path) -> CoordinatorConfig:
    accepted = contract("accepted-workers.json")
    accepted["workers"][0]["display_name"] = APPROVED_NAME
    accepted_file = tmp_path / "accepted-workers.json"
    accepted_file.write_text(json.dumps(accepted), encoding="utf-8")
    data = {
        **contract("coordinator.json"),
        "accepted_workers_file": str(accepted_file),
        "state_dir": str(tmp_path),
        "stop_file": str(tmp_path / "coordinator.stop"),
    }
    return CoordinatorConfig.model_validate(data)


@pytest.fixture
def registry() -> Registry[WebSocket]:
    return Registry()


@pytest.fixture
def control(config: CoordinatorConfig, registry: Registry[WebSocket]) -> TestClient:
    return TestClient(create_control_app(config, registry))


@pytest.fixture
def dashboard(registry: Registry[WebSocket]) -> TestClient:
    return TestClient(create_dashboard_app(registry))


def node_id() -> str:
    node: str = contract("accepted-workers.json")["workers"][0]["node_id"]
    return node


def test_accepted_hello_is_welcomed_and_listed(control: TestClient, dashboard: TestClient) -> None:
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        assert json.loads(socket.receive_text()) == {
            "type": "welcome",
            "schema_version": 1,
            "accepted": True,
            "node_id": node_id(),
        }
        state = ApiState.model_validate(dashboard.get("/api/state").json())
        [laptop] = state.laptops
        assert (laptop.node_id, laptop.display_name) == (node_id(), APPROVED_NAME)


def test_unknown_token_is_rejected_and_closed(control: TestClient) -> None:
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps({**HELLO, "token": "f" * 64}))
        assert json.loads(socket.receive_text()) == contract("welcome-rejected.json")
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_text()
        assert closed.value.code == REJECTED


@pytest.mark.parametrize(
    "first", ["not json", json.dumps({"type": "status"}), status_message(), b"binary"]
)
def test_first_message_must_be_hello(control: TestClient, first: str | bytes) -> None:
    with control.websocket_connect("/ws") as socket:
        if isinstance(first, bytes):
            socket.send_bytes(first)
        else:
            socket.send_text(first)
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_text()
        assert closed.value.code == BAD_HELLO


def test_no_hello_in_time_is_closed(control: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "HELLO_TIMEOUT_S", 0.2)
    with control.websocket_connect("/ws") as socket, pytest.raises(WebSocketDisconnect) as closed:
        socket.receive_text()
    assert closed.value.code == HELLO_TIMEOUT


def test_second_hello_closes_the_first_connection(control: TestClient) -> None:
    with control.websocket_connect("/ws") as first:
        first.send_text(json.dumps(HELLO))
        first.receive_text()
        with control.websocket_connect("/ws") as second:
            second.send_text(json.dumps(HELLO))
            assert json.loads(second.receive_text())["accepted"] is True
            with pytest.raises(WebSocketDisconnect) as closed:
                first.receive_text()
            assert closed.value.code == REPLACED


def test_status_updates_the_laptop(
    control: TestClient, dashboard: TestClient, registry: Registry[WebSocket]
) -> None:
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        socket.receive_text()
        missing = [{"id": "ollama", "reason": "not reachable", "required": False}]
        message = json.loads(status_message())
        socket.send_text(json.dumps(message))
        socket.send_text("not a status")
        socket.send_bytes(b"binary")
        socket.send_text(json.dumps({**message, "missing": missing}))
        socket.close()
    [laptop] = dashboard.get("/api/state").json()["laptops"]
    assert laptop["missing"] == missing


def test_unreadable_accepted_workers_closes_without_a_welcome(
    control: TestClient, config: CoordinatorConfig
) -> None:
    Path(config.accepted_workers_file).write_text("{", encoding="utf-8")
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        with pytest.raises(WebSocketDisconnect):
            socket.receive_text()


def test_tokens_never_reach_the_log(control: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    token = HELLO["token"]
    for hello in (
        {**HELLO, "token": token.upper()},
        {**HELLO, "display_name": 7},
        {**HELLO, "token": "f" * 64},
        HELLO,
    ):
        with control.websocket_connect("/ws") as socket:
            socket.send_text(json.dumps(hello))
            with contextlib.suppress(WebSocketDisconnect):
                socket.receive_text()
    logged = caplog.text
    assert token[:16] not in logged and token.upper()[:16] not in logged
    assert "f" * 32 not in logged


def test_dashboard_page_polls_api_state(dashboard: TestClient) -> None:
    page = dashboard.get("/")
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    assert "/api/state" in page.text
    assert "textContent" in page.text and "innerHTML" not in page.text


def test_api_state_has_the_contract_keys(dashboard: TestClient) -> None:
    assert set(dashboard.get("/api/state").json()) == set(contract("api-state.json"))


@pytest.mark.parametrize("token", ["A" * 64, "a" * 63, "not hex"])
def test_malformed_token_gets_welcome_rejected(control: TestClient, token: str) -> None:
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps({**HELLO, "token": token}))
        assert json.loads(socket.receive_text()) == contract("welcome-rejected.json")


class DeadSocket:
    """An old connection whose peer is gone: closing it fails the way uvicorn's does."""

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        raise WebSocketDisconnect(1006)


def test_dead_old_connection_does_not_lock_the_laptop_out(
    control: TestClient, dashboard: TestClient, registry: Registry[WebSocket]
) -> None:
    registry.join(node_id(), Hello.model_validate(HELLO), cast(WebSocket, DeadSocket()))
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        assert json.loads(socket.receive_text())["accepted"] is True
        missing = [{"id": "ollama", "reason": "not reachable", "required": False}]
        socket.send_text(json.dumps({**json.loads(status_message()), "missing": missing}))
        socket.close()
    assert dashboard.get("/api/state").json()["laptops"][0]["missing"] == missing


def test_client_chosen_field_names_cannot_forge_log_lines(
    control: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps({**HELLO, "x\nFORGED " + "y" * 500: 1}))
        with contextlib.suppress(WebSocketDisconnect):
            socket.receive_text()
    assert all("\n" not in record.getMessage() for record in caplog.records)
    assert all(len(record.getMessage()) < 400 for record in caplog.records)


def test_bad_messages_are_logged_once_per_connection(
    control: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        socket.receive_text()
        for _ in range(20):
            socket.send_text("not a status")
        socket.close()
    ignored = [r for r in caplog.records if "bad message" in r.getMessage()]
    assert len(ignored) == 1


def test_dashboard_marks_laptops_unknown_when_the_coordinator_is_down(
    dashboard: TestClient,
) -> None:
    page = dashboard.get("/").text
    assert "markAllUnknown" in page
