"""The watch_data job on the fake Layer 2 (contracts/watch-data.json, watch-reading.json)."""

import json
import logging
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import pytest
from fake_layer2_client import FakeLayer2

from layer2.job_client import Layer2Error
from layer3 import settings, watch_job
from layer3.watch_job import pass_on_batch, receive_once, watch_reading_message
from layer3.watch_receiver import HeartRateReading, WatchItem, WatchReceiver

REPO = Path(__file__).resolve().parents[2]
AT = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)

# The fields of each kind of message (contracts/README.md, "Layer 3 to Layer 4: watch readings").
COMMON = {"schema_version", "type", "kind", "last_received_at"}
FIELDS = {
    "heart_rate": {"measured_at", "bpm"},
    "sleep": {"night_of", "asleep_minutes", "bedtime_at", "wake_at", "interruptions"},
    "steps": {"measured_at", "steps_today"},
}


def contract(name: str) -> dict[str, object]:
    example: dict[str, object] = json.loads((REPO / "contracts" / name).read_text(encoding="utf-8"))
    return example


def heart_rate_batch(*minutes: int) -> dict[str, object]:
    return {
        "heart_rate": [
            {"measured_at": f"2026-11-14T11:{minute:02d}:00Z", "bpm": 60 + minute}
            for minute in minutes
        ]
    }


class _Done(Exception):
    """Ends run()'s endless loop in a test."""


class EndingLayer2(FakeLayer2):
    """The fake Layer 2, which ends the test once every prepared batch has been handed over."""

    def receive(self, kind: Literal["watch-data"], wait_s: float = 25.0) -> object:
        if not self._batches:
            raise _Done
        return super().receive(kind, wait_s)


def test_the_example_heart_rate_reading_becomes_the_contract_example_exactly() -> None:
    example = contract("watch-reading.json")
    measured_at, last_received_at = example["measured_at"], example["last_received_at"]
    assert isinstance(measured_at, str) and isinstance(last_received_at, str)
    batch = {"heart_rate": [{"measured_at": measured_at, "bpm": example["bpm"]}]}
    layer2 = FakeLayer2([])

    taken = pass_on_batch(layer2, WatchReceiver(), batch, datetime.fromisoformat(last_received_at))

    assert taken == 1
    assert layer2.passed_on == [example]
    assert list(layer2.passed_on[0]) == list(example)


def test_the_watch_data_example_gives_one_message_per_reading_with_only_its_kinds_fields() -> None:
    layer2 = FakeLayer2([])

    taken = pass_on_batch(layer2, WatchReceiver(), contract("watch-data.json"), AT)

    assert taken == 3
    heart_rate, sleep, steps = layer2.passed_on
    for message in layer2.passed_on:
        kind = message["kind"]
        assert isinstance(kind, str)
        assert set(message) == COMMON | FIELDS[kind]
        assert message["schema_version"] == 1 and message["type"] == "watch_reading"
        assert message["last_received_at"] == "2026-11-14T12:00:00Z"
    assert heart_rate["measured_at"] == "2026-11-14T03:12:45Z" and heart_rate["bpm"] == 72
    assert sleep == {
        "schema_version": 1,
        "type": "watch_reading",
        "kind": "sleep",
        "night_of": "2026-11-13",
        "asleep_minutes": 412,
        "bedtime_at": "2026-11-14T03:40:00Z",
        "wake_at": "2026-11-14T11:05:00Z",
        "interruptions": 2,
        "last_received_at": "2026-11-14T12:00:00Z",
    }
    assert steps["measured_at"] == "2026-11-14T11:20:00Z" and steps["steps_today"] == 230


def test_times_are_written_in_utc_with_z_and_counts_as_whole_numbers() -> None:
    plus_two = timezone(timedelta(hours=2))
    batch = {"heart_rate": [{"measured_at": "2026-11-14T05:12:45.25+02:00", "bpm": 66.5}]}
    layer2 = FakeLayer2([])

    pass_on_batch(layer2, WatchReceiver(), batch, datetime(2026, 11, 14, 14, 0, 1, tzinfo=plus_two))

    [message] = layer2.passed_on
    assert message["measured_at"] == "2026-11-14T03:12:45.250000Z"
    assert message["last_received_at"] == "2026-11-14T12:00:01Z"
    assert message["bpm"] == 67 and isinstance(message["bpm"], int)


def test_the_message_is_built_from_the_receivers_item() -> None:
    item = WatchItem(HeartRateReading(measured_at=AT, bpm=80), last_received_at=AT)

    assert watch_reading_message(item) == {
        "schema_version": settings.WATCH_READING_SCHEMA_VERSION,
        "type": "watch_reading",
        "kind": "heart_rate",
        "measured_at": "2026-11-14T12:00:00Z",
        "bpm": 80,
        "last_received_at": "2026-11-14T12:00:00Z",
    }


