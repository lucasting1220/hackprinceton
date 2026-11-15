import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest

from layer4.fall import Activity, CameraFrame, FallDetector, FallReading
from layer4.pose_fall import Point, Pose, PoseFallScorer
from layer4.rules import decide
from layer4.settings import RuleThresholds

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
BENDING = pose(hip_y=0.7, angle_deg=45.0)


def at(ms: int) -> datetime:
    return T0 + timedelta(milliseconds=ms)


def hold(p: Pose | None, start_ms: int, end_ms: int) -> Frames:
    return [(ms, p) for ms in range(start_ms, end_ms, STEP_MS)]


def run(scorer: PoseFallScorer, frames: Frames) -> list[FallReading]:
    return [scorer.score(p, at(ms)) for ms, p in frames]


def fall(
    descent_ms: int, stand: Pose = STANDING, end: Pose = FLOOR, settle_ms: int = 1500
) -> Frames:
    """Stand until 950 ms, bend (neither upright nor lying), lie from 950 + descent_ms."""
    lie_from = 950 + descent_ms
    return (
        hold(stand, 0, 1000)
        + hold(BENDING, 1000, lie_from)
        + hold(end, lie_from, lie_from + settle_ms)
    )


def peaks(frames: Frames) -> list[float]:
    return [r.confidence for r in run(PoseFallScorer(), frames) if r.confidence > 0.0]


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


def test_fast_fall_gives_one_high_reading_then_zero_while_lying() -> None:
    readings = run(PoseFallScorer(), fall(400))
    high = [r.confidence for r in readings if r.confidence > 0.0]
    assert len(high) == 1
    assert high[0] >= 0.8
    assert readings[0].activity == Activity.WALKING
    assert readings[-1].activity == Activity.LYING_DOWN


def test_fall_toward_the_camera_counts_through_foreshortening() -> None:
    toward = pose(hip_y=0.95, angle_deg=5.0, torso=0.1)
    assert peaks(fall(400, end=toward))[0] >= 0.8


@pytest.mark.parametrize(("descent_ms", "alerts"), [(1500, True), (2400, False), (3500, False)])
def test_descent_speed_window(descent_ms: int, alerts: bool) -> None:
    assert (max(peaks(fall(descent_ms)), default=0.0) >= 0.8) is alerts


def test_fast_sit_on_a_chair_is_not_a_fall() -> None:
    chair = pose(hip_y=0.75, knee_below_hip=0.02)
    readings = run(PoseFallScorer(), hold(STANDING, 0, 1000) + hold(chair, 1000, 3000))
    assert all(r.confidence == 0.0 for r in readings)
    assert readings[-1].activity == Activity.SITTING


@pytest.mark.parametrize("bow", [BENDING, pose(hip_y=0.57, angle_deg=75.0)], ids=["45", "75"])
def test_bowing_is_not_a_fall(bow: Pose) -> None:
    assert max(peaks(hold(STANDING, 0, 1000) + hold(bow, 1000, 3000)), default=0.0) < 0.2


def test_lying_for_less_than_the_settle_time_is_not_a_fall() -> None:
    stumble = hold(STANDING, 0, 1000) + hold(FLOOR, 1000, 1400) + hold(STANDING, 1400, 3000)
    assert peaks(stumble) == []


def test_lying_must_last_the_settle_time_without_a_break() -> None:
    broken = (
        hold(STANDING, 0, 1000)
        + hold(FLOOR, 1000, 1300)
        + hold(BENDING, 1300, 1600)
        + hold(FLOOR, 1600, 1900)
        + hold(STANDING, 1900, 2500)
    )
    assert peaks(broken) == []


def test_already_lying_when_first_seen_is_not_a_fall() -> None:
    readings = run(PoseFallScorer(), hold(FLOOR, 0, 3000))
    assert all(r.confidence == 0.0 for r in readings)
    assert readings[-1].activity == Activity.LYING_DOWN


def test_fall_get_up_and_fall_again_gives_two_readings() -> None:
    again = [(ms + 3000, p) for ms, p in fall(400)]
    assert len(peaks(fall(400) + again)) == 2


def test_hip_drop_is_measured_in_torso_lengths() -> None:
    def half_drop(torso: float) -> float:
        stand = pose(hip_y=0.3, torso=torso, knee_below_hip=torso)
        end = pose(hip_y=0.3 + 0.5 * torso, angle_deg=90.0, torso=torso)
        return peaks(fall(400, stand=stand, end=end))[0]

    assert half_drop(0.25) == pytest.approx(0.5)
    assert half_drop(0.08) == pytest.approx(0.5)


def test_a_late_frame_reports_activity_but_does_not_start_the_settle_clock() -> None:
    scorer = PoseFallScorer()
    frames = fall(400)
    first_lying = frames.index((1350, FLOOR))
    run(scorer, frames[:first_lying])
    assert scorer.score(FLOOR, at(0)) == FallReading(0.0, Activity.LYING_DOWN)
    rest = frames[first_lying:]
    fired = [ms for (ms, _), r in zip(rest, run(scorer, rest), strict=True) if r.confidence > 0.0]
    assert fired == [1350 + 500]


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
        lambda: PoseFallScorer(hip_drop_full=-1.0),
        lambda: PoseFallScorer(settle=timedelta(0)),
        lambda: PoseFallScorer(descent_fast=timedelta(seconds=3)),
    ],
)
def test_scorer_rejects_bad_settings(make: Callable[[], PoseFallScorer]) -> None:
    with pytest.raises(ValueError):
        make()


@dataclass(frozen=True)
class PoseFrame:
    image: Pose
    captured_at: datetime


class ScorerModel:
    def __init__(self) -> None:
        self._scorer = PoseFallScorer()

    def assess(self, frame: CameraFrame) -> FallReading:
        assert isinstance(frame.image, Pose)
        return self._scorer.score(frame.image, frame.captured_at)


def test_a_fall_through_the_detector_and_rule_gives_exactly_one_alert() -> None:
    now = T0
    detector = FallDetector(ScorerModel(), clock=lambda: now)
    alert_count = 0
    for ms, p in fall(400, settle_ms=5000):
        assert p is not None
        now = at(ms)
        signal = detector.process(PoseFrame(image=p, captured_at=now))
        if signal is not None and decide(signal, RuleThresholds()) is not None:
            alert_count += 1
    assert alert_count == 1
