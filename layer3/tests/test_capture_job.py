"""The capture job, with fake camera and mic devices (contracts/frame-feed.json)."""

import asyncio
import json
import socket
import threading
import time
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from layer3 import capture_job, devices, settings
from layer3.camera import CameraReadFailed, Frame
from layer3.capture_job import Latest, frame_feed_port, keep_capturing, serve_feeds, stamp
from layer3.device_check import Outcome
from layer3.mic import AudioChunk
from layer3.worker_config import ConfigError

REPO = Path(__file__).resolve().parents[2]
AT = datetime(2026, 11, 15, 3, 0, 0, 250000, tzinfo=UTC)


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


def fake_frames(name: str) -> Iterator[Frame]:
    image = np.zeros((settings.FRAME_HEIGHT, settings.FRAME_WIDTH, 3), dtype=np.uint8)
    image[:, :, 2] = 200  # red in blue-green-red order
    while True:
        yield Frame(image=image, captured_at=AT)
        time.sleep(0.02)


def fake_chunks(name: str) -> Iterator[AudioChunk]:
    samples = np.full((8000, 1), 7, dtype=np.int16)
    while True:
        yield AudioChunk(samples=samples, captured_at=AT, overflowed=False)
        time.sleep(0.02)


def micros(prefix: bytes) -> datetime:
    value = int.from_bytes(prefix, "big", signed=True)
    return datetime(1970, 1, 1, tzinfo=UTC) + (datetime.resolution * value)


async def first_message(port: int, path: str, origin: str | None = None) -> bytes:
    headers = {"Origin": origin} if origin else None
    async with connect(f"ws://127.0.0.1:{port}{path}", additional_headers=headers) as ws:
        message = await asyncio.wait_for(ws.recv(), 5)
    assert isinstance(message, bytes)
    return message


def run_server(
    test: Callable[[int], Awaitable[None]],
    camera: Callable[[str], Iterator[Frame]] = fake_frames,
    mic: Callable[[str], Iterator[AudioChunk]] = fake_chunks,
) -> None:
    port = free_port()

    async def scenario() -> None:
        stop = asyncio.Event()
        server = asyncio.create_task(
            serve_feeds(port, "cam", "mic", stop, open_camera=camera, open_mic=mic)
        )
        await asyncio.sleep(0.2)
        try:
            await test(port)
        finally:
            stop.set()
            await asyncio.wait_for(server, 5)

    asyncio.run(scenario())


def test_stamp_is_big_endian_microseconds_since_1970() -> None:
    assert micros(stamp(AT)) == AT
    assert stamp(datetime(1970, 1, 1, 0, 0, 1, tzinfo=UTC)) == (1_000_000).to_bytes(8, "big")


def test_camera_frames_are_stamped_jpegs() -> None:
    async def test(port: int) -> None:
        message = await first_message(port, "/camera")
        assert micros(message[:8]) == AT
        image = cv2.imdecode(np.frombuffer(message[8:], np.uint8), cv2.IMREAD_COLOR)
        assert image is not None
        assert image.shape == (settings.FRAME_HEIGHT, settings.FRAME_WIDTH, 3)
        assert image[0, 0, 2] > 150  # still red

    run_server(test)


def test_mic_chunks_are_stamped_little_endian_pcm() -> None:
    async def test(port: int) -> None:
        message = await first_message(port, "/mic")
        assert micros(message[:8]) == AT
        assert len(message) == 8 + 16000
        assert message[8:10] == (7).to_bytes(2, "little")

    run_server(test)


def test_live_view_gets_plain_jpeg_for_its_page_only() -> None:
    async def test(port: int) -> None:
        message = await first_message(port, "/live", origin=settings.LIVE_VIEW_ORIGINS[0])
        assert message[:2] == b"\xff\xd8"
        for origin in (None, "http://evil.example"):
            with pytest.raises(ConnectionClosed):
                await first_message(port, "/live", origin=origin)
        with pytest.raises(ConnectionClosed):
            await first_message(port, "/elsewhere")

    run_server(test)


