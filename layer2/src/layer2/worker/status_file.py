"""The worker status file (contracts/worker-status.json), which Layer 1's bridge reads to learn
whether this laptop is connected, rejected or disconnected."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from layer2.contracts import MissingItem, WorkerStatus
from layer2.files import write_json_atomic
from layer2.worker.client import Report, WorkerState


def _utc_now() -> datetime:
    return datetime.now(UTC)


def status_writer(path: Path, node_id: str, now: Callable[[], datetime] = _utc_now) -> Report:
    """A `report` callback for `run_worker` that rewrites the status file whole on every call.

    A failed write raises OSError (PermissionError while Windows keeps the file busy); the
    client logs it and carries on, and the next state change writes the file again.
    """

    async def write(state: WorkerState, missing: list[MissingItem]) -> None:
        status = WorkerStatus(
            schema_version=1,
            node_id=node_id,
            state=state,
            missing=missing,
            updated_at=now(),
        )
        await asyncio.to_thread(write_json_atomic, path, status)

    return write
