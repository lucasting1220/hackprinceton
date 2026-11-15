"""Layer 4 health check: the resident's watch readings in, heart-rate alerts out.

Each message from Layer 3 (contracts/watch-reading.json) is read once. A heart-rate reading
goes to the rules, which alert when it is outside the limits and log it either way. The latest
reading of each kind is kept for live status, with the heart-rate reading before it for the
trend; a reading that arrives after a newer one of its kind is judged but does not replace it.
A message that breaks the contract is skipped with a warning and counted; one bad reading
never stops the next.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime

from layer4.signals import HeartRateSignal
from layer4.upper_tier import UpperTier
from layer4.watch import SleepRecord, StepsCount, parse_reading

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LatestHealth:
    """The newest reading of each kind, for live status; None until one arrives."""

    heart_rate: HeartRateSignal | None = None
    heart_rate_before: HeartRateSignal | None = None
    sleep: SleepRecord | None = None
    steps: StepsCount | None = None
    last_received_at: datetime | None = None


class HealthCheck:
    def __init__(self, upper: UpperTier) -> None:
        self._upper = upper
        self.latest = LatestHealth()
        self.refused = 0

    def on_message(self, message: Mapping[str, object]) -> bool:
        """Read one message. True when it held a reading, false when it was refused."""
        try:
            received = parse_reading(message)
        except ValueError as err:
            self.refused += 1
            logger.warning("L4 health check: watch reading refused: %s", err)
            return False
        reading = received.reading
        latest = replace(self.latest, last_received_at=received.last_received_at)
        if isinstance(reading, HeartRateSignal):
            current = latest.heart_rate
            if current is None or reading.measured_at >= current.measured_at:
                latest = replace(latest, heart_rate=reading, heart_rate_before=current)
            self.latest = latest
            self._upper.handle(reading)
        elif isinstance(reading, SleepRecord):
            if latest.sleep is None or reading.wake_at >= latest.sleep.wake_at:
                latest = replace(latest, sleep=reading)
            self.latest = latest
        else:
            if latest.steps is None or reading.measured_at >= latest.steps.measured_at:
                latest = replace(latest, steps=reading)
            self.latest = latest
        return True
