import json
import time
from pathlib import Path

import pytest
from conftest import FakeGemini, closed_port

from layer2 import settings
from layer2.coordinator.ai_plan import PlanError, choose_plan, parse_and_check
from layer2.coordinator.plan import JobNeed, LaptopView, Plan, Sensor

CAPTURE = JobNeed("capture", 0.5, "camera")
FALL = JobNeed("fall_model", 2.0, "camera")
SPEECH = JobNeed("speech_to_text", 2.0, "mic")
RULES = JobNeed("care_rules", 0.5, None)
NEEDS = [CAPTURE, FALL, RULES]


def laptop(node_id: str, free: float, *sensors: Sensor) -> LaptopView:
    return LaptopView(node_id, frozenset(sensors), free)


A = laptop("a", 8.0, "camera")
B = laptop("b", 12.0)


def answer(jobs: dict[str, str], reasoning: str = "camera jobs on a") -> str:
    return json.dumps(
        {
            "jobs": [{"job": job, "node_id": node} for job, node in jobs.items()],
            "reasoning": reasoning,
        }
    )


GOOD = {"capture": "a", "fall_model": "a", "care_rules": "b"}


def test_a_good_plan_is_used_as_given() -> None:
    plan, reasoning = parse_and_check(answer(GOOD), NEEDS, [A, B], Plan())
    assert plan.jobs == GOOD and plan.dropped == ()
    assert reasoning == "camera jobs on a"


@pytest.mark.parametrize(
    ("jobs", "why"),
    [
        ({**GOOD, "unknown_job": "a"}, "unknown job"),
        ({**GOOD, "care_rules": "c"}, "not a connected laptop"),
        ({**GOOD, "fall_model": "b"}, "needs the camera"),
        ({"capture": "a", "fall_model": "a"}, "placeable work left out: care_rules"),
    ],
)
def test_plans_that_break_a_rule_are_rejected(jobs: dict[str, str], why: str) -> None:
    with pytest.raises(PlanError, match=why):
        parse_and_check(answer(jobs), NEEDS, [A, B], Plan())


def test_memory_must_fit_with_headroom_but_jobs_already_there_do_not_count() -> None:
    small = laptop("a", 2.0, "camera")
    with pytest.raises(PlanError, match="GB"):
        parse_and_check(answer(GOOD), NEEDS, [small, B], Plan())
    already = Plan(jobs={"capture": "a", "fall_model": "a"})
    plan, _ = parse_and_check(answer(GOOD), NEEDS, [small, B], already)
    assert plan.jobs == GOOD


def test_unplaceable_work_is_dropped_by_the_codes_reason() -> None:
    plan, _ = parse_and_check(answer({"care_rules": "b"}), [SPEECH, RULES], [A, B], Plan())
    assert [(item.work, "mic" in item.reason) for item in plan.dropped] == [
        ("speech_to_text", True)
    ]


@pytest.mark.parametrize("text", ["not json", "[]", '{"jobs": "x"}', '{"jobs": [1]}'])
def test_answers_that_are_not_a_plan_are_rejected(text: str) -> None:
    with pytest.raises(PlanError):
        parse_and_check(text, NEEDS, [A, B], Plan())


KEY = "test-key"


def test_the_ai_plan_is_used_when_it_passes(fake_gemini: type[FakeGemini], tmp_path: Path) -> None:
    fake_gemini.text = answer(GOOD)
    plan, made_by, why = choose_plan(
        KEY, NEEDS, [A, B], {"a", "b"}, Plan(), tmp_path / "planner.log"
    )
    assert (plan.jobs, made_by, why) == (GOOD, "ai", "camera jobs on a")
    [request] = fake_gemini.seen
    assert request["path"] == f"/v1beta/models/{settings.PLANNER_MODEL}:generateContent"
    assert request["key"] == KEY
    assert request["body"]["generationConfig"] == {"responseMimeType": "application/json"}
    assert "AI plan used" in (tmp_path / "planner.log").read_text("utf-8")


def test_a_bad_or_late_ai_plan_falls_back_to_the_rules(
    fake_gemini: type[FakeGemini], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_gemini.text = answer({**GOOD, "fall_model": "b"})
    plan, made_by, why = choose_plan(
        KEY, NEEDS, [A, B], {"a", "b"}, Plan(), tmp_path / "planner.log"
    )
    assert made_by == "rules" and plan.jobs["fall_model"] == "a"
    assert "needs the camera" in why
    assert "needs the camera" in (tmp_path / "planner.log").read_text("utf-8")
    monkeypatch.setattr(settings, "PLANNER_TIMEOUT_S", 0.2)
    fake_gemini.text = answer(GOOD)
    fake_gemini.delay = 1.0
    started = time.monotonic()
    _, made_by, why = choose_plan(KEY, NEEDS, [A, B], {"a", "b"}, Plan())
    assert made_by == "rules" and time.monotonic() - started < 1.0
    assert "did not answer" in why


def test_no_key_gemini_down_or_nothing_to_plan_uses_the_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "GEMINI_URL", f"http://127.0.0.1:{closed_port()}")
    assert choose_plan(None, NEEDS, [A, B], {"a", "b"}, Plan())[1:] == (
        "rules",
        "the coordinator has no Gemini API key",
    )
    assert choose_plan(KEY, NEEDS, [A, B], {"a", "b"}, Plan())[1] == "rules"
    assert choose_plan(KEY, [], [A, B], {"a", "b"}, Plan()) == (
        Plan(),
        "rules",
        "nothing to place yet",
    )
