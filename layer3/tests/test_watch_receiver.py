"""Tests for the watch data receiver, using fake readings."""

import logging
from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from layer3 import settings, watch_receiver
from layer3.watch_receiver import (
    HeartRateReading,
    SleepReading,
    StepsReading,
    WatchItem,
    WatchReceiver,
)

ARRIVED: datetime = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
HEART: dict[str, object] = {"measured_at": "2026-11-14T03:12:45Z", "bpm": 72}
SLEEP: dict[str, object] = {
    "night_of": "2026-11-13",
    "asleep_minutes": 412,
    "bedtime_at": "2026-11-14T03:40:00Z",
    "wake_at": "2026-11-14T11:05:00Z",
    "interruptions": 2,
}
STEPS: dict[str, object] = {"measured_at": "2026-11-14T11:20:00Z", "steps_today": 230}
GOOD: dict[str, dict[str, object]] = {"heart_rate": HEART, "sleep": SLEEP, "steps": STEPS}

# Every field the Layer 1 and Layer 3 docs name is needed: taking any one away refuses the reading.
ONE_FIELD_MISSING: list[tuple[str, object]] = [
    (kind, {name: value for name, value in good.items() if name != gone})
    for kind, good in GOOD.items()
    for gone in good
]
BAD_READINGS: list[tuple[str, object]] = [
    ("heart_rate", "not an object"),
    ("heart_rate", None),
    ("heart_rate", {**HEART, "measured_at": 1794000000}),
    ("heart_rate", {**HEART, "measured_at": "yesterday"}),
    ("heart_rate", {**HEART, "measured_at": "2026-11-14T03:12:45"}),
    ("heart_rate", {**HEART, "measured_at": "1970-01-01T23:59:59Z"}),
    ("heart_rate", {**HEART, "measured_at": "2999-12-31T00:00:01Z"}),
    ("heart_rate", {**HEART, "measured_at": "0001-01-01T00:00:00+05:00"}),
    ("heart_rate", {**HEART, "measured_at": "9999-12-31T23:59:59-05:00"}),
    ("heart_rate", {**HEART, "bpm": "72"}),
    ("heart_rate", {**HEART, "bpm": True}),
    ("heart_rate", {**HEART, "bpm": float("nan")}),
    ("heart_rate", {**HEART, "bpm": float("inf")}),
    ("heart_rate", {**HEART, "bpm": 0}),
    ("heart_rate", {**HEART, "bpm": 0.51}),
    ("steps", {**STEPS, "steps_today": -1}),
    ("steps", {**STEPS, "steps_today": -0.4}),
    ("sleep", {**SLEEP, "asleep_minutes": -1}),
    ("sleep", {**SLEEP, "interruptions": -1}),
    ("sleep", {**SLEEP, "night_of": "last night"}),
    ("sleep", {**SLEEP, "night_of": 20261113}),
    ("sleep", {**SLEEP, "night_of": "0001-01-01"}),
    ("sleep", {**SLEEP, "night_of": "3000-01-01"}),
]

# Values that are long, wide and nested, and hold line breaks: none may reach the log whole.
LONG_TEXT: str = "A\nB" * 50_000
WIDE: object = LONG_TEXT
for _ in range(6):
    WIDE = [WIDE] * 6
LONGEST_LOG_LINE: int = settings.WATCH_LOG_VALUE_LIMIT + 120
BAD_AND_LONG: list[tuple[str, object]] = [
    ("heart_rate", [[LONG_TEXT] * 3] * 3),
    ("heart_rate", WIDE),
    ("heart_rate", {**HEART, "measured_at": WIDE}),
    ("heart_rate", {**HEART, "measured_at": LONG_TEXT}),
    ("heart_rate", {**HEART, "bpm": WIDE}),
    ("steps", {**STEPS, "steps_today": -(10**400)}),
    ("sleep", {**SLEEP, "night_of": WIDE}),
    ("sleep", {**SLEEP, "night_of": LONG_TEXT}),
]
BAD_AND_LONG_NAMES: list[str] = [
    "wide entry",
    "nested entry",
    "nested time",
    "long time",
    "nested count",
    "huge negative count",
    "nested night",
    "long night",
]


def test_heart_rate_comes_out_as_layer_4_expects() -> None:
    [item] = WatchReceiver().receive({"device_id": "phone-1", "heart_rate": [HEART]}, ARRIVED)

    measured_at = datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
    assert item == WatchItem(HeartRateReading(measured_at, 72), ARRIVED)
    assert item.kind == "heart_rate"
    reading = item.reading
    assert isinstance(reading, HeartRateReading)
    assert type(reading.bpm) is int
    assert reading.measured_at.utcoffset() == timedelta(0)


