"""STUB demo: runs sample watch readings, one of them sent twice, through the watch_data job.

It runs on the fake Layer 2 beside it, so it shows the job's receiving and passing on working
and nothing more. Run from the layer3 directory:
    uv run python stubs/watch_demo.py
"""

import json
import logging
import sys
from datetime import UTC, datetime

from fake_layer2_client import FakeLayer2

from layer3.watch_job import pass_on_batch
from layer3.watch_receiver import WatchReceiver

logger = logging.getLogger(__name__)

# Two syncs from the phone. The second sends the 11:15 heart-rate reading again.
SAMPLE_BATCHES: list[dict[str, object]] = [
    {
        "device_id": "sample-phone",
        "heart_rate": [
            {"measured_at": "2026-11-14T11:10:00Z", "bpm": 64},
            {"measured_at": "2026-11-14T11:15:00Z", "bpm": 66.4},
        ],
        "sleep": [
            {
                "night_of": "2026-11-13",
                "asleep_minutes": 412,
                "bedtime_at": "2026-11-14T03:40:00Z",
                "wake_at": "2026-11-14T11:05:00Z",
                "interruptions": 2,
            }
        ],
        "steps": [{"measured_at": "2026-11-14T11:20:00Z", "steps_today": 230}],
    },
    {
        "device_id": "sample-phone",
        "heart_rate": [
            {"measured_at": "2026-11-14T11:15:00Z", "bpm": 66.4},
            {"measured_at": "2026-11-14T11:45:00Z", "bpm": 71},
        ],
        "steps": [{"measured_at": "2026-11-14T11:50:00Z", "steps_today": 1180}],
    },
]


def run() -> FakeLayer2:
    """Send the sample batches through the job's receiving and passing on, with one receiver,
    and return the fake that took the messages."""
    layer2 = FakeLayer2(SAMPLE_BATCHES)
    receiver = WatchReceiver()
    while (batch := layer2.receive("watch-data")) is not None:
        pass_on_batch(layer2, receiver, batch, received_at=datetime.now(UTC))
    for message in layer2.passed_on:
        logger.info("L3 STUB watch demo: out: %s", json.dumps(message))
    logger.info("L3 STUB watch demo: %d readings passed on", len(layer2.passed_on))
    return layer2


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
