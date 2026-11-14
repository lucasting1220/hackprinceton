"""Reading config files, writing JSON files whole, and watching for the stop file."""

import asyncio
import os
import stat
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel, ValidationError

from layer2 import settings


class ConfigError(Exception):
    """A config file is missing, unreadable or does not match its contract."""


def _retry_while_busy[T](action: Callable[[], T]) -> T:
    """Windows reports a file busy while another program has it open; retry for a short time."""
    deadline = time.monotonic() + settings.FILE_BUSY_RETRY_S
    while True:
        try:
            return action()
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(settings.FILE_BUSY_STEP_S)


def load_json_model[M: BaseModel](path: Path, model: type[M]) -> M:
    """Load a JSON file into its contract model.

    Error text, and the traceback behind it, never includes field values: config files sit
    next to the join token. A UTF-8 byte-order mark, which Windows tools often add, is allowed.
    """
    try:
        text = _retry_while_busy(lambda: path.read_text(encoding="utf-8-sig"))
    except OSError as error:
        raise ConfigError(f"cannot read {path}: {error.strerror or type(error).__name__}") from None
    except UnicodeDecodeError:
        raise ConfigError(f"{path} is not UTF-8 text") from None
    try:
        return model.model_validate_json(text)
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'file'}: {item['msg']}"
            for item in error.errors(include_input=False, include_url=False)
        )
    raise ConfigError(f"{path} is not valid: {problems}")


_PATH_FIELDS = ("python",)
_PATH_SUFFIXES = ("_file", "_dir")


def load_config[M: BaseModel](path: Path, model: type[M]) -> M:
    """Load a config file and check that every path in it is absolute on this machine.

    A path field is `python` or any top-level field ending in `_file` or `_dir`; name new
    path fields to match.
    """
    config = load_json_model(path, model)
    for name in type(config).model_fields:
        if not (name in _PATH_FIELDS or name.endswith(_PATH_SUFFIXES)):
            continue
        value = getattr(config, name)
        if isinstance(value, str) and not Path(value).is_absolute():
            raise ConfigError(f"{path} is not valid: {name}: must be an absolute path")
    return config


def write_json_atomic(path: Path, data: BaseModel) -> None:
    """Write to a temporary file in the same folder, flush it to disk, then rename it over
    the old one, retrying while Windows reports the target busy.

    This blocks for up to FILE_BUSY_RETRY_S. From async code, call it through
    `asyncio.to_thread`. It raises PermissionError if the target stays busy; a periodic
    writer should log that and try again on its next tick rather than exit.
    """
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temp_path = Path(temp_name)
    try:
        try:
            temp_file = os.fdopen(handle, "w", encoding="utf-8", newline="\n")
        except BaseException:
            os.close(handle)
            raise
        with temp_file:
            temp_file.write(data.model_dump_json(indent=2) + "\n")
            temp_file.flush()
            os.fsync(temp_file.fileno())
        temp_path.chmod(_mode_for(path))
        _retry_while_busy(lambda: temp_path.replace(path))
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


_NEW_FILE_MODE = 0o644


def _mode_for(path: Path) -> int:
    """Keep the target's permissions; mkstemp would otherwise leave every rewrite owner-only."""
    try:
        return stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        return _NEW_FILE_MODE


async def wait_for_stop_file(path: Path, poll_s: float = settings.STOP_POLL_S) -> None:
    """Return once the stop file exists."""
    while not path.exists():
        await asyncio.sleep(poll_s)
