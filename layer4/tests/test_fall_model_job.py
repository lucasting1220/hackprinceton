import hashlib
import importlib.util
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest
from fakes import FakeEventLog, FakePhone

from layer2.contracts import JobDescription
from layer2.job_client import FeedItem
from layer4.fall import (
    WHAT_STOPPED,
    Activity,
    CameraFrame,
    FallDetector,
    FallModel,
    FallModelError,
    FallReading,
)
from layer4.jobs.fall_model import (
    FallJob,
    decode_frame,
    ensure_model,
    main,
    open_model,
    run_frames,
)
from layer4.jobs.stop_reporter import StopReporter
from layer4.settings import RuleThresholds
from layer4.upper_tier import UpperTier

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
JOB_FOLDER = Path(__file__).resolve().parents[1] / "jobs" / "fall_model"


def jpeg() -> bytes:
    image = np.zeros((480, 640, 3), np.uint8)
    image[:, :, 0] = 220  # blue, in OpenCV's BGR order
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def item(ms: int, data: bytes | None = None) -> FeedItem:
    return FeedItem(
        data=jpeg() if data is None else data, captured_at=T0 + timedelta(milliseconds=ms)
    )


class ScriptedModel:
    def __init__(self, confidences: Iterator[float]) -> None:
        self._confidences = confidences

    def assess(self, frame: CameraFrame) -> FallReading:
        return FallReading(confidence=next(self._confidences), activity=Activity.WALKING)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


def build(
    confidences: Iterator[float], clock: Clock
) -> tuple[FallJob, FakeEventLog, FakePhone, FallDetector]:
    log, phone = FakeEventLog(), FakePhone()
    upper = UpperTier(RuleThresholds(), log, phone)
    detector = FallDetector(ScriptedModel(confidences), clock=clock)
    return (
        FallJob(detector, upper, StopReporter(upper, WHAT_STOPPED), started_at=T0),
        log,
        phone,
        detector,
    )


def feed(job: FallJob, clock: Clock, offsets_ms: list[int]) -> None:
    for ms in offsets_ms:
        clock.now = T0 + timedelta(milliseconds=ms)
        job.on_frame(item(ms))


def test_a_jpeg_decodes_to_a_bgr_frame_with_its_capture_time() -> None:
    frame = decode_frame(item(0))
    assert frame is not None
    assert frame.image.shape == (480, 640, 3)
    assert frame.image.dtype == np.uint8
    assert frame.image[0, 0, 0] > 200 > frame.image[0, 0, 2]
    assert frame.captured_at == T0


def test_data_that_is_not_a_jpeg_decodes_to_none() -> None:
    assert decode_frame(item(0, data=b"not a jpeg")) is None


def test_a_fall_sends_one_alert_and_logs_one_event() -> None:
    clock = Clock()
    job, log, phone, _ = build(iter([0.0, 0.9, 0.0, 0.0, 0.0, 0.0]), clock)
    feed(job, clock, [0, 300, 1000, 1300, 1600, 2000])
    assert [alert.kind for alert in phone.alerts] == ["fall"]
    assert len(log.events) == 1


def test_windows_with_no_fall_score_are_not_logged() -> None:
    clock = Clock()
    job, log, phone, _ = build(iter([0.0] * 5), clock)
    feed(job, clock, [0, 500, 1000, 1500, 2000])
    assert log.events == []
    assert phone.alerts == []


def test_a_frame_that_is_not_a_jpeg_is_skipped() -> None:
    clock = Clock()
    job, log, _, detector = build(iter([0.9]), clock)
    job.on_frame(item(0, data=b"broken"))
    assert detector.last_reading_at is None
    assert log.events == []


def test_no_frames_since_start_is_reported_once_it_alerts_then_not_again() -> None:
    job, log, phone, _ = build(iter([]), Clock())
    job.check_health(T0 + timedelta(seconds=2))
    assert log.events == []
    job.check_health(T0 + timedelta(seconds=10))
    assert phone.alerts == []
    assert len(log.events) == 1
    job.check_health(T0 + timedelta(seconds=40))
    assert [alert.kind for alert in phone.alerts] == ["monitoring"]
    job.check_health(T0 + timedelta(seconds=50))
    assert len(phone.alerts) == 1
    assert len(log.events) == 2


