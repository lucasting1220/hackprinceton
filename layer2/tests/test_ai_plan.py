import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from conftest import closed_port

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


class _Planner(BaseHTTPRequestHandler):
    reply = b""
    delay = 0.0
    seen: list[dict[str, Any]] = []

    def do_POST(self) -> None:
        type(self).seen.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        time.sleep(self.delay)
        body = json.dumps({"response": self.reply.decode()}).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass  # the coordinator gave up waiting

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def planner() -> Iterator[tuple[str, type[_Planner]]]:
    class handler(_Planner):
        seen: list[dict[str, Any]] = []

    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", handler
    server.shutdown()
    server.server_close()
    thread.join()


def test_the_ai_plan_is_used_when_it_passes(
    planner: tuple[str, type[_Planner]], tmp_path: Path
) -> None:
    url, handler = planner
    handler.reply = answer(GOOD).encode()
    plan, made_by, why = choose_plan(
        url, NEEDS, [A, B], {"a", "b"}, Plan(), tmp_path / "planner.log"
    )
    assert (plan.jobs, made_by, why) == (GOOD, "ai", "camera jobs on a")
    [request] = handler.seen
    assert (request["model"], request["format"], request["stream"]) == (
        settings.PLANNER_MODEL,
        "json",
        False,
    )
    assert "AI plan used" in (tmp_path / "planner.log").read_text("utf-8")


def test_a_bad_or_late_ai_plan_falls_back_to_the_rules(
    planner: tuple[str, type[_Planner]], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url, handler = planner
    handler.reply = answer({**GOOD, "fall_model": "b"}).encode()
    plan, made_by, why = choose_plan(
        url, NEEDS, [A, B], {"a", "b"}, Plan(), tmp_path / "planner.log"
    )
    assert made_by == "rules" and plan.jobs["fall_model"] == "a"
    assert "needs the camera" in why
    assert "needs the camera" in (tmp_path / "planner.log").read_text("utf-8")
    monkeypatch.setattr(settings, "PLANNER_TIMEOUT_S", 0.2)
    handler.reply = answer(GOOD).encode()
    handler.delay = 1.0
    started = time.monotonic()
    _, made_by, why = choose_plan(url, NEEDS, [A, B], {"a", "b"}, Plan())
    assert made_by == "rules" and time.monotonic() - started < 1.0
    assert "did not answer" in why


def test_no_ollama_or_nothing_to_plan_uses_the_rules_without_asking() -> None:
    down = f"http://127.0.0.1:{closed_port()}"
    assert choose_plan(down, NEEDS, [A, B], {"a", "b"}, Plan())[1] == "rules"
    assert choose_plan(down, [], [A, B], {"a", "b"}, Plan()) == (
        Plan(),
        "rules",
        "nothing to place yet",
    )
