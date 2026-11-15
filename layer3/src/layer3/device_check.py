"""The device check for Layer 1's setup page (contracts/device-check.json): whether the camera
and mic named in worker.json give a frame and sound, and what to change when they do not.

It opens only those two devices, at the same time, through the capture code, and keeps or
prints no frame or sound. On macOS it first reads whether the system lets this program use
each device, so a refusal is named rather than seen as a device that will not open.
"""

import logging
import math
import platform
import sys
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from layer3 import settings
from layer3.camera import (
    CameraFormatMismatch,
    CameraNoFirstFrame,
    CameraNotFound,
    CameraOpenFailed,
    CameraReadFailed,
    CameraReadTimedOut,
    CaptureError,
    FrameSource,
    ListedCamera,
    frames,
    list_cameras,
    open_cv_source,
    utc_now,
)
from layer3.devices import Media, similar_names, utc_text
from layer3.mic import (
    AudioSource,
    ListedMic,
    MicError,
    MicFormatMismatch,
    MicNoFirstChunk,
    MicNotFound,
    MicOpenFailed,
    MicReadFailed,
    MicReadTimedOut,
    chunks,
    list_mics,
    sound_device_source,
)

logger = logging.getLogger(__name__)

type Permission = Callable[[Media], str]
"""For a camera or mic: "allowed", "refused", "not_asked" or "unknown"."""

_WORDS: dict[Media, tuple[str, str, str]] = {
    # The device's word, its plural, and the name of its macOS privacy setting.
    "camera": ("camera", "cameras", "Camera"),
    "mic": ("mic", "mics", "Microphone"),
}


@dataclass(frozen=True)
class Outcome:
    """One device's part of contracts/device-check.json."""

    name: str | None
    result: str
    message: str
    fix: str | None = None
    similar: list[str] = field(default_factory=list)

    def written(self) -> dict[str, object]:
        return {
            "name": self.name,
            "result": self.result,
            "message": self.message,
            "fix": self.fix,
            "similar": list(self.similar),
        }


def system_permission(media: Media) -> str:
    """Whether the system lets this program use the camera or mic. Only macOS says."""
    if sys.platform != "darwin":
        return "unknown"
    import AVFoundation

    media_type = (
        AVFoundation.AVMediaTypeVideo if media == "camera" else AVFoundation.AVMediaTypeAudio
    )
    state = int(AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(media_type))
    return settings.MAC_PERMISSION_STATES.get(state, "unknown")


def _windows_setting(media: Media) -> str:
    return f"Settings > Privacy & security > {_WORDS[media][2]}"


def _permission_fix(media: Media, system: str) -> str:
    word, _, setting = _WORDS[media]
    if system == "Darwin":
        return (
            f"On this Mac, open System Settings > Privacy & Security > {setting}, allow the app "
            "that started the bridge, then start the bridge again"
        )
    return (
        f"On this laptop, open {_windows_setting(media)} and let desktop apps use the {word}, "
        "then run the check again"
    )


def _open_fix(media: Media, system: str) -> str:
    word = _WORDS[media][0]
    if system == "Darwin":
        return (
            f"If macOS asked to allow the {word}, click Allow and run the check again. Otherwise "
            f"close any other app using the {word}, then run the check again"
        )
    return (
        f"Close any other app using the {word}, including a running worker, make sure "
        f"{_windows_setting(media)} lets desktop apps use it, then run the check again"
    )


def _silent_fix(system: str) -> str:
    if system == "Darwin":
        return _permission_fix("mic", system)
    return (
        f"Check the mic is not muted and that {_windows_setting('mic')} lets desktop apps use "
        "it, then run the check again"
    )


def _before_opening(
    media: Media, name: str, names: Sequence[str], permission: Permission, system: str
) -> Outcome | None:
    """The outcome when the device cannot be opened at all: not found, two with its name, or
    refused by the system. None when it should be opened."""
    word, plural, _ = _WORDS[media]
    count = names.count(name)
    if count == 0:
        similar = similar_names(name, names)
        if similar:
            fix = (
                "Windows may have renamed it after it moved to another USB port: pick it again "
                f"from the device list, where it may be '{similar[0]}'"
            )
        else:
            fix = f"Plug in the {word}, then pick it again from the device list"
        return Outcome(name, "not_found", f"No {word} named '{name}' is connected", fix, similar)
    if count > 1:
        return Outcome(
            name,
            "same_name",
            f"{count} {plural} are named '{name}'",
            f"Unplug the other {plural} named '{name}', or pick another {word}",
        )
    if permission(media) == "refused":
        return Outcome(
            name,
            "no_permission",
            f"The {word} '{name}' is not allowed for the app that started the check",
            _permission_fix(media, system),
        )
    return None


