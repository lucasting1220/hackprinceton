"""Tests for the capture code and the frame reader, using a fake camera. No hardware needed."""

import json
import logging
import platform
import sys
import threading
import time
from collections.abc import Callable, Generator, Iterator, Sequence
from contextlib import closing
from datetime import UTC, datetime, timedelta
from itertools import islice
from pathlib import Path

import cv2
import numpy as np
import pytest

from layer3 import camera, frame_reader, settings
from layer3.camera import (
    CameraFormatMismatch,
    CameraNotFound,
    CameraOpenFailed,
    CameraReadFailed,
    CameraReadTimedOut,
    Frame,
    Image,
    ListedCamera,
    frames,
)

WEBCAM = ListedCamera("j5 WebCam JVCU100", 0)
BUILT_IN = ListedCamera("MacBook Air Camera", 1)
SHORT_TIMEOUT: float = 0.1
WAIT_LIMIT: float = 2.0


def image(value: int = 0, width: int = 640, height: int = 480) -> Image:
    return np.full((height, width, 3), value, dtype=np.uint8)


class FakeSource:
    """A camera that delivers the images it is given. A gate, while unset, makes a call block."""

    def __init__(
        self,
        images: Sequence[Image | None] = (),
        *,
        opens: bool = True,
        reported: float = 15.0,
        open_gate: threading.Event | None = None,
        read_gate: threading.Event | None = None,
        open_error: OSError | None = None,
        read_error: OSError | None = None,
        read_seconds: float = 0.0,
        close_error: OSError | None = None,
    ) -> None:
        self.images: list[Image | None] = list(images)
        self.opens: bool = opens
        self.reported: float = reported
        self.open_gate: threading.Event | None = open_gate
        self.read_gate: threading.Event | None = read_gate
        self.open_error: OSError | None = open_error
        self.read_error: OSError | None = read_error
        self.read_seconds: float = read_seconds
        self.opened_with: tuple[int, int, int] | None = None
        self.closed: threading.Event = threading.Event()
        self.close_error: OSError | None = close_error
        self.close_calls: int = 0
        self.read_waiting: threading.Event = threading.Event()

    def open(self, width: int, height: int, frames_per_second: int) -> bool:
        if self.open_gate is not None:
            self.open_gate.wait(WAIT_LIMIT)
        if self.open_error is not None:
            raise self.open_error
        self.opened_with = (width, height, frames_per_second)
        return self.opens

    def reported_frames_per_second(self) -> float:
        return self.reported

    def read(self) -> Image | None:
        if self.read_gate is not None:
            if not self.read_gate.is_set():
                self.read_waiting.set()
            self.read_gate.wait(WAIT_LIMIT)
        if self.read_seconds:
            time.sleep(self.read_seconds)
            return image()
        if self.images:
            return self.images.pop(0)
        if self.read_error is not None:
            raise self.read_error
        return None

    def close(self) -> None:
        self.close_calls += 1
        self.closed.set()
        if self.close_error is not None:
            raise self.close_error


def stream(
    source: FakeSource,
    wanted: str = WEBCAM.name,
    *,
    listed: Sequence[ListedCamera] = (WEBCAM, BUILT_IN),
    cameras: Callable[[], Sequence[ListedCamera]] | None = None,
    clock: Callable[[], datetime] = camera.utc_now,
    opened: list[ListedCamera] | None = None,
    open_timeout: float = WAIT_LIMIT,
    read_timeout: float = WAIT_LIMIT,
) -> Generator[Frame, None, None]:
    def make_source(chosen: ListedCamera) -> FakeSource:
        if opened is not None:
            opened.append(chosen)
        return source

    return frames(
        wanted,
        clock=clock,
        cameras=cameras if cameras is not None else lambda: listed,
        make_source=make_source,
        open_timeout=open_timeout,
        read_timeout=read_timeout,
    )


def reader_thread_ended() -> bool:
    deadline = time.monotonic() + WAIT_LIMIT
    while time.monotonic() < deadline:
        if not any(thread.name == camera.READER_THREAD_NAME for thread in threading.enumerate()):
            return True
        time.sleep(0.01)
    return False


