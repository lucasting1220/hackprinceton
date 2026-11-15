"""The device list (contracts/device-list.json), with fake listings and a fake AVFoundation."""

import json
import sys
import types
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from layer3 import devices
from layer3.camera import CameraNotFound, ListedCamera
from layer3.devices import (
    Kinds,
    Listed,
    device_list,
    kind_of,
    list_names,
    mac_kind,
    name_kind,
    similar_names,
    utc_text,
)
from layer3.mic import ListedMic, MicNotFound

REPO = Path(__file__).resolve().parents[2]
LISTED_AT = datetime(2026, 11, 15, 3, 12, 45, 600000, tzinfo=UTC)
NO_KINDS: Kinds = {"camera": {}, "mic": {}}


def fourcc(text: str) -> int:
    return int.from_bytes(text.encode("latin-1"), "big")


def contract() -> dict[str, object]:
    example: dict[str, object] = json.loads(
        (REPO / "contracts" / "device-list.json").read_text(encoding="utf-8")
    )
    return example


class FakeDevice:
    """One AVCaptureDevice, as pyobjc shows it."""

    def __init__(self, name: str, device_type: str, transport: str) -> None:
        self._name, self._type, self._transport = name, device_type, transport

    def localizedName(self) -> str:
        return self._name

    def deviceType(self) -> str:
        return self._type

    def transportType(self) -> int:
        return fourcc(self._transport) if self._transport else 0


def fake_avfoundation(
    monkeypatch: pytest.MonkeyPatch, video: list[FakeDevice], audio: list[FakeDevice]
) -> None:
    listed = {"vide": video, "soun": audio}

    class AVCaptureDevice:
        @staticmethod
        def devicesWithMediaType_(media_type: str) -> list[FakeDevice]:
            return listed[media_type]

    module = types.ModuleType("AVFoundation")
    module.__dict__.update(
        AVMediaTypeVideo="vide", AVMediaTypeAudio="soun", AVCaptureDevice=AVCaptureDevice
    )
    monkeypatch.setitem(sys.modules, "AVFoundation", module)


def test_mac_kinds_come_from_the_transport_and_device_type() -> None:
    assert mac_kind("AVCaptureDeviceTypeExternal", fourcc("usb ")) == "external"
    assert mac_kind("AVCaptureDeviceTypeBuiltInWideAngleCamera", fourcc("bltn")) == "built_in"
    assert mac_kind("AVCaptureDeviceTypeMicrophone", fourcc("bltn")) == "built_in"
    assert mac_kind("AVCaptureDeviceTypeExternal", fourcc("virt")) == "virtual"
    assert mac_kind("AVCaptureDeviceTypeContinuityCamera", fourcc("usb ")) == "continuity"
    assert mac_kind("AVCaptureDeviceTypeDeskViewCamera", 0) == "continuity"
    assert mac_kind("AVCaptureDeviceTypeMicrophone", fourcc("ccwl")) == "continuity"
    assert mac_kind("AVCaptureDeviceTypeExternal", fourcc("airp")) == "unknown"
    assert mac_kind("AVCaptureDeviceTypeExternal", 0) == "unknown"
    assert mac_kind("AVCaptureDeviceTypeExternal", 2**40) == "unknown"


def test_mac_kinds_read_every_camera_and_mic_and_distrust_a_shared_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_avfoundation(
        monkeypatch,
        video=[
            FakeDevice("j5 WebCam JVCU100", "AVCaptureDeviceTypeExternal", "usb "),
            FakeDevice("MacBook Air Camera", "AVCaptureDeviceTypeBuiltInWideAngleCamera", "bltn"),
            FakeDevice("Twin", "AVCaptureDeviceTypeExternal", "usb "),
            FakeDevice("Twin", "AVCaptureDeviceTypeExternal", "virt"),
        ],
        audio=[FakeDevice("Audio Streaming", "AVCaptureDeviceTypeMicrophone", "usb ")],
    )

    assert devices.mac_kinds() == {
        "camera": {
            "j5 WebCam JVCU100": "external",
            "MacBook Air Camera": "built_in",
            "Twin": "unknown",
        },
        "mic": {"Audio Streaming": "external"},
    }


def test_windows_kinds_come_only_from_words_in_the_name() -> None:
    assert name_kind("Integrated Webcam") == "built_in"
    assert name_kind("Microphone Array (Realtek(R) Audio)") == "built_in"
    assert name_kind("OBS Virtual Camera") == "virtual"
    assert name_kind("Stereo Mix (Realtek(R) Audio)") == "virtual"
    assert name_kind("j5 WebCam JVCU100") == "unknown"
    assert name_kind("Microphone (HD 2MP WEBCAM)") == "unknown"