def test_readings_are_passed_on_in_the_batchs_order() -> None:
    layer2 = FakeLayer2([])

    pass_on_batch(layer2, WatchReceiver(), heart_rate_batch(30, 10, 20), AT)

    assert [message["bpm"] for message in layer2.passed_on] == [90, 70, 80]


def test_a_reading_layer2_cannot_pass_on_is_logged_and_the_rest_still_go(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class Flaky(FakeLayer2):
        calls: int = 0

        def pass_on(self, kind: Literal["watch-readings"], message: dict[str, object]) -> None:
            self.calls += 1
            self.nobody_takes_readings = self.calls == 2
            super().pass_on(kind, message)

    layer2 = Flaky([])

    with caplog.at_level(logging.WARNING, logger="layer3.watch_job"):
        taken = pass_on_batch(layer2, WatchReceiver(), heart_rate_batch(1, 2, 3), AT)

    assert taken == 2
    assert [message["bpm"] for message in layer2.passed_on] == [61, 63]
    lines = [record.getMessage() for record in caplog.records if record.name == "layer3.watch_job"]
    assert lines == [
        "L3 watch data: a heart_rate reading was not passed on: STUB: no job takes watch-readings",
        "L3 watch data: 2 readings passed on, 1 could not be passed on and were dropped",
    ]


def test_when_nobody_takes_readings_only_the_first_few_failures_are_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    layer2 = FakeLayer2([])
    layer2.nobody_takes_readings = True
    sent = settings.WATCH_PASS_ON_FAILURES_LOGGED_PER_BATCH + 3

    with caplog.at_level(logging.WARNING, logger="layer3.watch_job"):
        taken = pass_on_batch(layer2, WatchReceiver(), heart_rate_batch(*range(sent)), AT)

    assert taken == 0
    lines = [record.getMessage() for record in caplog.records if record.name == "layer3.watch_job"]
    assert len(lines) == settings.WATCH_PASS_ON_FAILURES_LOGGED_PER_BATCH + 1
    assert lines[-1] == (
        f"L3 watch data: 0 readings passed on, {sent} could not be passed on and were dropped"
    )


def test_a_failed_receive_is_logged_and_asked_again(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "WATCH_RECEIVE_RETRY_SECONDS", 0.0)

    class Reconnecting(FakeLayer2):
        def __init__(self, batches: list[object]) -> None:
            super().__init__(batches)
            self.waits: list[float] = []

        def receive(self, kind: Literal["watch-data"], wait_s: float = 25.0) -> object:
            self.waits.append(wait_s)
            if len(self.waits) == 1:
                raise Layer2Error("cannot reach Layer 2's worker")
            return super().receive(kind, wait_s)

    layer2 = Reconnecting([heart_rate_batch(1)])
    receiver = WatchReceiver()

    with caplog.at_level(logging.WARNING, logger="layer3.watch_job"):
        receive_once(layer2, receiver)
        receive_once(layer2, receiver)

    assert len(layer2.passed_on) == 1
    assert layer2.waits == [settings.WATCH_RECEIVE_WAIT_SECONDS] * 2
    assert "cannot receive watch data, asking again" in caplog.records[0].getMessage()


def test_run_keeps_one_receiver_so_a_repeat_in_a_later_batch_is_dropped() -> None:
    layer2 = EndingLayer2([heart_rate_batch(1, 2), None, heart_rate_batch(2, 3)])

    with pytest.raises(_Done):
        watch_job.run(layer2)

    assert [message["bpm"] for message in layer2.passed_on] == [61, 62, 63]


def test_main_needs_layer2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAYER2_GATEWAY", raising=False)
    assert watch_job.main() == watch_job.EXIT_NO_LAYER2


def test_main_does_not_take_watch_data_when_layer2_has_no_pass_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[str] = []

    class ReceiveOnly:
        def receive(self, kind: str, wait_s: float = 25.0) -> object:
            received.append(kind)
            return None

    class NoPassOn:
        @classmethod
        def from_env(cls) -> ReceiveOnly:
            return ReceiveOnly()

    monkeypatch.setattr(watch_job, "Layer2", NoPassOn)

    assert watch_job.main() == watch_job.EXIT_NO_PASS_ON
    assert received == []


def test_main_runs_the_job_on_layer2s_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeLayer2([])
    ran: list[object] = []

    class WithPassOn:
        @classmethod
        def from_env(cls) -> FakeLayer2:
            return client

    monkeypatch.setattr(watch_job, "Layer2", WithPassOn)
    monkeypatch.setattr(watch_job, "run", ran.append)

    assert watch_job.main() == 0
    assert ran == [client]


def test_the_job_folder_matches_the_contract() -> None:
    job = json.loads((REPO / "layer3" / "jobs" / "watch_data" / "job.json").read_text("utf-8"))
    assert set(job) == set(contract("job.json"))
    assert job == {
        "schema_version": 1,
        "name": "watch_data",
        "start_command": ["uv", "run", "--project", "../..", "python", "-m", "layer3.watch_job"],
        "kind": "always-on",
        "memory_gb": 0.2,
        "sensor": None,
    }