def test_the_camera_with_exactly_that_name_is_opened_with_the_format_from_settings() -> None:
    source = FakeSource([image()])
    opened: list[ListedCamera] = []

    with closing(stream(source, BUILT_IN.name, opened=opened)) as frame_stream:
        next(frame_stream)

    assert opened == [BUILT_IN]
    assert source.opened_with == (640, 480, 15)


@pytest.mark.parametrize(
    ("wanted", "listed", "problem"),
    [
        ("j5 WebCam", (WEBCAM, BUILT_IN), "was not found"),
        (WEBCAM.name, (), "cameras found: none"),
        (WEBCAM.name, (WEBCAM, ListedCamera(WEBCAM.name, 2)), "matches more than one camera"),
    ],
)
def test_no_single_match_is_camera_not_found_and_nothing_is_opened(
    wanted: str, listed: Sequence[ListedCamera], problem: str
) -> None:
    opened: list[ListedCamera] = []

    with pytest.raises(CameraNotFound, match=problem) as failure:
        next(stream(FakeSource([image()]), wanted, listed=listed, opened=opened))

    assert opened == []
    assert repr(wanted) in str(failure.value)
    for candidate in listed:
        assert f"{candidate.name!r} (index {candidate.index})" in str(failure.value)
    assert reader_thread_ended()


def test_listing_cameras_on_a_system_with_no_backend_set_is_camera_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(camera.platform, "system", lambda: "Plan 9")

    with pytest.raises(CameraNotFound, match="no camera backend is set for Plan 9"):
        camera.list_cameras()


def test_listing_cameras_uses_this_systems_backend_and_keeps_names_and_indexes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked: list[int] = []

    def fake_enumerate(backend: int) -> list[ListedCamera]:
        asked.append(backend)
        return [WEBCAM, BUILT_IN]

    monkeypatch.setattr(camera, "enumerate_cameras", fake_enumerate)

    assert camera.list_cameras() == [WEBCAM, BUILT_IN]
    assert asked == [getattr(cv2, settings.CAMERA_BACKENDS[platform.system()])]


def test_listing_that_blocks_is_camera_open_failed_within_the_open_time_limit() -> None:
    gate = threading.Event()
    opened: list[ListedCamera] = []
    started = time.monotonic()

    def blocked_listing() -> Sequence[ListedCamera]:
        gate.wait(WAIT_LIMIT)
        return (WEBCAM,)

    with pytest.raises(CameraOpenFailed, match="did not open within 0.1 seconds"):
        next(
            stream(
                FakeSource([image()]),
                cameras=blocked_listing,
                opened=opened,
                open_timeout=SHORT_TIMEOUT,
            )
        )

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: the time limit is the behaviour
    gate.set()
    assert reader_thread_ended()
    assert opened == []


def test_listing_that_raises_is_camera_open_failed_naming_the_failure_at_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def failing_listing() -> Sequence[ListedCamera]:
        raise OSError("listing failed")

    started = time.monotonic()

    with (
        caplog.at_level(logging.ERROR, logger=camera.logger.name),
        pytest.raises(CameraOpenFailed, match="listing failed"),
    ):
        next(stream(FakeSource([image()]), cameras=failing_listing))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert "listing failed" in caplog.text
    assert reader_thread_ended()


def test_every_frame_is_passed_on_unchanged_in_order_and_stamped_in_utc() -> None:
    images = [image(1), image(2), image(3)]
    start = datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
    ticks: Iterator[datetime] = (start + timedelta(seconds=second) for second in range(10))

    with closing(stream(FakeSource(images), clock=lambda: next(ticks))) as frame_stream:
        received = list(islice(frame_stream, 3))

    assert all(frame.image is sent for frame, sent in zip(received, images, strict=True))
    assert [frame.captured_at for frame in received] == [
        start + timedelta(seconds=second) for second in range(3)
    ]
    assert all(frame.captured_at.utcoffset() == timedelta(0) for frame in received)


