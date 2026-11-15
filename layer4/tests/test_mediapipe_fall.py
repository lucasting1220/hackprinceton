import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from layer4.fall import Activity, FallModelError, FallReading
from layer4.mediapipe_fall import Landmark, MediaPipeFallModel, open_mediapipe_fall_model
from layer4.pose_fall import Pose, PoseFallScorer

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


@dataclass(frozen=True)
class Mark:
    x: float | None
    y: float | None
    visibility: float | None


@dataclass(frozen=True)
class Frame:
    image: object
    captured_at: datetime


def standing(visibility: float | None = 1.0, x: float | None = 0.5) -> list[Mark]:
    """33 landmarks; only shoulders (11, 12), hips (23, 24) and knees (25, 26) matter."""
    marks = [Mark(0.0, 0.0, 0.0)] * 33
    for index, y in ((11, 0.3), (12, 0.3), (23, 0.55), (24, 0.55), (25, 0.75), (26, 0.75)):
        marks[index] = Mark(x, y, visibility)
    return marks


class FakeLandmarker:
    def __init__(self, people: list[list[Mark]] | Exception) -> None:
        self.people = people
        self.calls: list[tuple[NDArray[np.uint8], int]] = []
        self.closed = False

    def detect(self, rgb: NDArray[np.uint8], timestamp_ms: int) -> Sequence[Sequence[Landmark]]:
        self.calls.append((rgb, timestamp_ms))
        if isinstance(self.people, Exception):
            raise self.people
        return self.people

    def close(self) -> None:
        self.closed = True


class RecordingScorer(PoseFallScorer):
    def __init__(self) -> None:
        super().__init__()
        self.poses: list[Pose | None] = []

    def score(self, pose: Pose | None, at: datetime) -> FallReading:
        self.poses.append(pose)
        return super().score(pose, at)


def image(height: int = 480, width: int = 640) -> NDArray[np.uint8]:
    bgr = np.zeros((height, width, 3), np.uint8)
    bgr[:, :, 0] = 10
    bgr[:, :, 2] = 200
    return bgr


def test_a_standing_person_reads_as_walking_and_the_image_arrives_as_rgb() -> None:
    fake = FakeLandmarker([standing()])
    reading = MediaPipeFallModel(fake).assess(Frame(image(), T0))
    assert reading == FallReading(confidence=0.0, activity=Activity.WALKING)
    rgb, _ = fake.calls[0]
    assert (rgb[0, 0, 0], rgb[0, 0, 2]) == (200, 10)
    assert rgb.flags["C_CONTIGUOUS"]


def test_x_is_scaled_to_fractions_of_the_frame_height() -> None:
    scorer = RecordingScorer()
    MediaPipeFallModel(FakeLandmarker([standing()]), scorer).assess(Frame(image(480, 640), T0))
    pose = scorer.poses[0]
    assert pose is not None
    assert pose.left_hip.x == pytest.approx(0.5 * 640 / 480)
    assert pose.left_hip.y == pytest.approx(0.55)


@pytest.mark.parametrize(
    "people",
    [[], [standing(visibility=None)], [standing(x=None)], [standing(x=float("nan"))]],
    ids=["nobody", "no-visibility", "no-x", "nan-x"],
)
def test_nobody_or_unreadable_points_read_as_not_in_view(people: list[list[Mark]]) -> None:
    reading = MediaPipeFallModel(FakeLandmarker(people)).assess(Frame(image(), T0))
    assert reading.activity == Activity.NOT_IN_VIEW


def test_visibility_outside_0_to_1_is_clamped_not_rejected() -> None:
    reading = MediaPipeFallModel(FakeLandmarker([standing(visibility=1.7)])).assess(
        Frame(image(), T0)
    )
    assert reading.activity == Activity.WALKING


def test_timestamps_always_increase() -> None:
    fake = FakeLandmarker([])
    model = MediaPipeFallModel(fake)
    for captured_at in (T0, T0, T0 - timedelta(seconds=1), T0 + timedelta(seconds=1)):
        model.assess(Frame(image(), captured_at))
    stamps = [ms for _, ms in fake.calls]
    base = int(T0.timestamp() * 1000)
    assert stamps == [base, base + 1, base + 2, base + 1000]


@pytest.mark.parametrize("error", [ValueError("bad timestamp"), RuntimeError("graph failed")])
def test_mediapipe_errors_become_fall_model_errors(error: Exception) -> None:
    with pytest.raises(FallModelError, match="could not read the frame"):
        MediaPipeFallModel(FakeLandmarker(error)).assess(Frame(image(), T0))


@pytest.mark.parametrize(
    "bad",
    [
        None,
        np.zeros((480, 640), np.uint8),
        np.zeros((480, 640, 4), np.uint8),
        np.zeros((480, 640, 3), np.float32),
        np.zeros((0, 640, 3), np.uint8),
    ],
    ids=["none", "grey", "four-channels", "float", "empty"],
)
def test_images_that_are_not_bgr_uint8_are_refused(bad: object) -> None:
    fake = FakeLandmarker([])
    with pytest.raises(FallModelError, match="uint8 image"):
        MediaPipeFallModel(fake).assess(Frame(bad, T0))
    assert fake.calls == []


def test_a_wrong_landmark_count_is_refused() -> None:
    with pytest.raises(FallModelError, match="33 pose landmarks"):
        MediaPipeFallModel(FakeLandmarker([standing()[:20]])).assess(Frame(image(), T0))


def test_close_closes_the_landmarker() -> None:
    fake = FakeLandmarker([])
    MediaPipeFallModel(fake).close()
    assert fake.closed


def test_opening_a_missing_model_file_names_it(tmp_path: Path) -> None:
    missing = tmp_path / "pose_landmarker_lite.task"
    with pytest.raises(FallModelError, match="pose_landmarker_lite.task"):
        open_mediapipe_fall_model(missing)


def test_opening_a_damaged_model_file_is_a_fall_model_error(tmp_path: Path) -> None:
    damaged = tmp_path / "pose_landmarker_lite.task"
    damaged.write_bytes(b"not a model")
    with pytest.raises(FallModelError, match="could not open the pose model"):
        open_mediapipe_fall_model(damaged)


def test_without_mediapipe_opening_says_it_is_not_available(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_file = tmp_path / "pose_landmarker_lite.task"
    model_file.write_bytes(b"model")
    monkeypatch.setitem(sys.modules, "mediapipe", None)
    with pytest.raises(FallModelError, match="not available on this laptop"):
        open_mediapipe_fall_model(model_file)
