"""Types for the parts of faster-whisper that Layer 4 uses. The library ships none of its own.

tests/test_library_stubs.py checks these files against the installed library with
mypy.stubtest.
"""

from collections.abc import Iterable
from typing import BinaryIO, Protocol

import numpy as np
from faster_whisper.vad import VadOptions
from numpy.typing import NDArray

class _Segment(Protocol):
    text: str

class WhisperModel:
    def __init__(
        self,
        model_size_or_path: str,
        device: str = "auto",
        device_index: int | list[int] = 0,
        compute_type: str = "default",
        cpu_threads: int = 0,
        num_workers: int = 1,
        download_root: str | None = None,
        local_files_only: bool = False,
        files: dict[str, object] | None = None,
        revision: str | None = None,
        use_auth_token: str | bool | None = None,
        **model_kwargs: object,
    ) -> None: ...
    def transcribe(
        self,
        audio: str | BinaryIO | NDArray[np.float32],
        language: str | None = None,
        task: str = "transcribe",
        log_progress: bool = False,
        beam_size: int = 5,
        best_of: int = 5,
        patience: float = 1,
        length_penalty: float = 1,
        repetition_penalty: float = 1,
        no_repeat_ngram_size: int = 0,
        temperature: float | list[float] | tuple[float, ...] = ...,
        compression_ratio_threshold: float | None = 2.4,
        log_prob_threshold: float | None = -1.0,
        no_speech_threshold: float | None = 0.6,
        condition_on_previous_text: bool = True,
        prompt_reset_on_temperature: float = 0.5,
        initial_prompt: str | Iterable[int] | None = None,
        prefix: str | None = None,
        suppress_blank: bool = True,
        suppress_tokens: list[int] | None = ...,
        without_timestamps: bool = False,
        max_initial_timestamp: float = 1.0,
        word_timestamps: bool = False,
        prepend_punctuations: str = ...,
        append_punctuations: str = ...,
        multilingual: bool = False,
        vad_filter: bool = False,
        vad_parameters: dict[str, object] | VadOptions | None = None,
        max_new_tokens: int | None = None,
        chunk_length: int | None = None,
        clip_timestamps: str | list[float] = "0",
        hallucination_silence_threshold: float | None = None,
        hotwords: str | None = None,
        language_detection_threshold: float | None = 0.5,
        language_detection_segments: int = 1,
    ) -> tuple[Iterable[_Segment], object]: ...
