from pathlib import Path

import pytest
from conftest import contract

from layer2.contracts import AcceptedWorkers
from layer2.tokens import (
    TokenError,
    find_node_id,
    is_well_formed,
    read_token_file,
    token_sha256,
)

EXAMPLE_TOKEN: str = contract("hello.json")["token"]
ACCEPTED = AcceptedWorkers.model_validate(contract("accepted-workers.json"))


def test_example_token_hashes_to_the_accepted_entry() -> None:
    assert token_sha256(EXAMPLE_TOKEN) == ACCEPTED.workers[0].token_sha256
    assert find_node_id(EXAMPLE_TOKEN, ACCEPTED) == ACCEPTED.workers[0].node_id


def test_unknown_token_finds_no_laptop() -> None:
    assert find_node_id("f" * 64, ACCEPTED) is None


@pytest.mark.parametrize(
    ("token", "ok"),
    [
        (EXAMPLE_TOKEN, True),
        (EXAMPLE_TOKEN.upper(), False),
        (EXAMPLE_TOKEN[:-1], False),
        (EXAMPLE_TOKEN + "0", False),
        (EXAMPLE_TOKEN + "\n", False),
        ("g" * 64, False),
    ],
)
def test_token_format(token: str, ok: bool) -> None:
    assert is_well_formed(token) is ok


def test_read_token_file(tmp_path: Path) -> None:
    path = tmp_path / "worker-token"
    path.write_text(EXAMPLE_TOKEN, encoding="utf-8")
    assert read_token_file(path) == EXAMPLE_TOKEN


def test_bad_token_file_error_never_shows_the_token(tmp_path: Path) -> None:
    path = tmp_path / "worker-token"
    path.write_text(EXAMPLE_TOKEN + "\n", encoding="utf-8")
    with pytest.raises(TokenError) as raised:
        read_token_file(path)
    assert EXAMPLE_TOKEN not in str(raised.value)


def test_missing_token_file(tmp_path: Path) -> None:
    with pytest.raises(TokenError):
        read_token_file(tmp_path / "absent")