def test_sleep_and_steps_come_out_with_every_field() -> None:
    items = WatchReceiver().receive({"sleep": [SLEEP], "steps": [STEPS]}, ARRIVED)

    bedtime_at = datetime(2026, 11, 14, 3, 40, tzinfo=UTC)
    wake_at = datetime(2026, 11, 14, 11, 5, tzinfo=UTC)
    assert items == [
        WatchItem(SleepReading(date(2026, 11, 13), 412, bedtime_at, wake_at, 2), ARRIVED),
        WatchItem(StepsReading(datetime(2026, 11, 14, 11, 20, tzinfo=UTC), 230), ARRIVED),
    ]
    assert [item.kind for item in items] == ["sleep", "steps"]


@pytest.mark.parametrize(
    "again",
    [HEART, {**HEART, "bpm": 140}, {**HEART, "measured_at": "2026-11-13T22:12:45-05:00"}],
    ids=["same reading", "different value", "same moment written another way"],
)
def test_same_kind_and_measured_time_is_a_repeat(again: dict[str, object]) -> None:
    receiver = WatchReceiver()

    assert len(receiver.receive({"heart_rate": [HEART, again]}, ARRIVED)) == 1
    assert receiver.receive({"heart_rate": [again]}, ARRIVED) == []


def test_same_time_under_another_kind_is_not_a_repeat() -> None:
    steps = {"measured_at": HEART["measured_at"], "steps_today": 9}

    assert len(WatchReceiver().receive({"heart_rate": [HEART], "steps": [steps]}, ARRIVED)) == 2


def test_sleep_is_a_repeat_by_its_wake_up_time() -> None:
    receiver = WatchReceiver()
    receiver.receive({"sleep": [SLEEP]}, ARRIVED)

    assert receiver.receive({"sleep": [{**SLEEP, "asleep_minutes": 400}]}, ARRIVED) == []
    fuller_night = {**SLEEP, "wake_at": "2026-11-14T12:30:00Z", "asleep_minutes": 480}
    assert len(receiver.receive({"sleep": [fuller_night]}, ARRIVED)) == 1


def test_only_a_new_reading_moves_last_received_at() -> None:
    assert WatchReceiver().last_received_at is None
    receiver = WatchReceiver()
    receiver.receive({"heart_rate": [HEART]}, ARRIVED.astimezone(timezone(timedelta(hours=-5))))

    nothing_new: list[object] = [{"heart_rate": [HEART]}, {}, {"steps": []}, {"steps": [{}]}]
    for batch in nothing_new:
        assert receiver.receive(batch, ARRIVED + timedelta(hours=1)) == []
    kept = receiver.last_received_at
    assert kept == ARRIVED
    assert kept is not None
    assert kept.utcoffset() == timedelta(0)


def test_a_later_new_reading_moves_last_received_at_forward() -> None:
    receiver = WatchReceiver()
    receiver.receive({"heart_rate": [HEART]}, ARRIVED)
    later = ARRIVED + timedelta(hours=1)

    [item] = receiver.receive({"steps": [STEPS]}, later)

    assert item.last_received_at == later
    assert receiver.last_received_at == later


@pytest.mark.parametrize("measured_at", ["1970-01-02T00:00:00Z", "2999-12-31T00:00:00Z"])
def test_the_time_limits_themselves_are_accepted_as_layer_4_accepts_them(measured_at: str) -> None:
    batch = {"heart_rate": [{**HEART, "measured_at": measured_at}]}

    assert len(WatchReceiver().receive(batch, ARRIVED)) == 1


def test_the_lowest_counts_and_the_earliest_night_pass() -> None:
    quiet_night = {**SLEEP, "asleep_minutes": 0, "interruptions": 0, "night_of": "1970-01-02"}
    batch = {
        "heart_rate": [{**HEART, "bpm": 1}],
        "sleep": [quiet_night],
        "steps": [{**STEPS, "steps_today": 0}],
    }

    assert len(WatchReceiver().receive(batch, ARRIVED)) == 3


def test_just_under_a_half_rounds_down() -> None:
    steps = {**STEPS, "steps_today": 0.49999999999999994}

    [item] = WatchReceiver().receive({"steps": [steps]}, ARRIVED)

    reading = item.reading
    assert isinstance(reading, StepsReading)
    assert reading.steps_today == 0


