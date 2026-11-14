"""Stopping the coordinator and the worker: the stop file and stop signals.

The stop file is consumed by the program that acts on it, never deleted at startup unread: if
it is already there when a program starts, that is a real request, so the program removes it
and exits 0 without starting.
"""

import asyncio
import contextlib
import logging
import signal
import threading
from collections.abc import Generator
from pathlib import Path

from layer2.files import retry_while_busy

log = logging.getLogger(__name__)

_STOP_SIGNALS = ("SIGINT", "SIGTERM", "SIGBREAK")


def stop_requested(path: Path) -> bool:
    """Whether the stop file exists. An error checking it is not a stop request."""
    try:
        return path.exists()
    except OSError:
        return False


def consume_stop_file(path: Path, program: str) -> None:
    """The stop request has been acted on; remove it so the next start is not stopped."""
    try:
        retry_while_busy(lambda: path.unlink(missing_ok=True))
    except OSError as error:
        log.warning("L2 %s: could not remove the stop file: %s", program, error)


@contextlib.contextmanager
def stop_signals(loop: asyncio.AbstractEventLoop, stopping: asyncio.Event) -> Generator[None]:
    """Ctrl+C, SIGTERM and Windows Ctrl+Break set `stopping`, like the stop file. Signals can
    only be caught on the main thread; elsewhere this does nothing."""
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