def test_after_frames_come_back_a_new_stop_alerts_again() -> None:
    clock = Clock()
    job, _, phone, _ = build(iter([0.0] * 10), clock)
    job.check_health(T0 + timedelta(seconds=40))
    feed(job, clock, [41_000])
    job.check_health(T0 + timedelta(seconds=42))
    clock.now = T0 + timedelta(seconds=80)
    job.check_health(clock.now)
    assert [alert.kind for alert in phone.alerts] == ["monitoring", "monitoring"]


def test_a_model_that_cannot_open_is_reported_and_retried() -> None:
    log, phone = FakeEventLog(), FakePhone()
    reporter = StopReporter(UpperTier(RuleThresholds(), log, phone), WHAT_STOPPED)
    attempts: list[Path] = []
    model = ScriptedModel(iter([]))

    def opener(path: Path) -> FallModel:
        attempts.append(path)
        if len(attempts) < 3:
            raise FallModelError("pose model file not found")
        return model

    waits: list[float] = []
    clock_times = iter([T0 + timedelta(seconds=10), T0 + timedelta(seconds=40)])
    opened = open_model(
        Path("pose.task"),
        reporter,
        T0,
        retry_s=30.0,
        opener=opener,
        clock=lambda: next(clock_times),
        sleep=waits.append,
    )
    assert opened is model
    assert waits == [30.0, 30.0]
    assert len(log.events) == 2
    assert [alert.kind for alert in phone.alerts] == ["monitoring"]


def test_run_frames_hands_every_item_to_the_job() -> None:
    clock = Clock()
    job, _, _, detector = build(iter([0.0, 0.0]), clock)
    clock.now = T0 + timedelta(milliseconds=100)
    run_frames(job, [item(0), item(100)])
    assert detector.last_reading_at == clock.now


def test_the_model_is_downloaded_once_and_checked(tmp_path: Path) -> None:
    source = tmp_path / "source.task"
    source.write_bytes(b"pose model bytes")
    digest = hashlib.sha256(b"pose model bytes").hexdigest()
    target = tmp_path / "pose_landmarker_full.task"
    assert ensure_model(target, url=source.as_uri(), sha256=digest) == target
    assert target.read_bytes() == b"pose model bytes"
    missing = (tmp_path / "gone.task").as_uri()
    assert ensure_model(target, url=missing, sha256=digest) == target


def test_a_model_with_the_wrong_hash_is_refused_and_removed(tmp_path: Path) -> None:
    source = tmp_path / "source.task"
    source.write_bytes(b"some other file")
    target = tmp_path / "pose_landmarker_full.task"
    with pytest.raises(FallModelError, match="not the expected file"):
        ensure_model(target, url=source.as_uri(), sha256="0" * 64)
    assert sorted(path.name for path in tmp_path.iterdir()) == ["source.task"]


def test_a_model_that_cannot_be_downloaded_is_a_fall_model_error(tmp_path: Path) -> None:
    with pytest.raises(FallModelError, match="could not download"):
        ensure_model(tmp_path / "pose.task", url=(tmp_path / "gone.task").as_uri(), sha256="0" * 64)
    assert list(tmp_path.iterdir()) == []


def test_outside_a_layer_2_job_main_exits_with_2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    assert main(["--model", "pose.task"]) == 2


def test_the_job_description_is_one_layer_2_accepts_and_starts_this_job() -> None:
    raw = json.loads((JOB_FOLDER / "job.json").read_text(encoding="utf-8"))
    job = JobDescription.model_validate(raw)
    assert job.name == JOB_FOLDER.name
    assert job.sensor == "camera"
    command = job.start_command
    module = command[command.index("-m") + 1]
    assert importlib.util.find_spec(module) is not None
    assert command[command.index("--project") + 1] == "../.."
    assert (JOB_FOLDER / "../.." / "pyproject.toml").resolve().is_file()
    assert command[command.index("--model") + 1].endswith(".task")