def test_a_read_with_no_frame_is_retried_until_one_arrives() -> None:
    wanted = image(9)

    with closing(stream(FakeSource([None, None, wanted]))) as frame_stream:
        assert next(frame_stream).image is wanted


def test_a_slow_reader_still_receives_every_frame() -> None:
    images = [image(value) for value in range(8)]

    with closing(stream(FakeSource(images))) as frame_stream:
        received = []
        for frame in islice(frame_stream, 8):
            time.sleep(0.02)
            received.append(frame)

    assert all(frame.image is sent for frame, sent in zip(received, images, strict=True))


@pytest.mark.parametrize(
    ("first", "delivered"),
    [
        (image(width=1280, height=720), "1280 by 720"),
        (np.zeros((480, 640), dtype=np.uint8), r"an image of shape \(480, 640\)"),
        (np.zeros((480, 640, 4), dtype=np.uint8), r"an image of shape \(480, 640, 4\)"),
    ],
)
def test_a_first_frame_of_another_format_stops_capture_and_closes_the_camera(
    first: Image, delivered: str
) -> None:
    source = FakeSource([first, image()])

    with pytest.raises(
        CameraFormatMismatch, match=f"640 by 480 colour frames but delivered {delivered}"
    ):
        next(stream(source))

    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


@pytest.mark.parametrize(
    ("reported", "warning"),
    [
        (30.0, "30.0 frames per second, not the 15"),
        (float("nan"), "nan frames per second, not the 15"),
        (float("inf"), "inf frames per second, not the 15"),
        (15.000015, None),
    ],
)
def test_a_reported_rate_other_than_15_is_one_warning_and_no_frame_is_skipped(
    reported: float, warning: str | None, caplog: pytest.LogCaptureFixture
) -> None:
    images = [image(1), image(2), image(3)]

    with (
        caplog.at_level(logging.INFO, logger=camera.logger.name),
        closing(stream(FakeSource(images, reported=reported))) as frame_stream,
    ):
        received = list(islice(frame_stream, 3))

    warned = [record.getMessage() for record in caplog.records if record.levelno >= logging.WARNING]
    assert len(warned) == (0 if warning is None else 1)
    assert all(warning is not None and warning in message for message in warned)
    assert all(frame.image is sent for frame, sent in zip(received, images, strict=True))


def test_a_refused_open_is_camera_open_failed_with_the_permission_hint() -> None:
    source = FakeSource(opens=False)

    with pytest.raises(CameraOpenFailed, match="click Allow and run again"):
        next(stream(source))

    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_an_open_that_raises_is_camera_open_failed_naming_the_failure_at_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource(open_error=OSError("device busy"))
    started = time.monotonic()

    with (
        caplog.at_level(logging.ERROR, logger=camera.logger.name),
        pytest.raises(CameraOpenFailed, match="device busy") as failure,
    ):
        next(stream(source))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert isinstance(failure.value.__cause__, OSError)
    assert "device busy" in caplog.text
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_an_open_that_blocks_is_reported_at_the_open_time_limit_not_after_cleanup() -> None:
    gate = threading.Event()
    source = FakeSource([image()], open_gate=gate)
    started = time.monotonic()

    with pytest.raises(CameraOpenFailed, match="did not open within 0.1 seconds"):
        next(stream(source, open_timeout=SHORT_TIMEOUT))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: cleanup must not add the 2 s limit
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_a_slow_first_frame_is_allowed_the_open_time_limit_not_the_frame_one() -> None:
    gate = threading.Event()
    wanted = image(4)
    source = FakeSource([wanted], read_gate=gate)
    release = threading.Timer(3 * SHORT_TIMEOUT, gate.set)
    release.start()

    with closing(stream(source, read_timeout=SHORT_TIMEOUT)) as frame_stream:
        assert next(frame_stream).image is wanted

    release.join()


