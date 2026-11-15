"""Tests for the fake Layer 2 and the sample-readings script that runs on it."""

import logging

import pytest
import watch_demo
from fake_layer2_client import FakeLayer2

from layer2.job_client import Layer2Error


def test_stub_hands_over_batches_keeps_messages_and_says_it_is_a_stub(
    caplog: pytest.LogCaptureFixture,
) -> None:
    batch = {"heart_rate": [{"measured_at": "2026-11-14T03:12:45Z", "bpm": 72}]}
    layer2 = FakeLayer2([batch])
    message: dict[str, object] = {"type": "watch_reading"}

    with caplog.at_level(logging.INFO):
        assert layer2.receive("watch-data") == batch
        assert layer2.receive("watch-data") is None
        layer2.pass_on("watch-readings", message)
        layer2.nobody_takes_readings = True
        with pytest.raises(Layer2Error):
            layer2.pass_on("watch-readings", message)

    assert layer2.passed_on == [message]
    stub_lines = [
        record.getMessage() for record in caplog.records if record.name == "fake_layer2_client"
    ]
    assert len(stub_lines) == 4
    assert all("STUB" in line for line in stub_lines)


def test_script_passes_on_every_sample_reading_but_the_repeat() -> None:
    sent = sum(
        len(readings)
        for batch in watch_demo.SAMPLE_BATCHES
        for readings in batch.values()
        if isinstance(readings, list)
    )

    assert len(watch_demo.run().passed_on) == sent - 1
    assert watch_demo.main() == 0