def test_a_recorded_kind_wins_and_only_windows_guesses_from_the_name() -> None:
    kinds: Kinds = {"camera": {"Integrated Webcam": "external"}, "mic": {}}

    assert kind_of("Integrated Webcam", "camera", kinds, "Windows") == "external"
    assert kind_of("Integrated Camera", "camera", kinds, "Windows") == "built_in"
    assert kind_of("Integrated Camera", "camera", kinds, "Darwin") == "unknown"
    assert kind_of("Integrated Webcam", "mic", kinds, "Darwin") == "unknown"


def test_the_demo_macs_devices_give_the_contract_example_exactly() -> None:
    listed = list_names(
        cameras=lambda: [
            ListedCamera("j5 WebCam JVCU100", 0),
            ListedCamera("MacBook Air Camera", 1),
        ],
        mics=lambda: [
            ListedMic("Audio Streaming", 0, 16000.0),
            ListedMic("MacBook Air Microphone", 1, 48000.0),
        ],
    )
    kinds: Kinds = {
        "camera": {"j5 WebCam JVCU100": "external", "MacBook Air Camera": "built_in"},
        "mic": {"Audio Streaming": "external", "MacBook Air Microphone": "built_in"},
    }

    written = device_list(listed, kinds, LISTED_AT, system="Darwin")

    assert written == contract()
    assert json.loads(json.dumps(written)) == contract()


def test_two_devices_with_one_name_are_both_flagged() -> None:
    listed = Listed(cameras=["Cam", "Cam", "Other"], mics=["Mic"], problems=[])

    written = device_list(listed, NO_KINDS, LISTED_AT, system="Windows")

    assert written["cameras"] == [
        {"name": "Cam", "kind": "unknown", "same_name": True},
        {"name": "Cam", "kind": "unknown", "same_name": True},
        {"name": "Other", "kind": "unknown", "same_name": False},
    ]
    assert written["mics"] == [{"name": "Mic", "kind": "unknown", "same_name": False}]


def test_a_list_that_cannot_be_read_is_empty_and_named_as_a_problem() -> None:
    def no_cameras() -> list[ListedCamera]:
        raise CameraNotFound("no camera backend is set for Plan9")

    def no_mics() -> list[ListedMic]:
        raise MicNotFound("the audio system could not list its mics: no PortAudio")

    listed = list_names(cameras=no_cameras, mics=no_mics)
    written = device_list(listed, NO_KINDS, LISTED_AT, system="Darwin")

    assert written["cameras"] == [] and written["mics"] == []
    assert written["problems"] == [
        "The cameras could not be listed: no camera backend is set for Plan9",
        "The mics could not be listed: the audio system could not list its mics: no PortAudio",
    ]


def test_kinds_that_cannot_be_read_leave_every_device_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken() -> Kinds:
        raise ImportError("No module named 'AVFoundation'")

    monkeypatch.setattr(devices, "system_kinds", broken)
    problems: list[str] = []

    assert devices.read_kinds(problems) == NO_KINDS
    assert problems == ["The kind of each device could not be read: No module named 'AVFoundation'"]


def test_only_macos_has_recorded_kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_avfoundation(
        monkeypatch, video=[FakeDevice("Cam", "AVCaptureDeviceTypeExternal", "usb ")], audio=[]
    )

    monkeypatch.setattr(sys, "platform", "win32")
    assert devices.system_kinds() == NO_KINDS
    monkeypatch.setattr(sys, "platform", "darwin")
    assert devices.system_kinds() == {"camera": {"Cam": "external"}, "mic": {}}


def test_a_device_windows_renamed_after_a_port_move_is_found_as_similar() -> None:
    listed = ["Microphone (2- Audio Streaming)", "Microphone (Realtek(R) Audio)"]

    assert similar_names("Microphone (Audio Streaming)", listed) == [
        "Microphone (2- Audio Streaming)"
    ]
    assert similar_names("microphone (3- audio streaming)", listed) == [
        "Microphone (2- Audio Streaming)"
    ]
    assert similar_names("Microphone (2- Audio Streaming)", listed) == []
    assert similar_names("Something else", listed) == []


def test_times_are_utc_to_whole_seconds_with_z() -> None:
    minus_five = timezone(timedelta(hours=-5))

    assert utc_text(datetime(2026, 11, 14, 22, 12, 45, 999999, tzinfo=minus_five)) == (
        "2026-11-15T03:12:45Z"
    )
