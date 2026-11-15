import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from layer4.fall import Activity, FallReading
from layer4.pose_fall import Point, Pose, PoseFallScorer

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
STEP_MS = 50
STAND_HIP = 0.55
TORSO = 0.25

Frames = list[tuple[int, Pose | None]]


def pose(
    hip_y: float = STAND_HIP,
    angle_deg: float = 0.0,
    torso: float = TORSO,
    knee_below_hip: float = 0.2,
    visibility: float = 1.0,
    knee_visibility: float = 1.0,
) -> Pose:
    """A side-on body: torso tilted angle_deg from straight up, knees below the hips."""
    dx = torso * math.sin(math.radians(angle_deg))
    dy = -torso * math.cos(math.radians(angle_deg))

    def pair(x: float, y: float, vis: float) -> tuple[Point, Point]:
        return Point(x - 0.02, y, vis), Point(x + 0.02, y, vis)

    shoulders = pair(0.6 + dx, hip_y + dy, visibility)
    hips = pair(0.6, hip_y, visibility)
    knees = pair(0.6, hip_y + knee_below_hip, knee_visibility)
    return Pose(*shoulders, *hips, *knees)


STANDING = pose()
FLOOR = pose(hip_y=0.95, angle_deg=90.0)


def at(ms: int) -> datetime:
    return T0 + timedelta(milliseconds=ms)


def hold(p: Pose | None, start_ms: int, end_ms: int) -> Frames:
    return [(ms, p) for ms in range(start_ms, end_ms, STEP_MS)]


def run(scorer: PoseFallScorer, frames: Frames) -> list[FallReading]:
    return [scorer.score(p, at(ms)) for ms, p in frames]


def last_activity(frames: Frames) -> Activity:
    return run(PoseFallScorer(), frames)[-1].activity


@pytest.mark.parametrize(
    ("body", "activity"),
    [
        (STANDING, Activity.WALKING),
        (pose(hip_y=0.75, knee_below_hip=0.02), Activity.SITTING),
        (pose(angle_deg=45.0), Activity.WALKING),
        (FLOOR, Activity.LYING_DOWN),
        (pose(knee_below_hip=0.0, knee_visibility=0.1), Activity.WALKING),
    ],
    ids=["standing", "sitting", "bending", "lying", "knees-hidden"],
)
def test_activity_from_one_pose(body: Pose, activity: Activity) -> None:
    assert PoseFallScorer().score(body, T0) == FallReading(confidence=0.0, activity=activity)


@pytest.mark.parametrize(
    "unseen", [None, pose(visibility=0.1), pose(torso=0.001)], ids=["none", "hidden", "flat"]
)
def test_no_usable_torso_is_not_in_view(unseen: Pose | None) -> None:
    reading = PoseFallScorer().score(unseen, T0)
    assert reading == FallReading(confidence=0.0, activity=Activity.NOT_IN_VIEW)


def test_lying_toward_the_camera_reads_as_lying_through_foreshortening() -> None:
    toward = pose(hip_y=0.95, angle_deg=5.0, torso=0.1)
    assert last_activity(hold(STANDING, 0, 500) + hold(toward, 500, 1000)) == Activity.LYING_DOWN


def test_walking_away_slowly_never_reads_as_lying() -> None:
    frames: Frames = [(i * STEP_MS, pose(torso=TORSO * (1 - i / 40))) for i in range(30)]
    assert all(r.activity == Activity.WALKING for r in run(PoseFallScorer(), frames))


def test_coming_back_into_view_further_away_is_not_lying() -> None:
    frames = (
        hold(pose(torso=0.3), 0, 500) + hold(None, 500, 1000) + hold(pose(torso=0.1), 1000, 1500)
    )
    assert last_activity(frames) == Activity.WALKING


def test_a_late_frame_reports_activity_but_changes_nothing() -> None:
    scorer = PoseFallScorer()
    run(scorer, hold(pose(torso=0.3), 0, 500))
    assert scorer.score(pose(torso=0.5), at(0)).activity == Activity.WALKING
    assert scorer.score(pose(torso=0.2), at(500)).activity == Activity.WALKING


@pytest.mark.parametrize(
    "bad",
    [
        {"x": math.nan, "y": 0.0, "visibility": 1.0},
        {"x": 0.0, "y": math.inf, "visibility": 1.0},
        {"x": 0.0, "y": 0.0, "visibility": 1.5},
        {"x": 0.0, "y": 0.0, "visibility": True},
    ],
)
def test_point_rejects_bad_values(bad: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        Point(**bad)


@pytest.mark.parametrize(
    "make",
    [
        lambda: PoseFallScorer(min_visibility=1.5),
        lambda: PoseFallScorer(min_torso=0.0),
        lambda: PoseFallScorer(upright_angle_deg=60.0, lying_angle_deg=60.0),
        lambda: PoseFallScorer(lying_angle_deg=95.0),
        lambda: PoseFallScorer(foreshortened_ratio=True),
        lambda: PoseFallScorer(sitting_hip_knee_ratio=math.nan),
    ],
)
def test_scorer_rejects_bad_settings(make: Callable[[], PoseFallScorer]) -> None:
    with pytest.raises(ValueError):
        make()
