"""Messages from Layer 1's bridge, handed to the worker whose job subscribed."""

import asyncio
import json
from pathlib import Path

import pytest
from conftest import contract
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket

from layer2 import settings
from layer2.contracts import CoordinatorConfig, Deliver
from layer2.coordinator.inbox import Subscriptions, create_client_app
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_control_app

HELLO = contract("hello.json")
REQUEST = {"request_id": "r-1", "device_id": "phone-1", "kind": "ask", "text": "How is Mum?"}


@pytest.fixture
def config(tmp_path: Path) -> CoordinatorConfig:
    accepted = tmp_path / "accepted-workers.json"
    accepted.write_text(json.dumps(contract("accepted-workers.json")), encoding="utf-8")
    data = {
        **contract("coordinator.json"),
        "accepted_workers_file": str(accepted),
        "state_dir": str(tmp_path),
        "stop_file": str(tmp_path / "coordinator.stop"),
    }
    return CoordinatorConfig.model_validate(data)


def bridge_client(subscriptions: Subscriptions) -> TestClient:
    return TestClient(create_client_app(subscriptions), base_url="http://127.0.0.1")


def test_a_subscribed_worker_gets_the_bridges_message_as_is(config: CoordinatorConfig) -> None:
    subscriptions = Subscriptions()
    control = TestClient(
        create_control_app(config, Registry[WebSocket](), subscriptions=subscriptions)
    )
    bridge = bridge_client(subscriptions)
    with control.websocket_connect("/ws") as socket:
        socket.send_text(json.dumps(HELLO))
        socket.receive_text()
        socket.send_text(json.dumps({"type": "subscribe", "schema_version": 1, "kind": "requests"}))
        for _ in range(100):  # the subscribe is handled on the server's loop
            if subscriptions.taker("requests"):
                break
            asyncio.run(asyncio.sleep(0.01))
        answer = bridge.post("/v1/requests", json=REQUEST)
        assert (answer.status_code, answer.json()) == (202, {"accepted": True})
        delivered = Deliver.model_validate_json(socket.receive_text())
        assert (delivered.kind, delivered.body) == ("requests", REQUEST)
        assert bridge.post("/v1/watch-data", json={"device_id": "w"}).status_code == 503
    for _ in range(100):  # the disconnect is handled on the server's loop
        if subscriptions.taker("requests") is None:
            break
        asyncio.run(asyncio.sleep(0.01))
    assert bridge.post("/v1/requests", json=REQUEST).status_code == 503


def test_nobody_subscribed_means_503_so_the_bridge_retries() -> None:
    answer = bridge_client(Subscriptions()).post("/v1/watch-data", json={"device_id": "w"})
    assert answer.status_code == 503
    assert answer.json() == {"error": "no job is taking watch-data right now"}


def test_bad_bodies_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = bridge_client(Subscriptions())
    assert bridge.post("/v1/requests", content=b"not json").status_code == 400
    assert bridge.post("/v1/requests", json=[1, 2]).status_code == 400
    monkeypatch.setattr(settings, "INBOUND_MAX_BYTES", 10)
    assert bridge.post("/v1/requests", json=REQUEST).status_code == 413


def test_only_this_machine_may_post() -> None:
    outsider = TestClient(create_client_app(Subscriptions()), base_url="http://attacker.example")
    assert outsider.post("/v1/requests", json=REQUEST).status_code == 400


def test_the_latest_subscriber_wins_and_a_dead_one_is_dropped() -> None:
    subscriptions = Subscriptions()
    seen: list[str] = []

    async def first(text: str) -> None:
        seen.append("first")

    async def broken(text: str) -> None:
        raise RuntimeError("connection closed")

    async def scenario() -> None:
        subscriptions.subscribe("requests", "node-a", first)
        subscriptions.subscribe("requests", "node-b", broken)
        assert subscriptions.taker("requests") == "node-b"
        assert not await subscriptions.deliver("requests", REQUEST)
        assert subscriptions.taker("requests") is None
        subscriptions.subscribe("requests", "node-a", first)
        assert await subscriptions.deliver("requests", REQUEST)

    asyncio.run(scenario())
    assert seen == ["first"]
