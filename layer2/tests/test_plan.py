from layer2 import settings
from layer2.contracts import JobStatus, StartMessage, StopMessage
from layer2.coordinator.plan import JobNeed, LaptopView, Placement, Plan, Sensor, rule_plan

CAPTURE = JobNeed("capture", 0.5, "camera")
FALL = JobNeed("fall_model", 2.0, "camera")
SPEECH = JobNeed("speech_to_text", 2.0, "mic")
RULES = JobNeed("care_rules", 0.5, None)
REPORT = JobNeed("report_writer", 4.0, None)


def laptop(node_id: str, free: float, *sensors: Sensor) -> LaptopView:
    return LaptopView(node_id, frozenset(sensors), free)


CAMERA_LAPTOP = laptop("a", 6.0, "camera", "mic")
BIG_LAPTOP = laptop("b", 12.0)


def test_sensor_jobs_go_to_the_sensor_and_the_rest_to_the_most_free_memory() -> None:
    plan = rule_plan(
        [CAPTURE, FALL, SPEECH, RULES], [CAMERA_LAPTOP, BIG_LAPTOP], {"a", "b"}, Plan()
    )
    assert plan.jobs == {
        "capture": "a",
        "fall_model": "a",
        "speech_to_text": "a",
        "care_rules": "b",
    }
    assert plan.dropped == ()


def test_new_placements_spread_by_counting_memory_already_planned() -> None:
    plan = rule_plan([REPORT, RULES], [laptop("a", 6.0), laptop("b", 7.0)], {"a", "b"}, Plan())
    assert plan.jobs == {"report_writer": "b", "care_rules": "a"}


def test_a_job_stays_on_its_laptop_when_another_joins() -> None:
    first = rule_plan([RULES], [CAMERA_LAPTOP], {"a"}, Plan())
    assert first.jobs == {"care_rules": "a"}
    second = rule_plan([RULES], [CAMERA_LAPTOP, BIG_LAPTOP], {"a", "b"}, first)
    assert second.jobs == {"care_rules": "a"}


def test_a_job_stays_on_a_briefly_disconnected_laptop() -> None:
    first = rule_plan([RULES], [CAMERA_LAPTOP], {"a"}, Plan())
    second = rule_plan([RULES], [BIG_LAPTOP], {"a", "b"}, first)
    assert second.jobs == {"care_rules": "a"}


def test_a_sensor_job_moves_when_its_laptop_no_longer_has_the_sensor() -> None:
    first = rule_plan([FALL], [CAMERA_LAPTOP], {"a"}, Plan())
    unplugged = laptop("a", 6.0)
    second = rule_plan([FALL], [unplugged, laptop("c", 4.0, "camera")], {"a", "c"}, first)
    assert second.jobs == {"fall_model": "c"}


def test_jobs_without_their_sensor_are_dropped_with_a_reason() -> None:
    plan = rule_plan([FALL, SPEECH, RULES], [BIG_LAPTOP], {"b"}, Plan())
    assert plan.jobs == {"care_rules": "b"}
    assert [(item.work, "camera" in item.reason) for item in plan.dropped] == [
        ("fall_model", True),
        ("speech_to_text", False),
    ]
    assert all("declined" in item.reason for item in plan.dropped)


def test_nothing_connected_drops_everything() -> None:
    plan = rule_plan([FALL, RULES], [], set(), Plan())
    assert plan.jobs == {}
    assert {item.reason for item in plan.dropped} == {"no worker connected"}


def test_memory_never_drops_a_job() -> None:
    plan = rule_plan([REPORT], [laptop("a", 0.5)], {"a"}, Plan())
    assert plan.jobs == {"report_writer": "a"}


class Clock:
    def __init__(self) -> None:
        self.now = 100.0


def running(*jobs: str) -> list[JobStatus]:
    return [JobStatus(job=job, state="running") for job in jobs]


def placed(needs: list[JobNeed], laptops: list[LaptopView], clock: Clock) -> Placement:
    placement = Placement(lambda: needs, monotonic=lambda: clock.now)
    placement.replan(laptops, {item.node_id for item in laptops})
    return placement


def test_orders_start_what_is_missing_and_stop_what_is_extra() -> None:
    clock = Clock()
    placement = placed([FALL, RULES], [CAMERA_LAPTOP, BIG_LAPTOP], clock)
    orders = placement.orders("a", {"a": running("old_job"), "b": []})
    assert orders == [
        StopMessage(type="stop", schema_version=1, job="old_job"),
        StartMessage(type="start", schema_version=1, job="fall_model"),
    ]
    assert placement.orders("b", {"a": [], "b": running("care_rules")}) == []


def test_orders_are_not_repeated_until_the_resend_time() -> None:
    clock = Clock()
    placement = placed([RULES], [BIG_LAPTOP], clock)
    assert len(placement.orders("b", {"b": []})) == 1
    clock.now += settings.ORDER_RESEND_S - 1
    assert placement.orders("b", {"b": []}) == []
    clock.now += 2
    assert len(placement.orders("b", {"b": []})) == 1


def test_a_moving_job_starts_only_after_the_old_laptop_stops_it() -> None:
    clock = Clock()
    placement = placed([RULES], [BIG_LAPTOP], clock)
    placement.plan = Plan(jobs={"care_rules": "b"})
    reports = {"a": running("care_rules"), "b": []}
    assert placement.orders("b", reports) == []
    assert placement.orders("a", reports) == [
        StopMessage(type="stop", schema_version=1, job="care_rules")
    ]
    assert placement.orders("b", {"a": [], "b": []}) == [
        StartMessage(type="start", schema_version=1, job="care_rules")
    ]