def test_every_time_is_passed_on_in_utc() -> None:
    eastern = timezone(timedelta(hours=-5))
    heart = {**HEART, "measured_at": "2026-11-13T22:12:45-05:00"}
    sleep = {
        **SLEEP,
        "bedtime_at": "2026-11-13T22:40:00-05:00",
        "wake_at": "2026-11-14T06:05:00-05:00",
    }
    receiver = WatchReceiver()

    items = receiver.receive({"heart_rate": [heart], "sleep": [sleep]}, ARRIVED.astimezone(eastern))

    times: list[datetime | None] = [receiver.last_received_at]
    for item in items:
        times.append(item.last_received_at)
        times.extend(time for time in vars(item.reading).values() if isinstance(time, datetime))
    assert len(times) == 6
    assert all(time is not None and time.utcoffset() == timedelta(0) for time in times)


def test_a_deeply_nested_entry_is_refused_without_raising() -> None:
    nested: object = "x"
    for _ in range(20_000):
        nested = [nested]
    receiver = WatchReceiver()

    items = receiver.receive({"heart_rate": [HEART, nested]}, ARRIVED)

    assert len(items) == 1
    assert receiver.refused_count == 1


def test_wrong_shaped_list_keeps_the_kinds_beside_it(caplog: pytest.LogCaptureFixture) -> None:
    receiver = WatchReceiver()

    with caplog.at_level(logging.INFO):
        items = receiver.receive({"heart_rate": "many", "steps": [STEPS]}, ARRIVED)

    assert [item.kind for item in items] == ["steps"]
    assert receiver.refused_count == 1
    summary = caplog.records[-1].getMessage()
    assert "1 readings arrived: 1 passed on, 0 repeats dropped, 0 refused" in summary


def test_an_unexpected_top_level_name_is_warned_about_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    receiver = WatchReceiver()
    batch = {"device_id": "phone-1", "heartRate": [HEART], "activity": [], "steps": [STEPS]}

    with caplog.at_level(logging.WARNING):
        items = receiver.receive(batch, ARRIVED)

    assert [item.kind for item in items] == ["steps"]
    assert receiver.refused_count == 1
    assert len(caplog.records) == 1
    assert "heartRate" in caplog.records[0].getMessage()


def test_refusal_logging_is_bounded(caplog: pytest.LogCaptureFixture) -> None:
    receiver = WatchReceiver()
    very_long_time = {**HEART, "measured_at": "A" * 100_000}
    batch = {"heart_rate": [very_long_time] + [0] * 1000, "heartRate": []}

    with caplog.at_level(logging.WARNING):
        receiver.receive(batch, ARRIVED)

    assert receiver.refused_count == 1002
    messages = [record.getMessage() for record in caplog.records]
    assert len(messages) == settings.WATCH_REFUSALS_LOGGED_PER_BATCH + 1
    assert max(len(message) for message in messages) <= LONGEST_LOG_LINE
    assert "heartRate" in messages[-1]


@pytest.mark.parametrize(("kind", "bad"), ONE_FIELD_MISSING + BAD_READINGS)
def test_malformed_reading_is_refused_and_the_good_one_beside_it_passes(
    kind: str, bad: object, caplog: pytest.LogCaptureFixture
) -> None:
    receiver = WatchReceiver()

    with caplog.at_level(logging.WARNING):
        items = receiver.receive({kind: [bad, GOOD[kind]]}, ARRIVED)

    assert [item.kind for item in items] == [kind]
    assert receiver.refused_count == 1
    assert len(caplog.records) == 1


@pytest.mark.parametrize("batch", [None, [], "text", {"heart_rate": HEART}, {"steps": "many"}])
def test_wrong_shaped_batch_or_list_is_refused_without_raising(
    batch: object, caplog: pytest.LogCaptureFixture
) -> None:
    receiver = WatchReceiver()

    with caplog.at_level(logging.WARNING):
        assert receiver.receive(batch, ARRIVED) == []

    assert receiver.refused_count == 1
    assert receiver.last_received_at is None
    assert len(caplog.records) == 1


@pytest.mark.parametrize(
    ("sent", "passed_on"),
    [
        (72.4, 72),
        (72.5, 73),
        (72.6, 73),
        (130.5, 131),
        (72.0, 72),
        (4503599627370497.0, 4503599627370497),
        (10**400, 10**400),
    ],
)
def test_a_count_is_passed_on_as_a_whole_number(sent: float, passed_on: int) -> None:
    [item] = WatchReceiver().receive({"heart_rate": [{**HEART, "bpm": sent}]}, ARRIVED)

    reading = item.reading
    assert isinstance(reading, HeartRateReading)
    assert reading.bpm == passed_on
    assert type(reading.bpm) is int


