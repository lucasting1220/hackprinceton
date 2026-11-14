"""The worker's connection to the coordinator: hello, welcome, a status every STATUS_INTERVAL_S,
and reconnecting.

The loop re-reads `coordinator_url` from worker.json before every try, so Layer 1 can point a
running worker at a new coordinator (a hotspot switch). Only a `welcome` with accepted=false
ends it ("rejected"); any other failure or close is "disconnected" and it retries after
RETRY_DELAY_S. Each state change is passed to `report`, which writes the status file.
The token is never logged.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

import psutil
from pydantic import TypeAdapter, ValidationError
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from layer2 import settings
from layer2.contracts import (
    Hello,
    MissingItem,
    Sensors,
    Specs,
    StatusMessage,
    WelcomeAccepted,
    WelcomeRejected,
    WorkerConfig,
)
from layer2.files import ConfigError, load_config
from layer2.specs import collect_specs, collect_tools, missing_items

log = logging.getLogger(__name__)

WorkerState = Literal["connected", "rejected", "disconnected"]
Report = Callable[[WorkerState, list[MissingItem]], Awaitable[None]]
Outcome = Literal["stopped", "rejected"]

_Welcome = TypeAdapter[WelcomeAccepted | WelcomeRejected](WelcomeAccepted | WelcomeRejected)
_GB = 2**30


class _Rejected(Exception):
    pass


async def run_worker(config_path: Path, token: str, report: Report, stop: asyncio.Event) -> Outcome:
    """Connect, report and reconnect until `stop` is set ("stopped") or the coordinator
    rejects the token ("rejected")."""
    specs = await asyncio.to_thread(collect_specs)
    psutil.cpu_percent(interval=None)  # the first reading is meaningless; start the clock
    missing: list[MissingItem] = []
    while not stop.is_set():
        try:
            config = await asyncio.to_thread(load_config, config_path, WorkerConfig)
        except ConfigError as error:
            log.warning("L2 worker: cannot read the config, will retry: %s", error)
        else:
            missing = await asyncio.to_thread(missing_items, config_path)
            try:
                await _session(config, token, specs, missing, report, stop)
            except _Rejected:
                log.error("L2 worker: the coordinator rejected this laptop's token")
                await report("rejected", missing)
                return "rejected"
        if stop.is_set():
            break
        await report("disconnected", missing)
        await _sleep_unless(stop, settings.RETRY_DELAY_S)
    return "stopped"


async def _session(
    config: WorkerConfig,
    token: str,
    specs: Specs,
    missing: list[MissingItem],
    report: Report,
    stop: asyncio.Event,
) -> None:
    """One connection. Returns when it drops or `stop` is set; raises _Rejected on rejection."""
    try:
        async with connect(
            config.coordinator_url,
            open_timeout=settings.CONNECT_TIMEOUT_S,
            max_size=settings.WS_MAX_MESSAGE_BYTES,
            proxy=None,  # the coordinator is on the local network; never go through a proxy
        ) as connection:
            await _join(connection, config, token, specs)
            log.info("L2 worker: connected to %s", config.coordinator_url)
            await report("connected", missing)
            await _send_status(connection, missing, stop)
    except _Rejected:
        raise
    except (OSError, TimeoutError, ConnectionClosed, InvalidHandshake, InvalidURI) as error:
        log.info(
            "L2 worker: not connected to %s (%s)", config.coordinator_url, type(error).__name__
        )


async def _join(
    connection: ClientConnection, config: WorkerConfig, token: str, specs: Specs
) -> None:
    tools = await asyncio.to_thread(collect_tools, config.ollama_url)
    hello = Hello(
        type="hello",
        schema_version=1,
        token=token,
        display_name=config.display_name,
        specs=specs,
        sensors=Sensors(camera=config.camera, mic=config.mic),
        tools=tools,
    )
    await connection.send(hello.model_dump_json())
    reply = await asyncio.wait_for(connection.recv(), settings.HELLO_TIMEOUT_S)
    try:
        welcome = _Welcome.validate_json(reply)
    except ValidationError:
        log.warning("L2 worker: the coordinator's reply was not a welcome")
        raise ConnectionClosed(None, None) from None
    if isinstance(welcome, WelcomeRejected):
        raise _Rejected


async def _send_status(
    connection: ClientConnection, missing: list[MissingItem], stop: asyncio.Event
) -> None:
    while not stop.is_set():
        memory = psutil.virtual_memory()
        message = StatusMessage(
            type="status",
            schema_version=1,
            missing=missing,
            memory_free_gb=round(memory.available / _GB, 2),
            cpu_percent=min(100.0, float(psutil.cpu_percent(interval=None))),
        )
        await connection.send(message.model_dump_json())
        await _sleep_unless(stop, settings.STATUS_INTERVAL_S)


async def _sleep_unless(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), seconds)
    except TimeoutError:
        return
