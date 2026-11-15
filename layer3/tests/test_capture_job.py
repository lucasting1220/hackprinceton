"""The capture job, with fake camera and mic devices (contracts/frame-feed.json)."""

import asyncio
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from websockets.asyncio.client import connect

from layer3 import settings
from layer3.camera import CameraReadFailed
from layer3.capture_job import Latest, keep_capturing, stamp

REPO = Path(__file__).resolve().parents[2]
AT = datetime(2026, 11, 15, 3, 0, 0, 250000, tzinfo=UTC)


def micros(prefix: bytes) -> datetime:
    value = int.from_bytes(prefix, "big", signed=True)
    return datetime(1970, 1, 1, tzinfo=UTC) + (datetime.resolution * value)


async def first_message(port: int, path: str, origin: str | None = None) -> bytes:
    headers = {"Origin": origin} if origin else None
    async with connect(f"ws://127.0.0.1:{port}{path}", additional_headers=headers) as ws:
        message = await asyncio.wait_for(ws.recv(), 5)
    assert isinstance(message, bytes)
    return message


def test_stamp_is_big_endian_microseconds_since_1970() -> None:
    assert micros(stamp(AT)) == AT
    assert stamp(datetime(1970, 1, 1, 0, 0, 1, tzinfo=UTC)) == (1_000_000).to_bytes(8, "big")


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
