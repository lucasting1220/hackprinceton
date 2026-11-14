import asyncio
import json
import os
import stat
import threading
import time
import traceback
from pathlib import Path

import pytest
from conftest import contract

from layer2 import settings
from layer2.contracts import CoordinatorConfig, WorkerConfig, WorkerStatus
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
    """On Windows a reader can find the file busy during the rename; it must never find it
    half written. Busy reads are retried, as every reader of these files must do."""
    target = tmp_path / "worker-status.json"
    write_json_atomic(target, STATUS)
    done = threading.Event()
    writer_errors: list[BaseException] = []

    def keep_writing() -> None:
        try:
            for _ in range(300):
                write_json_atomic(target, STATUS)
        except BaseException as error:
            writer_errors.append(error)
        finally:
            done.set()

    writer = threading.Thread(target=keep_writing)
    writer.start()
    deadline = time.monotonic() + 30
    reads = 0
    while not done.is_set() and time.monotonic() < deadline:
        try:
            text = target.read_text(encoding="utf-8")
        except PermissionError:
            continue
        WorkerStatus.model_validate_json(text)
        reads += 1
    writer.join(timeout=30)
    assert not writer_errors
    assert done.is_set()
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


def test_coordinator_relative_path_is_rejected(tmp_path: Path) -> None:
    data = contract("coordinator.json")
    for key in ("accepted_workers_file", "state_dir", "stop_file"):
        data[key] = str(tmp_path / key)
    data["accepted_workers_file"] = "accepted-workers.json"
    path = tmp_path / "coordinator.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ConfigError, match="accepted_workers_file"):
        load_config(path, CoordinatorConfig)


def test_config_with_byte_order_mark_loads(tmp_path: Path) -> None:
    path = tmp_path / "worker.json"
    path.write_bytes(b"\xef\xbb\xbf" + json.dumps(contract("worker.json")).encode("utf-8"))
    assert load_json_model(path, WorkerConfig).node_id == "node-uuid"


def test_config_that_will_not_decode(tmp_path: Path) -> None:
    path = tmp_path / "worker.json"
    path.write_bytes(b"\xff\xfe{}")
    with pytest.raises(ConfigError):
        load_json_model(path, WorkerConfig)


SENTINEL = "c0ffee" * 10


@pytest.mark.parametrize(
    "text",
    [SENTINEL, json.dumps({**contract("worker.json"), "frame_feed_port": SENTINEL})],
)
def test_config_error_never_shows_values(tmp_path: Path, text: str) -> None:
    path = tmp_path / "worker.json"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError) as raised:
        load_json_model(path, WorkerConfig)
    assert SENTINEL[:12] not in "".join(traceback.format_exception(raised.value))


def test_busy_config_read_is_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(contract("worker.json")), encoding="utf-8")
    real_read_text = Path.read_text
    failures = [PermissionError("busy"), PermissionError("busy")]

    def flaky_read_text(self: Path, encoding: str | None = None, errors: str | None = None) -> str:
        if failures:
            raise failures.pop()
        return real_read_text(self, encoding=encoding, errors=errors)

    monkeypatch.setattr(Path, "read_text", flaky_read_text)
    assert load_json_model(path, WorkerConfig).node_id == "node-uuid"
    assert not failures


def test_failed_write_leaves_no_temp_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken_dump(self: WorkerStatus, **kwargs: object) -> str:
        raise RuntimeError("cannot serialize")

    monkeypatch.setattr(WorkerStatus, "model_dump_json", broken_dump)
    with pytest.raises(RuntimeError):
        write_json_atomic(tmp_path / "worker-status.json", STATUS)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.skipif(os.name == "nt", reason="Windows has no Unix permission bits")
def test_write_keeps_the_target_permissions(tmp_path: Path) -> None:
    target = tmp_path / "worker-status.json"
    write_json_atomic(target, STATUS)
    assert stat.S_IMODE(target.stat().st_mode) == 0o644
    target.chmod(0o640)
    write_json_atomic(target, STATUS)
    assert stat.S_IMODE(target.stat().st_mode) == 0o640
