"""Audio reader: reads stamped mic chunks and logs them. It stores nothing.

It never logs sample values, only whether a chunk was all zeros. Run from the
layer3 directory:
    uv run python -m layer3.audio_reader --config <worker.json> [--seconds N]

Exit codes: 0 chunks were read or no mic is configured, 1 mic error,
2 bad config or bad arguments.

The command-line loop here is a copy of the one in frame_reader.py, kept
separate by the Layer 3 owner's decision.
"""

import argparse
import logging
import math
import sys
from collections.abc import Sequence
from contextlib import closing
from pathlib import Path
from time import monotonic

from layer3 import settings
from layer3.worker_config import ConfigError, load_mic

logger = logging.getLogger(__name__)

EXIT_OK: int = 0
EXIT_MIC_ERROR: int = 1
EXIT_BAD_CONFIG: int = 2


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read mic audio chunks and log them.")
    parser.add_argument("--config", type=Path, required=True, help="path to worker.json")
    parser.add_argument(
        "--seconds",
        type=_run_length,
        default=settings.AUDIO_READER_SECONDS,
        help="how long to read for, counted from the first chunk",
    )
    options = parser.parse_args(arguments)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        mic = load_mic(options.config)
    except ConfigError as error:
        logger.error("L3 audio reader: bad config: %s", error)
        return EXIT_BAD_CONFIG
    if mic is None:
        logger.info("L3 audio reader: no mic is configured, so none was opened")
        return EXIT_OK

    # Loaded only when there is a mic, so a laptop without one needs no audio library.
    import layer3.mic as capture

    count = 0
    first_chunk_at = 0.0
    last_chunk_at = 0.0
    try:
        with closing(capture.chunks(mic)) as stream:
            for chunk in stream:
                last_chunk_at = monotonic()
                if count == 0:
                    first_chunk_at = last_chunk_at
                count += 1
                logger.info(
                    "L3 audio reader: chunk %d has %d samples at %d Hz, captured_at %s, "
                    "all zeros: %s%s",
                    count,
                    chunk.samples.shape[0],
                    settings.AUDIO_SAMPLE_RATE,
                    chunk.captured_at.isoformat().replace("+00:00", "Z"),
                    "no" if chunk.samples.any() else "yes",
                    ", audio was lost before it" if chunk.overflowed else "",
                )
                if last_chunk_at - first_chunk_at >= options.seconds:
                    break
    except capture.MicError as error:
        logger.error("L3 audio reader: capture failed after %d chunks: %s", count, error)
        return EXIT_MIC_ERROR
    except KeyboardInterrupt:
        logger.info("L3 audio reader: stopped by the keyboard")

    elapsed = last_chunk_at - first_chunk_at
    rate = (count - 1) / elapsed if elapsed > 0 else 0.0
    logger.info(
        "L3 audio reader: read %d chunks over %.1f seconds from the first chunk, %.1f per second",
        count,
        elapsed,
        rate,
    )
    return EXIT_OK


def _run_length(text: str) -> float:
    try:
        seconds = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not a number") from None
    if not math.isfinite(seconds) or seconds < 0:
        raise argparse.ArgumentTypeError(f"{text!r} must be a finite number of 0 or more")
    return seconds


if __name__ == "__main__":
    sys.exit(main())
