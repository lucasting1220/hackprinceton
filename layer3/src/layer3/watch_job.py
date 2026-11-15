"""The watch_data job: runs the watch data receiver and hands each new reading to Layer 4.

Started by Layer 2's worker (layer3/jobs/watch_data/job.json). It takes the bridge's watch-data
batches (contracts/watch-data.json) with `receive("watch-data")`, keeps one WatchReceiver for
its whole life so a repeat is recognised across batches, and passes each new reading on with
`pass_on("watch-readings", ...)` as one contracts/watch-reading.json message. A reading Layer 2
cannot pass on is logged and dropped; the next one's last_received_at shows the gap. Nothing is
stored and no reading's values are logged. Layer 2 stops it by ending the process.

    uv run --project layer3 python -m layer3.watch_job
"""

import dataclasses
import logging
import sys
import time
from datetime import UTC, date, datetime
from typing import Literal, Protocol

from layer2.job_client import Layer2, Layer2Error
from layer3 import settings
from layer3.watch_receiver import WatchItem, WatchReceiver

logger = logging.getLogger(__name__)

EXIT_NO_LAYER2 = 2


class WatchClient(Protocol):
    """The two Layer 2 job client calls this job makes: Layer2 in the job, a stub in tests."""

    def receive(self, kind: Literal["watch-data"], wait_s: float = ...) -> object: ...

    def pass_on(self, kind: Literal["watch-readings"], message: dict[str, object]) -> None: ...


def _utc_text(moment: datetime) -> str:
    """A time as ISO 8601 in UTC, written with Z."""
    return moment.astimezone(UTC).isoformat().removesuffix("+00:00") + "Z"


def _written(value: object) -> object:
    if isinstance(value, datetime):
        return _utc_text(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def watch_reading_message(item: WatchItem) -> dict[str, object]:
    """One contracts/watch-reading.json message: the common fields and the reading's own."""
    message: dict[str, object] = {
        "schema_version": settings.WATCH_READING_SCHEMA_VERSION,
        "type": "watch_reading",
        "kind": item.kind,
    }
    for field in dataclasses.fields(item.reading):
        message[field.name] = _written(getattr(item.reading, field.name))
    message["last_received_at"] = _utc_text(item.last_received_at)
    return message


def pass_on_batch(
    layer2: WatchClient, receiver: WatchReceiver, batch: object, received_at: datetime
) -> int:
    """Pass on each new reading in the batch, in the receiver's order. Return how many Layer 2
    took; a reading it refused is logged and not tried again."""
    taken = failed = 0
    for item in receiver.receive(batch, received_at):
        try:
            layer2.pass_on("watch-readings", watch_reading_message(item))
        except Layer2Error as error:
            # Only the first few are logged, so a batch sent while Layer 4 is down cannot flood
            # the log. The summary line below carries the full count.
            if failed < settings.WATCH_PASS_ON_FAILURES_LOGGED_PER_BATCH:
                logger.warning(
                    "L3 watch data: a %s reading was not passed on: %s", item.kind, error
                )
            failed += 1
            continue
        taken += 1
    if failed:
        logger.warning(
            "L3 watch data: %d readings passed on, %d could not be passed on and were dropped",
            taken,
            failed,
        )
    return taken


def receive_once(layer2: WatchClient, receiver: WatchReceiver) -> None:
    """Wait for one batch and pass on its new readings. If Layer 2 cannot be reached, log it
    and pause before the caller asks again."""
    try:
        batch = layer2.receive("watch-data", settings.WATCH_RECEIVE_WAIT_SECONDS)
    except Layer2Error as error:
        logger.warning(
            "L3 watch data: cannot receive watch data, asking again in %s s: %s",
            settings.WATCH_RECEIVE_RETRY_SECONDS,
            error,
        )
        time.sleep(settings.WATCH_RECEIVE_RETRY_SECONDS)
        return
    if batch is None:
        return
    pass_on_batch(layer2, receiver, batch, datetime.now(UTC))


def run(layer2: WatchClient) -> None:
    """Receive and pass on watch readings until the process is ended."""
    receiver = WatchReceiver()
    logger.info("L3 watch data: taking watch-data and passing on watch-readings")
    while True:
        receive_once(layer2, receiver)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        layer2 = Layer2.from_env()
    except Layer2Error as error:
        logger.error("L3 watch data: %s; start me through Layer 2", error)
        return EXIT_NO_LAYER2
    run(layer2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
