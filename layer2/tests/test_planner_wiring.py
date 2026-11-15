"""Re-planning in the background with a slow planner, without stalling orders."""

import asyncio
import threading

from layer2.contracts import StartMessage
from layer2.coordinator.plan import JobNeed, LaptopView, Placement, Plan

RULES = JobNeed("care_rules", 0.5, None)
A = LaptopView("a", frozenset(), 8.0)
B = LaptopView("b", frozenset(), 12.0)


def test_a_slow_planner_never_stalls_orders_and_runs_one_at_a_time() -> None:
    release = threading.Event()
    calls: list[list[str]] = []

    def planner(
        needs: list[JobNeed], connected: list[LaptopView], known: set[str], previous: Plan
    ) -> Plan:
        calls.append([laptop.node_id for laptop in connected])
        release.wait(5)
        return Plan(jobs={"care_rules": connected[-1].node_id})

    laptops = [A]

    async def scenario() -> None:
        placement = Placement(lambda: [RULES], planner=planner)
        placement.plan = Plan(jobs={"care_rules": "a"})
        placement.request_replan(lambda: (list(laptops), {"a", "b"}))
        laptops.append(B)
        placement.request_replan(lambda: (list(laptops), {"a", "b"}))
        await asyncio.sleep(0.1)
        # the planner is thinking: the current plan still answers
        assert placement.orders("a", {"a": [], "b": []}) == [
            StartMessage(type="start", schema_version=1, job="care_rules")
        ]
        assert len(calls) == 1
        release.set()
        for _ in range(100):
            if len(calls) == 2 and placement.plan.jobs == {"care_rules": "b"}:
                break
            await asyncio.sleep(0.02)
        assert calls == [["a", "b"], ["a", "b"]]  # each read the laptops when it started
        assert placement.plan.jobs == {"care_rules": "b"}

    asyncio.run(scenario())


def test_without_a_planner_the_rule_plan_is_made_at_once() -> None:
    async def scenario() -> None:
        placement = Placement(lambda: [RULES])
        placement.request_replan(lambda: ([A], {"a"}))
        assert placement.plan.jobs == {"care_rules": "a"}

    asyncio.run(scenario())
