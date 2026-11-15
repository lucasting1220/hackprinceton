"""Layer 4 fall model's pose reading: a pose per frame in, a FallReading out.

A pose model (MediaPipe, in a separate adapter) finds the body points; this module holds the
rules that read them and imports no pose library, so the rules are tested on hand-made poses.
The rules and their settings are described in settings.py and docs/layer4-care-layer.md.

This module reads the resident's activity (walking, sitting, lying down, not in view). Its
fall confidence is 0: no fall rule is applied here.
"""

import math
from dataclasses import dataclass
from datetime import datetime

from layer4 import settings
from layer4.fall import Activity, FallReading


def _is_real(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True)
class Point:
    """One body point. x and y are in fractions of the frame height; y grows downward."""

    x: float
    y: float
    visibility: float

    def __post_init__(self) -> None:
        for name, value in (("x", self.x), ("y", self.y)):
            if not _is_real(value):
                raise ValueError(f"{name} must be a finite number, got {value!r}")
        if not _is_real(self.visibility) or not 0.0 <= self.visibility <= 1.0:
            raise ValueError(f"visibility must be a number from 0 to 1, got {self.visibility!r}")


@dataclass(frozen=True)
class Pose:
    """The body points the fall rules read."""

    left_shoulder: Point
    right_shoulder: Point
    left_hip: Point
    right_hip: Point
    left_knee: Point
    right_knee: Point


@dataclass(frozen=True)
class _Body:
    hip_y: float
    torso: float
    angle_deg: float
    knee_y: float | None


def _check_number(name: str, value: float, low: float, high: float, *, low_open: bool) -> None:
    if not _is_real(value) or value < low or value > high or (low_open and value == low):
        bracket = "(" if low_open else "["
        raise ValueError(f"{name} must be a number in {bracket}{low}, {high}], got {value!r}")


class PoseFallScorer:
    """Reads each frame's pose. Raises ValueError at construction if a setting makes no sense."""

    def __init__(
        self,
        *,
        min_visibility: float = settings.POSE_MIN_VISIBILITY,
        min_torso: float = settings.POSE_MIN_TORSO,
        upright_angle_deg: float = settings.POSE_UPRIGHT_ANGLE_DEG,
        lying_angle_deg: float = settings.POSE_LYING_ANGLE_DEG,
        foreshortened_ratio: float = settings.POSE_FORESHORTENED_RATIO,
        sitting_hip_knee_ratio: float = settings.POSE_SITTING_HIP_KNEE_RATIO,
    ) -> None:
        _check_number("min_visibility", min_visibility, 0.0, 1.0, low_open=False)
        _check_number("min_torso", min_torso, 0.0, 1.0, low_open=True)
        _check_number("upright_angle_deg", upright_angle_deg, 0.0, 90.0, low_open=True)
        _check_number("lying_angle_deg", lying_angle_deg, 0.0, 90.0, low_open=True)
        if upright_angle_deg >= lying_angle_deg:
            raise ValueError(
                f"upright_angle_deg ({upright_angle_deg}) must be below "
                f"lying_angle_deg ({lying_angle_deg})"
            )
        _check_number("foreshortened_ratio", foreshortened_ratio, 0.0, 1.0, low_open=True)
        _check_number("sitting_hip_knee_ratio", sitting_hip_knee_ratio, 0.0, 1.0, low_open=True)
        self._min_visibility = min_visibility
        self._min_torso = min_torso
        self._upright_angle = upright_angle_deg
        self._lying_angle = lying_angle_deg
        self._foreshortened_ratio = foreshortened_ratio
        self._sitting_ratio = sitting_hip_knee_ratio
        self._upright_torso: float | None = None
        self._last_at: datetime | None = None

    def score(self, pose: Pose | None, at: datetime) -> FallReading:
        """Read the pose seen at `at`; None means no person was found in the frame.

        A frame older than one already read reports its activity but changes nothing.
        """
        body = self._measure(pose)
        in_order = self._last_at is None or at >= self._last_at
        if in_order:
            self._last_at = at
        if body is None:
            if in_order:
                # Whoever comes back into view may stand at another distance from the camera.
                self._upright_torso = None
            return FallReading(confidence=0.0, activity=Activity.NOT_IN_VIEW)
        lying = self._is_lying(body)
        if in_order and not lying and body.angle_deg <= self._upright_angle:
            self._upright_torso = body.torso
        return FallReading(confidence=0.0, activity=self._activity(body, lying))

    def _measure(self, pose: Pose | None) -> _Body | None:
        if pose is None:
            return None
        torso_points = (pose.left_shoulder, pose.right_shoulder, pose.left_hip, pose.right_hip)
        if any(point.visibility < self._min_visibility for point in torso_points):
            return None
        shoulder_x = (pose.left_shoulder.x + pose.right_shoulder.x) / 2
        shoulder_y = (pose.left_shoulder.y + pose.right_shoulder.y) / 2
        hip_x = (pose.left_hip.x + pose.right_hip.x) / 2
        hip_y = (pose.left_hip.y + pose.right_hip.y) / 2
        dx = shoulder_x - hip_x
        dy = shoulder_y - hip_y
        torso = math.hypot(dx, dy)
        if torso < self._min_torso:
            return None
        angle = math.degrees(math.atan2(abs(dx), -dy))
        knees = (pose.left_knee, pose.right_knee)
        knee_y = None
        if all(knee.visibility >= self._min_visibility for knee in knees):
            knee_y = (pose.left_knee.y + pose.right_knee.y) / 2
        return _Body(hip_y=hip_y, torso=torso, angle_deg=angle, knee_y=knee_y)

    def _is_lying(self, body: _Body) -> bool:
        if body.angle_deg >= self._lying_angle:
            return True
        reference = self._upright_torso
        return reference is not None and body.torso < self._foreshortened_ratio * reference

    def _activity(self, body: _Body, lying: bool) -> Activity:
        if lying:
            return Activity.LYING_DOWN
        if body.knee_y is not None and abs(body.knee_y - body.hip_y) < (
            self._sitting_ratio * body.torso
        ):
            return Activity.SITTING
        return Activity.WALKING
