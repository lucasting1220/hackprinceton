"""Types for the parts of sounddevice that Layer 3 uses. The library ships none of its own.

tests/test_mic.py checks this file against the installed library with mypy.stubtest.
"""

from typing import TypedDict

import numpy as np
from numpy.typing import NDArray

class _Device(TypedDict):
    name: str
    index: int
    hostapi: int
    max_input_channels: int
    max_output_channels: int
    default_samplerate: float

class _HostApi(TypedDict):
    name: str
    devices: list[int]
    default_input_device: int
    default_output_device: int

class PortAudioError(Exception): ...
class DeviceList(tuple[_Device, ...]): ...

def query_devices(device: int | str | None = None, kind: str | None = None) -> DeviceList: ...
def query_hostapis(index: int | None = None) -> tuple[_HostApi, ...]: ...

class InputStream:
    def __init__(
        self,
        samplerate: float | None = None,
        blocksize: int | None = None,
        device: int | str | None = None,
        channels: int | None = None,
        dtype: str | None = None,
        latency: float | str | None = None,
        extra_settings: object | None = None,
        callback: object | None = None,
        finished_callback: object | None = None,
        clip_off: bool | None = None,
        dither_off: bool | None = None,
        never_drop_input: bool | None = None,
        prime_output_buffers_using_stream_callback: bool | None = None,
    ) -> None: ...
    def start(self) -> None: ...
    def stop(self, ignore_errors: bool = True) -> None: ...
    def close(self, ignore_errors: bool = True) -> None: ...
    def read(self, frames: int) -> tuple[NDArray[np.int16], bool]: ...
