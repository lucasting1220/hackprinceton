"""The worker's connection to the coordinator: hello, welcome, a status every STATUS_INTERVAL_S,
and reconnecting.

The loop re-reads `coordinator_url` from worker.json before every try, so Layer 1 can point a
running worker at a new coordinator (a hotspot switch). Only a `welcome` with accepted=false,
or one naming another laptop, ends it ("rejected"); any other failure or close is
"disconnected" and it retries after RETRY_DELAY_S.

Each state change is passed to `report`, which writes the status file: "disconnected" at the
start and whenever a connection ends or the worker stops, "connected" after an accepting
welcome, "rejected" at the end. A report that fails is logged and never ends a connection.
The token is never logged.
"""

import asyncio
import contextlib
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
    Reply,
    Sensors,
    Specs,
    StartMessage,
    StatusMessage,
    StopMessage,
    WelcomeAccepted,
    WelcomeRejected,
    WorkerConfig,
)
from layer2.files import ConfigError, load_config
from layer2.specs import collect_specs, collect_tools, missing_items
from layer2.tokens import is_well_formed
from layer2.worker.gateway import Relay
from layer2.worker.jobs import JobControl

log = logging.getLogger(__name__)

WorkerState = Literal["connected", "rejected", "disconnected"]
Report = Callable[[WorkerState, list[MissingItem]], Awaitable[None]]
Outcome = Literal["stopped", "rejected"]

_Order = TypeAdapter[StartMessage | StopMessage | Reply](StartMessage | StopMessage | Reply)
_Welcome = TypeAdapter[WelcomeAccepted | WelcomeRejected](WelcomeAccepted | WelcomeRejected)
_GB = 2**30
# ValueError: websockets raises it for a URL with a bad port; Layer 1 may fix the file later.
_NETWORK_ERRORS = (
    OSError,
    TimeoutError,
    ValueError,
    ConnectionClosed,
    InvalidHandshake,
    InvalidURI,
)


class _RejectedError(Exception):
    pass


async def run_worker(
    config_path: Path,
    token: str,
    report: Report,
    stop: asyncio.Event,
    jobs: JobControl | None = None,
    relay: Relay | None = None,
) -> Outcome:
    """Connect, report and reconnect until `stop` is set ("stopped") or the coordinator
    rejects this laptop ("rejected"). Returns within a few seconds of `stop` being set, after
    stopping every job.

    Jobs keep running while the connection is down: the safety work must not stop for a
    Wi-Fi drop. The coordinator sends what to run again when the worker rejoins.
    """
    try:
        return await _run(config_path, token, report, stop, jobs, relay)
    finally:
        if jobs is not None:
            await jobs.stop_all()


async def _run(
    config_path: Path,
    token: str,
    report: Report,
    stop: asyncio.Event,
    jobs: JobControl | None,
    relay: Relay | None,
) -> Outcome:

    async def tell(state: WorkerState, missing: list[MissingItem]) -> None:
        try:
            await report(state, missing)
        except OSError as error:  # Windows can keep the status file busy; never fatal
            log.warning("L2 worker: could not write the status %r: %s", state, error)

    if not is_well_formed(token):
        raise ValueError(
            "the token must be 64 lowercase hex characters; read it with read_token_file"
        )
    missing = await asyncio.to_thread(missing_items, config_path)
    await tell("disconnected", missing)
    specs = await asyncio.to_thread(collect_specs)
    psutil.cpu_percent(interval=None)  # the first reading is meaningless; start the clock
    try:
        while not stop.is_set():
            missing = await asyncio.to_thread(missing_items, config_path)
            try:
                config = await asyncio.to_thread(load_config, config_path, WorkerConfig)
            except ConfigError as error:
                log.warning("L2 worker: cannot read the config, will retry: %s", error)
            else:
                session = _session(config_path, config, token, specs, missing, tell, jobs, relay)
                await _until_stopped(session, stop)
            if stop.is_set():
                break
            await tell("disconnected", missing)
            await _sleep_unless(stop, settings.RETRY_DELAY_S)
    except _RejectedError:
        await tell("rejected", missing)
        return "rejected"
    await tell("disconnected", missing)
    return "stopped"


