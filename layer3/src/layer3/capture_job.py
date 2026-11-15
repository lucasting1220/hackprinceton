"""The capture job: the only program that opens the camera and mic (Layer 3 doc).

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

import asyncio
import json
import logging
import os
import signal
import sys
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

import cv2
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from layer3 import settings
from layer3.camera import CaptureError, Frame, frames
from layer3.mic import AudioChunk, MicError, chunks
from layer3.worker_config import ConfigError, load_camera, load_mic

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


class FeedServer:
    def __init__(self, camera: Latest[Frame], mic: Latest[AudioChunk], stop: asyncio.Event) -> None:
        self.camera, self.mic, self.stop = camera, mic, stop

    async def handle(self, connection: ServerConnection) -> None:
        path = connection.request.path if connection.request else ""
        host = connection.remote_address[0] if connection.remote_address else ""
        if host not in ("127.0.0.1", "::1"):
            await connection.close(1008, "local only")
            return
        if path == "/camera":
            await self._send(
                connection, self.camera, "camera", lambda f: stamp(f.captured_at) + encode_frame(f)
            )
        elif path == "/live":
            origin = connection.request.headers.get("Origin") if connection.request else None
            if origin not in settings.LIVE_VIEW_ORIGINS:
                await connection.close(1008, "live view page only")
                return
            await self._send(connection, self.camera, "live", encode_frame)
        elif path == "/mic":
            await self._send(
                connection, self.mic, "mic", lambda c: stamp(c.captured_at) + encode_chunk(c)
            )
        else:
            await connection.close(1008, "unknown path")

    async def _send[T](
        self,
        connection: ServerConnection,
        latest: Latest[T],
        kind: str,
        encode: Callable[[T], bytes],
    ) -> None:
        number = latest.number  # start from the next item: no backlog
        try:
            while not self.stop.is_set():
                found = await asyncio.to_thread(latest.after, number, settings.FEED_WAIT_SECONDS)
                if found is None:
                    continue
                number, item = found
                data = await asyncio.to_thread(latest.encoding, number, kind, partial(encode, item))
                await connection.send(data)
        except ConnectionClosed:
            return


def frame_feed_port(config_path: Path) -> int:
    try:
        port = json.loads(config_path.read_text(encoding="utf-8-sig"))["frame_feed_port"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ConfigError(f"cannot read frame_feed_port from {config_path}: {error}") from None
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ConfigError(f"frame_feed_port in {config_path} must be a port number")
    return port


async def serve_feeds(
    port: int,
    camera_name: str | None,
    mic_name: str | None,
    stop: asyncio.Event,
    open_camera: Callable[[str], Iterator[Frame]] = frames,
    open_mic: Callable[[str], Iterator[AudioChunk]] = chunks,
) -> None:
    camera: Latest[Frame] = Latest()
    mic: Latest[AudioChunk] = Latest()
    stopping = threading.Event()
    threads = []
    if camera_name is not None:
        threads.append(
            threading.Thread(
                target=keep_capturing,
                daemon=True,
                args=(
                    "camera",
                    lambda: open_camera(camera_name),
                    camera,
                    stopping,
                    (CaptureError,),
                ),
            )
        )
    if mic_name is not None:
        threads.append(
            threading.Thread(
                target=keep_capturing,
                daemon=True,
                args=("mic", lambda: open_mic(mic_name), mic, stopping, (MicError,)),
            )
        )
    for thread in threads:
        thread.start()
    feeds = FeedServer(camera, mic, stop)
    try:
        async with serve(feeds.handle, "127.0.0.1", port, max_size=1024):
            logger.info(
                "L3 capture: serving camera=%s mic=%s on 127.0.0.1:%s",
                camera_name is not None,
                mic_name is not None,
                port,
            )
            await stop.wait()
    finally:
        stopping.set()
        for thread in threads:
            thread.join(settings.FRAME_READ_TIMEOUT_SECONDS)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = os.environ.get("LAYER2_WORKER_CONFIG")
    if not config:
        logger.error("L3 capture: LAYER2_WORKER_CONFIG is not set; start me through Layer 2")
        return EXIT_BAD_CONFIG
    path = Path(config)
    try:
        port, camera_name, mic_name = frame_feed_port(path), load_camera(path), load_mic(path)
    except ConfigError as error:
        logger.error("L3 capture: %s", error)
        return EXIT_BAD_CONFIG

    async def run() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for name in ("SIGTERM", "SIGINT"):
            if hasattr(signal, name):
                try:
                    loop.add_signal_handler(getattr(signal, name), stop.set)
                except NotImplementedError:  # Windows: SIGTERM ends the process at once
                    signal.signal(
                        getattr(signal, name), lambda *_: loop.call_soon_threadsafe(stop.set)
                    )
        await serve_feeds(port, camera_name, mic_name, stop)

    asyncio.run(run())
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
