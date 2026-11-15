import enum
from typing import Protocol

from mediapipe import Image
from mediapipe.tasks.python import BaseOptions

class _NormalizedLandmark(Protocol):
    x: float | None
    y: float | None
    visibility: float | None

class RunningMode(enum.Enum):
    VIDEO = "VIDEO"

class PoseLandmarkerResult:
    pose_landmarks: list[list[_NormalizedLandmark]]
    def __init__(
        self,
        pose_landmarks: list[list[_NormalizedLandmark]],
        pose_world_landmarks: list[list[object]],
        segmentation_masks: list[Image] | None = None,
    ) -> None: ...

class PoseLandmarkerOptions:
    def __init__(
        self,
        base_options: BaseOptions,
        running_mode: RunningMode = ...,
        num_poses: int = 1,
        min_pose_detection_confidence: float = 0.5,
        min_pose_presence_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        output_segmentation_masks: bool = False,
        result_callback: object | None = None,
    ) -> None: ...

class PoseLandmarker:
    def __init__(
        self, lib: object, handle: object, dispatcher: object, async_callback: object
    ) -> None: ...
    @classmethod
    def create_from_options(cls, options: PoseLandmarkerOptions) -> PoseLandmarker: ...
    def detect_for_video(
        self, image: Image, timestamp_ms: int, image_processing_options: object | None = None
    ) -> PoseLandmarkerResult: ...
    def close(self) -> None: ...
