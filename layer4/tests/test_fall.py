from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest

from layer4.fall import Activity, CameraFrame, FallDetector, FallModelError, FallReading
from layer4.signals import FallSignal

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


@dataclass(frozen=True)
class Frame:
    image: object
    captured_at: datetime


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


class ScriptedModel:
    """Returns each reading in turn; an exception in the script is raised instead."""

    def __init__(self, script: list[FallReading | Exception]) -> None:
        self._script: Iterator[FallReading | Exception] = iter(script)

    def assess(self, frame: CameraFrame) -> FallReading:
        step = next(self._script)
        if isinstance(step, Exception):
            raise step
        return step


def reading(confidence: float, activity: Activity = Activity.WALKING) -> FallReading:
    return FallReading(confidence=confidence, activity=activity)


def feed(detector: FallDetector, clock: Clock, offsets_ms: list[int]) -> list[FallSignal | None]:
    out: list[FallSignal | None] = []
    for ms in offsets_ms:
        clock.now = T0 + timedelta(milliseconds=ms)
        out.append(detector.process(Frame(image=None, captured_at=clock.now)))
    return out


def test_one_signal_per_window_carries_the_highest_confidence() -> None:
    clock = Clock()
    model = ScriptedModel([reading(0.1), reading(0.9), reading(0.2), reading(0.3)])
    detector = FallDetector(model, clock=clock)
    out = feed(detector, clock, [0, 300, 600, 1000])
    assert out[:3] == [None, None, None]
    signal = out[3]
    assert signal is not None
    assert signal.confidence == 0.9
    assert signal.detected_at == T0 + timedelta(seconds=1)


def test_the_next_window_starts_fresh() -> None:
    clock = Clock()
    model = ScriptedModel([reading(0.9), reading(0.9), reading(0.1), reading(0.2)])
    detector = FallDetector(model, clock=clock)
    out = feed(detector, clock, [0, 1000, 1100, 2100])
    assert [None if s is None else s.confidence for s in out] == [None, 0.9, None, 0.2]


def test_a_stale_frame_is_skipped() -> None:
    clock = Clock()
    detector = FallDetector(ScriptedModel([]), clock=clock)
    clock.now = T0 + timedelta(seconds=3)
    assert detector.process(Frame(image=None, captured_at=T0)) is None
    assert detector.last_reading_at is None


@pytest.mark.parametrize(
    "failure", [FallModelError("no person found"), ValueError("bad confidence")], ids=str
)
def test_a_model_failure_skips_the_frame(failure: Exception) -> None:
    clock = Clock()
    detector = FallDetector(ScriptedModel([failure]), clock=clock)
    assert feed(detector, clock, [0]) == [None]
    assert detector.last_reading_at is None


def test_the_current_activity_follows_the_latest_reading() -> None:
    clock = Clock()
    model = ScriptedModel([reading(0.1, Activity.SITTING), reading(0.2, Activity.LYING_DOWN)])
    detector = FallDetector(model, clock=clock)
    feed(detector, clock, [0, 200])
    assert detector.activity is Activity.LYING_DOWN
    assert detector.activity_at == T0 + timedelta(milliseconds=200)


def test_health_reports_fall_detection_stopped_after_the_gap() -> None:
    clock = Clock()
    detector = FallDetector(ScriptedModel([reading(0.1)]), clock=clock)
    assert detector.health() is None
    feed(detector, clock, [0])
    clock.now = T0 + timedelta(seconds=4)
    assert detector.health() is None
    clock.now = T0 + timedelta(seconds=40)
    stopped = detector.health()
    assert stopped is not None
    assert stopped.what_stopped == "fall detection"
    assert stopped.stopped_at == T0
    assert stopped.checked_at == clock.now


@pytest.mark.parametrize("confidence", [1.5, -0.1, float("nan")])
def test_a_reading_outside_zero_to_one_is_rejected(confidence: float) -> None:
    with pytest.raises(ValueError, match="confidence"):
        reading(confidence)


def test_a_reading_needs_an_activity() -> None:
    with pytest.raises(ValueError, match="activity"):
        FallReading(confidence=0.5, activity=cast(Activity, "dancing"))
