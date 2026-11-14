"""Reading config files, writing JSON files whole, and watching for the stop file."""

import asyncio
import os
import tempfile
import time
from pathlib import Path

from pydantic import BaseModel, ValidationError

from layer2 import settings


class ConfigError(Exception):
    """A config file is missing, unreadable or does not match its contract."""


def load_json_model[M: BaseModel](path: Path, model: type[M]) -> M:
    """Load a JSON file into its contract model. Error text never includes field values."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ConfigError(f"cannot read {path}: {error.strerror}") from error
    try:
        return model.model_validate_json(text)
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'file'}: {item['msg']}"
            for item in error.errors(include_input=False, include_url=False)
        )
        raise ConfigError(f"{path} is not valid: {problems}") from error


_PATH_FIELDS = ("python",)
_PATH_SUFFIXES = ("_file", "_dir")


def load_config[M: BaseModel](path: Path, model: type[M]) -> M:
    """Load a config file and check that every path in it is absolute on this machine."""
    config = load_json_model(path, model)
    for name in type(config).model_fields:
        if not (name in _PATH_FIELDS or name.endswith(_PATH_SUFFIXES)):
            continue
        value = getattr(config, name)
        if isinstance(value, str) and not Path(value).is_absolute():
            raise ConfigError(f"{path} is not valid: {name}: must be an absolute path")
    return config


def write_json_atomic(path: Path, data: BaseModel) -> None:
    """Write to a temporary file in the same folder, then rename it over the old one."""
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temp_path = Path(temp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temp_file:
            temp_file.write(data.model_dump_json(indent=2) + "\n")
        _replace_with_retry(temp_path, path)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise


def _replace_with_retry(source: Path, target: Path) -> None:
    """Windows reports a file busy while another program reads it; retry for a short time."""
    deadline = time.monotonic() + settings.FILE_BUSY_RETRY_S
    while True:
        try:
            source.replace(target)
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(settings.FILE_BUSY_STEP_S)


async def wait_for_stop_file(path: Path, poll_s: float = settings.STOP_POLL_S) -> None:
    """Return once the stop file exists."""
    while not path.exists():
        await asyncio.sleep(poll_s)
