"""The device check (contracts/device-check.json), with fake cameras and mics."""

import json
import sys
import threading
import types
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from layer3 import settings
from layer3.camera import CameraNotFound, FrameSource, Image, ListedCamera
from layer3.device_check import (
    Outcome,
    Permission,
    check_camera,
    check_mic,
    device_check,
    system_permission,
)
from layer3.devices import Media
from layer3.mic import AudioSource, ListedMic, MicNotFound, Samples

REPO = Path(__file__).resolve().parents[2]
CHECKED_AT = datetime(2026, 11, 15, 3, 13, 2, tzinfo=UTC)
WEBCAM = ListedCamera("j5 WebCam JVCU100", 0)
WEBCAM_MIC = ListedMic("Audio Streaming", 0, 16000.0)
CHUNK = int(settings.AUDIO_SAMPLE_RATE * settings.AUDIO_CHUNK_SECONDS)
FIELDS = {"name", "result", "message", "fix", "similar"}


@pytest.fixture(autouse=True)
def short_waits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEVICE_CHECK_OPEN_SECONDS", 0.3)


def allowed(media: Media) -> str:
    return "allowed"


def refused(media: Media) -> str:
    return "refused"


def picture(width: int = settings.FRAME_WIDTH, height: int = settings.FRAME_HEIGHT) -> Image:
    return np.full((height, width, 3), 90, dtype=np.uint8)


def sound(value: int = 0, count: int = CHUNK) -> Samples:
    return np.full((count, settings.AUDIO_CHANNELS), value, dtype=np.int16)


class FakeCamera:
    """A camera that opens or not, and then always gives the same image, or none."""

    def __init__(
        self,
        image: Image | None = None,
        *,
        opens: bool = True,
        gate: threading.Barrier | None = None,
    ) -> None:
        self.image, self.opens, self.gate = image, opens, gate
        self.opened = False

    def open(self, width: int, height: int, frames_per_second: int) -> bool:
        if self.gate is not None:
            self.gate.wait()
        self.opened = True
        return self.opens

    def reported_frames_per_second(self) -> float:
        return float(settings.FRAMES_PER_SECOND)

    def read(self) -> Image | None:
        return self.image

    def close(self) -> None:
        return None


class FakeMic:
    """A mic that always gives the same samples, or blocks until closed when given none."""

    def __init__(
        self,
        samples: Samples | None = None,
        *,
        open_error: OSError | None = None,
        gate: threading.Barrier | None = None,
    ) -> None:
        self.samples, self.open_error, self.gate = samples, open_error, gate
        self.opened = False
        self.closed = threading.Event()

    def open(self, sample_rate: int, channels: int, chunk_samples: int) -> None:
        if self.gate is not None:
            self.gate.wait()
        if self.open_error is not None:
            raise self.open_error
        self.opened = True

    def read(self) -> tuple[Samples, bool]:
        if self.samples is None:
            self.closed.wait(settings.DEVICE_CHECK_OPEN_SECONDS * 3)
            return sound(), False
        return self.samples, False

    def close(self) -> None:
        self.closed.set()


def camera(
    source: FakeCamera,
    name: str | None = WEBCAM.name,
    listed: Sequence[ListedCamera] = (WEBCAM,),
    permission: Permission = allowed,
    system: str = "Darwin",
) -> Outcome:
    def make_source(chosen: ListedCamera) -> FrameSource:
        return source

    return check_camera(
        name,
        cameras=lambda: list(listed),
        make_source=make_source,
        permission=permission,
        system=system,
    )


def mic(
    source: FakeMic,
    name: str | None = WEBCAM_MIC.name,
    listed: Sequence[ListedMic] = (WEBCAM_MIC,),
    permission: Permission = allowed,
    system: str = "Darwin",
) -> Outcome:
    def make_source(chosen: ListedMic) -> AudioSource:
        return source

    return check_mic(
        name,
        mics=lambda: list(listed),
        make_source=make_source,
        permission=permission,
        system=system,
    )


