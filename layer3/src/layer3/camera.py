"""Opens the one camera named in the worker config and hands out stamped frames.

Only this module opens the camera. A background reader thread lists the cameras,
opens the named one and reads frames, so the caller never waits longer than the
limits in the settings module.
"""

import logging
import math
import platform
import queue
import threading
import time
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import cv2
import numpy as np
from cv2_enumerate_cameras import enumerate_cameras
from numpy.typing import NDArray

from layer3 import settings

logger = logging.getLogger(__name__)

READER_THREAD_NAME: str = "layer3-camera-reader"
IMAGE_DIMENSIONS: int = 3
COLOUR_CHANNELS: int = 3

type Image = NDArray[np.uint8]


@dataclass(frozen=True, eq=False)
class Frame:
    """One camera frame exactly as OpenCV delivered it, with the time it was captured.

    image is height by width by 3, 8-bit, in blue-green-red order.
    captured_at is in UTC, from the capturing laptop's clock.
    """

    image: Image
    captured_at: datetime


@dataclass(frozen=True)
class ListedCamera:
    """A camera the operating system lists, with the index OpenCV opens it by."""

    name: str
    index: int


class FrameSource(Protocol):
    """The camera device, as the reader thread uses it."""

    def open(self, width: int, height: int, frames_per_second: int) -> bool: ...

    def reported_frames_per_second(self) -> float: ...

    def read(self) -> Image | None: ...

    def close(self) -> None: ...


class CaptureError(Exception):
    """The camera could not be found, opened or read."""


class CameraNotFound(CaptureError):
    """No single listed camera has the name given in the config."""


class CameraOpenFailed(CaptureError):
    """The camera refused to open, failed while opening, or did not open in time."""


class CameraNoFirstFrame(CameraOpenFailed):
    """The camera opened but delivered no first frame in time."""


class CameraReadFailed(CaptureError):
    """Reading a frame from the camera raised an error."""


class CameraReadTimedOut(CaptureError):
    """No frame arrived within the frame time limit."""


class CameraFormatMismatch(CaptureError):
    """The camera delivered frames in a format other than the one asked for."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def list_cameras() -> list[ListedCamera]:
    """List the cameras the operating system reports, in this system's OpenCV backend."""
    backend = _backend()
    return [ListedCamera(listed.name, listed.index) for listed in enumerate_cameras(backend)]


def find_camera(name: str, listed: Sequence[ListedCamera]) -> ListedCamera:
    """Return the one listed camera with exactly this name. Never picks between two."""
    matches = [candidate for candidate in listed if candidate.name == name]
    if len(matches) == 1:
        return matches[0]
    problem = "matches more than one camera" if matches else "was not found"
    found = ", ".join(f"{candidate.name!r} (index {candidate.index})" for candidate in listed)
    raise CameraNotFound(f"camera {name!r} {problem}; cameras found: {found or 'none'}")


class _OpenCvFrameSource:
    """The real camera, through OpenCV."""

    def __init__(self, camera: ListedCamera) -> None:
        self._camera: ListedCamera = camera
        self._capture: cv2.VideoCapture | None = None

    def open(self, width: int, height: int, frames_per_second: int) -> bool:
        capture = cv2.VideoCapture(self._camera.index, _backend())
        self._capture = capture
        if not capture.isOpened():
            return False
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        capture.set(cv2.CAP_PROP_FPS, frames_per_second)
        return True

    def reported_frames_per_second(self) -> float:
        return 0.0 if self._capture is None else float(self._capture.get(cv2.CAP_PROP_FPS))

    def read(self) -> Image | None:
        if self._capture is None:
            return None
        delivered, image = self._capture.read()
        return np.asarray(image) if delivered else None

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


def open_cv_source(camera: ListedCamera) -> FrameSource:
    return _OpenCvFrameSource(camera)


