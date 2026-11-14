"""`layer2-coordinator --config <coordinator.json>`: runs the control and dashboard servers
until the stop file appears.

Exit codes (contracts/README.md): 0 stopped normally, 2 bad config, 1 anything else.
"""

import argparse
import asyncio
import contextlib
import logging
import signal
import sys
import threading
from collections.abc import Generator
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket

from layer2 import settings
from layer2.contracts import CoordinatorConfig
from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_control_app, create_dashboard_app
from layer2.files import ConfigError, load_config, retry_while_busy, wait_for_stop_file

log = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_BAD_CONFIG = 2

_STOP_SIGNALS = ("SIGINT", "SIGTERM", "SIGBREAK")


class _Server(uvicorn.Server):
    """Two servers share one process, so neither may take over the signal handlers;
    _stop_signals handles them for both."""

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


def _consume_stop_file(path: Path) -> None:
    """The stop request has been acted on; remove it so the next start is not stopped."""
    try:
        retry_while_busy(lambda: path.unlink(missing_ok=True))
    except OSError as error:
        log.warning("L2 coordinator: could not remove the stop file: %s", error)


@contextlib.contextmanager
def _stop_signals(loop: asyncio.AbstractEventLoop, stopping: asyncio.Event) -> Generator[None]:
    """Ctrl+C, SIGTERM and Windows Ctrl+Break stop the servers gracefully, like the stop
    file. Signals can only be caught on the main thread; elsewhere this does nothing."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    def handle(signum: int, frame: object) -> None:
        loop.call_soon_threadsafe(stopping.set)

    caught = [getattr(signal, name) for name in _STOP_SIGNALS if hasattr(signal, name)]
    originals = {sig: signal.signal(sig, handle) for sig in caught}
    try:
        yield
    finally:
        for sig, original in originals.items():
            signal.signal(sig, original)


async def _log_when_ready(servers: list[_Server], config: CoordinatorConfig) -> None:
    while not all(server.started for server in servers):
        await asyncio.sleep(settings.STOP_POLL_S)
    log.info(
        "L2 coordinator: ready; workers join on port %s, dashboard on 127.0.0.1:%s, stop file %s",
        config.listen_port,
        config.dashboard_port,
        config.stop_file,
    )


async def _serve(config: CoordinatorConfig) -> int:
    registry: Registry[WebSocket] = Registry()
    servers = [
        _server(create_control_app(config, registry), "0.0.0.0", config.listen_port),
        _server(create_dashboard_app(registry), "127.0.0.1", config.dashboard_port),
    ]
    stop_file = Path(config.stop_file)
    stopping = asyncio.Event()
    with _stop_signals(asyncio.get_running_loop(), stopping):
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
        _consume_stop_file(stop_file)
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
    try:
        stop_requested = stop_file.exists()
    except OSError:
        stop_requested = False
    if stop_requested:
        # Never delete it unread: it may be a real request made while this program started.
        log.info("L2 coordinator: the stop file is already there; not starting")
        _consume_stop_file(stop_file)
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
