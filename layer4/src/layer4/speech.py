"""Layer 4 speech-to-text: mic audio in, one transcript per utterance out.

Mic chunks (contracts/frame-feed.json, /mic: 16 kHz mono 16-bit little-endian PCM) go to the
utterance collector, which asks a voice detector whether each chunk holds speech. An utterance
starts at the first speech chunk (with the chunk before it, so a first word is not clipped)
and ends after the silence end, at the longest utterance, or at a gap in the audio. faster-
whisper then transcribes it on the CPU. faster-whisper has no build for Intel Macs, so it is
imported only when the model is opened, and there opening raises SpeechModelError.

Transcripts are never logged or stored: only their verdict from the help check is.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from layer4 import settings

Audio = NDArray[np.float32]


class SpeechModelError(Exception):
    """The speech-to-text model could not be opened or could not transcribe."""


def pcm_to_audio(data: bytes) -> Audio:
    """16-bit little-endian PCM as floats from -1 to 1. Raises ValueError on an odd byte count."""
    if len(data) % 2:
        raise ValueError(f"16-bit audio needs an even number of bytes, got {len(data)}")
    samples = np.frombuffer(data, dtype="<i2").astype(np.float32)
    return samples / np.float32(32768.0)


@dataclass(frozen=True)
class Utterance:
    audio: Audio
    started_at: datetime


class UtteranceCollector:
    """Joins mic chunks into utterances, one chunk at a time."""

    def __init__(
        self,
        is_speech: Callable[[Audio], bool],
        sample_rate: int = settings.MIC_SAMPLE_RATE,
        silence_end: timedelta = settings.STT_SILENCE_END,
        longest: timedelta = settings.STT_LONGEST_UTTERANCE,
    ) -> None:
        self._is_speech = is_speech
        self._sample_rate = sample_rate
        self._silence_end = silence_end
        self._longest = longest
        self._before: tuple[Audio, datetime] | None = None
        self._chunks: list[Audio] = []
        self._started_at: datetime | None = None
        self._next_at: datetime | None = None
        self._silence = timedelta(0)

    def add(self, chunk: Audio, captured_at: datetime) -> Utterance | None:
        """Take one chunk. Returns an utterance when one has just ended, otherwise None."""
        length = timedelta(seconds=len(chunk) / self._sample_rate)
        finished: Utterance | None = None
        if self._next_at is not None and abs(captured_at - self._next_at) > length:
            finished = self._finish()
        speech = self._is_speech(chunk)
        if self._started_at is None:
            if speech:
                self._start(chunk, captured_at)
            else:
                self._before = (chunk, captured_at)
            self._next_at = captured_at + length
            return finished
        self._chunks.append(chunk)
        self._next_at = captured_at + length
        self._silence = timedelta(0) if speech else self._silence + length
        heard = timedelta(seconds=sum(len(part) for part in self._chunks) / self._sample_rate)
        if self._silence >= self._silence_end or heard >= self._longest:
            return self._finish()
        return finished

    def _start(self, chunk: Audio, captured_at: datetime) -> None:
        self._chunks = []
        self._started_at = captured_at
        if self._before is not None:
            before, before_at = self._before
            self._chunks.append(before)
            self._started_at = before_at
        self._chunks.append(chunk)
        self._silence = timedelta(0)
        self._before = None

    def _finish(self) -> Utterance | None:
        started_at = self._started_at
        self._started_at = None
        self._before = None
        if started_at is None or not self._chunks:
            return None
        audio = np.concatenate(self._chunks)
        self._chunks = []
        return Utterance(audio=audio, started_at=started_at)


class SileroSpeechDetector:
    """faster-whisper's built-in voice detector, asked about one chunk at a time."""

    def __init__(self, threshold: float = settings.STT_VAD_THRESHOLD) -> None:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        self._find = get_speech_timestamps
        self._options = VadOptions(threshold=threshold, min_silence_duration_ms=100)

    def __call__(self, chunk: Audio) -> bool:
        return bool(self._find(chunk, self._options))


class Transcriber(Protocol):
    def transcribe(self, audio: Audio) -> str: ...


class _Segment(Protocol):
    @property
    def text(self) -> str: ...


class Whisper(Protocol):
    """The part of faster_whisper.WhisperModel that Layer 4 uses."""

    def transcribe(
        self,
        audio: Audio,
        *,
        language: str | None,
        beam_size: int,
        vad_filter: bool,
        condition_on_previous_text: bool,
    ) -> tuple[Iterable[_Segment], object]: ...


class WhisperTranscriber:
    def __init__(self, model: Whisper, beam_size: int = settings.STT_BEAM_SIZE) -> None:
        self._model = model
        self._beam_size = beam_size

    def transcribe(self, audio: Audio) -> str:
        try:
            segments, _ = self._model.transcribe(
                audio,
                language="en",
                beam_size=self._beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()
        except (RuntimeError, ValueError) as err:
            raise SpeechModelError(f"could not transcribe: {err}") from err


def open_whisper(
    download_root: Path,
    name: str = settings.STT_MODEL,
    compute_type: str = settings.STT_COMPUTE_TYPE,
) -> WhisperTranscriber:
    """Open the Whisper model, downloading it into download_root the first time."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as err:
        raise SpeechModelError("faster-whisper is not available on this laptop") from err
    try:
        model = WhisperModel(
            name, device="cpu", compute_type=compute_type, download_root=str(download_root)
        )
    except (OSError, RuntimeError, ValueError) as err:
        raise SpeechModelError(f"could not open the speech model {name}: {err}") from err
    return WhisperTranscriber(model)