def test_a_reading_older_than_the_memory_is_never_passed_on_again(
    caplog: pytest.LogCaptureFixture,
) -> None:
    receiver = WatchReceiver(seen_limit=2)
    history = [{"measured_at": f"2026-11-14T03:1{minute}:00Z", "bpm": 70} for minute in range(3)]
    assert len(receiver.receive({"heart_rate": history}, ARRIVED)) == 3

    assert receiver.receive({"heart_rate": history}, ARRIVED) == []
    older_and_never_sent = {"measured_at": "2026-11-14T03:00:00Z", "bpm": 70}
    with caplog.at_level(logging.WARNING):
        assert receiver.receive({"heart_rate": [older_and_never_sent]}, ARRIVED) == []
    assert "forgotten" in caplog.text


def test_the_memory_keeps_the_newest_times_whatever_order_they_arrive_in() -> None:
    receiver = WatchReceiver(seen_limit=2)
    for time in ("03:30:00", "03:10:00", "03:20:00", "03:15:00"):
        reading = {"measured_at": f"2026-11-14T{time}Z", "bpm": 70}
        assert len(receiver.receive({"heart_rate": [reading]}, ARRIVED)) == 1

    forgotten = {"measured_at": "2026-11-14T03:10:00Z", "bpm": 70}
    assert receiver.receive({"heart_rate": [forgotten]}, ARRIVED) == []


def test_readings_dated_in_the_future_cannot_silence_a_kind() -> None:
    receiver = WatchReceiver(seen_limit=2)
    future = [{"measured_at": f"2990-01-01T00:0{minute}:00Z", "bpm": 70} for minute in range(3)]
    receiver.receive({"heart_rate": future}, ARRIVED)
    genuine = {"measured_at": "2026-11-14T12:30:00Z", "bpm": 190}

    assert len(receiver.receive({"heart_rate": [genuine]}, ARRIVED + timedelta(hours=1))) == 1


def test_the_same_time_under_another_kind_passes_in_a_later_batch() -> None:
    receiver = WatchReceiver()
    receiver.receive({"heart_rate": [HEART]}, ARRIVED)
    steps = {"measured_at": HEART["measured_at"], "steps_today": 9}

    assert len(receiver.receive({"steps": [steps]}, ARRIVED)) == 1


def test_a_full_memory_of_one_kind_keeps_new_readings_of_another() -> None:
    receiver = WatchReceiver(seen_limit=1)
    steps = [{**STEPS, "measured_at": f"2026-11-14T11:2{minute}:00Z"} for minute in range(3)]
    receiver.receive({"steps": steps}, ARRIVED)

    assert len(receiver.receive({"heart_rate": [HEART]}, ARRIVED)) == 1


def test_a_batch_that_fails_part_way_remembers_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(entry: dict[str, object]) -> StepsReading:
        raise RuntimeError

    receiver = WatchReceiver()
    with monkeypatch.context() as patch:
        patch.setitem(watch_receiver._PARSERS, "steps", broken)
        with pytest.raises(RuntimeError):
            receiver.receive({"heart_rate": [HEART, None], "steps": [STEPS]}, ARRIVED)

    assert receiver.refused_count == 0
    assert len(receiver.receive({"heart_rate": [HEART]}, ARRIVED)) == 1


def test_the_summary_counts_every_refused_reading(caplog: pytest.LogCaptureFixture) -> None:
    receiver = WatchReceiver()
    receiver.receive({"heart_rate": [HEART]}, ARRIVED)

    with caplog.at_level(logging.INFO):
        receiver.receive({"heart_rate": [HEART] + [None] * 7, "steps": [STEPS]}, ARRIVED)

    assert "9 readings arrived: 1 passed on, 1 repeats dropped, 7 refused" in caplog.text


