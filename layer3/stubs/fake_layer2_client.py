"""STUB: stands in for two Layer 2 job-client calls that do not exist yet.

layer2/job_client.py says feed(), to_phone() and on_request() come with later build steps. This
fake covers the call that hands a job the watch data Layer 1's bridge received, and the call
that takes a job's `watch` feed items. Both method names are placeholders: Layer 2 has not named
the real calls. It keeps everything in memory and never counts as an integration test.
"""

import logging
from collections.abc import Iterator, Sequence

from layer3.watch_receiver import WatchItem

logger = logging.getLogger(__name__)


class FakeLayer2:
    def __init__(self, batches: Sequence[object]) -> None:
        self._batches: list[object] = list(batches)
        self.published: list[WatchItem] = []

    def watch_data(self) -> Iterator[object]:
        """Hand over each batch, shaped as the body of Layer 1's `POST /v1/watch-data`."""
        for number, batch in enumerate(self._batches, start=1):
            logger.info("L3 STUB fake Layer 2: handing over watch-data batch %d", number)
            yield batch

    def publish_watch(self, item: WatchItem) -> None:
        """Take one item of the `watch` feed."""
        logger.info("L3 STUB fake Layer 2: took a %s item for the watch feed", item.kind)
        self.published.append(item)
