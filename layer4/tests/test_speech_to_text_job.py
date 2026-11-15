import importlib.util
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from fakes import FakeEventLog, FakeModel, FakePhone

from layer2.contracts import JobDescription
from layer2.job_client import FeedItem
from layer4.help_check import WHAT_STOPPED as HELP_STOPPED
from layer4.help_check import HelpCheck
from layer4.jobs.speech_to_text import WHAT_STOPPED, SpeechJob, main, open_model, run_chunks
from layer4.jobs.stop_reporter import StopReporter
from layer4.settings import RuleThresholds
from layer4.speech import Audio, SpeechModelError, Transcriber, UtteranceCollector
from layer4.upper_tier import UpperTier

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
JOB_FOLDER = Path(__file__).resolve().parents[1] / "jobs" / "speech_to_text"
TRANSCRIPT = "Help me, I fell and I can't get up"


def pcm(level: int) -> bytes:
    return np.full(8000, level, dtype="<i2").tobytes()


def item(index: int, level: int) -> FeedItem:
    return FeedItem(data=pcm(level), captured_at=T0 + timedelta(milliseconds=500 * index))


def is_loud(audio: Audio) -> bool:
    return bool(audio.max() > 0.0)


class FakeTranscriber:
    def __init__(self, text: str | Exception) -> None:
        self.text = text
        self.heard: list[int] = []

    def transcribe(self, audio: Audio) -> str:
        self.heard.append(len(audio))
        if isinstance(self.text, Exception):
            raise self.text
        return self.text


def build(
    text: str | Exception = TRANSCRIPT, answer: str | None = "YES", queue_size: int = 4
) -> tuple[SpeechJob, FakeEventLog, FakePhone, FakeTranscriber]:
    log, phone = FakeEventLog(), FakePhone()
    upper = UpperTier(RuleThresholds(), log, phone)
    transcriber = FakeTranscriber(text)
    job = SpeechJob(
        UtteranceCollector(is_loud),
        transcriber,
        HelpCheck(FakeModel(answer), clock=lambda: T0),
        upper,
        StopReporter(upper, WHAT_STOPPED),
        StopReporter(upper, HELP_STOPPED),
        started_at=T0,
        queue_size=queue_size,
    )
    return job, log, phone, transcriber


def speak(job: SpeechJob, start: int = 0) -> None:
    """One utterance: a second of speech, then a second of silence."""
    for index, level in enumerate([0, 9000, 9000, 0, 0], start=start):
        job.on_chunk(item(index, level), T0)


def test_a_call_for_help_sends_a_help_alert_and_logs_one_event() -> None:
    job, log, phone, transcriber = build()
    speak(job)
    job.transcribe_next(timeout_s=0)
    assert transcriber.heard == [5 * 8000]
    assert [alert.kind for alert in phone.alerts] == ["help"]
    assert len(log.events) == 1


def test_ordinary_speech_is_logged_without_an_alert() -> None:
    job, log, phone, _ = build(answer="NO")
    speak(job)
    job.transcribe_next(timeout_s=0)
    assert phone.alerts == []
    assert len(log.events) == 1


def test_an_empty_transcript_goes_no_further() -> None:
    job, log, phone, _ = build(text="")
    speak(job)
    job.transcribe_next(timeout_s=0)
    assert (log.events, phone.alerts) == ([], [])


def test_a_failed_transcription_or_help_check_sends_nothing() -> None:
    for job, log, phone, _ in (build(text=SpeechModelError("broken")), build(answer=None)):
        speak(job)
        job.transcribe_next(timeout_s=0)
        assert (log.events, phone.alerts) == ([], [])


def test_with_nothing_queued_transcribe_next_returns() -> None:
    job, _, _, transcriber = build()
    job.transcribe_next(timeout_s=0)
    assert transcriber.heard == []


def test_when_behind_the_oldest_utterance_is_dropped() -> None:
    job, _, _, _ = build(queue_size=1)
    speak(job, start=0)
    speak(job, start=5)
    queued = job.waiting.get_nowait()
    assert queued.started_at == T0 + timedelta(milliseconds=500 * 5)
    assert job.waiting.empty()


