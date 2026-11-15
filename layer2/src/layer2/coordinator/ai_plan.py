"""The AI planner (docs/layer2-device-management.md, "The plan"), with code checks and the
rule-based fallback.

The coordinator's own Ollama, with PLANNER_MODEL, is given each connected laptop (sensors and
free memory), the jobs Layers 3 and 4 asked for, and the previous plan, and returns where each
job runs as JSON. Code checks every plan before it is used:
- every job named exists, and every laptop named is connected;
- a job needing the camera or mic is on a laptop holding it;
- the jobs it newly places on a laptop fit in that laptop's free memory, with
  PLAN_MEMORY_HEADROOM_GB left for the operating system;
- the safety work is all placed: every job some connected laptop could hold must be placed.
What is left out is listed as dropped with the reason the code works out, not the model's.
If the plan fails a check, the model takes longer than PLANNER_TIMEOUT_S, or Ollama is
unreachable, the rule-based plan is used at once. The model's reasoning goes to the planner
log file, never to the dashboard.
"""

import json
import logging
from pathlib import Path
from typing import Any

from layer2 import settings
from layer2.coordinator.plan import JobNeed, LaptopView, Plan, rule_plan
from layer2.ollama import ModelError, generate

log = logging.getLogger(__name__)


class PlanError(Exception):
    """The model's plan cannot be used; the message says why."""


def choose_plan(
    ollama_url: str,
    needs: list[JobNeed],
    connected: list[LaptopView],
    known: set[str],
    previous: Plan,
    planner_log: Path | None = None,
) -> tuple[Plan, str]:
    """The AI's plan if it passes every check, else the rule-based plan. Returns the plan and
    which planner made it ("ai" or "rules"). Blocks for up to PLANNER_TIMEOUT_S."""
    fallback = rule_plan(needs, connected, known, previous)
    if not needs or not connected:
        return fallback, "rules"
    prompt = planner_prompt(needs, connected, previous)
    try:
        text = generate(
            ollama_url,
            settings.PLANNER_MODEL,
            prompt,
            timeout=settings.PLANNER_TIMEOUT_S,
            json_only=True,
        )
        plan, reasoning = parse_and_check(text, needs, connected, previous)
    except (ModelError, PlanError) as error:
        _note(planner_log, f"rule-based plan used: {error}")
        log.info("L2 coordinator: planner fell back to the rule-based plan: %s", error)
        return fallback, "rules"
    _note(planner_log, f"AI plan used: {json.dumps(plan.jobs, sort_keys=True)}; {reasoning}")
    return plan, "ai"


def planner_prompt(needs: list[JobNeed], connected: list[LaptopView], previous: Plan) -> str:
    facts = {
        "laptops": [
            {
                "node_id": laptop.node_id,
                "sensors": sorted(laptop.sensors),
                "memory_free_gb": laptop.memory_free_gb,
            }
            for laptop in connected
        ],
        "jobs": [
            {"job": need.name, "memory_gb": need.memory_gb, "sensor": need.sensor} for need in needs
        ],
        "previous_plan": [{"job": job, "node_id": node} for job, node in previous.jobs.items()],
    }
    return (
        "You place the jobs of a home safety system on laptops. Rules: a job with a sensor "
        "must run on a laptop that has that sensor; every job that can be placed must be "
        "placed; keep jobs where the previous plan put them unless a rule forces a move; "
        f"leave {settings.PLAN_MEMORY_HEADROOM_GB} GB free on each laptop; spread the rest by "
        "free memory. Answer with JSON only, in this shape: "
        '{"jobs": [{"job": "<name>", "node_id": "<id>"}], "reasoning": "<one sentence>"}.\n'
        f"Facts: {json.dumps(facts)}"
    )


def parse_and_check(
    text: str, needs: list[JobNeed], connected: list[LaptopView], previous: Plan
) -> tuple[Plan, str]:
    """The model's answer as a Plan, after every check; raises PlanError otherwise."""
    try:
        answer: Any = json.loads(text)
    except ValueError:
        raise PlanError("the answer is not JSON") from None
    if not isinstance(answer, dict) or not isinstance(answer.get("jobs"), list):
        raise PlanError("the answer has no jobs list")
    by_name = {need.name: need for need in needs}
    by_id = {laptop.node_id: laptop for laptop in connected}
    jobs: dict[str, str] = {}
    for entry in answer["jobs"]:
        if not isinstance(entry, dict):
            raise PlanError("a jobs entry is not an object")
        job, node = entry.get("job"), entry.get("node_id")
        if not isinstance(job, str) or job not in by_name:
            raise PlanError(f"unknown job {str(job)[:64]!r}")
        if not isinstance(node, str) or node not in by_id:
            raise PlanError(f"job {job} is on {str(node)[:64]!r}, which is not a connected laptop")
        if job in jobs:
            raise PlanError(f"job {job} is placed twice")
        sensor = by_name[job].sensor
        if sensor is not None and sensor not in by_id[node].sensors:
            raise PlanError(f"job {job} needs the {sensor}, which {node} does not have")
        jobs[job] = node
    _check_memory(jobs, by_name, by_id, previous)
    dropped = rule_plan(
        [need for need in needs if need.name not in jobs], connected, set(by_id), Plan()
    )
    if dropped.jobs:
        raise PlanError(f"placeable work left out: {', '.join(sorted(dropped.jobs))}")
    reasoning = answer.get("reasoning")
    return Plan(jobs=jobs, dropped=dropped.dropped), str(reasoning)[:500] if reasoning else ""


def _check_memory(
    jobs: dict[str, str],
    needs: dict[str, JobNeed],
    laptops: dict[str, LaptopView],
    previous: Plan,
) -> None:
    """Jobs already running on a laptop are in its free memory figure; only new ones count."""
    added: dict[str, float] = {}
    for job, node in jobs.items():
        if previous.jobs.get(job) != node:
            added[node] = added.get(node, 0.0) + needs[job].memory_gb
    for node, gb in added.items():
        room = laptops[node].memory_free_gb - settings.PLAN_MEMORY_HEADROOM_GB
        if gb > room:
            raise PlanError(f"{node} would need {gb:.1f} GB more but has {room:.1f} GB to spare")


def _note(planner_log: Path | None, line: str) -> None:
    if planner_log is None:
        return
    try:
        with planner_log.open("a", encoding="utf-8") as file:
            file.write(line + "\n")
    except OSError as error:
        log.warning("L2 coordinator: could not write the planner log: %s", error)
