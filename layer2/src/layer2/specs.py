"""What this laptop has, and what it is missing. Shared by `check` and the worker."""

import http.client
import logging
import platform
import shutil
import subprocess
import sys
import threading
import urllib.request
from pathlib import Path
from typing import Literal

import psutil

from layer2 import settings
from layer2.contracts import MissingItem, Specs, Tools, WorkerConfig
from layer2.files import ConfigError, load_config
from layer2.tokens import TokenError, read_token_file

log = logging.getLogger(__name__)


class UnsupportedPlatformError(Exception):
    """Workers run only on macOS and Windows."""


def collect_specs() -> Specs:
    """This laptop's hardware. Blocks for up to a few seconds (subprocess calls); from async
    code call it through `asyncio.to_thread`. Specs do not change while running: call it once."""
    cores = psutil.cpu_count(logical=False) or psutil.cpu_count() or 1
    memory_gb = round(psutil.virtual_memory().total / 2**30)
    if sys.platform == "darwin":
        return Specs(
            os="macos",
            os_version=platform.mac_ver()[0],
            cpu=_sysctl("machdep.cpu.brand_string") or platform.processor(),
            cores=cores,
            memory_gb=memory_gb,
            gpu="apple-silicon" if _is_apple_silicon() else _nvidia_or_none(),
        )
    if sys.platform == "win32":
        return Specs(
            os="windows",
            os_version=platform.version(),
            cpu=_windows_cpu_name(),
            cores=cores,
            memory_gb=memory_gb,
            gpu=_nvidia_or_none(),
        )
    raise UnsupportedPlatformError(f"workers run on macOS or Windows, not {sys.platform}")


_SYSCTL = "/usr/sbin/sysctl"


def _sysctl(name: str) -> str | None:
    try:
        result = subprocess.run(
            [_SYSCTL, "-n", name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=settings.SUBPROCESS_TIMEOUT_S,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        log.warning("L2 specs: cannot read %s: %s", name, error)
        return None
    return result.stdout.strip() or None


def _is_apple_silicon() -> bool:
    """True on an M-series Mac even when this Python is an Intel build running under Rosetta."""
    return platform.machine() == "arm64" or _sysctl("hw.optional.arm64") == "1"


def _windows_cpu_name() -> str:
    if sys.platform != "win32":
        return platform.processor()
    import winreg

    key_path = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
            name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
    except OSError as error:
        log.warning("L2 specs: cannot read the processor name: %s", error)
        return platform.processor()
    return str(name).strip()


def _nvidia_or_none() -> Literal["nvidia", "none"]:
    return "nvidia" if shutil.which("nvidia-smi") else "none"


_MAC_TOOL_DIRS = (Path("/opt/homebrew/bin"), Path("/usr/local/bin"))


def _has_tool(name: str) -> bool:
    """On PATH, or in Homebrew's folders: a Mac app started from the Dock has a short PATH."""
    if shutil.which(name):
        return True
    return sys.platform == "darwin" and any((folder / name).is_file() for folder in _MAC_TOOL_DIRS)


def collect_tools(ollama_url: str) -> Tools:
    """Blocks for up to OLLAMA_CHECK_TIMEOUT_S; from async code call it through
    `asyncio.to_thread`."""
    return Tools(
        python=platform.python_version(),
        ollama=ollama_answers(ollama_url),
        llama_cpp=_has_tool("llama-server"),
    )


_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def ollama_answers(ollama_url: str) -> bool:
    """True if Ollama answers /api/version with a 2xx within OLLAMA_CHECK_TIMEOUT_S in total.

    Never raises, never uses a system proxy (Ollama is local). Blocks for up to the timeout;
    from async code call it through `asyncio.to_thread`.
    """
    url = ollama_url.rstrip("/") + "/api/version"
    answers: list[bool] = []
    probe = threading.Thread(target=lambda: answers.append(_probe(url)), daemon=True)
    probe.start()
    probe.join(settings.OLLAMA_CHECK_TIMEOUT_S)
    if not answers:
        log.info("L2 specs: Ollama did not answer in %s s", settings.OLLAMA_CHECK_TIMEOUT_S)
        return False
    return answers[0]


def _probe(url: str) -> bool:
    try:
        with _NO_PROXY.open(url, timeout=settings.OLLAMA_CHECK_TIMEOUT_S) as response:
            status: int = response.status
            return 200 <= status < 300
    except (OSError, ValueError, http.client.HTTPException) as error:
        log.info("L2 specs: Ollama not reachable: %s", type(error).__name__)
        return False


def missing_items(config_path: Path) -> list[MissingItem]:
    """Everything this laptop lacks. `required` items stop it joining; the rest are reported.

    Never raises for a missing item. Blocks for a few seconds at most (file retries, the
    Ollama check); from async code call it through `asyncio.to_thread`.
    """
    try:
        config = load_config(config_path, WorkerConfig)
    except ConfigError as error:
        return [MissingItem(id="config", reason=str(error), required=True)]
    items: list[MissingItem] = []
    try:
        read_token_file(Path(config.token_file))
    except TokenError as error:
        items.append(MissingItem(id="token", reason=str(error), required=True))
    if sys.version_info[:2] != settings.REQUIRED_PYTHON:
        wanted = ".".join(str(part) for part in settings.REQUIRED_PYTHON)
        items.append(
            MissingItem(
                id="python",
                reason=f"Python {wanted} is needed, found {platform.python_version()}",
                required=True,
            )
        )
    if not ollama_answers(config.ollama_url):
        items.append(
            MissingItem(id="ollama", reason=f"not reachable at {config.ollama_url}", required=False)
        )
    return items
