"""Layer 4 job speech_to_text: mic audio in, calls for help out, on the laptop with the mic.

Layer 2's worker starts it from layer4/jobs/speech_to_text/job.json. The reading thread joins
mic chunks into utterances and queues them; a second thread transcribes each one and hands
the transcript to the help check, then the help check's verdict to the rules, which alert and
log in this process (the rules keep no state, and Layer 2 carries no messages between jobs).
Reading never waits on the model, so the feed is not left behind while a transcript is made.

Two things are reported as stopped through the monitoring rule: speech-to-text (no mic audio
for the detection gap, or no model), and the help check (no verdict from the quick model).
Transcripts are never logged or stored.
"""

import argparse
import logging
import queue
import threading
import time
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from layer2.job_client import FeedItem, Layer2, Layer2Error
from layer4 import settings
from layer4.help_check import WHAT_STOPPED as HELP_STOPPED
from layer4.help_check import HelpCheck, HelpCheckFailed
from layer4.jobs.stop_reporter import StopReporter
from layer4.layer2_ports import Layer2EventLog, Layer2Model, Layer2Phone
from layer4.speech import (
    SileroSpeechDetector,
    SpeechModelError,
    Transcriber,
    Utterance,
    UtteranceCollector,
    open_whisper,
    pcm_to_audio,
)
from layer4.upper_tier import UpperTier

logger = logging.getLogger(__name__)

WHAT_STOPPED = "speech-to-text"


def _now() -> datetime:
    return datetime.now(UTC)


class SpeechJob:
    """Mic chunks in on one thread, utterances transcribed on another, a health check on a third."""

    def __init__(
        self,
        collector: UtteranceCollector,
        transcriber: Transcriber,
        help_check: HelpCheck,
        upper: UpperTier,
        speech_reporter: StopReporter,
        help_reporter: StopReporter,
        started_at: datetime,
        queue_size: int = settings.STT_QUEUE_SIZE,
        detection_gap: timedelta = settings.STT_DETECTION_GAP,
    ) -> None:
        self._collector = collector
        self._transcriber = transcriber
        self._help_check = help_check
        self._upper = upper
        self._speech_reporter = speech_reporter
        self._help_reporter = help_reporter
        self._started_at = started_at
        self._detection_gap = detection_gap
        self.waiting: queue.Queue[Utterance] = queue.Queue(maxsize=queue_size)
        self.last_chunk_at: datetime | None = None
        self._lock = threading.Lock()

    def on_chunk(self, item: FeedItem, received_at: datetime) -> None:
        try:
            audio = pcm_to_audio(item.data)
        except ValueError as err:
            logger.warning("L4 speech_to_text: skipped a mic chunk: %s", err)
            return
        self.last_chunk_at = received_at
        utterance = self._collector.add(audio, item.captured_at)
        if utterance is None:
            return
        while True:
            try:
                self.waiting.put_nowait(utterance)
                return
            except queue.Full:
                self.waiting.get_nowait()
                logger.warning("L4 speech_to_text: behind, dropped the oldest utterance")

    def transcribe_next(self, timeout_s: float | None = None) -> None:
        """Transcribe one queued utterance and pass the result on. Waits up to timeout_s."""
        try:
            utterance = self.waiting.get(timeout=timeout_s)
        except queue.Empty:
            return
        try:
            transcript = self._transcriber.transcribe(utterance.audio)
        except SpeechModelError as err:
            logger.error("L4 speech_to_text: %s", err)
            return
        logger.info("L4 speech_to_text: transcribed an utterance of %d characters", len(transcript))
        try:
            signal = self._help_check.check(transcript, utterance.started_at)
        except HelpCheckFailed as err:
            logger.error("L4 speech_to_text: help check failed: %s", err)
            return
        if signal is not None:
            with self._lock:
                self._upper.handle(signal)

    def check_health(self, now: datetime) -> None:
        last = self.last_chunk_at
        since = last if last is not None else self._started_at
        help_signal = self._help_check.health()
        with self._lock:
            if now - since >= self._detection_gap:
                self._speech_reporter.stopped(since, now)
            else:
                self._speech_reporter.running()
            if help_signal is not None:
                self._help_reporter.stopped(help_signal.stopped_at, now)
            else:
                self._help_reporter.running()


def open_model(
    models_dir: Path,
    reporter: StopReporter,
    started_at: datetime,
    retry_s: float = settings.STT_MODEL_RETRY_S,
    opener: Callable[[Path], Transcriber] = open_whisper,
    clock: Callable[[], datetime] = _now,
    sleep: Callable[[float], None] = time.sleep,
) -> Transcriber:
    """Open the speech model, reporting speech-to-text as stopped and retrying until it opens."""
    while True:
        try:
            return opener(models_dir)
        except SpeechModelError as err:
            logger.error("L4 speech_to_text: cannot run the speech model: %s", err)
            reporter.stopped(started_at, clock())
            sleep(retry_s)


def run_chunks(job: SpeechJob, chunks: Iterable[FeedItem]) -> None:
    for item in chunks:
        job.on_chunk(item, _now())


def _transcribe_forever(job: SpeechJob) -> None:
    while True:
        job.transcribe_next()


def _check_health_forever(job: SpeechJob, every_s: float) -> None:
    while True:
        time.sleep(every_s)
        job.check_health(_now())


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Layer 4 speech_to_text job")
    parser.add_argument("--models", type=Path, required=True, help="where the speech model lives")
    args = parser.parse_args(argv)
    try:
        client = Layer2.from_env()
    except Layer2Error as err:
        logger.error("L4 speech_to_text: %s", err)
        return 2
    started_at = _now()
    upper = UpperTier(settings.RuleThresholds(), Layer2EventLog(client), Layer2Phone(client))
    speech_reporter = StopReporter(upper, WHAT_STOPPED)
    transcriber = open_model(args.models, speech_reporter, started_at)
    job = SpeechJob(
        UtteranceCollector(SileroSpeechDetector()),
        transcriber,
        HelpCheck(Layer2Model(client)),
        upper,
        speech_reporter,
        StopReporter(upper, HELP_STOPPED),
        started_at,
    )
    threading.Thread(target=_transcribe_forever, args=(job,), daemon=True).start()
    threading.Thread(
        target=_check_health_forever, args=(job, settings.STT_HEALTH_CHECK_S), daemon=True
    ).start()
    logger.info("L4 speech_to_text: running")
    while True:
        try:
            run_chunks(job, client.feed("mic"))
        except Layer2Error as err:
            logger.error("L4 speech_to_text: no mic feed: %s", err)
            time.sleep(settings.STT_MODEL_RETRY_S)


if __name__ == "__main__":
    raise SystemExit(main())