def test_a_failed_camera_is_reopened(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEVICE_RETRY_SECONDS", 0.05)
    opened: list[str] = []

    def flaky(name: str) -> Iterator[Frame]:
        opened.append(name)
        if len(opened) == 1:
            raise CameraReadFailed("unplugged")
        return fake_frames(name)

    async def test(port: int) -> None:
        message = await first_message(port, "/camera")
        assert micros(message[:8]) == AT

    run_server(test, camera=flaky)
    assert len(opened) >= 2


def test_latest_hands_out_only_the_newest() -> None:
    latest: Latest[int] = Latest()
    for n in (10, 20, 30):
        latest.put(n)
    assert latest.after(0, 0.1) == (3, 30)
    assert latest.after(3, 0.05) is None
    calls: list[int] = []

    def encode() -> bytes:
        calls.append(1)
        return b"once"

    for _ in range(2):
        assert latest.encoding(3, "x", encode) == b"once"
    assert calls == [1]  # encoded once for every client


def test_frame_feed_port_comes_from_worker_json(tmp_path: Path) -> None:
    config = tmp_path / "worker.json"
    example = json.loads((REPO / "contracts" / "worker.json").read_text(encoding="utf-8"))
    config.write_text(json.dumps(example), encoding="utf-8")
    assert frame_feed_port(config) == example["frame_feed_port"]
    config.write_text(json.dumps({**example, "frame_feed_port": "7460"}), encoding="utf-8")
    with pytest.raises(ConfigError):
        frame_feed_port(config)


def test_main_needs_layer2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_WORKER_CONFIG", raising=False)
    assert capture_job.main() == capture_job.EXIT_BAD_CONFIG


def test_the_job_folder_matches_the_contract() -> None:
    job = json.loads((REPO / "layer3" / "jobs" / "capture" / "job.json").read_text("utf-8"))
    example = json.loads((REPO / "contracts" / "job.json").read_text("utf-8"))
    assert set(job) == set(example)
    assert job["name"] == "capture" and job["sensor"] == "camera" and job["kind"] == "always-on"
    assert job["start_command"][-1] == "layer3.capture_job"


def test_a_device_that_fails_is_reopened_and_stops_on_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "DEVICE_RETRY_SECONDS", 0.01)
    opened: list[int] = []
    latest: Latest[int] = Latest()
    stop = threading.Event()

    def device() -> Iterator[int]:
        opened.append(1)
        if len(opened) == 1:
            raise CameraReadFailed("unplugged")  # fails at once
        if len(opened) == 2:
            yield 1
            raise CameraReadFailed("unplugged")  # fails while reading
        while True:
            yield 2
            stop.set()

    keep_capturing("camera", device, latest, stop, (CameraReadFailed,))
    assert len(opened) == 3
    assert latest.item == 2


def worker_json(tmp_path: Path, camera: str | None, mic: str | None) -> Path:
    config = json.loads((REPO / "contracts" / "worker.json").read_text("utf-8"))
    config.update(camera=camera, mic=mic)
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    return path


def printed(capsys: pytest.CaptureFixture[str]) -> dict[str, object]:
    out = capsys.readouterr().out
    assert out.endswith("\n") and out.count("\n") == 1
    result: dict[str, object] = json.loads(out)
    return result


def test_list_mode_prints_one_device_list(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    listed = devices.Listed(cameras=["j5 WebCam JVCU100"], mics=["Audio Streaming"], problems=[])
    monkeypatch.setattr(devices, "list_names", lambda: listed)
    monkeypatch.setattr(devices, "read_kinds", lambda problems: {"camera": {}, "mic": {}})

    assert capture_job.main(["list", "--json"]) == capture_job.EXIT_OK

    written = printed(capsys)
    example = json.loads((REPO / "contracts" / "device-list.json").read_text("utf-8"))
    assert set(written) == set(example)
    assert written["cameras"] == [
        {"name": "j5 WebCam JVCU100", "kind": "unknown", "same_name": False}
    ]


def test_check_mode_with_no_devices_named_is_ok(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert (
        capture_job.main(["check", "--config", str(worker_json(tmp_path, None, None)), "--json"])
        == capture_job.EXIT_OK
    )

    written = printed(capsys)
    assert written["ok"] is True
    assert written["type"] == "device_check"


def test_check_mode_exits_4_when_a_device_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    checked: list[str | None] = []

    def failing_camera(name: str | None) -> Outcome:
        checked.append(name)
        return Outcome(name, "open_failed", "The camera would not open")

    monkeypatch.setattr(capture_job, "check_camera", failing_camera)
    config = worker_json(tmp_path, "j5 WebCam JVCU100", None)

    assert capture_job.main(["check", "--config", str(config), "--json"]) == 4

    assert checked == ["j5 WebCam JVCU100"]
    assert printed(capsys)["ok"] is False


def test_check_mode_with_a_config_it_cannot_read_exits_2_and_prints_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    missing = tmp_path / "missing.json"

    assert capture_job.main(["check", "--config", str(missing), "--json"]) == 2

    assert capsys.readouterr().out == ""


def test_a_mode_without_json_is_a_bad_command_line(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as stopped:
        capture_job.main(["list"])

    assert stopped.value.code == 2
    assert capsys.readouterr().out == ""
