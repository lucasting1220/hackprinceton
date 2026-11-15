import numpy as np
from numpy.typing import NDArray

class VadOptions:
    def __init__(
        self,
        threshold: float = 0.5,
        neg_threshold: float | None = None,
        min_speech_duration_ms: int = 0,
        max_speech_duration_s: float = ...,
        min_silence_duration_ms: int = 2000,
        speech_pad_ms: int = 400,
    ) -> None: ...

def get_speech_timestamps(
    audio: NDArray[np.float32],
    vad_options: VadOptions | None = None,
    sampling_rate: int = 16000,
    **kwargs: object,
) -> list[dict[str, int]]: ...
