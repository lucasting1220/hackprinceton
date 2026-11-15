"""Layer 4 job fall_model: camera frames in, fall alerts out, on the laptop with the camera.

Layer 2's worker starts it from layer4/jobs/fall_model/job.json. It runs the fall detector and
the upper tier together: the rules keep no state (decision D4), so a job can apply them to its
own signals, and Layer 2 carries no messages between jobs. Only fall signals with a score go
on to the rules and the event log; a window with nothing in it is not an event.

When fall detection stops (no model, or no frames for the detection gap), a monitoring signal
goes through the same rules, which alert once it has been stopped long enough. It is reported
until that alert is sent, then not again until frames are read once more.

The resident's activity (walking, sitting, lying down, not in view) is written to the event log
whenever it changes and has held for ACTIVITY_STABLE, so the job that sends live status can
show it.
"""

import argparse
import hashlib
import logging
import threading
import time
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from layer2.job_client import FeedItem, Layer2, Layer2Error
from layer4 import settings
from layer4.fall import WHAT_STOPPED, Activity, FallDetector, FallModel, FallModelError
from layer4.jobs.stop_reporter import StopReporter
from layer4.layer2_ports import Layer2EventLog, Layer2Phone
from layer4.mediapipe_fall import open_mediapipe_fall_model
from layer4.ports import PortError
from layer4.upper_tier import UpperTier

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JpegFrame:
    """A decoded camera frame: height x width x 3 uint8 in BGR order, as Layer 3 sends it."""

    image: NDArray[np.uint8]
    captured_at: datetime


def decode_frame(item: FeedItem) -> JpegFrame | None:
    """The frame in a feed item, or None if its data is not a JPEG."""
    import cv2  # Only here: OpenCV comes with MediaPipe, which Intel Macs do not get.

    image = cv2.imdecode(np.frombuffer(item.data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None
    return JpegFrame(image=np.asarray(image, dtype=np.uint8), captured_at=item.captured_at)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_model(
    path: Path,
    url: str = settings.POSE_MODEL_URL,
    sha256: str = settings.POSE_MODEL_SHA256,
    timeout_s: float = settings.POSE_MODEL_DOWNLOAD_TIMEOUT_S,
) -> Path:
    """The pose model at `path`, downloaded first if it is missing or not the expected file.
    Raises FallModelError if it cannot be downloaded or does not match `sha256`."""
    if path.is_file() and _sha256(path) == sha256:
        return path
    logger.info("L4 fall_model: downloading the pose model to %s", path)
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as response:
            data: bytes = response.read()
    except OSError as err:
        raise FallModelError(f"could not download the pose model: {err}") from err
    if hashlib.sha256(data).hexdigest() != sha256:
        raise FallModelError("the downloaded pose model is not the expected file")
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    partial.replace(path)
    return path


def _now() -> datetime:
    return datetime.now(UTC)


class ActivityWriter(Protocol):
    def append_activity(self, state: Activity, since: datetime) -> None: ...


class ActivityReporter:
    """Writes the activity once it has changed and held for `stable`; a flicker is not written."""

    def __init__(self, log: ActivityWriter, stable: timedelta = settings.ACTIVITY_STABLE) -> None:
        self._log = log
        self._stable = stable
        self._seen: Activity | None = None
        self._seen_since: datetime | None = None
        self._written: Activity | None = None

    def update(self, state: Activity | None, at: datetime | None) -> None:
        if state is None or at is None:
            return
        if state != self._seen or self._seen_since is None:
            self._seen, self._seen_since = state, at
            return
        if state == self._written or at - self._seen_since < self._stable:
            return
        self._written = state
        try:
            self._log.append_activity(state, self._seen_since)
        except PortError as err:
            logger.warning("L4 fall_model: activity not logged: %s", err)


class FallJob:
    """One frame at a time from the feed, and a health check from a timer thread."""

    def __init__(
        self,
        detector: FallDetector,
        upper: UpperTier,
        reporter: StopReporter,
        started_at: datetime,
        detection_gap: timedelta = settings.FALL_DETECTION_GAP,
        activity: ActivityReporter | None = None,
    ) -> None:
        self._detector = detector
        self._activity = activity
        self._upper = upper
        self._reporter = reporter
        self._started_at = started_at
        self._detection_gap = detection_gap
        self._lock = threading.Lock()

    def on_frame(self, item: FeedItem) -> None:
        frame = decode_frame(item)
        if frame is None:
            logger.warning("L4 fall_model: skipped a camera frame that is not a JPEG")
            return
        signal = self._detector.process(frame)
        if self._activity is not None:
            self._activity.update(self._detector.activity, self._detector.activity_at)
        if signal is not None and signal.confidence > 0.0:
            with self._lock:
                self._upper.handle(signal)

    def check_health(self, now: datetime) -> None:
        signal = self._detector.health()
        last = self._detector.last_reading_at
        since: datetime | None = None
        if signal is not None:
            since = signal.stopped_at
        elif last is None and now - self._started_at >= self._detection_gap:
            since = self._started_at
        with self._lock:
            if since is None:
                self._reporter.running()
            else:
                self._reporter.stopped(since, now)


def open_pose_model(path: Path) -> FallModel:
    """Download the pose model if needed, then open it with MediaPipe."""
    return open_mediapipe_fall_model(ensure_model(path))


def open_model(
    model_path: Path,
    reporter: StopReporter,
    started_at: datetime,
    retry_s: float = settings.FALL_MODEL_RETRY_S,
    opener: Callable[[Path], FallModel] = open_pose_model,
    clock: Callable[[], datetime] = _now,
    sleep: Callable[[float], None] = time.sleep,
) -> FallModel:
    """Open the pose model, reporting fall detection as stopped and retrying until it opens."""
    while True:
        try:
            return opener(model_path)
        except FallModelError as err:
            logger.error("L4 fall_model: cannot run the pose model: %s", err)
            reporter.stopped(started_at, clock())
            sleep(retry_s)


def run_frames(job: FallJob, frames: Iterable[FeedItem]) -> None:
    for item in frames:
        job.on_frame(item)


def _check_health_forever(job: FallJob, every_s: float) -> None:
    while True:
        time.sleep(every_s)
        job.check_health(_now())


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Layer 4 fall_model job")
    parser.add_argument("--model", type=Path, required=True, help="where the pose model lives")
    args = parser.parse_args(argv)
    try:
        client = Layer2.from_env()
    except Layer2Error as err:
        logger.error("L4 fall_model: %s", err)
        return 2
    started_at = _now()
    event_log = Layer2EventLog(client)
    upper = UpperTier(settings.RuleThresholds(), event_log, Layer2Phone(client))
    reporter = StopReporter(upper, WHAT_STOPPED)
    model = open_model(args.model, reporter, started_at)
    job = FallJob(
        FallDetector(model), upper, reporter, started_at, activity=ActivityReporter(event_log)
    )
    threading.Thread(
        target=_check_health_forever, args=(job, settings.FALL_HEALTH_CHECK_S), daemon=True
    ).start()
    logger.info("L4 fall_model: running")
    while True:
        try:
            run_frames(job, client.feed("camera"))
        except Layer2Error as err:
            logger.error("L4 fall_model: no camera feed: %s", err)
            time.sleep(settings.FALL_MODEL_RETRY_S)


if __name__ == "__main__":
    raise SystemExit(main())
