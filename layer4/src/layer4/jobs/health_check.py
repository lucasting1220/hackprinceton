"""Layer 4 job health_check: the resident's watch readings in, heart-rate alerts out.

Layer 2's worker starts it from layer4/jobs/health_check/job.json, on any laptop: it needs no
camera or mic. It takes Layer 3's checked watch readings (contracts/watch-reading.json) with
receive("watch-readings") and hands each to the health check, which sends heart rate to the
rules and keeps the latest of each kind for live status. A wait with no reading is normal: the
phone sends watch data only now and then.
"""

import logging
import time
from collections.abc import Callable, Mapping

from layer2.job_client import Layer2, Layer2Error
from layer4 import settings
from layer4.health_check import HealthCheck
from layer4.layer2_ports import Layer2EventLog, Layer2Phone
from layer4.upper_tier import UpperTier

logger = logging.getLogger(__name__)

Source = Callable[[], Mapping[str, object] | None]


def take_one(
    check: HealthCheck, source: Source, sleep: Callable[[float], None] = time.sleep
) -> None:
    """Wait for one reading and hand it on. If Layer 2 cannot be reached, wait and return."""
    try:
        message = source()
    except Layer2Error as err:
        logger.error("L4 health_check: no watch readings from Layer 2: %s", err)
        sleep(settings.WATCH_RETRY_S)
        return
    if message is not None:
        check.on_message(message)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        client = Layer2.from_env()
    except Layer2Error as err:
        logger.error("L4 health_check: %s", err)
        return 2
    upper = UpperTier(settings.RuleThresholds(), Layer2EventLog(client), Layer2Phone(client))
    check = HealthCheck(upper)

    def next_reading() -> Mapping[str, object] | None:
        return client.receive("watch-readings", wait_s=settings.WATCH_WAIT_S)

    logger.info("L4 health_check: running")
    while True:
        take_one(check, next_reading)


if __name__ == "__main__":
    raise SystemExit(main())
