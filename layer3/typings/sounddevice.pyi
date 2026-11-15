"""Types for the parts of sounddevice that Layer 3 uses. The library ships none of its own.

tests/test_mic.py checks this file against the installed library with mypy.stubtest.
"""

from typing import TypedDict, overload

import numpy as np
from numpy.typing import NDArray

class _Device(TypedDict):
    name: str
    hostapi: int
    max_input_channels: int
    default_samplerate: float

class _HostApi(TypedDict):
    name: str

class DeviceList(tuple[_Device, ...]): ...

class WasapiSettings:
    def __init__(
        self,
        exclusive: bool = False,
        auto_convert: bool = False,
        explicit_sample_format: bool = False,
    ) -> None: ...

@overload
def query_devices(device: None = None, kind: None = None) -> DeviceList: ...
@overload
def query_devices(device: int | str, kind: str | None = None) -> _Device: ...
@overload
def query_devices(device: None = None, *, kind: str) -> _Device: ...
@overload
def query_hostapis(index: None = None) -> tuple[_HostApi, ...]: ...
@overload
def query_hostapis(index: int) -> _HostApi: ...

class InputStream:
    def __init__(
        self,
        samplerate: float | None = None,
        blocksize: int | None = None,
        device: int | str | None = None,
        channels: int | None = None,
        dtype: str | None = None,
        latency: float | str | None = None,
        extra_settings: WasapiSettings | None = None,
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
