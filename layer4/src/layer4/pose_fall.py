"""Layer 4 fall scoring from body pose: a pose per frame in, a FallReading out.

A pose model (MediaPipe, in a separate adapter) finds the body points; this module holds every
fall rule and imports no pose library, so the rules are tested on hand-made poses. The rules
and their settings are described in settings.py and docs/layer4-care-layer.md.

One fall gives one high confidence: after scoring a fall the scorer reports 0 until the
resident is upright again. The upper tier's rules keep no state (decision D4), so without
this a resident lying on the floor would raise an alert every second.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

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


@dataclass(frozen=True)
class _Upright:
    at: datetime
    hip_y: float
    torso: float


def _check_number(name: str, value: float, low: float, high: float, *, low_open: bool) -> None:
    if not _is_real(value) or value < low or value > high or (low_open and value == low):
        bracket = "(" if low_open else "["
        raise ValueError(f"{name} must be a number in {bracket}{low}, {high}], got {value!r}")


def _check_duration(name: str, value: timedelta) -> None:
    if not isinstance(value, timedelta) or value <= timedelta(0):
        raise ValueError(f"{name} must be a positive timedelta, got {value!r}")


class PoseFallScorer:
    """Scores each frame's pose. Raises ValueError at construction if a setting makes no sense."""

    def __init__(
        self,
        *,
        min_visibility: float = settings.POSE_MIN_VISIBILITY,
        min_torso: float = settings.POSE_MIN_TORSO,
        upright_angle_deg: float = settings.POSE_UPRIGHT_ANGLE_DEG,
        lying_angle_deg: float = settings.POSE_LYING_ANGLE_DEG,
        foreshortened_ratio: float = settings.POSE_FORESHORTENED_RATIO,
        sitting_hip_knee_ratio: float = settings.POSE_SITTING_HIP_KNEE_RATIO,
        settle: timedelta = settings.FALL_SETTLE,
        hip_drop_full: float = settings.FALL_HIP_DROP_FULL,
        descent_fast: timedelta = settings.FALL_DESCENT_FAST,
        descent_slow: timedelta = settings.FALL_DESCENT_SLOW,
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
        _check_number("hip_drop_full", hip_drop_full, 0.0, 10.0, low_open=True)
        for name, duration in (
            ("settle", settle),
            ("descent_fast", descent_fast),
            ("descent_slow", descent_slow),
        ):
            _check_duration(name, duration)
        if descent_fast >= descent_slow:
            raise ValueError(
                f"descent_fast ({descent_fast}) must be shorter than descent_slow ({descent_slow})"
            )
        self._min_visibility = min_visibility
        self._min_torso = min_torso
        self._upright_angle = upright_angle_deg
        self._lying_angle = lying_angle_deg
        self._foreshortened_ratio = foreshortened_ratio
        self._sitting_ratio = sitting_hip_knee_ratio
        self._settle = settle
        self._hip_drop_full = hip_drop_full
        self._descent_fast = descent_fast
        self._descent_slow = descent_slow
        self._last_upright: _Upright | None = None
        self._upright_torso: float | None = None
        self._lying_since: datetime | None = None
        self._latched = False
        self._last_at: datetime | None = None

    def score(self, pose: Pose | None, at: datetime) -> FallReading:
        """Score the pose seen at `at`; None means no person was found in the frame."""
        body = self._measure(pose)
        in_order = self._last_at is None or at >= self._last_at
        if in_order:
            self._last_at = at
        if body is None:
            if in_order:
                # Whoever comes back into view may stand at another distance from the camera.
                self._upright_torso = None
                self._lying_since = None
            return FallReading(confidence=0.0, activity=Activity.NOT_IN_VIEW)
        lying = self._is_lying(body)
        upright = not lying and body.angle_deg <= self._upright_angle
        activity = self._activity(body, lying)
        if not in_order:
            return FallReading(confidence=0.0, activity=activity)
        if upright:
            self._last_upright = _Upright(at=at, hip_y=body.hip_y, torso=body.torso)
            self._upright_torso = body.torso
            self._latched = False
            self._lying_since = None
            return FallReading(confidence=0.0, activity=activity)
        if not lying:
            self._lying_since = None
            return FallReading(confidence=0.0, activity=activity)
        if self._lying_since is None:
            self._lying_since = at
        if self._latched or at - self._lying_since < self._settle:
            return FallReading(confidence=0.0, activity=activity)
        self._latched = True
        return FallReading(confidence=self._fall_confidence(body), activity=activity)

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

    def _fall_confidence(self, body: _Body) -> float:
        last = self._last_upright
        lying_since = self._lying_since
        if last is None or lying_since is None:
            return 0.0
        drop = (body.hip_y - last.hip_y) / last.torso
        drop_score = max(0.0, min(1.0, drop / self._hip_drop_full))
        descent = lying_since - last.at
        span = self._descent_slow - self._descent_fast
        speed_score = max(0.0, min(1.0, (self._descent_slow - descent) / span))
        return min(drop_score, speed_score)
