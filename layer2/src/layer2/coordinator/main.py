"""`layer2-coordinator --config <coordinator.json>`: runs the control and dashboard servers
until the stop file appears.

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
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_control_app, create_dashboard_app
from layer2.files import ConfigError, load_config, wait_for_stop_file

log = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_BAD_CONFIG = 2


class _Server(uvicorn.Server):
    """Two servers share one process, so neither may take over the signal handlers;
    Ctrl+C reaches main() as KeyboardInterrupt instead."""

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


async def _serve(config: CoordinatorConfig) -> int:
    registry: Registry[WebSocket] = Registry()
    servers = [
        _server(create_control_app(config, registry), "0.0.0.0", config.listen_port),
        _server(create_dashboard_app(registry), "127.0.0.1", config.dashboard_port),
    ]
    stop = asyncio.create_task(wait_for_stop_file(Path(config.stop_file)))
    running = [asyncio.create_task(_run(server)) for server in servers]
    done, _ = await asyncio.wait([stop, *running], return_when=asyncio.FIRST_COMPLETED)
    for server in servers:
        server.should_exit = True
    stop.cancel()
    outcomes = await asyncio.gather(*running, return_exceptions=True)
    if stop in done:
        log.info("L2 coordinator: stop file found; stopped")
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
    if stop_file.exists():
        log.info("L2 coordinator: removing a stop file left from an earlier run")
        stop_file.unlink(missing_ok=True)
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
