"""Every laptop seen since the coordinator started, and which connection is current for each.

All methods run on the coordinator's one event loop, so nothing here locks.
"""

import logging
import time
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from layer2 import settings
from layer2.contracts import (
    ApiState,
    DashboardDetails,
    DroppedWork,
    HardwareState,
    Hello,
    JobEntry,
    JobHealth,
    JobStatus,
    Laptop,
    LaptopHardware,
    MissingItem,
    Specs,
    StatusMessage,
    Tools,
)
from layer2.coordinator.plan import LaptopView

log = logging.getLogger(__name__)

Sensor = Literal["camera", "mic"]


def _utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class _Entry[C]:
    display_name: str
    sensors: list[Sensor]
    specs: Specs
    tools: Tools
    last_status_at: datetime
    memory_free_gb: float | None = None
    cpu_percent: float | None = None
    missing: list[MissingItem] = field(default_factory=list)
    jobs: list[JobStatus] = field(default_factory=list)
    connection: C | None = None
    replacements: deque[float] = field(default_factory=deque)
    warned_at: float | None = None


def _sensor_kinds(hello: Hello) -> list[Sensor]:
    kinds: list[Sensor] = []
    if hello.sensors.camera is not None:
        kinds.append("camera")
    if hello.sensors.mic is not None:
        kinds.append("mic")
    return kinds


class Registry[C]:
    """`C` is whatever stands for a connection; the server passes its WebSocket objects."""

    def __init__(
        self,
        now: Callable[[], datetime] = _utc_now,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._now = now
        self._monotonic = monotonic
        self._laptops: dict[str, _Entry[C]] = {}

    def join(self, node_id: str, hello: Hello, connection: C) -> C | None:
        """Register an accepted hello. Returns the laptop's previous connection, to be closed.

        Only status messages advance last_status_at of a known laptop, so one that keeps
        rejoining without ever reporting still goes quiet. Its missing and jobs lists are
        cleared until the new connection reports.
        """
        entry = self._laptops.get(node_id)
        if entry is None:
            self._laptops[node_id] = _Entry(
                display_name=hello.display_name,
                sensors=_sensor_kinds(hello),
                specs=hello.specs,
                tools=hello.tools,
                last_status_at=self._now(),
                connection=connection,
            )
            return None
        previous = entry.connection
        entry.display_name = hello.display_name
        entry.sensors = _sensor_kinds(hello)
        entry.specs = hello.specs
        entry.tools = hello.tools
        entry.missing = []
        entry.memory_free_gb = None
        entry.cpu_percent = None
        entry.jobs = []
        entry.connection = connection
        if previous is not None:
            self._count_replacement(node_id, entry)
        return previous

    def _count_replacement(self, node_id: str, entry: _Entry[C]) -> None:
        now = self._monotonic()
        entry.replacements.append(now)
        while (
            entry.replacements and now - entry.replacements[0] > settings.REPLACEMENT_WARN_WINDOW_S
        ):
            entry.replacements.popleft()
        window = settings.REPLACEMENT_WARN_WINDOW_S
        recently_warned = entry.warned_at is not None and now - entry.warned_at < window
        if len(entry.replacements) > settings.REPLACEMENT_WARN_COUNT and not recently_warned:
            entry.warned_at = now
            log.warning(
                "L2 coordinator: laptop %s replaced its connection %d times in %.0f s; "
                "two workers may share one token",
                node_id,
                len(entry.replacements),
                settings.REPLACEMENT_WARN_WINDOW_S,
            )

    def is_current(self, node_id: str, connection: C) -> bool:
        entry = self._laptops.get(node_id)
        return entry is not None and entry.connection is connection

    def status(self, node_id: str, connection: C, message: StatusMessage) -> None:
        """Record a status message, timed by the coordinator's own clock. Ignored if
        `connection` has been replaced."""
        if not self.is_current(node_id, connection):
            return
        entry = self._laptops[node_id]
        entry.last_status_at = self._now()
        entry.missing = list(message.missing)
        entry.jobs = list(message.jobs)
        entry.memory_free_gb = message.memory_free_gb
        entry.cpu_percent = message.cpu_percent

    def leave(self, node_id: str, connection: C) -> None:
        """The connection closed. The laptop stays listed with its last status time."""
        if self.is_current(node_id, connection):
            self._laptops[node_id].connection = None

    def forget_except(self, accepted: set[str]) -> tuple[list[str], list[C]]:
        """Forget every laptop not in `accepted` (taken out of accepted-workers.json). Returns
        the forgotten node IDs, and their open connections, to be closed."""
        gone = [node_id for node_id in self._laptops if node_id not in accepted]
        connections = []
        for node_id in gone:
            connection = self._laptops.pop(node_id).connection
            if connection is not None:
                connections.append(connection)
        return gone, connections

    def connected(self) -> list[LaptopView]:
        """Laptops with a current connection, for the planner. Memory is 0 until the first
        status arrives."""
        return [
            LaptopView(
                node_id=node_id,
                sensors=frozenset(entry.sensors),
                memory_free_gb=entry.memory_free_gb or 0.0,
            )
            for node_id, entry in self._laptops.items()
            if entry.connection is not None
        ]

    def known(self) -> set[str]:
        return set(self._laptops)

    def job_reports(self) -> dict[str, list[JobStatus]]:
        """The latest jobs each connected laptop reported."""
        return {
            node_id: list(entry.jobs)
            for node_id, entry in self._laptops.items()
            if entry.connection is not None
        }

    def api_state(self, dropped: Iterable[DroppedWork] = ()) -> ApiState:
        return ApiState(
            schema_version=1,
            updated_at=self._now(),
            laptops=[
                Laptop(
                    node_id=node_id,
                    display_name=entry.display_name,
                    last_status_at=entry.last_status_at,
                    sensors=entry.sensors,
                    missing=entry.missing,
                )
                for node_id, entry in self._laptops.items()
            ],
            jobs=[
                JobEntry(job=job.job, node_id=node_id, state=job.state)
                for node_id, entry in self._laptops.items()
                for job in entry.jobs
            ],
            dropped=list(dropped),
        )

    def details(self) -> DashboardDetails:
        """For the dashboard: each job's health as its laptop last reported it."""
        return DashboardDetails(
            schema_version=1,
            updated_at=self._now(),
            jobs=[
                JobHealth(job=job.job, node_id=node_id, state=job.state, restarts=job.restarts)
                for node_id, entry in self._laptops.items()
                for job in entry.jobs
            ],
        )

    def hardware(self) -> HardwareState:
        """What each laptop has (from its hello) and its latest load (from its last status;
        None until the current connection reports)."""
        return HardwareState(
            schema_version=1,
            updated_at=self._now(),
            laptops=[
                LaptopHardware(
                    node_id=node_id,
                    display_name=entry.display_name,
                    last_status_at=entry.last_status_at,
                    specs=entry.specs,
                    tools=entry.tools,
                    memory_free_gb=entry.memory_free_gb,
                    cpu_percent=entry.cpu_percent,
                )
                for node_id, entry in self._laptops.items()
            ],
        )
