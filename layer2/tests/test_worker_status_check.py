import asyncio
import io
import json
from collections.abc import Awaitable
from datetime import UTC, datetime
from pathlib import Path

import pytest
from conftest import closed_port, contract

from layer2 import settings
from layer2.contracts import CheckOutput, MissingItem, WorkerStatus
from layer2.worker.check import EXIT_MISSING, EXIT_OK, run_check
from layer2.worker.status_file import status_writer

TOKEN: str = contract("hello.json")["token"]
NOW = datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
OLLAMA_DOWN = MissingItem(id="ollama", reason="not reachable", required=False)


@pytest.fixture(autouse=True)
def fast_ollama_check(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)


def run(awaitable: Awaitable[None]) -> None:
    async def wait() -> None:
        await awaitable

    asyncio.run(wait())


def write_config(tmp_path: Path, ollama_url: str | None = None, token: str = TOKEN) -> Path:
    token_file = tmp_path / "worker-token"
    token_file.write_text(token, encoding="utf-8")
    data = {
        **contract("worker.json"),
        "token_file": str(token_file),
        "ollama_url": ollama_url or f"http://127.0.0.1:{closed_port()}",
        "python": str(tmp_path / "python"),
        "status_file": str(tmp_path / "worker-status.json"),
        "stop_file": str(tmp_path / "worker.stop"),
        "state_dir": str(tmp_path),
    }
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_status_file_matches_the_contract(tmp_path: Path) -> None:
    path = tmp_path / "worker-status.json"
    write = status_writer(path, "node-uuid", now=lambda: NOW)
    run(write("connected", [OLLAMA_DOWN]))
    written = json.loads(path.read_text(encoding="utf-8"))
    assert written.keys() == contract("worker-status.json").keys()
    assert written["updated_at"] == "2026-11-14T03:12:45Z"
    status = WorkerStatus.model_validate(written)
    assert (status.node_id, status.state, status.missing) == (
        "node-uuid",
        "connected",
        [OLLAMA_DOWN],
    )


def test_each_report_replaces_the_status_file(tmp_path: Path) -> None:
    path = tmp_path / "worker-status.json"
    write = status_writer(path, "node-uuid")
    run(write("disconnected", []))
    run(write("rejected", []))
    status = WorkerStatus.model_validate_json(path.read_text(encoding="utf-8"))
    assert status.state == "rejected"
    assert status.updated_at.tzinfo == UTC
    assert [p.name for p in tmp_path.iterdir()] == ["worker-status.json"]


def test_status_write_failure_is_an_os_error(tmp_path: Path) -> None:
    """The client logs OSError from a report and keeps going; the writer must raise only that."""
    write = status_writer(tmp_path / "missing-folder" / "worker-status.json", "node-uuid")
    with pytest.raises(OSError):
        run(write("connected", []))


def test_check_json_prints_the_contract_shape(tmp_path: Path, ollama_url: str) -> None:
    out = io.StringIO()
    assert run_check(write_config(tmp_path, ollama_url), as_json=True, out=out) == EXIT_OK
    printed = json.loads(out.getvalue())
    assert printed.keys() == contract("check-output.json").keys()
    assert CheckOutput.model_validate(printed) == CheckOutput(schema_version=1, ok=True, missing=[])


def test_check_without_ollama_is_still_ok(tmp_path: Path) -> None:
    out = io.StringIO()
    assert run_check(write_config(tmp_path), as_json=True, out=out) == EXIT_OK
    printed = CheckOutput.model_validate_json(out.getvalue())
    assert printed.ok
    assert [item.id for item in printed.missing] == ["ollama"]
    assert not printed.missing[0].required


def test_check_exits_4_when_the_token_is_bad(tmp_path: Path, ollama_url: str) -> None:
    out = io.StringIO()
    config = write_config(tmp_path, ollama_url, token="not-a-token")
    assert run_check(config, as_json=True, out=out) == EXIT_MISSING == 4
    printed = CheckOutput.model_validate_json(out.getvalue())
    assert not printed.ok
    assert [(item.id, item.required) for item in printed.missing] == [("token", True)]
    assert "not-a-token" not in out.getvalue()


def test_check_exits_4_when_the_config_is_missing(tmp_path: Path) -> None:
    out = io.StringIO()
    assert run_check(tmp_path / "nope.json", as_json=True, out=out) == EXIT_MISSING
    printed = CheckOutput.model_validate_json(out.getvalue())
    assert [item.id for item in printed.missing] == ["config"]


def test_check_without_json_prints_readable_lines(tmp_path: Path) -> None:
    out = io.StringIO()
    assert run_check(write_config(tmp_path), as_json=False, out=out) == EXIT_OK
    text = out.getvalue()
    assert text.startswith("OK")
    assert "ollama (optional): not reachable" in text
    with pytest.raises(json.JSONDecodeError):
        json.loads(text)