def check_camera(
    name: str | None,
    *,
    cameras: Callable[[], Sequence[ListedCamera]] = list_cameras,
    make_source: Callable[[ListedCamera], FrameSource] = open_cv_source,
    permission: Permission = system_permission,
    system: str | None = None,
) -> Outcome:
    """Open the named camera and take one frame."""
    system = platform.system() if system is None else system
    if name is None:
        return Outcome(None, "none", "No camera is set for this laptop")
    try:
        listed = list(cameras())
    except (CaptureError, OSError) as error:
        logger.warning("L3 device check: cannot list cameras: %s", error)
        return Outcome(name, "not_found", f"The cameras could not be listed: {error}")
    early = _before_opening("camera", name, [camera.name for camera in listed], permission, system)
    if early is not None:
        return early
    try:
        with closing(
            frames(
                name,
                cameras=lambda: listed,
                make_source=make_source,
                open_timeout=settings.DEVICE_CHECK_OPEN_SECONDS,
            )
        ) as delivered:
            next(delivered)
    except CameraFormatMismatch as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "wrong_format",
            f"The camera '{name}' does not give {settings.FRAME_WIDTH} by "
            f"{settings.FRAME_HEIGHT} colour frames",
            "Pick another camera",
        )
    except (CameraNoFirstFrame, CameraReadFailed, CameraReadTimedOut) as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "no_data",
            f"The camera '{name}' opened but gave no picture",
            "Unplug the camera, plug it in again, then run the check again",
        )
    except CameraOpenFailed as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name, "open_failed", f"The camera '{name}' would not open", _open_fix("camera", system)
        )
    except CameraNotFound as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "not_found",
            f"No camera named '{name}' is connected",
            "Plug in the camera, then pick it again from the device list",
        )
    return Outcome(name, "ok", "Camera OK")


def check_mic(
    name: str | None,
    *,
    mics: Callable[[], Sequence[ListedMic]] = list_mics,
    make_source: Callable[[ListedMic], AudioSource] = sound_device_source,
    permission: Permission = system_permission,
    system: str | None = None,
) -> Outcome:
    """Open the named mic and read about DEVICE_CHECK_AUDIO_SECONDS of sound."""
    system = platform.system() if system is None else system
    if name is None:
        return Outcome(None, "none", "No mic is set for this laptop")
    try:
        listed = list(mics())
    except (MicError, OSError) as error:
        logger.warning("L3 device check: cannot list mics: %s", error)
        return Outcome(name, "not_found", f"The mics could not be listed: {error}")
    early = _before_opening("mic", name, [mic.name for mic in listed], permission, system)
    if early is not None:
        return early
    wanted = math.ceil(settings.DEVICE_CHECK_AUDIO_SECONDS / settings.AUDIO_CHUNK_SECONDS)
    heard = False
    try:
        with closing(
            chunks(
                name,
                mics=lambda: listed,
                make_source=make_source,
                open_timeout=settings.DEVICE_CHECK_OPEN_SECONDS,
            )
        ) as delivered:
            for _ in range(wanted):
                heard = heard or bool(np.any(next(delivered).samples))
    except MicFormatMismatch as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "wrong_format",
            f"The mic '{name}' does not give {settings.AUDIO_SAMPLE_RATE} Hz sound in "
            f"{settings.AUDIO_CHANNELS} channel",
            "Pick another mic",
        )
    except (MicNoFirstChunk, MicReadFailed, MicReadTimedOut) as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "no_data",
            f"The mic '{name}' opened but gave no sound",
            "Unplug the mic, plug it in again, then run the check again",
        )
    except MicOpenFailed as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name, "open_failed", f"The mic '{name}' would not open", _open_fix("mic", system)
        )
    except MicNotFound as error:
        logger.warning("L3 device check: %s", error)
        return Outcome(
            name,
            "not_found",
            f"No mic named '{name}' is connected",
            "Plug in the mic, then pick it again from the device list",
        )
    if not heard:
        return Outcome(
            name,
            "silent",
            f"The mic '{name}' opened but recorded only silence",
            _silent_fix(system),
        )
    return Outcome(name, "ok", "Mic OK")


def device_check(
    camera: Callable[[], Outcome],
    mic: Callable[[], Outcome],
    clock: Callable[[], datetime] = utc_now,
) -> dict[str, object]:
    """Check the camera and mic at the same time; one contracts/device-check.json object."""
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="layer3-device-check") as pool:
        camera_outcome = pool.submit(camera)
        mic_outcome = pool.submit(mic)
        outcomes = camera_outcome.result(), mic_outcome.result()
    return {
        "schema_version": settings.DEVICE_CHECK_SCHEMA_VERSION,
        "type": "device_check",
        "checked_at": utc_text(clock()),
        "ok": all(outcome.result in ("ok", "none") for outcome in outcomes),
        "camera": outcomes[0].written(),
        "mic": outcomes[1].written(),
    }