def frames(
    camera: str,
    *,
    clock: Callable[[], datetime] = utc_now,
    cameras: Callable[[], Sequence[ListedCamera]] = list_cameras,
    make_source: Callable[[ListedCamera], FrameSource] = open_cv_source,
    open_timeout: float = settings.OPEN_TIMEOUT_SECONDS,
    read_timeout: float = settings.FRAME_READ_TIMEOUT_SECONDS,
) -> Generator[Frame, None, None]:
    """Open the camera with this name and yield every frame it delivers, unchanged and stamped.

    Layer 3 code drops no frame: a slow reader makes the reader thread wait.
    Closing the generator stops the reader thread, which then closes the camera.
    """
    reader = _Reader(camera, cameras, make_source, clock)
    reader.start()
    first_frame_due = time.monotonic() + open_timeout
    opened = False
    try:
        listed, reported = reader.wait_until_open(open_timeout)
        opened = True
        _log_rate(listed, reported)
        first = reader.first_frame(max(first_frame_due - time.monotonic(), 0.0), open_timeout)
        _check_format(listed, first)
        yield first
        while True:
            yield reader.next_frame(read_timeout)
    finally:
        if not reader.stop(read_timeout):
            logger.warning(
                "L3 capture: a camera call for %r has not returned; "
                "the reader thread is left behind until it does",
                camera,
            )
        elif opened:
            logger.info("L3 capture: stopped reading camera %r", camera)


def _backend() -> int:
    system = platform.system()
    backend = settings.CAMERA_BACKENDS.get(system)
    if backend is None:
        raise CameraNotFound(f"no camera backend is set for {system}")
    return int(getattr(cv2, backend))


def _log_rate(listed: ListedCamera, reported: float) -> None:
    if math.isfinite(reported) and round(reported) == settings.FRAMES_PER_SECOND:
        logger.info("L3 capture: camera %r reports %.1f frames per second", listed.name, reported)
    else:
        logger.warning(
            "L3 capture: camera %r reports %.1f frames per second, not the %d asked for",
            listed.name,
            reported,
            settings.FRAMES_PER_SECOND,
        )


def _check_format(listed: ListedCamera, frame: Frame) -> None:
    shape = frame.image.shape
    eight_bit = frame.image.dtype == np.uint8
    if shape == (settings.FRAME_HEIGHT, settings.FRAME_WIDTH, COLOUR_CHANNELS) and eight_bit:
        return
    if len(shape) != IMAGE_DIMENSIONS or shape[2] != COLOUR_CHANNELS:
        delivered = f"an image of shape {shape}"
    elif not eight_bit:
        delivered = f"frames with {frame.image.dtype} values instead of 8-bit"
    else:
        delivered = f"{shape[1]} by {shape[0]}"
    raise CameraFormatMismatch(
        f"camera {listed.name!r} was asked for {settings.FRAME_WIDTH} by "
        f"{settings.FRAME_HEIGHT} colour frames but delivered {delivered}"
    )


