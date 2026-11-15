import logging
from datetime import UTC, datetime, timedelta

import pytest
from conftest import contract
from pydantic import ValidationError

from layer2 import settings
from layer2.contracts import ApiState, Hello, MissingItem, StatusMessage
from layer2.coordinator.registry import Registry

HELLO = Hello.model_validate(contract("hello.json"))
START = datetime(2026, 11, 14, 3, 0, 0, tzinfo=UTC)


class Clock:
    """A clock the test moves by hand: wall time for last_status_at, monotonic for windows."""

    def __init__(self) -> None:
        self.now = START
        self.mono = 1000.0

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)
        self.mono += seconds


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def registry(clock: Clock) -> Registry[str]:
    return Registry(now=lambda: clock.now, monotonic=lambda: clock.mono)


def status(missing: list[MissingItem] | None = None) -> StatusMessage:
    return StatusMessage(
        type="status", schema_version=1, missing=missing or [], memory_free_gb=8.0, cpu_percent=12.5
    )


def test_join_lists_the_laptop(registry: Registry[str]) -> None:
    assert registry.join("node-1", HELLO, "conn-a") is None
    state = registry.api_state()
    [laptop] = state.laptops
    assert (laptop.node_id, laptop.display_name) == ("node-1", HELLO.display_name)
    assert laptop.sensors == ["camera", "mic"]
    assert laptop.last_status_at == START
    assert state.jobs == [] and state.dropped == []


def test_api_state_matches_the_contract_shape(registry: Registry[str]) -> None:
    registry.join("node-uuid", HELLO, "conn-a")
    dumped = registry.api_state().model_dump(mode="json")
    expected = contract("api-state.json")
    assert set(dumped) == set(expected)
    assert set(dumped["laptops"][0]) == set(expected["laptops"][0])
    ApiState.model_validate(dumped)


def test_only_named_sensors_are_listed(registry: Registry[str]) -> None:
    no_mic = HELLO.model_copy(update={"sensors": HELLO.sensors.model_copy(update={"mic": None})})
    registry.join("node-1", no_mic, "conn-a")
    assert registry.api_state().laptops[0].sensors == ["camera"]


