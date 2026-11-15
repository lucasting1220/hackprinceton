"""Layer 4 fall detection: camera frames in, fall signals and the current activity out.

The fall model itself is pluggable (which model to use is an open question in the Layer 4
doc). Frames come from Layer 3; any object with `image` and a UTC `captured_at` will do.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol

from layer4 import settings
from layer4._checks import is_number
from layer4.signals import FallSignal, MonitoringSignal

logger = logging.getLogger(__name__)

WHAT_STOPPED = "fall detection"


class Activity(StrEnum):
    WALKING = "walking"
    SITTING = "sitting"
    LYING_DOWN = "lying_down"
    NOT_IN_VIEW = "not_in_view"


class CameraFrame(Protocol):
    """One frame from Layer 3: the picture and when it was captured, in UTC."""

    @property
    def image(self) -> object: ...

    @property
    def captured_at(self) -> datetime: ...


@dataclass(frozen=True)
class FallReading:
    """What the fall model sees in one frame."""

    confidence: float
    activity: Activity

    def __post_init__(self) -> None:
        if not is_number(self.confidence) or not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence must be a number from 0 to 1, got {self.confidence!r}")
        if not isinstance(self.activity, Activity):
            raise ValueError(f"activity must be an Activity, got {self.activity!r}")


class FallModelError(Exception):
    """The fall model could not read a frame."""


class FallModel(Protocol):
    def assess(self, frame: CameraFrame) -> FallReading: ...


def _now() -> datetime:
    return datetime.now(UTC)


class FallDetector:
    """Feeds frames to the fall model and emits one fall signal per window."""

    def __init__(
        self,
        model: FallModel,
        window: timedelta = settings.FALL_SIGNAL_WINDOW,
        max_frame_age: timedelta = settings.FALL_FRAME_MAX_AGE,
        detection_gap: timedelta = settings.FALL_DETECTION_GAP,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._model = model
        self._window = window
        self._max_frame_age = max_frame_age
        self._detection_gap = detection_gap
        self._clock = clock
        self._window_start: datetime | None = None
        self._window_peak: float = 0.0
        self.activity: Activity | None = None
        self.activity_at: datetime | None = None
        self.last_reading_at: datetime | None = None

    def process(self, frame: CameraFrame) -> FallSignal | None:
        """Read one frame. Returns a signal when a window closes, otherwise None."""
        now = self._clock()
        if now - frame.captured_at > self._max_frame_age:
            logger.debug("L4 fall: skipped a frame captured at %s", frame.captured_at.isoformat())
            return None
        try:
            reading = self._model.assess(frame)
        except (FallModelError, ValueError) as err:
            logger.warning("L4 fall: model gave no usable reading: %s", err)
            return None
        self.last_reading_at = now
        self.activity = reading.activity
        self.activity_at = frame.captured_at
        if self._window_start is None:
            self._window_start = frame.captured_at
            self._window_peak = reading.confidence
        else:
            self._window_peak = max(self._window_peak, reading.confidence)
        if frame.captured_at - self._window_start < self._window:
            return None
        signal = FallSignal(confidence=self._window_peak, detected_at=frame.captured_at)
        self._window_start = None
        return signal

    def health(self) -> MonitoringSignal | None:
        """A monitoring signal when no frame has been read for the detection gap."""
        if self.last_reading_at is None:
            return None
        now = self._clock()
        if now - self.last_reading_at < self._detection_gap:
            return None
        return MonitoringSignal(
            what_stopped=WHAT_STOPPED, stopped_at=self.last_reading_at, checked_at=now
        )
