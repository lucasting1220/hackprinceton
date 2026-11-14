"""Reads which camera to open from a worker's config file (contracts/worker.json)."""

import json
from pathlib import Path

from layer3 import settings

SCHEMA_VERSION_FIELD: str = "schema_version"
CAMERA_FIELD: str = "camera"
FIELDS_READ: tuple[str, ...] = (SCHEMA_VERSION_FIELD, CAMERA_FIELD)


class ConfigError(Exception):
    """The worker config file is missing, unreadable, or not what the contract says."""


def load_camera(config_path: Path) -> str | None:
    """Return the camera's name exactly as written, or None when there is none or it was declined.

    The file is read as UTF-8 with an optional byte-order mark, as Layer 2 reads it.
    """
    try:
        text = config_path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as error:
        raise ConfigError(f"cannot read {config_path}: {error}") from error
    try:
        config: object = json.loads(text)
    except (ValueError, RecursionError) as error:
        raise ConfigError(f"{config_path} is not valid JSON: {error}") from error
    if not isinstance(config, dict):
        raise ConfigError(f"{config_path} must hold one JSON object")
    for field in FIELDS_READ:
        if field not in config:
            raise ConfigError(f"{config_path} has no {field!r} field")

    version = config[SCHEMA_VERSION_FIELD]
    if type(version) is not int or version != settings.SUPPORTED_SCHEMA_VERSION:
        raise ConfigError(
            f"{config_path} has {SCHEMA_VERSION_FIELD} {version!r}; "
            f"this code reads version {settings.SUPPORTED_SCHEMA_VERSION}"
        )

    camera = config[CAMERA_FIELD]
    if camera is None:
        return None
    if isinstance(camera, str) and camera.strip():
        return camera
    raise ConfigError(
        f"{config_path} has {CAMERA_FIELD} {camera!r}; it must be a camera name or null"
    )