class _Reader:
    """Lists the cameras, opens the named one and reads frames, all on a background thread.

    A camera call that never returns cannot be stopped. The caller still gets an
    error within its time limit; the thread is left behind and closes the camera
    when the call returns. An error raised by a camera call is logged and handed
    to the caller as a CaptureError that names it.
    """

    def __init__(
        self,
        camera: str,
        cameras: Callable[[], Sequence[ListedCamera]],
        make_source: Callable[[ListedCamera], FrameSource],
        clock: Callable[[], datetime],
    ) -> None:
        self._camera: str = camera
        self._cameras: Callable[[], Sequence[ListedCamera]] = cameras
        self._make_source: Callable[[ListedCamera], FrameSource] = make_source
        self._clock: Callable[[], datetime] = clock
        self._frames: queue.Queue[Frame | CameraReadFailed] = queue.Queue(
            maxsize=settings.FRAME_QUEUE_SIZE
        )
        self._open_done: threading.Event = threading.Event()
        self._stop: threading.Event = threading.Event()
        self._opened: tuple[ListedCamera, float] | None = None
        self._open_failure: CaptureError | None = None
        self._time_limit_ran_out: bool = False
        self._thread: threading.Thread = threading.Thread(
            target=self._run, name=READER_THREAD_NAME, daemon=True
        )

    def start(self) -> None:
        self._thread.start()

    def wait_until_open(self, timeout: float) -> tuple[ListedCamera, float]:
        """Wait for the camera to open; return it and the frame rate it reports."""
        if not self._open_done.wait(timeout):
            self._time_limit_ran_out = True
            raise CameraOpenFailed(f"the camera did not open within {timeout:g} seconds")
        if self._open_failure is not None:
            raise self._open_failure
        if self._opened is None:
            raise CameraOpenFailed("the reader thread ended before the camera opened")
        return self._opened

    def first_frame(self, timeout: float, open_timeout: float) -> Frame:
        """Wait for the first frame, which shares the open time limit: cameras start slowly."""
        try:
            return self._next(timeout)
        except queue.Empty:
            self._time_limit_ran_out = True
            raise CameraNoFirstFrame(
                f"the camera opened but delivered no first frame within {open_timeout:g} seconds"
            ) from None

    def next_frame(self, timeout: float) -> Frame:
        try:
            return self._next(timeout)
        except queue.Empty:
            self._time_limit_ran_out = True
            raise CameraReadTimedOut(f"no frame arrived within {timeout:g} seconds") from None

    def stop(self, timeout: float) -> bool:
        """Tell the thread to stop and say whether it ended.

        After a time limit ran out the thread may be stuck in a camera call, so
        the wait is kept short and the caller hears about the failure on time.
        """
        self._stop.set()
        limit = settings.ABANDON_WAIT_SECONDS if self._time_limit_ran_out else timeout
        self._thread.join(limit)
        return not self._thread.is_alive()

    def _next(self, timeout: float) -> Frame:
        item = self._frames.get(timeout=timeout)
        if isinstance(item, CameraReadFailed):
            raise item
        return item

    def _run(self) -> None:
        source: FrameSource | None = None
        try:
            try:
                listed = find_camera(self._camera, self._cameras())
                if self._stop.is_set():
                    return
                logger.info("L3 capture: opening camera %r", listed.name)
                source = self._make_source(listed)
                if not source.open(
                    settings.FRAME_WIDTH, settings.FRAME_HEIGHT, settings.FRAMES_PER_SECOND
                ):
                    raise CameraOpenFailed(
                        "the camera refused to open. If macOS is asking for camera permission, "
                        "click Allow and run again"
                    )
                self._opened = (listed, source.reported_frames_per_second())
            except CaptureError as error:
                self._open_failure = error
                return
            except Exception as error:
                logger.error("L3 capture: opening camera %r failed: %r", self._camera, error)
                self._open_failure = CameraOpenFailed(f"opening the camera failed: {error!r}")
                self._open_failure.__cause__ = error
                return
            finally:
                self._open_done.set()
            self._read_frames(source)
        finally:
            if source is not None:
                self._close(source)

    def _close(self, source: FrameSource) -> None:
        try:
            source.close()
        except Exception as error:
            logger.error("L3 capture: closing camera %r failed: %r", self._camera, error)

    def _read_frames(self, source: FrameSource) -> None:
        try:
            while not self._stop.is_set():
                image = source.read()
                if image is None:
                    self._stop.wait(settings.STOP_CHECK_SECONDS)
                    continue
                self._hand_over(Frame(image, self._clock()))
        except Exception as error:
            logger.error("L3 capture: reading camera %r failed: %r", self._camera, error)
            failure = CameraReadFailed(f"reading the camera failed: {error!r}")
            failure.__cause__ = error
            self._hand_over(failure)

    def _hand_over(self, item: Frame | CameraReadFailed) -> None:
        while not self._stop.is_set():
            try:
                self._frames.put(item, timeout=settings.STOP_CHECK_SECONDS)
            except queue.Full:
                continue
            return