def test_a_working_camera_and_a_silent_mac_mic_give_the_contract_example_exactly() -> None:
    example = json.loads((REPO / "contracts" / "device-check.json").read_text(encoding="utf-8"))

    written = device_check(
        lambda: camera(FakeCamera(picture())), lambda: mic(FakeMic(sound(0))), lambda: CHECKED_AT
    )

    assert written == example
    assert list(written) == list(example)


def test_a_camera_and_mic_that_work_are_ok() -> None:
    written = device_check(
        lambda: camera(FakeCamera(picture())), lambda: mic(FakeMic(sound(7))), lambda: CHECKED_AT
    )

    assert written["ok"] is True
    assert written["camera"] == {
        "name": WEBCAM.name,
        "result": "ok",
        "message": "Camera OK",
        "fix": None,
        "similar": [],
    }
    assert written["mic"] == {
        "name": WEBCAM_MIC.name,
        "result": "ok",
        "message": "Mic OK",
        "fix": None,
        "similar": [],
    }


def test_no_device_named_is_not_opened_and_counts_as_ok() -> None:
    source, sound_source = FakeCamera(picture()), FakeMic(sound(7))

    written = device_check(
        lambda: camera(source, name=None), lambda: mic(sound_source, name=None), lambda: CHECKED_AT
    )

    assert written["ok"] is True
    assert written["camera"] == {
        "name": None,
        "result": "none",
        "message": "No camera is set for this laptop",
        "fix": None,
        "similar": [],
    }
    assert not source.opened and not sound_source.opened


def test_one_failing_device_makes_the_check_not_ok() -> None:
    written = device_check(
        lambda: camera(FakeCamera(picture()), name="Gone"),
        lambda: mic(FakeMic(sound(7))),
        lambda: CHECKED_AT,
    )

    assert written["ok"] is False
    for part in ("camera", "mic"):
        entry = written[part]
        assert isinstance(entry, dict) and set(entry) == FIELDS


def test_the_camera_and_mic_are_checked_at_the_same_time() -> None:
    both_opening = threading.Barrier(2, timeout=2.0)

    written = device_check(
        lambda: camera(FakeCamera(picture(), gate=both_opening)),
        lambda: mic(FakeMic(sound(7), gate=both_opening)),
        lambda: CHECKED_AT,
    )

    assert written["ok"] is True


def test_a_name_no_device_has_is_not_found() -> None:
    outcome = camera(FakeCamera(picture()), name="j5 WebCam")

    assert outcome == Outcome(
        "j5 WebCam",
        "not_found",
        "No camera named 'j5 WebCam' is connected",
        "Plug in the camera, then pick it again from the device list",
        [],
    )


def test_a_windows_device_renamed_after_a_port_move_is_offered_but_not_picked() -> None:
    renamed = ListedMic("Microphone (2- Audio Streaming)", 3, 16000.0)
    source = FakeMic(sound(7))

    outcome = mic(source, name="Microphone (Audio Streaming)", listed=[renamed], system="Windows")

    assert outcome.result == "not_found"
    assert outcome.similar == ["Microphone (2- Audio Streaming)"]
    assert outcome.fix is not None and "'Microphone (2- Audio Streaming)'" in outcome.fix
    assert not source.opened


def test_two_devices_with_the_name_are_not_opened() -> None:
    source = FakeCamera(picture())

    outcome = camera(source, listed=[WEBCAM, ListedCamera(WEBCAM.name, 1)])

    assert outcome.result == "same_name"
    assert outcome.message == "2 cameras are named 'j5 WebCam JVCU100'"
    assert not source.opened


