import asyncio
import json
import threading
from pathlib import Path

import pytest
from conftest import contract

from layer2 import settings
from layer2.contracts import WorkerConfig, WorkerStatus
from layer2.files import (
    ConfigError,
    load_config,
    load_json_model,
    wait_for_stop_file,
    write_json_atomic,
)

STATUS = WorkerStatus.model_validate(contract("worker-status.json"))


def test_load_valid_config(tmp_path: Path) -> None:
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(contract("worker.json")), encoding="utf-8")
    assert load_json_model(path, WorkerConfig).node_id == "node-uuid"


@pytest.mark.parametrize(
    "text",
    ["not json", "{}", json.dumps({**contract("worker.json"), "extra": True})],
)
def test_bad_config_raises(tmp_path: Path, text: str) -> None:
    path = tmp_path / "worker.json"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError):
        load_json_model(path, WorkerConfig)


def test_missing_config_raises(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_json_model(tmp_path / "absent.json", WorkerConfig)


def test_write_leaves_only_the_target(tmp_path: Path) -> None:
    target = tmp_path / "worker-status.json"
    write_json_atomic(target, STATUS)
    assert [p.name for p in tmp_path.iterdir()] == ["worker-status.json"]
    assert WorkerStatus.model_validate_json(target.read_text(encoding="utf-8")) == STATUS


def test_reader_never_sees_a_partial_file(tmp_path: Path) -> None:
    target = tmp_path / "worker-status.json"
    write_json_atomic(target, STATUS)
    done = threading.Event()

    def keep_writing() -> None:
        for _ in range(300):
            write_json_atomic(target, STATUS)
        done.set()

    writer = threading.Thread(target=keep_writing)
    writer.start()
    reads = 0
    while not done.is_set():
        WorkerStatus.model_validate_json(target.read_text(encoding="utf-8"))
        reads += 1
    writer.join()
    assert reads > 0


def test_busy_file_is_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    real_replace = Path.replace
    failures = [PermissionError("busy"), PermissionError("busy")]

    def flaky_replace(self: Path, target: Path) -> Path:
        if failures:
            raise failures.pop()
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    write_json_atomic(tmp_path / "worker-status.json", STATUS)
    assert not failures
    assert (tmp_path / "worker-status.json").exists()


def test_busy_file_gives_up_and_cleans_up(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def always_busy(self: Path, target: Path) -> Path:
        raise PermissionError("busy")

    monkeypatch.setattr(Path, "replace", always_busy)
    monkeypatch.setattr(settings, "FILE_BUSY_RETRY_S", 0.1)
    with pytest.raises(PermissionError):
        write_json_atomic(tmp_path / "worker-status.json", STATUS)
    assert list(tmp_path.iterdir()) == []


def test_stop_file_wait_returns_once_it_appears(tmp_path: Path) -> None:
    stop = tmp_path / "worker.stop"

    async def scenario() -> None:
        waiter = asyncio.create_task(wait_for_stop_file(stop, poll_s=0.01))
        await asyncio.sleep(0.05)
        assert not waiter.done()
        stop.touch()
        await asyncio.wait_for(waiter, timeout=1)

    asyncio.run(scenario())


def _worker_config(tmp_path: Path, **changes: object) -> Path:
    """worker.json with every path pointing inside tmp_path, absolute on this OS."""
    data = contract("worker.json")
    for key in ("token_file", "python", "status_file", "stop_file", "state_dir"):
        data[key] = str(tmp_path / key)
    data.update(changes)
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_load_config_with_absolute_paths(tmp_path: Path) -> None:
    config = load_config(_worker_config(tmp_path), WorkerConfig)
    assert config.status_file == str(tmp_path / "status_file")


@pytest.mark.parametrize("key", ["token_file", "python", "status_file", "stop_file", "state_dir"])
def test_relative_path_in_config_is_rejected(tmp_path: Path, key: str) -> None:
    with pytest.raises(ConfigError, match=key):
        load_config(_worker_config(tmp_path, **{key: "relative/path"}), WorkerConfig)
