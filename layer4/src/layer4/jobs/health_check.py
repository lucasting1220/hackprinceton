"""Layer 4 job health_check: watch readings and caregivers' requests in; alerts, live status
and replies out.

Layer 2's worker starts it from layer4/jobs/health_check/job.json, on any laptop: it needs no
camera or mic. One thread takes Layer 3's checked watch readings (contracts/watch-reading.json)
with receive("watch-readings"): heart rate goes to the rules, and every new reading sends a
fresh live status (contracts/live-status.json). A second thread takes the caregivers' requests
(contracts/phone-request.json) with receive("requests"): check_now sends the live status, ask
gets a reply (contracts/reply.json). A wait with nothing in it is normal.
"""

import logging
import threading
import time
from collections.abc import Callable, Mapping

from layer2.job_client import Layer2, Layer2Error
from layer4 import settings
from layer4.health_check import HealthCheck
from layer4.layer2_ports import Layer2EventLog, Layer2Model, Layer2Phone
from layer4.ports import PortError
from layer4.requests import RequestHandler
from layer4.upper_tier import UpperTier

logger = logging.getLogger(__name__)

Source = Callable[[], Mapping[str, object] | None]


def _wait(source: Source, what: str, sleep: Callable[[float], None]) -> Mapping[str, object] | None:
    """The next message, or None. If Layer 2 cannot be reached, wait first."""
    try:
        return source()
    except Layer2Error as err:
        logger.error("L4 health_check: no %s from Layer 2: %s", what, err)
        sleep(settings.WATCH_RETRY_S)
        return None


def take_one(
    check: HealthCheck,
    source: Source,
    on_new: Callable[[], None] = lambda: None,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Wait for one watch reading and hand it on; call on_new when it held a reading."""
    message = _wait(source, "watch readings", sleep)
    if message is not None and check.on_message(message):
        on_new()


def take_request(
    handler: RequestHandler, source: Source, sleep: Callable[[float], None] = time.sleep
) -> None:
    """Wait for one caregiver request and answer it."""
    message = _wait(source, "requests", sleep)
    if message is not None:
        handler.handle(message)


def send_status(handler: RequestHandler) -> None:
    try:
        handler.send_status()
    except PortError as err:
        logger.error("L4 health_check: live status not delivered: %s", err)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        client = Layer2.from_env()
    except Layer2Error as err:
        logger.error("L4 health_check: %s", err)
        return 2
    phone = Layer2Phone(client)
    check = HealthCheck(UpperTier(settings.RuleThresholds(), Layer2EventLog(client), phone))
    handler = RequestHandler(lambda: check.latest, phone, Layer2Model(client))

    def next_reading() -> Mapping[str, object] | None:
        return client.receive("watch-readings", wait_s=settings.WATCH_WAIT_S)

    def next_request() -> Mapping[str, object] | None:
        return client.receive("requests", wait_s=settings.WATCH_WAIT_S)

    def requests_forever() -> None:
        while True:
            take_request(handler, next_request)

    threading.Thread(target=requests_forever, daemon=True).start()
    logger.info("L4 health_check: running")
    while True:
        take_one(check, next_reading, on_new=lambda: send_status(handler))


if __name__ == "__main__":
    raise SystemExit(main())