def test_no_first_frame_within_the_open_time_limit_is_camera_open_failed() -> None:
    gate = threading.Event()
    source = FakeSource([image()], read_gate=gate)
    started = time.monotonic()

    with pytest.raises(CameraOpenFailed, match="no first frame within 0.1 seconds"):
        next(stream(source, open_timeout=SHORT_TIMEOUT))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: cleanup must not add the 2 s limit
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_a_read_that_blocks_after_the_first_frame_is_camera_read_timed_out() -> None:
    gate = threading.Event()
    gate.set()
    source = FakeSource([image(value) for value in range(6)], read_gate=gate)

    with closing(stream(source, read_timeout=SHORT_TIMEOUT)) as frame_stream:
        next(frame_stream)
        gate.clear()
        started = time.monotonic()
        with pytest.raises(CameraReadTimedOut, match="no frame arrived within 0.1 seconds"):
            for _ in frame_stream:
                pass

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: the time limit is the behaviour
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_reads_that_go_empty_after_the_first_frame_are_camera_read_timed_out() -> None:
    source = FakeSource([image()])

    with closing(stream(source, read_timeout=SHORT_TIMEOUT)) as frame_stream:
        next(frame_stream)
        with pytest.raises(CameraReadTimedOut, match="no frame arrived within 0.1 seconds"):
            next(frame_stream)

    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()
    assert source.close_calls == 1


def test_a_read_that_raises_is_camera_read_failed_naming_the_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource([image()], read_error=OSError("device unplugged"))

    with (
        caplog.at_level(logging.ERROR, logger=camera.logger.name),
        closing(stream(source)) as frame_stream,
    ):
        next(frame_stream)
        started = time.monotonic()
        with pytest.raises(CameraReadFailed, match="device unplugged") as failure:
            next(frame_stream)

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert isinstance(failure.value.__cause__, OSError)
    assert "device unplugged" in caplog.text
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()
    assert source.close_calls == 1


def test_stopping_after_a_read_raised_returns_with_the_camera_closed_exactly_once() -> None:
    source = FakeSource([image()], read_error=OSError("device unplugged"))
    frame_stream = stream(source)
    next(frame_stream)
    assert source.closed.wait(WAIT_LIMIT)

    frame_stream.close()

    assert reader_thread_ended()
    assert source.close_calls == 1