def test_a_chunk_with_an_odd_byte_count_is_skipped() -> None:
    job, _, _, _ = build()
    job.on_chunk(FeedItem(data=b"\x00\x01\x02", captured_at=T0), T0)
    assert job.last_chunk_at is None


def test_transcripts_are_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    job, _, _, _ = build()
    with caplog.at_level(logging.DEBUG):
        speak(job)
        job.transcribe_next(timeout_s=0)
    assert "fell" not in caplog.text.lower()
    assert "help me" not in caplog.text.lower()


def test_no_mic_audio_is_reported_until_it_alerts_then_rearms() -> None:
    job, log, phone, _ = build()
    job.check_health(T0 + timedelta(seconds=10))
    assert phone.alerts == []
    job.check_health(T0 + timedelta(seconds=40))
    job.check_health(T0 + timedelta(seconds=50))
    assert [alert.kind for alert in phone.alerts] == ["monitoring"]
    job.on_chunk(item(0, 0), T0 + timedelta(seconds=51))
    job.check_health(T0 + timedelta(seconds=52))
    job.check_health(T0 + timedelta(seconds=90))
    assert [alert.kind for alert in phone.alerts] == ["monitoring", "monitoring"]
    assert all("speech-to-text" in alert.body for alert in phone.alerts)


def test_a_help_check_that_keeps_failing_is_reported() -> None:
    log, phone = FakeEventLog(), FakePhone()
    upper = UpperTier(RuleThresholds(), log, phone)
    clock = [T0]
    help_check = HelpCheck(FakeModel(None), clock=lambda: clock[0])
    job = SpeechJob(
        UtteranceCollector(is_loud),
        FakeTranscriber(TRANSCRIPT),
        help_check,
        upper,
        StopReporter(upper, WHAT_STOPPED),
        StopReporter(upper, HELP_STOPPED),
        started_at=T0,
    )
    speak(job)
    job.transcribe_next(timeout_s=0)
    clock[0] = T0 + timedelta(seconds=40)
    job.on_chunk(item(80, 0), clock[0])
    job.check_health(clock[0])
    assert [alert.body for alert in phone.alerts] == ["Monitoring is degraded: help check"]


def test_a_speech_model_that_cannot_open_is_reported_and_retried() -> None:
    log, phone = FakeEventLog(), FakePhone()
    reporter = StopReporter(UpperTier(RuleThresholds(), log, phone), WHAT_STOPPED)
    attempts: list[Path] = []
    model = FakeTranscriber(TRANSCRIPT)

    def opener(path: Path) -> Transcriber:
        attempts.append(path)
        if len(attempts) < 3:
            raise SpeechModelError("no network to download the model")
        return model

    waits: list[float] = []
    times = iter([T0 + timedelta(seconds=10), T0 + timedelta(seconds=40)])
    opened = open_model(
        Path("models"),
        reporter,
        T0,
        retry_s=30.0,
        opener=opener,
        clock=lambda: next(times),
        sleep=waits.append,
    )
    assert opened is model
    assert waits == [30.0, 30.0]
    assert [alert.kind for alert in phone.alerts] == ["monitoring"]


def test_run_chunks_hands_every_chunk_to_the_job() -> None:
    job, _, _, _ = build()
    run_chunks(job, [item(0, 0), item(1, 0)])
    assert job.last_chunk_at is not None


def test_outside_a_layer_2_job_main_exits_with_2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    assert main(["--models", "models"]) == 2


def test_the_job_description_is_one_layer_2_accepts_and_starts_this_job() -> None:
    raw = json.loads((JOB_FOLDER / "job.json").read_text(encoding="utf-8"))
    job = JobDescription.model_validate(raw)
    assert job.name == JOB_FOLDER.name
    assert job.sensor == "mic"
    command = job.start_command
    assert importlib.util.find_spec(command[command.index("-m") + 1]) is not None
    assert (JOB_FOLDER / command[command.index("--project") + 1] / "pyproject.toml").is_file()
    assert "--models" in command
