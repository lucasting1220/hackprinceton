"""The capture job: the only program that opens the camera and mic (Layer 3 doc).

This module grows in two steps: first the capture loop and encoding (here), then the feed
server and the program itself.

Started by Layer 2's worker on the laptop holding the sensors (layer3/jobs/capture/job.json).
It reads the camera, mic and frame_feed_port from the worker.json named by
LAYER2_WORKER_CONFIG and serves contracts/frame-feed.json on ws://127.0.0.1:<frame_feed_port>:

    /camera  8-byte big-endian captured_at (microseconds since 1970 UTC) + JPEG 640x480 q80
    /mic     the same 8 bytes + 0.5 s of 16 kHz mono 16-bit little-endian PCM
    /live    the JPEG only, for Layer 1's live-view page (its origin only)

Capture runs all the time on background threads; a device that fails is reopened every
DEVICE_RETRY_SECONDS. Frames are encoded only while a client is connected, once per frame
for all clients, and a client that falls behind skips to the newest. Nothing is stored and
no sample or pixel is logged. SIGTERM stops it within a few seconds.

    uv run --project layer3 python -m layer3.capture_job
"""

import logging
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

import cv2

from layer3 import settings
from layer3.camera import Frame
from layer3.mic import AudioChunk

logger = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_BAD_CONFIG = 2
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def stamp(captured_at: datetime) -> bytes:
    """captured_at as 8 bytes: big-endian microseconds since 1970-01-01 UTC."""
    micros = (captured_at.astimezone(UTC) - _EPOCH) // datetime.resolution
    return int(micros).to_bytes(8, "big", signed=True)


def encode_frame(frame: Frame) -> bytes:
    ok, jpeg = cv2.imencode(".jpg", frame.image, [cv2.IMWRITE_JPEG_QUALITY, settings.JPEG_QUALITY])
    if not ok:
        raise ValueError("the frame could not be encoded as JPEG")
    return bytes(jpeg.tobytes())


def encode_chunk(chunk: AudioChunk) -> bytes:
    return bytes(chunk.samples.astype("<i2").tobytes())


@dataclass
class Latest[T]:
    """The newest item from one device, numbered, shared between its capture thread and the
    feed clients. Encodings are cached per item so several clients encode it once."""

    item: T | None = None
    number: int = 0
    encoded: dict[str, bytes] = field(default_factory=dict)
    changed: threading.Condition = field(default_factory=threading.Condition)

    def put(self, item: T) -> None:
        with self.changed:
            self.item, self.number, self.encoded = item, self.number + 1, {}
            self.changed.notify_all()

    def after(self, number: int, timeout: float) -> tuple[int, T] | None:
        """The newest item numbered above `number`, waiting up to `timeout`."""
        with self.changed:
            if not self.changed.wait_for(lambda: self.number > number, timeout):
                return None
            assert self.item is not None
            return self.number, self.item

    def encoding(self, number: int, kind: str, encode: Callable[[], bytes]) -> bytes:
        with self.changed:
            if number == self.number and kind in self.encoded:
                return self.encoded[kind]
        data = encode()
        with self.changed:
            if number == self.number:
                self.encoded[kind] = data
        return data


def keep_capturing[T](
    name: str,
    open_device: Callable[[], Iterator[T]],
    latest: Latest[T],
    stop: threading.Event,
    errors: tuple[type[Exception], ...],
) -> None:
    """Read the device into `latest` until `stop`, reopening it after a failure."""
    while not stop.is_set():
        source: Iterator[T] | None = None
        try:
            source = open_device()  # may fail at once, or on the first read
            for item in source:
                latest.put(item)
                if stop.is_set():
                    break
        except errors as error:
            logger.warning(
                "L3 capture: %s failed, retrying in %s s: %s",
                name,
                settings.DEVICE_RETRY_SECONDS,
                error,
            )
            stop.wait(settings.DEVICE_RETRY_SECONDS)
        finally:
            close = getattr(source, "close", None)
            if close is not None:
                close()
