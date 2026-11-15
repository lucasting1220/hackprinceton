import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from layer4.speech import (
    Audio,
    SileroSpeechDetector,
    SpeechModelError,
    UtteranceCollector,
    WhisperTranscriber,
    open_whisper,
    pcm_to_audio,
)

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
CHUNK = 8000  # 0.5 s at 16 kHz


def chunk(level: float) -> Audio:
    """A chunk the fake detector calls speech when its level is above zero."""
    return np.full(CHUNK, level, np.float32)


def is_loud(audio: Audio) -> bool:
    return bool(audio.max() > 0.0)


def feed(
    collector: UtteranceCollector, levels: list[float], start_ms: int = 0
) -> list[tuple[int, int]]:
    """(start ms, length in chunks) of each utterance the collector gives back."""
    out = []
    for index, level in enumerate(levels):
        at = T0 + timedelta(milliseconds=start_ms + 500 * index)
        utterance = collector.add(chunk(level), at)
        if utterance is not None:
            ms = int((utterance.started_at - T0).total_seconds() * 1000)
            out.append((ms, len(utterance.audio) // CHUNK))
    return out


def test_pcm_becomes_floats_from_minus_one_to_one() -> None:
    data = np.array([0, 16384, -32768, 32767], dtype="<i2").tobytes()
    assert pcm_to_audio(data).tolist() == pytest.approx([0.0, 0.5, -1.0, 32767 / 32768])


def test_an_odd_number_of_pcm_bytes_is_refused() -> None:
    with pytest.raises(ValueError, match="even number of bytes"):
        pcm_to_audio(b"\x00\x01\x02")


def test_an_utterance_starts_one_chunk_early_and_ends_after_a_second_of_silence() -> None:
    collector = UtteranceCollector(is_loud)
    assert feed(collector, [0, 0, 0.5, 0.5, 0.5, 0, 0, 0]) == [(500, 6)]


def test_a_short_pause_does_not_end_the_utterance() -> None:
    collector = UtteranceCollector(is_loud)
    assert feed(collector, [0.5, 0, 0.5, 0, 0]) == [(0, 5)]


def test_a_long_utterance_is_cut_at_the_longest_length() -> None:
    collector = UtteranceCollector(is_loud, longest=timedelta(seconds=2))
    assert feed(collector, [0.5] * 10) == [(0, 4), (2000, 4)]


def test_a_gap_in_the_audio_ends_the_utterance_and_drops_the_stale_chunk_before() -> None:
    collector = UtteranceCollector(is_loud)
    first = feed(collector, [0, 0.5, 0.5])
    after_gap = feed(collector, [0.5, 0, 0], start_ms=10_000)
    assert first == []
    assert after_gap == [(0, 3), (10_000, 3)]


def test_silence_alone_gives_nothing() -> None:
    assert feed(UtteranceCollector(is_loud), [0] * 20) == []


def test_the_real_voice_detector_hears_no_speech_in_silence() -> None:
    assert SileroSpeechDetector()(np.zeros(CHUNK, np.float32)) is False


class Segment:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeWhisper:
    def __init__(self, texts: list[str] | Exception) -> None:
        self.texts = texts
        self.options: dict[str, object] = {}

    def transcribe(
        self,
        audio: Audio,
        *,
        language: str | None,
        beam_size: int,
        vad_filter: bool,
        condition_on_previous_text: bool,
    ) -> tuple[list[Segment], object]:
        self.options = {"language": language, "beam_size": beam_size, "vad_filter": vad_filter}
        if isinstance(self.texts, Exception):
            raise self.texts
        return [Segment(text) for text in self.texts], None


def test_segments_are_joined_into_one_transcript() -> None:
    fake = FakeWhisper([" Help me, ", "I fell. "])
    assert WhisperTranscriber(fake, beam_size=1).transcribe(chunk(0.5)) == "Help me, I fell."
    assert fake.options == {"language": "en", "beam_size": 1, "vad_filter": True}


def test_a_transcription_error_is_a_speech_model_error() -> None:
    with pytest.raises(SpeechModelError, match="could not transcribe"):
        WhisperTranscriber(FakeWhisper(RuntimeError("out of memory"))).transcribe(chunk(0.5))


def test_a_model_folder_without_a_model_is_a_speech_model_error(tmp_path: Path) -> None:
    empty = tmp_path / "empty-model"
    empty.mkdir()
    with pytest.raises(SpeechModelError, match="could not open the speech model"):
        open_whisper(tmp_path, name=str(empty))


def test_without_faster_whisper_opening_says_it_is_not_available(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    with pytest.raises(SpeechModelError, match="not available on this laptop"):
        open_whisper(tmp_path)
