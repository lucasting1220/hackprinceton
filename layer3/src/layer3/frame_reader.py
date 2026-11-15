"""Frame reader: the test reader of build step 1. Reads stamped frames and logs them.

It stores nothing. Run from the layer3 directory:
    uv run python -m layer3.frame_reader --config <worker.json> [--seconds N]

Exit codes: 0 frames were read or no camera is configured, 1 capture error,
2 bad config or bad arguments.
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
from layer3.worker_config import ConfigError, load_camera

logger = logging.getLogger(__name__)

EXIT_OK: int = 0
EXIT_CAPTURE_ERROR: int = 1
EXIT_BAD_CONFIG: int = 2


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read camera frames and log them.")
    parser.add_argument("--config", type=Path, required=True, help="path to worker.json")
    parser.add_argument(
        "--seconds",
        type=_run_length,
        default=settings.FRAME_READER_SECONDS,
        help="how long to read for, counted from the first frame",
    )
    options = parser.parse_args(arguments)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        camera = load_camera(options.config)
    except ConfigError as error:
        logger.error("L3 frame reader: bad config: %s", error)
        return EXIT_BAD_CONFIG
    if camera is None:
        logger.info("L3 frame reader: no camera is configured, so none was opened")
        return EXIT_OK

    # Loaded only when there is a camera, so a laptop without one needs no camera library.
    import layer3.camera as capture

    count = 0
    first_frame_at = 0.0
    last_frame_at = 0.0
    try:
        with closing(capture.frames(camera)) as stream:
            for frame in stream:
                last_frame_at = monotonic()
                if count == 0:
                    first_frame_at = last_frame_at
                count += 1
                logger.info(
                    "L3 frame reader: frame %d is %d by %d, captured_at %s",
                    count,
                    frame.image.shape[1],
                    frame.image.shape[0],
                    frame.captured_at.isoformat().replace("+00:00", "Z"),
                )
                if last_frame_at - first_frame_at >= options.seconds:
                    break
    except capture.CaptureError as error:
        logger.error("L3 frame reader: capture failed after %d frames: %s", count, error)
        return EXIT_CAPTURE_ERROR
    except KeyboardInterrupt:
        logger.info("L3 frame reader: stopped by the keyboard")

    elapsed = last_frame_at - first_frame_at
    rate = (count - 1) / elapsed if elapsed > 0 else 0.0
    logger.info(
        "L3 frame reader: read %d frames over %.1f seconds from the first frame, %.1f per second",
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