@pytest.mark.parametrize(("kind", "bad"), BAD_AND_LONG, ids=BAD_AND_LONG_NAMES)
def test_a_refused_value_is_logged_short_and_on_one_line(
    kind: str, bad: object, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        WatchReceiver().receive({kind: [bad]}, ARRIVED)

    [message] = [record.getMessage() for record in caplog.records]
    assert len(message) <= LONGEST_LOG_LINE
    assert "\n" not in message


def test_an_over_long_name_is_logged_short_and_on_one_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        WatchReceiver().receive({LONG_TEXT: []}, ARRIVED)

    [message] = [record.getMessage() for record in caplog.records]
    assert len(message) <= LONGEST_LOG_LINE
    assert "\n" not in message


def test_a_cut_value_is_exactly_as_long_as_the_limit() -> None:
    wide = [["A" * 1000] * 3] * 3

    assert len(watch_receiver._short(wide)) == settings.WATCH_LOG_VALUE_LIMIT


def test_a_number_too_long_to_write_out_is_refused_without_raising() -> None:
    receiver = WatchReceiver()
    batch: dict[object, object] = {
        10**5000: [],
        "steps": [{**STEPS, "steps_today": -(10**5000)}],
    }

    assert receiver.receive(batch, ARRIVED) == []
    assert receiver.refused_count == 2


def test_every_time_forgotten_in_one_batch_stays_a_repeat_with_one_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    receiver = WatchReceiver(seen_limit=1)
    history = [{"measured_at": f"2026-11-14T03:1{minute}:00Z", "bpm": 70} for minute in range(3)]
    assert len(receiver.receive({"heart_rate": history}, ARRIVED)) == 3

    with caplog.at_level(logging.WARNING):
        assert receiver.receive({"heart_rate": history}, ARRIVED) == []

    [message] = [record.getMessage() for record in caplog.records]
    assert "2 readings were measured at or before a time the receiver has forgotten" in message


def test_the_forgotten_time_never_moves_backwards_when_the_clock_does() -> None:
    receiver = WatchReceiver(seen_limit=2)
    history = [{"measured_at": f"2026-11-14T11:0{minute}:00Z", "bpm": 70} for minute in range(3)]
    receiver.receive({"heart_rate": history}, ARRIVED)
    newer = {"measured_at": "2026-11-14T11:03:00Z", "bpm": 70}
    receiver.receive({"heart_rate": [newer]}, ARRIVED - timedelta(hours=3))

    assert receiver.receive({"heart_rate": [history[0]]}, ARRIVED) == []


def test_the_logging_limit_starts_again_with_each_batch(caplog: pytest.LogCaptureFixture) -> None:
    receiver = WatchReceiver()

    with caplog.at_level(logging.WARNING):
        receiver.receive({"heart_rate": [0] * 10}, ARRIVED)
        receiver.receive({"heart_rate": [0] * 10}, ARRIVED)

    assert len(caplog.records) == 2 * settings.WATCH_REFUSALS_LOGGED_PER_BATCH


def test_names_every_message_carries_are_expected(caplog: pytest.LogCaptureFixture) -> None:
    receiver = WatchReceiver()
    batch = {
        "type": "watch_data",
        "schema_version": 1,
        "msg_id": "message-1",
        "sent_at": "2026-11-14T12:00:00Z",
        "device_id": "phone-1",
        "steps": [STEPS],
    }

    with caplog.at_level(logging.WARNING):
        items = receiver.receive(batch, ARRIVED)

    assert len(items) == 1
    assert receiver.refused_count == 0
    assert caplog.records == []


def test_each_kind_has_its_own_memory() -> None:
    receiver = WatchReceiver(seen_limit=1)
    steps = [
        {"measured_at": f"2026-11-14T11:2{minute}:00Z", "steps_today": 230} for minute in range(3)
    ]
    receiver.receive({"heart_rate": [HEART], "steps": steps}, ARRIVED)

    assert receiver.receive({"heart_rate": [HEART]}, ARRIVED) == []


@pytest.mark.parametrize("seen_limit", [0, -3])
def test_a_memory_limit_below_one_is_the_callers_bug(seen_limit: int) -> None:
    with pytest.raises(ValueError, match="seen_limit"):
        WatchReceiver(seen_limit=seen_limit)


def test_a_batch_of_repeats_logs_one_summary_not_one_line_each(
    caplog: pytest.LogCaptureFixture,
) -> None:
    receiver = WatchReceiver()
    receiver.receive({"heart_rate": [HEART]}, ARRIVED)

    with caplog.at_level(logging.INFO):
        receiver.receive({"heart_rate": [HEART] * 300}, ARRIVED)

    assert len(caplog.records) == 1
    assert "0 passed on, 300 repeats dropped, 0 refused" in caplog.records[0].getMessage()


def test_arrival_time_without_a_time_zone_is_the_callers_bug() -> None:
    with pytest.raises(ValueError, match="time zone"):
        WatchReceiver().receive({"heart_rate": [HEART]}, datetime(2026, 11, 14, 12, 0))
