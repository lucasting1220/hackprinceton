"""layer2.feed(): frames and audio from Layer 3's capture job (contracts/frame-feed.json)."""

import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from itertools import islice
from pathlib import Path
from typing import Any, Literal, cast

import pytest
from conftest import closed_port, contract
from websockets.sync.server import ServerConnection, serve

from layer2.contracts import WorkerConfig
from layer2.job_client import FeedItem, Layer2, Layer2Error
from layer2.worker.main import job_env

AT = datetime(2026, 11, 15, 3, 0, 0, 123456, tzinfo=UTC)
MICROS = (AT - datetime(1970, 1, 1, tzinfo=UTC)) // datetime.resolution


def stamped(data: bytes, at: int = MICROS) -> bytes:
    return at.to_bytes(8, "big", signed=True) + data


class CaptureStandIn:
    """Stands in for Layer 3's capture job: serves `messages` on each path, then holds open."""

    def __init__(self, port: int, messages: dict[str, list[bytes | str]]) -> None:
        self.paths: list[str] = []
        self.messages = messages
        self.server = serve(self.handle, "127.0.0.1", port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def handle(self, connection: ServerConnection) -> None:
        path = connection.request.path if connection.request else ""
        self.paths.append(path)
        for message in self.messages.get(path, []):
            connection.send(message)
        connection.recv()  # hold the connection until the reader leaves

    def __enter__(self) -> "CaptureStandIn":
        self.thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.server.shutdown()
        self.thread.join()


def client(port: int) -> Layer2:
    return Layer2("127.0.0.1:1", "token", frame_feed=f"127.0.0.1:{port}")


def test_camera_frames_arrive_with_their_capture_time() -> None:
    port = closed_port()
    jpeg = b"\xff\xd8 a jpeg \xff\xd9"
    messages: dict[str, list[bytes | str]] = {
        "/camera": ["text is skipped", b"short", stamped(jpeg), stamped(b"second", MICROS + 1)]
    }
    with CaptureStandIn(port, messages) as capture:
        items = list(islice(client(port).feed("camera"), 2))
    assert items == [
        FeedItem(data=jpeg, captured_at=AT),
        FeedItem(data=b"second", captured_at=AT.replace(microsecond=AT.microsecond + 1)),
    ]
    assert capture.paths == ["/camera"]


def test_mic_reads_its_own_path() -> None:
    port = closed_port()
    pcm = bytes(16000)
    with CaptureStandIn(port, {"/mic": [stamped(pcm)]}) as capture:
        [item] = list(islice(client(port).feed("mic"), 1))
    assert (len(item.data), item.captured_at) == (16000, AT)
    assert capture.paths == ["/mic"]


def test_it_waits_for_a_capture_job_that_starts_later(monkeypatch: pytest.MonkeyPatch) -> None:
    import layer2.job_client as job_client

    monkeypatch.setattr(job_client, "_FEED_RETRY_S", 0.05)
    port = closed_port()
    frames: Iterator[FeedItem] = client(port).feed("camera")
    result: list[FeedItem] = []
    reader = threading.Thread(target=lambda: result.extend(islice(frames, 1)), daemon=True)
    reader.start()
    reader.join(0.3)
    assert not result  # nothing is serving yet: it keeps trying
    with CaptureStandIn(port, {"/camera": [stamped(b"late")]}):
        reader.join(5)
    assert [item.data for item in result] == [b"late"]


def test_bad_names_and_no_feed_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError):
        next(client(1).feed(cast(Literal["camera", "mic"], "video")))
    with pytest.raises(Layer2Error, match="LAYER2_FRAME_FEED"):
        next(Layer2("127.0.0.1:1", "token").feed("camera"))
    monkeypatch.setenv("LAYER2_GATEWAY", "127.0.0.1:1")
    monkeypatch.setenv("LAYER2_GATEWAY_TOKEN", "t")
    monkeypatch.setenv("LAYER2_FRAME_FEED", "127.0.0.1:7460")
    assert Layer2.from_env()._frame_feed == "127.0.0.1:7460"


def test_every_job_gets_the_frame_feed_address_and_config_path(tmp_path: Path) -> None:
    config = WorkerConfig.model_validate(contract("worker.json"))
    path = tmp_path / "worker.json"
    env = job_env(path, config, {"LAYER2_GATEWAY": "127.0.0.1:5", "LAYER2_GATEWAY_TOKEN": "t"})
    assert env["LAYER2_WORKER_CONFIG"] == str(path.resolve())
    assert env["LAYER2_FRAME_FEED"] == f"127.0.0.1:{config.frame_feed_port}"
    assert env["LAYER2_NODE_ID"] == config.node_id
