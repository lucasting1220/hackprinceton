"""Layer 4 health check: the resident's watch readings in, heart-rate alerts out.

Each message from Layer 3 (contracts/watch-reading.json) is read once. A heart-rate reading
goes to the rules, which alert when it is outside the limits and log it either way. The latest
reading of each kind is kept for live status. A message that breaks the contract is skipped
with a warning and counted; one bad reading never stops the next.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from layer4.signals import HeartRateSignal
from layer4.upper_tier import UpperTier
from layer4.watch import SleepRecord, StepsCount, parse_reading

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LatestHealth:
    """The newest reading of each kind, for live status; None until one arrives."""

    heart_rate: HeartRateSignal | None = None
    sleep: SleepRecord | None = None
    steps: StepsCount | None = None
    last_received_at: datetime | None = None


class HealthCheck:
    def __init__(self, upper: UpperTier) -> None:
        self._upper = upper
        self.latest = LatestHealth()
        self.refused = 0

    def on_message(self, message: Mapping[str, object]) -> None:
        try:
            received = parse_reading(message)
        except ValueError as err:
            self.refused += 1
            logger.warning("L4 health check: watch reading refused: %s", err)
            return
        reading = received.reading
        latest = self.latest
        if isinstance(reading, HeartRateSignal):
            self.latest = LatestHealth(
                reading, latest.sleep, latest.steps, received.last_received_at
            )
            self._upper.handle(reading)
        elif isinstance(reading, SleepRecord):
            self.latest = LatestHealth(
                latest.heart_rate, reading, latest.steps, received.last_received_at
            )
        else:
            self.latest = LatestHealth(
                latest.heart_rate, latest.sleep, reading, received.last_received_at
            )
