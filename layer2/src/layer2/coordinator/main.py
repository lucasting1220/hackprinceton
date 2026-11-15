"""`layer2-coordinator --config <coordinator.json>`: runs the control server (workers), the
dashboard server and the bridge's server (client_port) until the stop file appears.

Exit codes (contracts/README.md): 0 stopped normally, 2 bad config, 1 anything else.
"""

import argparse
import asyncio
import contextlib
import logging
import sys
from collections.abc import Generator
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket

from layer2 import settings
from layer2.contracts import CoordinatorConfig
from layer2.coordinator.ai_plan import choose_plan
from layer2.coordinator.event_log import EventLog
from layer2.coordinator.inbox import Subscriptions, create_client_app
from layer2.coordinator.plan import JobNeed, LaptopView, Placement, Plan
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_control_app, create_dashboard_app
from layer2.files import ConfigError, load_config, wait_for_stop_file
from layer2.job_files import job_needs
from layer2.stopping import consume_stop_file, stop_requested, stop_signals

log = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_BAD_CONFIG = 2


class _Server(uvicorn.Server):
    """Three servers share one process, so none may take over the signal handlers;
    stop_signals handles them for all."""

    @contextlib.contextmanager
    def capture_signals(self) -> Generator[None]:
        yield


def _server(app: FastAPI, host: str, port: int) -> _Server:
    return _Server(
        uvicorn.Config(
            app,
            host=host,
            port=port,
            lifespan="off",
            log_level="warning",
            ws_max_size=settings.WS_MAX_MESSAGE_BYTES,
            ws_ping_interval=settings.WS_PING_INTERVAL_S,
            ws_ping_timeout=settings.WS_PING_TIMEOUT_S,
            timeout_graceful_shutdown=settings.SHUTDOWN_GRACE_S,
        )
    )


class _StartupFailedError(Exception):
    """uvicorn calls sys.exit when it cannot start (for example, a port in use)."""


async def _run(server: _Server) -> None:
    try:
        await server.serve()
    except SystemExit as exit_:
        raise _StartupFailedError(
            f"server on port {server.config.port} exited {exit_.code}"
        ) from None


async def _log_when_ready(servers: list[_Server], config: CoordinatorConfig) -> None:
    while not all(server.started for server in servers):
        await asyncio.sleep(settings.STOP_POLL_S)
    log.info(
        "L2 coordinator: ready; workers join on port %s, dashboard on 127.0.0.1:%s, "
        "bridge on 127.0.0.1:%s, stop file %s",
        config.listen_port,
        config.dashboard_port,
        config.client_port,
        config.stop_file,
    )


def _job_needs() -> list[JobNeed]:
    """Every always-on job Layers 3 and 4 provide, read again at each re-plan."""
    return job_needs()


async def _serve(config: CoordinatorConfig) -> int:
    registry: Registry[WebSocket] = Registry()
    planner_log = Path(config.state_dir) / "planner.log"

    def planner(
        needs: list[JobNeed], connected: list[LaptopView], known: set[str], previous: Plan
    ) -> Plan:
        plan, _ = choose_plan(config.ollama_url, needs, connected, known, previous, planner_log)
        return plan

    placement = Placement(_job_needs, planner=planner)
    events = EventLog(Path(config.state_dir) / "events")
    subscriptions = Subscriptions()
    control = create_control_app(config, registry, placement, events, subscriptions)
    servers = [
        _server(control, "0.0.0.0", config.listen_port),
        _server(create_dashboard_app(registry, placement), "127.0.0.1", config.dashboard_port),
        _server(create_client_app(subscriptions), "127.0.0.1", config.client_port),
    ]
    stop_file = Path(config.stop_file)
    stopping = asyncio.Event()
    with stop_signals(asyncio.get_running_loop(), stopping):
        stop = asyncio.create_task(wait_for_stop_file(stop_file))
        signalled = asyncio.create_task(stopping.wait())
        ready = asyncio.create_task(_log_when_ready(servers, config))
        running = [asyncio.create_task(_run(server)) for server in servers]
        done, _ = await asyncio.wait(
            [stop, signalled, *running], return_when=asyncio.FIRST_COMPLETED
        )
        for server in servers:
            server.should_exit = True
        for task in (stop, signalled, ready):
            task.cancel()
        outcomes = await asyncio.gather(*running, return_exceptions=True)
    if stop in done:
        log.info("L2 coordinator: stop file found; stopped")
        consume_stop_file(stop_file, "coordinator")
        return EXIT_OK
    if signalled in done:
        log.info("L2 coordinator: stop signal received; stopped")
        return EXIT_OK
    problems = [str(outcome) for outcome in outcomes if isinstance(outcome, BaseException)]
    log.error("L2 coordinator: a server stopped on its own: %s", "; ".join(problems) or "no error")
    return EXIT_ERROR


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="layer2-coordinator")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config, CoordinatorConfig)
    except ConfigError as error:
        log.error("L2 coordinator: %s", error)
        return EXIT_BAD_CONFIG
    stop_file = Path(config.stop_file)
    if stop_requested(stop_file):
        # Never delete it unread: it may be a real request made while this program started.
        log.info("L2 coordinator: the stop file is already there; not starting")
        consume_stop_file(stop_file, "coordinator")
        return EXIT_OK
    try:
        return asyncio.run(_serve(config))
    except KeyboardInterrupt:
        log.info("L2 coordinator: interrupted; stopped")
        return EXIT_OK
    except Exception:
        log.exception("L2 coordinator: stopped by an unexpected error")
        return EXIT_ERROR


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(main())
