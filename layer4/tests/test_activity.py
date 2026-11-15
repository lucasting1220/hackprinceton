import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeEventLog, FakePhone
from test_layer2_ports import FakeClient

from layer4 import settings
from layer4.fall import Activity
from layer4.health_check import HealthCheck, LatestHealth
from layer4.jobs.fall_model import ActivityReporter
from layer4.jobs.health_check import ActivityWatcher
from layer4.layer2_ports import Layer2EventLog
from layer4.live_status import live_status
from layer4.ports import PortError
from layer4.records import activity_from_record, activity_record
from layer4.requests import question_prompt, summary
from layer4.upper_tier import UpperTier

T0 = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def test_an_activity_record_reads_back_as_written() -> None:
    record = activity_record(Activity.LYING_DOWN, T0)
    assert record == {
        "schema_version": 1,
        "type": "activity",
        "activity": "lying_down",
        "since": "2026-11-14T03:12:00Z",
    }
    assert activity_from_record(record) == (Activity.LYING_DOWN, T0)


@pytest.mark.parametrize(
    "record",
    [
        {**activity_record(Activity.SITTING, T0), "activity": "dancing"},
        {**activity_record(Activity.SITTING, T0), "type": "event"},
        {**activity_record(Activity.SITTING, T0), "schema_version": 2},
        {**activity_record(Activity.SITTING, T0), "since": "2026-11-14T03:12:00"},
    ],
    ids=["unknown-activity", "wrong-type", "version-2", "no-time-zone"],
)
def test_a_bad_activity_record_is_refused(record: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        activity_from_record(record)


def rows(*records: dict[str, object]) -> list[Mapping[str, object]]:
    return [{"logged_at": "2026-11-14T03:12:00Z", "event": record} for record in records]


def test_the_newest_activity_is_read_from_the_log_and_other_records_ignored() -> None:
    client = FakeClient()
    client.rows = rows(
        activity_record(Activity.WALKING, at(0)),
        {"type": "event", "kind": "fall"},
        activity_record(Activity.LYING_DOWN, at(60)),
        {**activity_record(Activity.SITTING, at(90)), "activity": "dancing"},
        activity_record(Activity.SITTING, at(30)),
    )
    assert Layer2EventLog(client).latest_activity(T0) == (Activity.LYING_DOWN, at(60))


def test_activity_records_are_not_warned_about_when_reading_events(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = FakeClient()
    client.rows = rows(activity_record(Activity.WALKING, T0))
    with caplog.at_level(logging.WARNING):
        assert Layer2EventLog(client).read_since(T0) == []
    assert caplog.text == ""


def test_writing_and_reading_activity_report_layer_2_failures_as_port_errors() -> None:
    log = Layer2EventLog(FakeClient(fail=True))
    with pytest.raises(PortError):
        log.append_activity(Activity.WALKING, T0)
    with pytest.raises(PortError):
        log.latest_activity(T0)


class ActivityLog:
    def __init__(self, fail: bool = False) -> None:
        self.written: list[tuple[Activity, datetime]] = []
        self.fail = fail

    def append_activity(self, state: Activity, since: datetime) -> None:
        if self.fail:
            raise PortError("coordinator unreachable")
        self.written.append((state, since))


def feed(reporter: ActivityReporter, states: list[tuple[float, Activity]]) -> None:
    for seconds, state in states:
        reporter.update(state, at(seconds))


def test_an_activity_is_written_once_it_has_held_and_only_once() -> None:
    log = ActivityLog()
    reporter = ActivityReporter(log, stable=timedelta(seconds=2))
    feed(
        reporter,
        [
            (0, Activity.WALKING),
            (1, Activity.WALKING),
            (2, Activity.WALKING),
            (5, Activity.WALKING),
        ],
    )
    assert log.written == [(Activity.WALKING, at(0))]


def test_a_flicker_is_not_written_and_a_real_change_is() -> None:
    log = ActivityLog()
    reporter = ActivityReporter(log, stable=timedelta(seconds=2))
    feed(
        reporter,
        [
            (0, Activity.WALKING),
            (2, Activity.WALKING),
            (3, Activity.SITTING),
            (3.5, Activity.WALKING),
            (4, Activity.WALKING),
        ],
    )
    feed(
        reporter, [(10, Activity.LYING_DOWN), (11, Activity.LYING_DOWN), (12, Activity.LYING_DOWN)]
    )
    assert log.written == [(Activity.WALKING, at(0)), (Activity.LYING_DOWN, at(10))]


def test_nothing_is_written_before_an_activity_has_held_for_the_stable_time() -> None:
    log = ActivityLog()
    reporter = ActivityReporter(log, stable=timedelta(seconds=2))
    feed(reporter, [(0, Activity.WALKING), (1, Activity.WALKING)])
    assert log.written == []
    feed(
        reporter,
        [
            (2, Activity.WALKING),
            (3, Activity.SITTING),
            (4, Activity.SITTING),
            (4.5, Activity.WALKING),
        ],
    )
    assert log.written == [(Activity.WALKING, at(0))]


def test_no_reading_yet_writes_nothing_and_a_failed_write_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    reporter = ActivityReporter(ActivityLog(fail=True), stable=timedelta(seconds=2))
    reporter.update(None, None)
    feed(reporter, [(0, Activity.SITTING), (3, Activity.SITTING)])
    assert "activity not logged" in caplog.text


def check() -> HealthCheck:
    return HealthCheck(UpperTier(settings.RuleThresholds(), FakeEventLog(), FakePhone()))


def test_the_health_check_keeps_the_newest_activity_and_says_when_it_changed() -> None:
    health = check()
    assert health.set_activity(Activity.WALKING, at(0)) is True
    assert health.set_activity(Activity.WALKING, at(30)) is False
    assert health.set_activity(Activity.LYING_DOWN, at(10)) is False
    assert health.latest.activity == Activity.WALKING
    assert health.set_activity(Activity.LYING_DOWN, at(60)) is True
    assert (health.latest.activity, health.latest.activity_since) == (Activity.LYING_DOWN, at(60))


class Source:
    def __init__(self, found: tuple[Activity, datetime] | None, fail: bool = False) -> None:
        self.found = found
        self.fail = fail
        self.asked: list[datetime] = []

    def latest_activity(self, since: datetime) -> tuple[Activity, datetime] | None:
        self.asked.append(since)
        if self.fail:
            raise PortError("coordinator unreachable")
        return self.found


def test_the_watcher_looks_back_an_hour_first_then_from_its_last_look() -> None:
    health = check()
    source = Source((Activity.SITTING, at(0)))
    watcher = ActivityWatcher(health, source, lookback=timedelta(hours=1))
    assert watcher.poll(at(10)) is True
    assert watcher.poll(at(15)) is False
    margin = timedelta(seconds=settings.ACTIVITY_POLL_S)
    assert source.asked == [at(10) - timedelta(hours=1) - margin, at(10) - margin]
    assert health.latest.activity == Activity.SITTING


def test_the_watcher_reports_no_change_when_the_log_cannot_be_read() -> None:
    health = check()
    assert ActivityWatcher(health, Source(None, fail=True)).poll(at(10)) is False
    assert ActivityWatcher(health, Source(None)).poll(at(10)) is False


def test_live_status_and_answers_carry_the_activity() -> None:
    latest = LatestHealth(activity=Activity.LYING_DOWN, activity_since=at(0))
    assert live_status(latest, at(60))["activity"] == {
        "state": "lying_down",
        "at": "2026-11-14T03:12:00Z",
    }
    assert summary(latest, UTC) == "Activity: lying down since 3:12 AM on Nov 14."
    prompt = question_prompt("Is she up yet?", latest, UTC)
    assert "- Activity: lying down since 3:12 AM on Nov 14." in prompt


def test_the_answer_prompt_forbids_judging_readings_and_medical_advice() -> None:
    prompt = question_prompt("Is her heart rate okay?", LatestHealth(), UTC)
    assert "Do not say whether a reading is normal, high, low or worrying" in prompt
    assert "do not give\nmedical advice" in prompt
