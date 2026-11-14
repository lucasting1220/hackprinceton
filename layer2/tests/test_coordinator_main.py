import json
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from conftest import Running, contract, wait_until_serving, write_coordinator_config
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from layer2 import settings
from layer2.coordinator import main as coordinator_main
from layer2.coordinator.main import main


@pytest.fixture(autouse=True)
def fast_stop_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    """wait_for_stop_file reads STOP_POLL_S on each call, so this takes effect."""
    monkeypatch.setattr(settings, "STOP_POLL_S", 0.05)


def test_bad_config_exits_2(tmp_path: Path) -> None:
    assert main(["--config", str(tmp_path / "absent.json")]) == 2
    relative = write_coordinator_config(tmp_path, stop_file="coordinator.stop")
    assert main(["--config", str(relative)]) == 2


def test_joins_over_a_real_socket_then_stops_on_the_stop_file(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
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
    config_path = write_coordinator_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    try:
        with connect(f"ws://127.0.0.1:{config['listen_port']}/ws", open_timeout=5) as worker:
            worker.send(json.dumps(contract("hello.json")))
            assert json.loads(worker.recv(timeout=5))["accepted"] is True
            worker.send("x" * (settings.WS_MAX_MESSAGE_BYTES - 1024))
            with pytest.raises(TimeoutError):
                worker.recv(timeout=0.5)
            worker.send("x" * (settings.WS_MAX_MESSAGE_BYTES + 1))
            with pytest.raises(ConnectionClosed) as closed:
                worker.recv(timeout=5)
            assert closed.value.rcvd is not None and closed.value.rcvd.code == 1009
    finally:
        Path(config["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_dashboard_listens_only_on_localhost(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    try:
        wait_until_serving(config["dashboard_port"])
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect(("192.0.2.1", 9))
                outward = probe.getsockname()[0]
        except OSError:
            pytest.skip("this machine has no network address other than localhost")
        if outward.startswith("127.") or outward == "0.0.0.0":
            pytest.skip("this machine has no address other than localhost")
        with (
            pytest.raises(OSError),
            socket.create_connection((outward, config["dashboard_port"]), 1),
        ):
            pass
    finally:
        Path(config["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_stop_file_present_at_start_stops_at_once(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
    stop = Path(json.loads(config_path.read_text(encoding="utf-8"))["stop_file"])
    stop.touch()
    started = time.monotonic()
    assert main(["--config", str(config_path)]) == 0
    assert time.monotonic() - started < settings.STOP_DEADLINE_S
    assert not stop.exists()


def test_clean_stop_removes_the_stop_file(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    wait_until_serving(config["dashboard_port"])
    Path(config["stop_file"]).touch()
    assert running.wait(settings.STOP_DEADLINE_S) == 0
    assert not Path(config["stop_file"]).exists()


def test_interrupt_exits_0_and_unexpected_error_exits_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = write_coordinator_config(tmp_path)

    async def interrupted(config: object) -> int:
        raise KeyboardInterrupt

    async def broken(config: object) -> int:
        raise RuntimeError("boom")

    monkeypatch.setattr(coordinator_main, "_serve", interrupted)
    assert main(["--config", str(config_path)]) == 0
    monkeypatch.setattr(coordinator_main, "_serve", broken)
    assert main(["--config", str(config_path)]) == 1


def test_dashboard_refuses_other_host_names(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    running = Running(config_path)
    try:
        wait_until_serving(config["dashboard_port"])
        request = urllib.request.Request(
            f"http://127.0.0.1:{config['dashboard_port']}/api/state",
            headers={"Host": "attacker.example"},
        )
        with pytest.raises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(request, timeout=2)
        assert refused.value.code == 400
        refused.value.close()
    finally:
        Path(config["stop_file"]).touch()
        assert running.wait(settings.STOP_DEADLINE_S) == 0


def test_port_in_use_exits_1(tmp_path: Path) -> None:
    config_path = write_coordinator_config(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", config["dashboard_port"]))
        holder.listen(1)
        running = Running(config_path)
        assert running.wait(settings.STOP_DEADLINE_S) == 1
