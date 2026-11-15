"""Tests for the fake Layer 2 and the sample-readings script that runs on it."""

import logging
from datetime import UTC, datetime

import pytest
import watch_demo
from fake_layer2_client import FakeLayer2

from layer3.watch_receiver import WatchReceiver


def test_stub_hands_over_batches_records_items_and_says_it_is_a_stub(
    caplog: pytest.LogCaptureFixture,
) -> None:
    layer2 = FakeLayer2([{"heart_rate": [{"measured_at": "2026-11-14T03:12:45Z", "bpm": 72}]}])

    with caplog.at_level(logging.INFO):
        [batch] = list(layer2.watch_data())
        [item] = WatchReceiver().receive(batch, datetime(2026, 11, 14, 12, 0, tzinfo=UTC))
        layer2.publish_watch(item)

    assert layer2.published == [item]
    stub_lines = [
        record.getMessage() for record in caplog.records if record.name == "fake_layer2_client"
    ]
    assert len(stub_lines) == 2
    assert all("STUB" in line for line in stub_lines)


def test_script_passes_on_every_sample_reading_but_the_repeat() -> None:
    sent = sum(
        len(readings)
        for batch in watch_demo.SAMPLE_BATCHES
        for readings in batch.values()
        if isinstance(readings, list)
    )

    assert len(watch_demo.run().published) == sent - 1
    assert watch_demo.main() == 0
