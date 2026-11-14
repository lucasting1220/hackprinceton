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