def test_stopping_early_closes_the_camera_and_ends_the_thread(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource([image(value) for value in range(10)])

    with (
        caplog.at_level(logging.INFO, logger=camera.logger.name),
        closing(stream(source)) as frame_stream,
    ):
        received = list(islice(frame_stream, 3))

    assert len(received) == 3
    assert source.closed.is_set()
    assert reader_thread_ended()
    assert "stopped reading camera" in caplog.text


def test_stopping_while_a_read_is_in_progress_closes_the_camera_and_ends_the_thread() -> None:
    source = FakeSource(read_seconds=0.03)

    with closing(stream(source)) as frame_stream:
        received = list(islice(frame_stream, 3))

    assert len(received) == 3
    assert source.closed.is_set()
    assert reader_thread_ended()


def test_stopping_while_reads_are_empty_closes_the_camera_and_ends_the_thread() -> None:
    source = FakeSource([image()])

    with closing(stream(source)) as frame_stream:
        next(frame_stream)

    assert source.closed.is_set()
    assert reader_thread_ended()


def test_stopping_while_a_read_blocks_returns_in_time_and_says_the_camera_is_still_held(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gate = threading.Event()
    gate.set()
    source = FakeSource([image()], read_gate=gate)
    frame_stream = stream(source, read_timeout=SHORT_TIMEOUT)
    next(frame_stream)
    gate.clear()
    assert source.read_waiting.wait(WAIT_LIMIT)
    started = time.monotonic()

    with caplog.at_level(logging.INFO, logger=camera.logger.name):
        frame_stream.close()

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: close must not hang on the read
    assert not source.closed.is_set()
    assert "has not returned" in caplog.text
    assert "stopped reading camera" not in caplog.text
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


class FakeCapture:
    """Stands in for cv2.VideoCapture and records what the real frame source asks of it."""

    def __init__(self, index: int, backend: int, *, opened: bool = True) -> None:
        self.index: int = index
        self.backend: int = backend
        self.opened: bool = opened
        self.asked: dict[int, float] = {}
        self.delivers: bool = True
        self.releases: int = 0

    def isOpened(self) -> bool:
        return self.opened

    def set(self, prop: int, value: float) -> bool:
        self.asked[prop] = value
        return True

    def get(self, prop: int) -> float:
        return self.asked[prop]

    def read(self) -> tuple[bool, Image | None]:
        return (True, image(7)) if self.delivers else (False, None)

    def release(self) -> None:
        self.releases += 1


@pytest.fixture
def captures(monkeypatch: pytest.MonkeyPatch) -> list[FakeCapture]:
    made: list[FakeCapture] = []

    def make(index: int, backend: int) -> FakeCapture:
        made.append(FakeCapture(index, backend, opened=index == WEBCAM.index))
        return made[-1]

    monkeypatch.setattr(camera.cv2, "VideoCapture", make)
    return made


def test_the_real_source_opens_by_index_and_backend_and_asks_for_the_format(
    captures: list[FakeCapture],
) -> None:
    source = camera.open_cv_source(WEBCAM)

    assert source.open(640, 480, 15)

    assert (captures[0].index, captures[0].backend) == (
        WEBCAM.index,
        getattr(cv2, settings.CAMERA_BACKENDS[platform.system()]),
    )
    assert captures[0].asked == {
        cv2.CAP_PROP_FRAME_WIDTH: 640,
        cv2.CAP_PROP_FRAME_HEIGHT: 480,
        cv2.CAP_PROP_FPS: 15,
    }
    assert source.reported_frames_per_second() == 15.0


def test_the_real_source_reads_a_frame_or_none_when_nothing_is_delivered(
    captures: list[FakeCapture],
) -> None:
    source = camera.open_cv_source(WEBCAM)
    assert source.read() is None
    source.open(640, 480, 15)

    delivered = source.read()
    captures[0].delivers = False

    assert delivered is not None
    assert delivered.shape == (480, 640, 3)
    assert source.read() is None


def test_the_real_source_releases_the_camera_exactly_once(captures: list[FakeCapture]) -> None:
    never_opened = camera.open_cv_source(WEBCAM)
    never_opened.close()
    refused = camera.open_cv_source(BUILT_IN)

    assert not refused.open(640, 480, 15)
    refused.close()
    refused.close()

    assert [capture.releases for capture in captures] == [1]


def write_config(folder: Path, camera_value: object) -> list[str]:
    config_path = folder / "worker.json"
    config_path.write_text(
        json.dumps({"schema_version": 1, "camera": camera_value}), encoding="utf-8"
    )
    return ["--config", str(config_path)]


def test_reader_exits_0_after_reading_frames(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def fake_frames(wanted: str) -> Generator[Frame, None, None]:
        yield Frame(image(), datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC))

    monkeypatch.setattr(camera, "frames", fake_frames)

    with caplog.at_level(logging.INFO, logger=frame_reader.logger.name):
        assert frame_reader.main([*write_config(tmp_path, WEBCAM.name), "--seconds", "0"]) == 0

    assert "frame 1 is 640 by 480, captured_at 2026-11-14T03:12:45Z" in caplog.text


def test_reader_run_length_and_rate_are_measured_from_the_first_frame(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    now = [100.0]

    def slow_to_open_frames(wanted: str) -> Generator[Frame, None, None]:
        now[0] += 0.25
        for _ in range(50):
            yield Frame(image(), camera.utc_now())
            now[0] += 0.125

    monkeypatch.setattr(camera, "frames", slow_to_open_frames)
    monkeypatch.setattr(frame_reader, "monotonic", lambda: now[0])

    with caplog.at_level(logging.INFO, logger=frame_reader.logger.name):
        assert frame_reader.main([*write_config(tmp_path, WEBCAM.name), "--seconds", "0.5"]) == 0

    assert "frame 5 is 640 by 480" in caplog.text
    assert "frame 6 is" not in caplog.text
    assert "read 5 frames over 0.5 seconds from the first frame, 8.0 per second" in caplog.text


def test_reader_exits_0_and_opens_nothing_when_no_camera_is_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[str] = []

    def fake_frames(wanted: str) -> Generator[Frame, None, None]:
        asked.append(wanted)
        yield Frame(image(), camera.utc_now())

    monkeypatch.setattr(camera, "frames", fake_frames)

    assert frame_reader.main(write_config(tmp_path, None)) == 0
    assert asked == []


@pytest.mark.parametrize(
    ("failure", "exit_code"),
    [(CameraNotFound("camera 'x' was not found"), 1), (KeyboardInterrupt(), 0)],
)
def test_reader_exits_1_on_a_capture_error_and_0_when_stopped_by_the_keyboard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: BaseException, exit_code: int
) -> None:
    def fake_frames(wanted: str) -> Generator[Frame, None, None]:
        raise failure
        yield

    monkeypatch.setattr(camera, "frames", fake_frames)

    assert frame_reader.main(write_config(tmp_path, WEBCAM.name)) == exit_code


def test_reader_exits_2_on_a_bad_config(tmp_path: Path) -> None:
    assert frame_reader.main(write_config(tmp_path, True)) == 2


@pytest.mark.parametrize("seconds", ["nan", "inf", "1e400", "-1", "soon"])
def test_reader_refuses_a_run_length_that_is_not_a_finite_number_of_0_or_more(
    tmp_path: Path, seconds: str
) -> None:
    with pytest.raises(SystemExit) as stopped:
        frame_reader.main([*write_config(tmp_path, WEBCAM.name), "--seconds", seconds])

    assert stopped.value.code == 2


def test_frames_with_its_defaults_lists_opens_and_stamps_in_utc(
    captures: list[FakeCapture], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(camera, "enumerate_cameras", lambda backend: [WEBCAM])
    before = datetime.now(UTC)

    with closing(frames(WEBCAM.name)) as frame_stream:
        frame = next(frame_stream)

    assert frame.image.shape == (480, 640, 3)
    assert frame.captured_at.utcoffset() == timedelta(0)
    assert before <= frame.captured_at <= datetime.now(UTC)
    assert captures[0].releases == 1


def test_a_first_read_that_raises_is_camera_read_failed_at_once() -> None:
    source = FakeSource(read_error=OSError("device unplugged"))
    started = time.monotonic()

    with pytest.raises(CameraReadFailed, match="device unplugged"):
        next(stream(source))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()
    assert source.close_calls == 1


def test_a_first_frame_that_is_not_8_bit_stops_capture() -> None:
    source = FakeSource([np.zeros((480, 640, 3), dtype=np.uint16)])

    with pytest.raises(CameraFormatMismatch, match="uint16 values instead of 8-bit"):
        next(stream(source))

    assert source.closed.wait(WAIT_LIMIT)


@pytest.mark.parametrize("source", [FakeSource(opens=False), FakeSource([image()])])
def test_stopped_reading_is_logged_only_for_a_camera_that_opened(
    source: FakeSource, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger=camera.logger.name):
        frame_stream = stream(source)
        if source.opens:
            next(frame_stream)
            frame_stream.close()
        else:
            with pytest.raises(CameraOpenFailed):
                next(frame_stream)

    assert ("stopped reading camera" in caplog.text) == source.opens


def test_a_close_that_raises_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    source = FakeSource([image()], close_error=OSError("release failed"))

    with (
        caplog.at_level(logging.ERROR, logger=camera.logger.name),
        closing(stream(source)) as frame_stream,
    ):
        next(frame_stream)

    assert reader_thread_ended()
    assert "closing camera" in caplog.text
    assert "release failed" in caplog.text


def test_reader_with_no_camera_configured_never_loads_the_capture_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, "layer3.camera", None)

    assert frame_reader.main(write_config(tmp_path, None)) == 0