async def _until_stopped(session: Awaitable[None], stop: asyncio.Event) -> None:
    """Run one session, cancelling it as soon as `stop` is set (even mid-connect or while
    waiting for the welcome)."""
    task = asyncio.ensure_future(session)
    stopped = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait([task, stopped], return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopped.cancel()
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    if task.done() and not task.cancelled():
        task.result()  # re-raises _RejectedError


async def _session(
    config_path: Path,
    config: WorkerConfig,
    token: str,
    specs: Specs,
    missing: list[MissingItem],
    tell: Report,
    jobs: JobControl | None,
    relay: Relay | None,
) -> None:
    """One connection. Returns when it drops; raises _RejectedError on rejection."""
    try:
        async with connect(
            config.coordinator_url,
            open_timeout=settings.CONNECT_TIMEOUT_S,
            close_timeout=settings.WORKER_CLOSE_TIMEOUT_S,
            ping_interval=settings.WS_PING_INTERVAL_S,
            ping_timeout=settings.WORKER_PING_TIMEOUT_S,
            max_size=settings.WORKER_MAX_MESSAGE_BYTES,  # event log replies can be large
            proxy=None,  # the coordinator is on the local network; never go through a proxy
        ) as connection:
            await _join(connection, config, token, specs)
            log.info("L2 worker: connected to %s", config.coordinator_url)
            await tell("connected", missing)
            if relay is not None:
                relay.attach(connection)
            try:
                await _first_to_end(
                    _send_status(connection, config_path, missing, tell, jobs),
                    _receive_orders(connection, jobs, relay),
                )
            finally:
                if relay is not None:
                    relay.detach()
    except _NETWORK_ERRORS as error:
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
        log.error("L2 worker: the coordinator rejected this laptop's token")
        raise _RejectedError
    if welcome.node_id != config.node_id:
        log.error(
            "L2 worker: this token belongs to laptop %s, not %s; ask Layer 1 to re-pair",
            welcome.node_id,
            config.node_id,
        )
        raise _RejectedError


async def _first_to_end(*parts: Awaitable[None]) -> None:
    """Run the parts of a session together; when one ends (or fails), cancel the rest and
    re-raise its error."""
    tasks = [asyncio.ensure_future(part) for part in parts]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    for task in done:
        task.result()


async def _receive_orders(
    connection: ClientConnection, jobs: JobControl | None, relay: Relay | None
) -> None:
    """Act on `start` and `stop`, and pass each `reply` to the relay, until the connection
    closes. A bad message is logged once per connection and ignored."""
    logged_bad = False
    async for text in connection:
        try:
            order = _Order.validate_json(text)
        except ValidationError:
            if not logged_bad:
                logged_bad = True
                log.warning(
                    "L2 worker: ignored a message from the coordinator that is not "
                    "start, stop or reply; further ones are not logged"
                )
            continue
        if isinstance(order, Reply):
            if relay is not None:
                relay.resolve(order)
        elif jobs is None:
            log.warning("L2 worker: this worker runs no jobs; ignored %s %s", order.type, order.job)
        elif isinstance(order, StartMessage):
            await jobs.start(order.job)
        else:
            await jobs.stop(order.job)


async def _send_status(
    connection: ClientConnection,
    config_path: Path,
    missing: list[MissingItem],
    tell: Report,
    jobs: JobControl | None,
) -> None:
    """Send a status every STATUS_INTERVAL_S; re-check what is missing every
    MISSING_REFRESH_S, and tell the status file when it changes."""
    loop = asyncio.get_running_loop()
    checked_at = loop.time()
    while True:
        if loop.time() - checked_at >= settings.MISSING_REFRESH_S:
            checked_at = loop.time()
            latest = await asyncio.to_thread(missing_items, config_path)
            if latest != missing:
                missing = latest
                await tell("connected", missing)
        memory = psutil.virtual_memory()
        message = StatusMessage(
            type="status",
            schema_version=1,
            missing=missing,
            memory_free_gb=round(memory.available / _GB, 2),
            cpu_percent=min(100.0, float(psutil.cpu_percent(interval=None))),
            jobs=[] if jobs is None else jobs.statuses(),
        )
        await connection.send(message.model_dump_json())
        await asyncio.sleep(settings.STATUS_INTERVAL_S)


async def _sleep_unless(stop: asyncio.Event, seconds: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), seconds)
