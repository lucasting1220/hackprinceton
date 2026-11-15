"""STUB: stands in for Layer 2's job client so the watch receiver can run with no coordinator.

`receive` has the shape of the real `Layer2.receive("watch-data")` in layer2/job_client.py and
hands over prepared batches from memory. `publish_watch` is a placeholder: Layer 2 has no call
yet that takes a job's `watch` feed items (its `feed()` carries only camera and mic). This fake
keeps everything in memory and never counts as an integration test.
"""

import logging
from collections.abc import Sequence
from typing import Literal

from layer3.watch_receiver import WatchItem

logger = logging.getLogger(__name__)


class FakeLayer2:
    def __init__(self, batches: Sequence[dict[str, object]]) -> None:
        self._batches: list[dict[str, object]] = list(batches)
        self.published: list[WatchItem] = []

    def receive(
        self, kind: Literal["watch-data"], wait_s: float = 25.0
    ) -> dict[str, object] | None:
        """The next prepared batch, shaped as the body of Layer 1's `POST /v1/watch-data`, or
        None when there are no more. It never waits: `wait_s` is here only to match the call."""
        if not self._batches:
            logger.info("L3 STUB fake Layer 2: no more %s to hand over", kind)
            return None
        logger.info("L3 STUB fake Layer 2: handing over one %s batch", kind)
        return self._batches.pop(0)

    def publish_watch(self, item: WatchItem) -> None:
        """Take one item of the `watch` feed."""
        logger.info("L3 STUB fake Layer 2: took a %s item for the watch feed", item.kind)
        self.published.append(item)