def test_a_device_the_system_refuses_is_named_and_not_opened() -> None:
    source, sound_source = FakeCamera(picture()), FakeMic(sound(7))

    on_mac = camera(source, permission=refused)
    on_windows = mic(sound_source, permission=refused, system="Windows")

    assert on_mac.result == "no_permission"
    assert on_mac.fix == (
        "On this Mac, open System Settings > Privacy & Security > Camera, allow the app that "
        "started the bridge, then start the bridge again"
    )
    assert on_windows.result == "no_permission"
    assert on_windows.fix is not None
    assert "Settings > Privacy & security > Microphone" in on_windows.fix
    assert not source.opened and not sound_source.opened


def test_a_camera_that_will_not_open_is_open_failed() -> None:
    outcome = camera(FakeCamera(picture(), opens=False))

    assert outcome.result == "open_failed"
    assert outcome.message == "The camera 'j5 WebCam JVCU100' would not open"
    assert outcome.fix is not None and "click Allow" in outcome.fix


def test_a_mic_that_fails_to_open_is_open_failed() -> None:
    outcome = mic(FakeMic(open_error=OSError("device busy")), system="Windows")

    assert outcome.result == "open_failed"
    assert outcome.fix is not None and "including a running worker" in outcome.fix


def test_a_camera_that_opens_but_gives_no_picture_is_no_data() -> None:
    outcome = camera(FakeCamera(None))

    assert outcome.result == "no_data"
    assert outcome.message == "The camera 'j5 WebCam JVCU100' opened but gave no picture"


def test_a_mic_that_opens_but_gives_no_sound_is_no_data() -> None:
    outcome = mic(FakeMic(None))

    assert outcome.result == "no_data"
    assert outcome.message == "The mic 'Audio Streaming' opened but gave no sound"


def test_a_device_in_another_format_is_wrong_format() -> None:
    small = camera(FakeCamera(picture(320, 240)))
    short = mic(FakeMic(sound(7, count=CHUNK // 2)))

    assert small.result == "wrong_format"
    assert small.message == "The camera 'j5 WebCam JVCU100' does not give 640 by 480 colour frames"
    assert short.result == "wrong_format"


def test_a_silent_mic_on_windows_says_to_check_mute_and_privacy() -> None:
    outcome = mic(FakeMic(sound(0)), system="Windows")

    assert outcome.result == "silent"
    assert outcome.fix == (
        "Check the mic is not muted and that Settings > Privacy & security > Microphone lets "
        "desktop apps use it, then run the check again"
    )


def test_a_list_that_cannot_be_read_is_not_found() -> None:
    def no_cameras() -> list[ListedCamera]:
        raise CameraNotFound("no camera backend is set for Plan9")

    def no_mics() -> list[ListedMic]:
        raise MicNotFound("the audio system could not list its mics")

    camera_outcome = check_camera(WEBCAM.name, cameras=no_cameras, permission=allowed)
    mic_outcome = check_mic(WEBCAM_MIC.name, mics=no_mics, permission=allowed)

    assert camera_outcome.result == "not_found"
    assert camera_outcome.message == (
        "The cameras could not be listed: no camera backend is set for Plan9"
    )
    assert mic_outcome.result == "not_found"


def test_permission_is_read_from_macos_and_unknown_elsewhere(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    states = {"vide": 2, "soun": 3}

    class AVCaptureDevice:
        @staticmethod
        def authorizationStatusForMediaType_(media_type: str) -> int:
            return states[media_type]

    module = types.ModuleType("AVFoundation")
    module.__dict__.update(
        AVMediaTypeVideo="vide", AVMediaTypeAudio="soun", AVCaptureDevice=AVCaptureDevice
    )
    monkeypatch.setitem(sys.modules, "AVFoundation", module)

    monkeypatch.setattr(sys, "platform", "darwin")
    assert system_permission("camera") == "refused"
    assert system_permission("mic") == "allowed"
    states["vide"] = 0
    assert system_permission("camera") == "not_asked"
    states["vide"] = 99
    assert system_permission("camera") == "unknown"
    monkeypatch.setattr(sys, "platform", "win32")
    assert system_permission("camera") == "unknown"
