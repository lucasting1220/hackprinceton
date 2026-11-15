"""The device list for Layer 1's setup page (contracts/device-list.json): every camera and mic
the laptop reports, with its kind, and whether another device of the same type has its name.

Listing opens no device. On macOS the kind comes from AVFoundation's record of how each device
is connected; on Windows, which has no such record here, only from words in the name.
"""

import logging
import platform
import re
import sys
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from layer3 import settings
from layer3.camera import CaptureError, ListedCamera, list_cameras
from layer3.mic import ListedMic, MicError, list_mics

logger = logging.getLogger(__name__)

type Media = Literal["camera", "mic"]
type Kinds = dict[Media, dict[str, str]]
"""For each media, the kind the system records for each device name."""

UNKNOWN: str = "unknown"
_PORT_NUMBER = re.compile(r"\b\d+-\s*")


@dataclass(frozen=True)
class Listed:
    """The device names the system lists, and any problem reading them."""

    cameras: list[str]
    mics: list[str]
    problems: list[str]


def utc_text(moment: datetime) -> str:
    """A time as ISO 8601 in UTC to whole seconds, written with Z."""
    return moment.astimezone(UTC).replace(microsecond=0).isoformat().removesuffix("+00:00") + "Z"


def _fourcc(number: int) -> str:
    if not 0 < number < 2**32:
        return ""
    return number.to_bytes(4, "big").decode("latin-1")


def mac_kind(device_type: str, transport: int) -> str:
    """A device's kind from AVFoundation's device type and transport type."""
    if device_type in settings.MAC_CONTINUITY_DEVICE_TYPES:
        return "continuity"
    return settings.MAC_TRANSPORT_KINDS.get(_fourcc(transport), UNKNOWN)


def mac_kinds() -> Kinds:
    """The kind of every camera and mic AVFoundation lists. Two devices of one name whose kinds
    differ are recorded as unknown."""
    import AVFoundation

    kinds: Kinds = {"camera": {}, "mic": {}}
    media_types: dict[Media, str] = {
        "camera": AVFoundation.AVMediaTypeVideo,
        "mic": AVFoundation.AVMediaTypeAudio,
    }
    for media, media_type in media_types.items():
        for device in AVFoundation.AVCaptureDevice.devicesWithMediaType_(media_type):
            name = str(device.localizedName())
            kind = mac_kind(str(device.deviceType()), int(device.transportType()))
            known = kinds[media].get(name)
            kinds[media][name] = kind if known in (None, kind) else UNKNOWN
    return kinds


def system_kinds() -> Kinds:
    """The kinds the system records. Only macOS keeps a record this program can read."""
    if sys.platform == "darwin":
        return mac_kinds()
    return {"camera": {}, "mic": {}}


def name_kind(name: str) -> str:
    """A device's kind from words in its name: built in or virtual, else unknown (Windows)."""
    lowered = name.lower()
    if any(hint in lowered for hint in settings.WINDOWS_VIRTUAL_NAME_HINTS):
        return "virtual"
    if any(hint in lowered for hint in settings.WINDOWS_BUILT_IN_NAME_HINTS):
        return "built_in"
    return UNKNOWN


def kind_of(name: str, media: Media, kinds: Kinds, system: str) -> str:
    recorded = kinds[media].get(name)
    if recorded is not None:
        return recorded
    if system == "Windows":
        return name_kind(name)
    return UNKNOWN


def similar_names(name: str, listed: Sequence[str]) -> list[str]:
    """The other listed names that match this one once case and a Windows port number such as
    "2- " are ignored. Windows renames a device moved to another USB port this way."""

    def plain(text: str) -> str:
        return " ".join(_PORT_NUMBER.sub("", text).lower().split())

    wanted = plain(name)
    return [other for other in listed if other != name and plain(other) == wanted]


def list_names(
    cameras: Callable[[], Sequence[ListedCamera]] = list_cameras,
    mics: Callable[[], Sequence[ListedMic]] = list_mics,
) -> Listed:
    """The camera and mic names the system lists. A list that cannot be read is empty, and its
    problem is named."""
    problems: list[str] = []
    try:
        camera_names = [camera.name for camera in cameras()]
    except (CaptureError, OSError) as error:
        logger.warning("L3 device list: cannot list cameras: %s", error)
        problems.append(f"The cameras could not be listed: {error}")
        camera_names = []
    try:
        mic_names = [mic.name for mic in mics()]
    except (MicError, OSError) as error:
        logger.warning("L3 device list: cannot list mics: %s", error)
        problems.append(f"The mics could not be listed: {error}")
        mic_names = []
    return Listed(camera_names, mic_names, problems)


def _entries(names: Sequence[str], media: Media, kinds: Kinds, system: str) -> list[object]:
    counts = Counter(names)
    return [
        {"name": name, "kind": kind_of(name, media, kinds, system), "same_name": counts[name] > 1}
        for name in names
    ]


def device_list(
    listed: Listed,
    kinds: Kinds,
    listed_at: datetime,
    system: str | None = None,
) -> dict[str, object]:
    """One contracts/device-list.json object."""
    system = platform.system() if system is None else system
    return {
        "schema_version": settings.DEVICE_LIST_SCHEMA_VERSION,
        "type": "device_list",
        "listed_at": utc_text(listed_at),
        "cameras": _entries(listed.cameras, "camera", kinds, system),
        "mics": _entries(listed.mics, "mic", kinds, system),
        "problems": list(listed.problems),
    }


def read_kinds(problems: list[str]) -> Kinds:
    """The system's kinds, or none (every device unknown) with the problem named."""
    try:
        return system_kinds()
    except (ImportError, OSError) as error:
        logger.warning("L3 device list: cannot read device kinds: %s", error)
        problems.append(f"The kind of each device could not be read: {error}")
        return {"camera": {}, "mic": {}}
