"""STUB: stands in for Layer 2's job client so the watch_data job can run with no coordinator.

`receive` has the shape of the real `Layer2.receive("watch-data")` in layer2/job_client.py and
hands over prepared batches from memory. `pass_on` has the shape of the real
`Layer2.pass_on("watch-readings", message)`: it keeps each message, or raises Layer2Error as the
real call does when no job takes watch-readings. Everything stays in memory and this never
counts as an integration test.
"""

import logging
from collections.abc import Sequence
from typing import Literal

from layer2.job_client import Layer2Error

logger = logging.getLogger(__name__)


class FakeLayer2:
    def __init__(self, batches: Sequence[object]) -> None:
        self._batches: list[object] = list(batches)
        self.passed_on: list[dict[str, object]] = []
        self.nobody_takes_readings: bool = False
        """When True, pass_on raises Layer2Error, as when Layer 4's job is down."""

    def receive(self, kind: Literal["watch-data"], wait_s: float = 25.0) -> object:
        """The next prepared batch, shaped as contracts/watch-data.json, or None when there are
        no more. It never waits: `wait_s` is here only to match the call."""
        if not self._batches:
            logger.info("L3 STUB fake Layer 2: no more %s to hand over", kind)
            return None
        logger.info("L3 STUB fake Layer 2: handing over one %s batch", kind)
        return self._batches.pop(0)

    def pass_on(self, kind: Literal["watch-readings"], message: dict[str, object]) -> None:
        """Take one contracts/watch-reading.json message, or refuse it."""
        if self.nobody_takes_readings:
            logger.info("L3 STUB fake Layer 2: no job takes %s", kind)
            raise Layer2Error(f"STUB: no job takes {kind}")
        logger.info("L3 STUB fake Layer 2: took one %s message", kind)
        self.passed_on.append(message)
