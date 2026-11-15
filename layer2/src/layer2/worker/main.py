"""`layer2-worker --config <worker.json>`: connects to the coordinator and reports until the stop
file appears. `layer2-worker check --config <worker.json> [--json]`: what this laptop lacks.

Exit codes (contracts/README.md): 0 stopped normally, 2 bad config or token file, 3 token
rejected, 1 anything else; `check` exits 4 when a required item is missing. A missing item
never makes the worker exit. Logs go to stderr, so `check --json` prints only JSON on stdout.
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from layer2.contracts import WorkerConfig
from layer2.files import ConfigError, load_config, wait_for_stop_file
from layer2.job_files import JobCatalog
from layer2.stopping import consume_stop_file, stop_requested, stop_signals
from layer2.tokens import TokenError, read_token_file
from layer2.worker.check import run_check
from layer2.worker.client import run_worker
from layer2.worker.gateway import Gateway, Relay
from layer2.worker.jobs import JobControl, JobRunner
from layer2.worker.status_file import status_writer

log = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_BAD_CONFIG = 2
EXIT_REJECTED = 3

_PROGRAM = "worker"


def job_env(config_path: Path, config: WorkerConfig, gateway: dict[str, str]) -> dict[str, str]:
    """What every job on this worker gets in its environment (contracts/README.md, jobs)."""
    return {
        "LAYER2_NODE_ID": config.node_id,
        "LAYER2_WORKER_CONFIG": str(config_path.resolve()),
        "LAYER2_FRAME_FEED": f"127.0.0.1:{config.frame_feed_port}",
        **gateway,
    }


async def _work(config_path: Path, config: WorkerConfig, token: str) -> int:
    stop_file = Path(config.stop_file)
    stop = asyncio.Event()
    report = status_writer(Path(config.status_file), config.node_id)
    relay = Relay()
    gateway = Gateway(relay, config.ollama_url)
    await gateway.start()
    env = job_env(config_path, config, gateway.env())
    runner = JobRunner(Path(config.state_dir) / "jobs", env)
    jobs = JobControl(runner, JobCatalog())
    with stop_signals(asyncio.get_running_loop(), stop):
        watcher = asyncio.create_task(wait_for_stop_file(stop_file))
        watcher.add_done_callback(lambda _: stop.set())
        try:
            outcome = await run_worker(config_path, token, report, stop, jobs, relay)
        finally:
            watcher.cancel()
            await gateway.close()
    if outcome == "rejected":
        log.error("L2 worker: the coordinator rejected this laptop; stopped")
        return EXIT_REJECTED
    if stop_requested(stop_file):
        log.info("L2 worker: stop file found; stopped")
        consume_stop_file(stop_file, _PROGRAM)
    else:
        log.info("L2 worker: stop signal received; stopped")
    return EXIT_OK


def _run_worker(config_path: Path) -> int:
    try:
        config = load_config(config_path, WorkerConfig)
        token = read_token_file(Path(config.token_file))
    except (ConfigError, TokenError) as error:
        log.error("L2 worker: %s", error)
        return EXIT_BAD_CONFIG
    stop_file = Path(config.stop_file)
    if stop_requested(stop_file):
        # Never delete it unread: it may be a real request made while this program started.
        log.info("L2 worker: the stop file is already there; not starting")
        consume_stop_file(stop_file, _PROGRAM)
        return EXIT_OK
    log.info("L2 worker: starting as %s; stop file %s", config.node_id, config.stop_file)
    try:
        return asyncio.run(_work(config_path, config, token))
    except KeyboardInterrupt:
        log.info("L2 worker: interrupted; stopped")
        return EXIT_OK
    except Exception:
        log.exception("L2 worker: stopped by an unexpected error")
        return EXIT_ERROR


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="layer2-worker")
    parser.add_argument("command", nargs="?", choices=["check"], help="list what is missing")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--json", action="store_true", help="with check: print JSON")
    args = parser.parse_args(argv)
    config_path: Path = args.config
    if args.command == "check":
        return run_check(config_path, as_json=args.json, out=sys.stdout)
    if args.json:
        parser.error("--json goes with check")
    return _run_worker(config_path)


def run() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr
    )
    sys.exit(main())
