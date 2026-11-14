"""Every laptop seen since the coordinator started, and which connection is current for each.

All methods run on the coordinator's one event loop, so nothing here locks.
"""

import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from layer2 import settings
from layer2.contracts import ApiState, Hello, Laptop, MissingItem, StatusMessage

log = logging.getLogger(__name__)

Sensor = Literal["camera", "mic"]


def _utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class _Entry[C]:
    display_name: str
    sensors: list[Sensor]
    last_status_at: datetime
    missing: list[MissingItem] = field(default_factory=list)
    connection: C | None = None
    replacements: deque[float] = field(default_factory=deque)


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
        """Register an accepted hello. Returns the laptop's previous connection, to be closed."""
        entry = self._laptops.get(node_id)
        if entry is None:
            self._laptops[node_id] = _Entry(
                display_name=hello.display_name,
                sensors=_sensor_kinds(hello),
                last_status_at=self._now(),
                connection=connection,
            )
            return None
        previous = entry.connection
        entry.display_name = hello.display_name
        entry.sensors = _sensor_kinds(hello)
        entry.last_status_at = self._now()
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
        if len(entry.replacements) > settings.REPLACEMENT_WARN_COUNT:
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

    def leave(self, node_id: str, connection: C) -> None:
        """The connection closed. The laptop stays listed with its last status time."""
        if self.is_current(node_id, connection):
            self._laptops[node_id].connection = None

    def api_state(self) -> ApiState:
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
            jobs=[],
            dropped=[],
        )