def test_second_hello_replaces_the_first_connection(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    assert registry.join("node-1", HELLO, "conn-b") == "conn-a"
    assert len(registry.api_state().laptops) == 1
    assert registry.is_current("node-1", "conn-b")
    assert not registry.is_current("node-1", "conn-a")


def test_status_updates_time_and_missing(registry: Registry[str], clock: Clock) -> None:
    registry.join("node-1", HELLO, "conn-a")
    clock.advance(5)
    item = MissingItem(id="ollama", reason="not reachable", required=False)
    registry.status("node-1", "conn-a", status([item]))
    [laptop] = registry.api_state().laptops
    assert laptop.last_status_at == START + timedelta(seconds=5)
    assert laptop.missing == [item]


def test_status_from_a_replaced_connection_is_ignored(
    registry: Registry[str], clock: Clock
) -> None:
    registry.join("node-1", HELLO, "conn-a")
    registry.join("node-1", HELLO, "conn-b")
    clock.advance(5)
    registry.status("node-1", "conn-a", status())
    assert registry.api_state().laptops[0].last_status_at == START


def test_quiet_laptop_stays_listed_with_its_old_time(registry: Registry[str], clock: Clock) -> None:
    registry.join("node-1", HELLO, "conn-a")
    registry.leave("node-1", "conn-a")
    clock.advance(60)
    [laptop] = registry.api_state().laptops
    assert laptop.last_status_at == START
    assert registry.api_state().updated_at == START + timedelta(seconds=60)
    assert not registry.is_current("node-1", "conn-a")


def test_leave_from_a_replaced_connection_keeps_the_new_one(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    registry.join("node-1", HELLO, "conn-b")
    registry.leave("node-1", "conn-a")
    assert registry.is_current("node-1", "conn-b")


def test_many_replacements_in_a_minute_warn(
    registry: Registry[str], clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    registry.join("node-1", HELLO, "conn-0")
    for n in range(1, settings.REPLACEMENT_WARN_COUNT + 1):
        clock.advance(1)
        registry.join("node-1", HELLO, f"conn-{n}")
    assert not caplog.records
    clock.advance(1)
    registry.join("node-1", HELLO, "conn-last")
    [record] = caplog.records
    assert "node-1" in record.getMessage()
    assert HELLO.token not in record.getMessage()


def test_replacements_spread_over_time_do_not_warn(
    registry: Registry[str], clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    registry.join("node-1", HELLO, "conn-0")
    for n in range(1, 10):
        clock.advance(settings.REPLACEMENT_WARN_WINDOW_S / 2)
        registry.join("node-1", HELLO, f"conn-{n}")
    assert not caplog.records


def test_status_message_round_trips() -> None:
    message = status()
    assert StatusMessage.model_validate_json(message.model_dump_json()) == message


def test_rejoin_after_leave_is_not_a_replacement(
    registry: Registry[str], clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    connections = [f"conn-{n}" for n in range(settings.REPLACEMENT_WARN_COUNT + 3)]
    registry.join("node-1", HELLO, connections[0])
    for previous, current in zip(connections, connections[1:], strict=False):
        registry.leave("node-1", previous)
        clock.advance(1)
        assert registry.join("node-1", HELLO, current) is None
    assert not caplog.records


def test_rejoin_shows_the_new_name_and_sensors(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    registry.leave("node-1", "conn-a")
    renamed = HELLO.model_copy(
        update={
            "display_name": "Renamed",
            "sensors": HELLO.sensors.model_copy(update={"camera": None}),
        }
    )
    registry.join("node-1", renamed, "conn-b")
    [laptop] = registry.api_state().laptops
    assert (laptop.display_name, laptop.sensors) == ("Renamed", ["mic"])


def test_rejoin_clears_the_old_missing_list(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    item = MissingItem(id="ollama", reason="not reachable", required=False)
    registry.status("node-1", "conn-a", status([item]))
    registry.join("node-1", HELLO, "conn-b")
    assert registry.api_state().laptops[0].missing == []


def test_rejoin_without_status_lets_the_laptop_go_quiet(
    registry: Registry[str], clock: Clock
) -> None:
    registry.join("node-1", HELLO, "conn-0")
    for n in range(1, 6):
        clock.advance(3)
        registry.join("node-1", HELLO, f"conn-{n}")
    assert registry.api_state().laptops[0].last_status_at == START


def test_sharing_warning_is_logged_once_per_window(
    registry: Registry[str], clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    registry.join("node-1", HELLO, "conn-0")
    for n in range(1, 20):
        clock.advance(1)
        registry.join("node-1", HELLO, f"conn-{n}")
    assert len(caplog.records) == 1
    clock.advance(settings.REPLACEMENT_WARN_WINDOW_S)
    for n in range(20, 26):
        clock.advance(1)
        registry.join("node-1", HELLO, f"conn-{n}")
    assert len(caplog.records) == 2


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("memory_free_gb", float("inf")),
        ("memory_free_gb", "3"),
        ("cpu_percent", True),
        ("cpu_percent", 101),
        ("missing", [{"id": "x", "reason": "y", "required": False}] * 101),
    ],
)
def test_bad_status_message_is_rejected(field: str, value: object) -> None:
    data = status().model_dump()
    with pytest.raises(ValidationError):
        StatusMessage.model_validate({**data, field: value})


def test_hardware_lists_specs_and_tools_from_hello(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    [laptop] = registry.hardware().laptops
    assert (laptop.node_id, laptop.display_name) == ("node-1", HELLO.display_name)
    assert (laptop.specs, laptop.tools) == (HELLO.specs, HELLO.tools)
    assert laptop.memory_free_gb is None and laptop.cpu_percent is None


def test_hardware_shows_the_latest_load(registry: Registry[str], clock: Clock) -> None:
    registry.join("node-1", HELLO, "conn-a")
    clock.advance(2)
    registry.status("node-1", "conn-a", status())
    [laptop] = registry.hardware().laptops
    assert (laptop.memory_free_gb, laptop.cpu_percent) == (8.0, 12.5)
    assert laptop.last_status_at == START + timedelta(seconds=2)
    assert registry.hardware().updated_at == START + timedelta(seconds=2)


def test_rejoin_refreshes_specs_and_clears_the_old_load(registry: Registry[str]) -> None:
    registry.join("node-1", HELLO, "conn-a")
    registry.status("node-1", "conn-a", status())
    upgraded = HELLO.model_copy(update={"specs": HELLO.specs.model_copy(update={"memory_gb": 64})})
    registry.join("node-1", upgraded, "conn-b")
    [laptop] = registry.hardware().laptops
    assert laptop.specs.memory_gb == 64
    assert laptop.memory_free_gb is None and laptop.cpu_percent is None
