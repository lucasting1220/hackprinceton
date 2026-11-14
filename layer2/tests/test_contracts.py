import pytest
from conftest import contract
from pydantic import BaseModel, ValidationError

from layer2.contracts import (
    AcceptedWorkers,
    ApiState,
    CheckOutput,
    CoordinatorConfig,
    Hello,
    WelcomeAccepted,
    WelcomeRejected,
    WorkerConfig,
    WorkerStatus,
)

FILES: list[tuple[str, type[BaseModel]]] = [
    ("coordinator.json", CoordinatorConfig),
    ("worker.json", WorkerConfig),
    ("accepted-workers.json", AcceptedWorkers),
    ("worker-status.json", WorkerStatus),
    ("check-output.json", CheckOutput),
    ("api-state.json", ApiState),
    ("hello.json", Hello),
    ("welcome-accepted.json", WelcomeAccepted),
    ("welcome-rejected.json", WelcomeRejected),
]


@pytest.mark.parametrize(("name", "model"), FILES)
def test_contract_file_round_trips_exactly(name: str, model: type[BaseModel]) -> None:
    original = contract(name)
    assert model.model_validate(original).model_dump(mode="json") == original


@pytest.mark.parametrize(("name", "model"), FILES)
def test_unknown_field_is_rejected(name: str, model: type[BaseModel]) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**contract(name), "unexpected": 1})


def test_hello_repr_hides_the_token() -> None:
    hello = Hello.model_validate(contract("hello.json"))
    assert hello.token not in repr(hello)
    assert hello.token not in str(hello)


@pytest.mark.parametrize(
    ("name", "model", "field", "value"),
    [
        ("coordinator.json", CoordinatorConfig, "listen_port", 0),
        ("coordinator.json", CoordinatorConfig, "listen_port", 65536),
        ("coordinator.json", CoordinatorConfig, "schema_version", 2),
        ("worker.json", WorkerConfig, "frame_feed_port", 0),
        ("worker-status.json", WorkerStatus, "updated_at", "2026-11-14T12:00:00"),
        ("worker-status.json", WorkerStatus, "state", "connecting"),
        ("welcome-accepted.json", WelcomeAccepted, "accepted", False),
        ("welcome-rejected.json", WelcomeRejected, "accepted", True),
        ("hello.json", Hello, "token", "A" * 64),
        ("hello.json", Hello, "token", "a" * 63),
    ],
)
def test_constrained_field_rejects_bad_value(
    name: str, model: type[BaseModel], field: str, value: object
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**contract(name), field: value})


def test_bad_token_hash_is_rejected() -> None:
    data = contract("accepted-workers.json")
    data["workers"][0]["token_sha256"] = "F" * 64
    with pytest.raises(ValidationError):
        AcceptedWorkers.model_validate(data)


@pytest.mark.parametrize("key", ["token_sha256", "node_id"])
def test_duplicate_accepted_worker_is_rejected(key: str) -> None:
    data = contract("accepted-workers.json")
    first = data["workers"][0]
    second = {"node_id": "second", "display_name": "Second", "token_sha256": "f" * 64}
    second[key] = first[key]
    with pytest.raises(ValidationError):
        AcceptedWorkers.model_validate({**data, "workers": [first, second]})


def test_bad_hello_error_hides_the_token() -> None:
    """str() and repr() are safe to log. json() and errors() echo the input unless the
    caller passes include_input=False, so the coordinator must always pass it."""
    data = contract("hello.json")
    token = data["token"].upper()
    with pytest.raises(ValidationError) as raised:
        Hello.model_validate({**data, "token": token})
    error = raised.value
    for text in (str(error), repr(error), error.json(include_input=False)):
        assert token[:16] not in text
        assert token[-16:] not in text


@pytest.mark.parametrize("field", ["dashboard_port", "client_port"])
def test_coordinator_ports_must_differ(field: str) -> None:
    data = contract("coordinator.json")
    with pytest.raises(ValidationError):
        CoordinatorConfig.model_validate({**data, field: data["listen_port"]})
