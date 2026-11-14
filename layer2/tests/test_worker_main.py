"""`layer2-worker` end to end: the real coordinator and the worker's main() on threads."""

import json
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import Running, closed_port, contract, wait_until_serving, write_coordinator_config

from layer2 import settings
from layer2.worker.main import EXIT_BAD_CONFIG, EXIT_OK, EXIT_REJECTED, main

TOKEN: str = contract("hello.json")["token"]
UNKNOWN_TOKEN = "f" * 64


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STATUS_INTERVAL_S", 0.1)
    monkeypatch.setattr(settings, "RETRY_DELAY_S", 0.1)
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.2)


@pytest.fixture
def coordinator_url(tmp_path: Path) -> Iterator[str]:
    folder = tmp_path / "coordinator"
    folder.mkdir()
    config_path = write_coordinator_config(folder)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    yield f"ws://127.0.0.1:{config['listen_port']}/ws"
    Path(config["stop_file"]).touch()
    assert running.wait(settings.STOP_DEADLINE_S) == 0


def write_worker_config(tmp_path: Path, coordinator_url: str, token: str = TOKEN) -> Path:
    folder = tmp_path / "worker"
    folder.mkdir(exist_ok=True)
    (folder / "worker-token").write_text(token, encoding="utf-8")
    data = {
        **contract("worker.json"),
        "coordinator_url": coordinator_url,
        "token_file": str(folder / "worker-token"),
        "ollama_url": f"http://127.0.0.1:{closed_port()}",
        "python": str(folder / "python"),
        "status_file": str(folder / "worker-status.json"),
        "stop_file": str(folder / "worker.stop"),
        "state_dir": str(folder),
    }
    path = folder / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class Worker:
    """The worker's main() on a background thread."""

    def __init__(self, config: Path) -> None:
        self.folder = config.parent
        self.result: list[int] = []
        self.thread = threading.Thread(
            target=lambda: self.result.append(main(["--config", str(config)])), daemon=True
        )
        self.thread.start()

    def status(self) -> dict[str, Any] | None:
        try:
            data: dict[str, Any] = json.loads(
                (self.folder / "worker-status.json").read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            return None
        return data

    def wait(self, timeout: float) -> int | None:
        self.thread.join(timeout)
        return self.result[0] if self.result else None


def wait_until(condition: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        time.sleep(0.05)


def state_of(worker: Worker) -> str | None:
    status = worker.status()
    return None if status is None else status["state"]


def test_connects_writes_status_and_stops_on_the_stop_file(
    tmp_path: Path, coordinator_url: str
) -> None:
    worker = Worker(write_worker_config(tmp_path, coordinator_url))
    wait_until(lambda: state_of(worker) == "connected")
    status = worker.status()
    assert status is not None
    assert status["node_id"] == contract("worker.json")["node_id"]
    assert [item["id"] for item in status["missing"]] == ["ollama"]
    stop_file = worker.folder / "worker.stop"
    stop_file.touch()
    started = time.monotonic()
    assert worker.wait(settings.STOP_DEADLINE_S) == EXIT_OK
    assert time.monotonic() - started < settings.STOP_DEADLINE_S
    assert state_of(worker) == "disconnected"
    assert not stop_file.exists()


def test_rejected_token_exits_3(tmp_path: Path, coordinator_url: str) -> None:
    worker = Worker(write_worker_config(tmp_path, coordinator_url, token=UNKNOWN_TOKEN))
    assert worker.wait(settings.STOP_DEADLINE_S) == EXIT_REJECTED
    assert state_of(worker) == "rejected"


def test_no_coordinator_is_disconnected_not_fatal(tmp_path: Path) -> None:
    worker = Worker(write_worker_config(tmp_path, f"ws://127.0.0.1:{closed_port()}/ws"))
    wait_until(lambda: state_of(worker) == "disconnected")
    time.sleep(0.5)  # several retries
    assert worker.thread.is_alive()
    (worker.folder / "worker.stop").touch()
    assert worker.wait(settings.STOP_DEADLINE_S) == EXIT_OK


def test_a_stop_file_already_there_means_do_not_start(tmp_path: Path) -> None:
    config = write_worker_config(tmp_path, f"ws://127.0.0.1:{closed_port()}/ws")
    stop_file = config.parent / "worker.stop"
    stop_file.touch()
    assert main(["--config", str(config)]) == EXIT_OK
    assert not stop_file.exists()
    assert not (config.parent / "worker-status.json").exists()


def test_bad_config_exits_2(tmp_path: Path) -> None:
    bad = tmp_path / "worker.json"
    bad.write_text("{}", encoding="utf-8")
    assert main(["--config", str(bad)]) == EXIT_BAD_CONFIG
    assert main(["--config", str(tmp_path / "missing.json")]) == EXIT_BAD_CONFIG


def test_bad_token_file_exits_2_without_logging_it(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    config = write_worker_config(tmp_path, "ws://127.0.0.1:1/ws", token=TOKEN + "\n")
    assert main(["--config", str(config)]) == EXIT_BAD_CONFIG
    assert TOKEN not in caplog.text


def test_check_subcommand_prints_json_only(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    config = write_worker_config(tmp_path, "ws://127.0.0.1:1/ws")
    assert main(["check", "--config", str(config), "--json"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True
    (config.parent / "worker-token").write_text("bad", encoding="utf-8")
    assert main(["check", "--config", str(config), "--json"]) == 4


def test_json_without_check_is_a_usage_error(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exit_:
        main(["--config", str(tmp_path / "worker.json"), "--json"])
    assert exit_.value.code == 2
