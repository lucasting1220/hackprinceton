"""Where each job runs: the rule-based plan, and the orders that make workers match it.

The rule-based plan (docs/layer2-device-management.md, "Fallback"): a job that needs the camera
or mic goes to a connected laptop holding that sensor; every other job goes to the connected
laptop with the most free memory, counting what this plan already put there (largest jobs
first). Nothing is split.
A job stays where it is while its laptop is still known, so a laptop joining does not shuffle
running work. A job is dropped only when no laptop can hold it: the safety work is never
dropped for memory (the dashboard shows the memory instead).

The plan is made when a laptop joins, not on every status. Orders are worked out from each
worker's status: `start` for a planned job it is not running, `stop` for one it runs but
should not. A job moving between laptops starts on the new one only after no other laptop
reports it, so it is stopped first and started second. An order not acted on is sent again
after ORDER_RESEND_S.
"""

import asyncio
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from layer2 import settings
from layer2.contracts import DroppedWork, JobStatus, StartMessage, StopMessage

Sensor = Literal["camera", "mic"]
Order = StartMessage | StopMessage


@dataclass(frozen=True)
class JobNeed:
    """What a job asks of a laptop, from its description file."""

    name: str
    memory_gb: float
    sensor: Sensor | None


@dataclass(frozen=True)
class LaptopView:
    """A connected worker as the planner sees it."""

    node_id: str
    sensors: frozenset[Sensor]
    memory_free_gb: float


@dataclass(frozen=True)
class Plan:
    jobs: dict[str, str] = field(default_factory=dict)
    """Job name to node_id."""
    dropped: tuple[DroppedWork, ...] = ()


def rule_plan(
    needs: Iterable[JobNeed],
    connected: list[LaptopView],
    known: set[str],
    previous: Plan,
) -> Plan:
    """`known` is every laptop seen since start, connected or not: a job placed on a laptop
    that is briefly disconnected is probably still running there, so it stays."""
    free = {laptop.node_id: laptop.memory_free_gb for laptop in connected}
    by_id = {laptop.node_id: laptop for laptop in connected}
    jobs: dict[str, str] = {}
    dropped: list[DroppedWork] = []
    for need in sorted(needs, key=lambda need: (-need.memory_gb, need.name)):
        kept = previous.jobs.get(need.name)
        if kept is not None and kept in known and _can_hold(by_id.get(kept), need):
            jobs[need.name] = kept
            continue
        able = [
            laptop for laptop in connected if need.sensor is None or need.sensor in laptop.sensors
        ]
        if not able:
            reason = (
                "no worker connected"
                if need.sensor is None or not connected
                else f"no laptop has a {need.sensor} (none attached, or the resident declined it)"
            )
            dropped.append(DroppedWork(work=need.name, reason=reason))
            continue
        chosen = max(able, key=lambda laptop: (free[laptop.node_id], laptop.node_id))
        free[chosen.node_id] -= need.memory_gb
        jobs[need.name] = chosen.node_id
    return Plan(jobs=jobs, dropped=tuple(dropped))


def _can_hold(laptop: LaptopView | None, need: JobNeed) -> bool:
    """A disconnected laptop (None) keeps its jobs; a connected one must still have the sensor."""
    return laptop is None or need.sensor is None or need.sensor in laptop.sensors


@dataclass(frozen=True)
class Decision:
    """The latest re-plan, for the dashboard: who made it, why, when, and what moved."""

    made_by: Literal["ai", "rules"]
    why: str
    decided_at: datetime
    moved: tuple[str, ...]


Planner = Callable[[list[JobNeed], list[LaptopView], set[str], Plan], tuple[Plan, str, str]]
"""Makes a plan and says who made it and why; may block for a long time (the AI planner), so
it runs in a thread."""
Snapshot = Callable[[], tuple[list[LaptopView], set[str]]]
"""The connected laptops and every known laptop, read when a plan starts."""


class Placement:
    """The current plan, and which orders each worker needs to match it.

    Without a `planner`, re-planning is the rule-based plan, made at once. With one (the AI
    planner), each re-plan runs in a thread, one at a time, reading the laptops when it
    starts; the current plan keeps answering orders until the new one is ready.
    """

    def __init__(
        self,
        needs: Callable[[], list[JobNeed]],
        monotonic: Callable[[], float] = time.monotonic,
        planner: Planner | None = None,
    ) -> None:
        self._needs = needs
        self._monotonic = monotonic
        self._planner = planner
        self.plan = Plan()
        self.decision: Decision | None = None
        self._sent: dict[tuple[str, str, str], float] = {}
        self._planning = asyncio.Lock()
        self._tasks: set[asyncio.Task[None]] = set()

    def replan(self, connected: list[LaptopView], known: set[str]) -> None:
        self._use(rule_plan(self._needs(), connected, known, self.plan), "rules", "rule-based plan")

    def _use(self, plan: Plan, made_by: str, why: str) -> None:
        moved = tuple(
            sorted(job for job, node in plan.jobs.items() if self.plan.jobs.get(job, node) != node)
        )
        self.decision = Decision(
            made_by="ai" if made_by == "ai" else "rules",
            why=why,
            decided_at=datetime.now(UTC),
            moved=moved,
        )
        self.plan = plan

    def request_replan(self, snapshot: Snapshot) -> None:
        """Re-plan now (rules) or in the background (a planner). Call from the event loop."""
        if self._planner is None:
            self.replan(*snapshot())
            return
        task = asyncio.create_task(self._replan_in_background(self._planner, snapshot))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _replan_in_background(self, planner: Planner, snapshot: Snapshot) -> None:
        async with self._planning:
            connected, known = snapshot()
            needs = self._needs()
            plan, made_by, why = await asyncio.to_thread(
                planner, needs, connected, known, self.plan
            )
            self._use(plan, made_by, why)

    def orders(self, node_id: str, reports: dict[str, list[JobStatus]]) -> list[Order]:
        """The orders for `node_id`, given the latest job reports of every connected laptop.
        Stops come before starts."""
        running = {job.job for job in reports.get(node_id, [])}
        elsewhere = {job.job for other, jobs in reports.items() if other != node_id for job in jobs}
        wanted = {job for job, owner in self.plan.jobs.items() if owner == node_id}
        orders: list[Order] = []
        for job in sorted(running - wanted):
            if self._due(node_id, "stop", job):
                orders.append(StopMessage(type="stop", schema_version=1, job=job))
        for job in sorted(wanted - running - elsewhere):
            if self._due(node_id, "start", job):
                orders.append(StartMessage(type="start", schema_version=1, job=job))
        return orders

    def _due(self, node_id: str, kind: str, job: str) -> bool:
        now = self._monotonic()
        key = (node_id, kind, job)
        sent = self._sent.get(key)
        if sent is not None and now - sent < settings.ORDER_RESEND_S:
            return False
        self._sent[key] = now
        return True
