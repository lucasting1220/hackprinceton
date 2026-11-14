"""What this laptop has, and what it is missing. Shared by `check` and the worker."""

import logging
import platform
import shutil
import subprocess
import sys
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
    cores = psutil.cpu_count(logical=False) or psutil.cpu_count() or 1
    memory_gb = round(psutil.virtual_memory().total / 2**30)
    if sys.platform == "darwin":
        return Specs(
            os="macos",
            os_version=platform.mac_ver()[0],
            cpu=_mac_cpu_name(),
            cores=cores,
            memory_gb=memory_gb,
            gpu="apple-silicon" if platform.machine() == "arm64" else _nvidia_or_none(),
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


def _mac_cpu_name() -> str:
    try:
        result = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=settings.SUBPROCESS_TIMEOUT_S,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        log.warning("L2 specs: cannot read the processor name: %s", error)
        return platform.processor()
    return result.stdout.strip()


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


def collect_tools(ollama_url: str) -> Tools:
    return Tools(
        python=platform.python_version(),
        ollama=ollama_answers(ollama_url),
        llama_cpp=shutil.which("llama-server") is not None,
    )


def ollama_answers(ollama_url: str) -> bool:
    url = ollama_url.rstrip("/") + "/api/version"
    try:
        with urllib.request.urlopen(url, timeout=settings.OLLAMA_CHECK_TIMEOUT_S) as response:
            status: int = response.status
            return 200 <= status < 300
    except (OSError, ValueError) as error:
        log.info("L2 specs: Ollama not reachable at %s: %s", ollama_url, error)
        return False


def missing_items(config_path: Path) -> list[MissingItem]:
    """Everything this laptop lacks. `required` items stop it joining; the rest are reported."""
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
