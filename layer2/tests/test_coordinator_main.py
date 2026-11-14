import json
import socket
import threading
import time
import urllib.request
from pathlib import Path

import pytest
from conftest import closed_port, contract
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from layer2 import settings
from layer2.coordinator.main import main


def write_config(tmp_path: Path, **changes: object) -> Path:
    accepted = tmp_path / "accepted-workers.json"
    accepted.write_text(json.dumps(contract("accepted-workers.json")), encoding="utf-8")
    ports = [closed_port() for _ in range(3)]
    data = {
        **contract("coordinator.json"),
        "listen_port": ports[0],
        "dashboard_port": ports[1],
        "client_port": ports[2],
        "accepted_workers_file": str(accepted),
        "state_dir": str(tmp_path),
        "stop_file": str(tmp_path / "coordinator.stop"),
        **changes,
    }
    path = tmp_path / "coordinator.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class Running:
    """main() on a background thread, with its result."""

    def __init__(self, config: Path) -> None:
        self.result: list[int] = []
        self.thread = threading.Thread(
            target=lambda: self.result.append(main(["--config", str(config)])), daemon=True
        )
        self.thread.start()

    def wait(self, timeout: float) -> int | None:
        self.thread.join(timeout)
        return self.result[0] if self.result else None


def wait_until_serving(port: int, deadline_s: float = 10.0) -> None:
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError("coordinator did not start")


@pytest.fixture(autouse=True)
def fast_stop_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)


def test_bad_config_exits_2(tmp_path: Path) -> None:
    assert main(["--config", str(tmp_path / "absent.json")]) == 2
    relative = write_config(tmp_path, stop_file="coordinator.stop")
    assert main(["--config", str(relative)]) == 2


def test_joins_over_a_real_socket_then_stops_on_the_stop_file(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    with connect(f"ws://127.0.0.1:{config['listen_port']}/ws", open_timeout=5) as worker:
        worker.send(json.dumps(contract("hello.json")))
        assert json.loads(worker.recv(timeout=5))["accepted"] is True
        Path(config["stop_file"]).touch()
        started = time.monotonic()
        assert running.wait(settings.STOP_DEADLINE_S) == 0
        assert time.monotonic() - started < settings.STOP_DEADLINE_S


def test_oversized_message_closes_the_connection(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    try:
        with connect(f"ws://127.0.0.1:{config['listen_port']}/ws", open_timeout=5) as worker:
            worker.send("x" * (settings.WS_MAX_MESSAGE_BYTES + 1))
            with pytest.raises(ConnectionClosed):
                worker.recv(timeout=5)
    finally:
        Path(config["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_dashboard_listens_only_on_localhost(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    try:
        wait_until_serving(config["dashboard_port"])
        outward = socket.gethostbyname(socket.gethostname())
        if outward.startswith("127."):
            pytest.skip("this machine has no address other than localhost")
        with (
            pytest.raises(OSError),
            socket.create_connection((outward, config["dashboard_port"]), 1),
        ):
            pass
    finally:
        Path(config["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_stale_stop_file_is_removed_at_start(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    stop = Path(config["stop_file"])
    stop.touch()
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    assert running.wait(0.5) is None
    stop.touch()
    assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_port_in_use_exits_1(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", config["dashboard_port"]))
        holder.listen(1)
        running = Running(config_path)
        assert running.wait(settings.STOP_DEADLINE_S) == 1
