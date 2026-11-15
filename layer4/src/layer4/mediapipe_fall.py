"""Layer 4 fall model: MediaPipe Pose Landmarker finds the body points, PoseFallScorer reads them.

Frames come from Layer 3 as height x width x 3 uint8 images in BGR order. The model file
(pose_landmarker_lite.task) is never in the repository; its path comes from the job's
configuration. MediaPipe has no build for Intel Macs, so it is imported only when the model is
opened, and there opening raises FallModelError for the job to report.
"""

import math
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import numpy as np
from numpy.typing import NDArray

from layer4 import settings
from layer4.fall import CameraFrame, FallModelError, FallReading
from layer4.pose_fall import Point, Pose, PoseFallScorer

if TYPE_CHECKING:
    from mediapipe import Image
    from mediapipe.tasks.python.vision import PoseLandmarker

# MediaPipe's pose landmark numbers for the points the fall rules read.
_LEFT_SHOULDER, _RIGHT_SHOULDER = 11, 12
_LEFT_HIP, _RIGHT_HIP = 23, 24
_LEFT_KNEE, _RIGHT_KNEE = 25, 26
_LANDMARK_COUNT = 33


class Landmark(Protocol):
    """One body point as MediaPipe gives it: x and y in fractions of the width and height."""

    @property
    def x(self) -> float | None: ...

    @property
    def y(self) -> float | None: ...

    @property
    def visibility(self) -> float | None: ...


class Landmarker(Protocol):
    """Finds each person's landmarks in one RGB image. Timestamps must keep increasing."""

    def detect(self, rgb: NDArray[np.uint8], timestamp_ms: int) -> Sequence[Sequence[Landmark]]: ...

    def close(self) -> None: ...


class _MediaPipeLandmarker:
    def __init__(
        self, landmarker: "PoseLandmarker", make_image: Callable[[NDArray[np.uint8]], "Image"]
    ) -> None:
        self._landmarker = landmarker
        self._make_image = make_image

    def detect(self, rgb: NDArray[np.uint8], timestamp_ms: int) -> Sequence[Sequence[Landmark]]:
        result = self._landmarker.detect_for_video(self._make_image(rgb), timestamp_ms)
        return result.pose_landmarks

    def close(self) -> None:
        self._landmarker.close()


def _rgb(image: object) -> NDArray[np.uint8]:
    if (
        not isinstance(image, np.ndarray)
        or image.ndim != 3
        or image.shape[2] != 3
        or image.dtype != np.uint8
        or image.shape[0] == 0
        or image.shape[1] == 0
    ):
        shape = getattr(image, "shape", None)
        dtype = getattr(image, "dtype", None)
        raise FallModelError(
            f"expected a height x width x 3 uint8 image, got {type(image).__name__} "
            f"with shape {shape} and dtype {dtype}"
        )
    return np.ascontiguousarray(image[:, :, ::-1])


def _point(landmark: Landmark, x_scale: float) -> Point:
    x, y, visibility = landmark.x, landmark.y, landmark.visibility
    if x is None or y is None or not math.isfinite(x) or not math.isfinite(y):
        return Point(0.0, 0.0, 0.0)
    if visibility is None or not math.isfinite(visibility):
        visibility = 0.0
    return Point(x * x_scale, y, min(1.0, max(0.0, visibility)))


def _pose(landmarks: Sequence[Landmark], x_scale: float) -> Pose:
    if len(landmarks) != _LANDMARK_COUNT:
        raise FallModelError(f"expected {_LANDMARK_COUNT} pose landmarks, got {len(landmarks)}")
    return Pose(
        left_shoulder=_point(landmarks[_LEFT_SHOULDER], x_scale),
        right_shoulder=_point(landmarks[_RIGHT_SHOULDER], x_scale),
        left_hip=_point(landmarks[_LEFT_HIP], x_scale),
        right_hip=_point(landmarks[_RIGHT_HIP], x_scale),
        left_knee=_point(landmarks[_LEFT_KNEE], x_scale),
        right_knee=_point(landmarks[_RIGHT_KNEE], x_scale),
    )


class MediaPipeFallModel:
    """A FallModel: the landmarker finds the pose in each frame and the scorer reads it."""

    def __init__(self, landmarker: Landmarker, scorer: PoseFallScorer | None = None) -> None:
        self._landmarker = landmarker
        self._scorer = scorer if scorer is not None else PoseFallScorer()
        self._last_timestamp_ms: int | None = None

    def assess(self, frame: CameraFrame) -> FallReading:
        rgb = _rgb(frame.image)
        timestamp_ms = self._timestamp_ms(frame.captured_at)
        try:
            people = self._landmarker.detect(rgb, timestamp_ms)
        except (ValueError, RuntimeError) as err:
            raise FallModelError(f"MediaPipe could not read the frame: {err}") from err
        height, width = rgb.shape[:2]
        pose = _pose(people[0], width / height) if people else None
        return self._scorer.score(pose, frame.captured_at)

    def close(self) -> None:
        self._landmarker.close()

    def _timestamp_ms(self, captured_at: datetime) -> int:
        """MediaPipe rejects a timestamp that does not increase, so a repeat moves 1 ms on."""
        timestamp_ms = int(captured_at.timestamp() * 1000)
        last = self._last_timestamp_ms
        if last is not None and timestamp_ms <= last:
            timestamp_ms = last + 1
        self._last_timestamp_ms = timestamp_ms
        return timestamp_ms


def open_mediapipe_fall_model(
    model_path: Path, scorer: PoseFallScorer | None = None
) -> MediaPipeFallModel:
    """Open the pose model file. Raises FallModelError if it cannot run on this laptop."""
    if not model_path.is_file():
        raise FallModelError(f"pose model file not found: {model_path}")
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
    except ImportError as err:
        raise FallModelError("MediaPipe is not available on this laptop") from err
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=settings.POSE_MODEL_PEOPLE,
    )
    try:
        landmarker = vision.PoseLandmarker.create_from_options(options)
    except (ValueError, RuntimeError) as err:
        raise FallModelError(f"could not open the pose model {model_path}: {err}") from err

    def make_image(rgb: NDArray[np.uint8]) -> "Image":
        return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    return MediaPipeFallModel(_MediaPipeLandmarker(landmarker, make_image), scorer)
