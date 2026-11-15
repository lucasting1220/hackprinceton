"""Opens the one mic named in the worker config and hands out stamped audio chunks.

Only this module opens the mic. A background reader thread lists the mics, opens
the named one and reads chunks, so the caller never waits longer than the limits
in the settings module.

The reader thread here is a copy of the one in camera.py, kept separate by the
Layer 3 owner's decision. A fix to one reader has to be made in the other.

The audio library is loaded inside the reader thread, so its start-up, which
scans the audio devices, falls under the open time limit too.
"""

import logging
import platform
import queue
import threading
import time
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from layer3 import settings

logger = logging.getLogger(__name__)

READER_THREAD_NAME: str = "layer3-mic-reader"
CHUNK_SAMPLES: int = round(settings.AUDIO_SAMPLE_RATE * settings.AUDIO_CHUNK_SECONDS)

type Samples = NDArray[np.int16]


@dataclass(frozen=True, eq=False)
class AudioChunk:
    """One chunk of mic audio exactly as the audio library delivered it.

    samples has CHUNK_SAMPLES rows by settings.AUDIO_CHANNELS columns, of the type
    settings.AUDIO_SAMPLE_TYPE, at settings.AUDIO_SAMPLE_RATE samples a second.
    captured_at is in UTC, from the capturing laptop's clock, taken when the read
    of the chunk returned, so it marks the chunk's end.
    overflowed is true when the audio system reported that audio was lost just
    before this chunk.
    """

    samples: Samples
    captured_at: datetime
    overflowed: bool


@dataclass(frozen=True)
class ListedMic:
    """A mic the operating system lists, with the index it is opened by and its own rate."""

    name: str
    index: int
    default_sample_rate: float


class _Stream(Protocol):
    """The audio library's input stream, as the real source uses it."""

    def start(self) -> None: ...

    def read(self, frames: int) -> tuple[Samples, bool]: ...

    def stop(self) -> None: ...

    def close(self) -> None: ...


class AudioSource(Protocol):
    """The mic device, as the reader thread uses it. open and read raise when they fail."""

    def open(self, sample_rate: int, channels: int, chunk_samples: int) -> None: ...

    def read(self) -> tuple[Samples, bool]: ...

    def close(self) -> None: ...


class MicError(Exception):
    """The mic could not be found, opened or read."""


class MicNotFound(MicError):
    """No single listed mic has the name given in the config."""


class MicOpenFailed(MicError):
    """The mic failed while opening, or did not open in time."""


class MicReadFailed(MicError):
    """Reading a chunk from the mic raised an error."""


class MicReadTimedOut(MicError):
    """No chunk arrived within the chunk time limit."""


class MicFormatMismatch(MicError):
    """The mic delivered a chunk in a format other than the one asked for."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def list_mics() -> list[ListedMic]:
    """List the audio inputs the operating system reports, in this system's host interface."""
    interface = _host_interface()
    import sounddevice

    hosts = sounddevice.query_hostapis()
    return [
        ListedMic(device["name"], index, float(device["default_samplerate"]))
        for index, device in enumerate(sounddevice.query_devices())
        if device["max_input_channels"] > 0 and hosts[device["hostapi"]]["name"] == interface
    ]


def _host_interface() -> str:
    system = platform.system()
    interface = settings.AUDIO_HOST_INTERFACES.get(system)
    if interface is None:
        raise MicNotFound(f"no audio host interface is set for {system}")
    return interface


def find_mic(name: str, listed: Sequence[ListedMic]) -> ListedMic:
    """Return the one listed mic with exactly this name. Never picks between two."""
    matches = [candidate for candidate in listed if candidate.name == name]
    if len(matches) == 1:
        return matches[0]
    problem = "matches more than one mic" if matches else "was not found"
    found = ", ".join(f"{candidate.name!r} (index {candidate.index})" for candidate in listed)
    raise MicNotFound(f"mic {name!r} {problem}; mics found: {found or 'none'}")


class _SoundDeviceSource:
    """The real mic, through sounddevice."""

    def __init__(self, listed: ListedMic) -> None:
        self._listed: ListedMic = listed
        self._stream: _Stream | None = None
        self._chunk_samples: int = 0

    def open(self, sample_rate: int, channels: int, chunk_samples: int) -> None:
        import sounddevice

        self._chunk_samples = chunk_samples
        converts_on_request = _host_interface() == settings.AUDIO_INTERFACE_NEEDING_CONVERT_REQUEST
        stream: _Stream = sounddevice.InputStream(
            samplerate=sample_rate,
            blocksize=chunk_samples,
            device=self._listed.index,
            channels=channels,
            dtype=settings.AUDIO_SAMPLE_TYPE,
            dither_off=True,
            extra_settings=(
                sounddevice.WasapiSettings(auto_convert=True) if converts_on_request else None
            ),
        )
        self._stream = stream
        stream.start()

    def read(self) -> tuple[Samples, bool]:
        if self._stream is None:
            raise MicReadFailed("the mic is not open")
        samples, overflowed = self._stream.read(self._chunk_samples)
        return samples, bool(overflowed)

    def close(self) -> None:
        if self._stream is not None:
            stream, self._stream = self._stream, None
            stream.stop()
            stream.close()


def sound_device_source(listed: ListedMic) -> AudioSource:
    return _SoundDeviceSource(listed)


def chunks(
    mic: str,
    *,
    clock: Callable[[], datetime] = utc_now,
    mics: Callable[[], Sequence[ListedMic]] = list_mics,
    make_source: Callable[[ListedMic], AudioSource] = sound_device_source,
    open_timeout: float = settings.AUDIO_OPEN_TIMEOUT_SECONDS,
    chunk_timeout: float = settings.AUDIO_CHUNK_TIMEOUT_SECONDS,
) -> Generator[AudioChunk, None, None]:
    """Open the mic with this name and yield every chunk it delivers, unchanged and stamped.

    Layer 3 code drops no audio: a slow reader makes the reader thread wait, and
    audio the system loses meanwhile is marked on the next chunk.
    Closing the generator stops the reader thread, which then closes the mic.
    """
    reader = _Reader(mic, mics, make_source, clock)
    reader.start()
    first_chunk_due = time.monotonic() + open_timeout
    opened = False
    try:
        listed = reader.wait_until_open(open_timeout)
        opened = True
        _log_rate(listed)
        yield reader.first_chunk(max(first_chunk_due - time.monotonic(), 0.0), open_timeout)
        while True:
            yield reader.next_chunk(chunk_timeout)
    finally:
        if not reader.stop(chunk_timeout):
            logger.warning(
                "L3 capture: a mic call for %r has not returned; "
                "the reader thread is left behind until it does",
                mic,
            )
        elif opened:
            logger.info("L3 capture: stopped reading mic %r", mic)


def _log_rate(listed: ListedMic) -> None:
    if listed.default_sample_rate == settings.AUDIO_SAMPLE_RATE:
        logger.info("L3 capture: mic %r runs at %d Hz", listed.name, settings.AUDIO_SAMPLE_RATE)
    else:
        logger.warning(
            "L3 capture: mic %r runs at %.0f Hz itself; the audio system converts it to %d Hz",
            listed.name,
            listed.default_sample_rate,
            settings.AUDIO_SAMPLE_RATE,
        )


def _check_format(listed: ListedMic, samples: Samples) -> None:
    if samples.shape != (CHUNK_SAMPLES, settings.AUDIO_CHANNELS):
        delivered = f"a chunk of shape {samples.shape}"
    elif samples.dtype != np.dtype(settings.AUDIO_SAMPLE_TYPE):
        delivered = f"{samples.dtype} samples"
    else:
        return
    raise MicFormatMismatch(
        f"mic {listed.name!r} was asked for chunks of {CHUNK_SAMPLES} {settings.AUDIO_SAMPLE_TYPE} "
        f"samples in {settings.AUDIO_CHANNELS} channel but delivered {delivered}"
    )


class _Reader:
    """Lists the mics, opens the named one and reads chunks, all on a background thread.

    A mic call that never returns cannot be stopped. The caller still gets an
    error within its time limit; the thread is left behind and closes the mic
    when the call returns. An error raised by a mic call is logged and handed to
    the caller as a MicError that names it.
    """

    def __init__(
        self,
        mic: str,
        mics: Callable[[], Sequence[ListedMic]],
        make_source: Callable[[ListedMic], AudioSource],
        clock: Callable[[], datetime],
    ) -> None:
        self._mic: str = mic
        self._mics: Callable[[], Sequence[ListedMic]] = mics
        self._make_source: Callable[[ListedMic], AudioSource] = make_source
        self._clock: Callable[[], datetime] = clock
        self._chunks: queue.Queue[AudioChunk | MicError] = queue.Queue(
            maxsize=settings.AUDIO_QUEUE_SIZE
        )
        self._open_done: threading.Event = threading.Event()
        self._stop: threading.Event = threading.Event()
        self._opened: ListedMic | None = None
        self._open_failure: MicError | None = None
        self._time_limit_ran_out: bool = False
        self._thread: threading.Thread = threading.Thread(
            target=self._run, name=READER_THREAD_NAME, daemon=True
        )

    def start(self) -> None:
        self._thread.start()

    def wait_until_open(self, timeout: float) -> ListedMic:
        if not self._open_done.wait(timeout):
            self._time_limit_ran_out = True
            raise MicOpenFailed(f"the mic did not open within {timeout:g} seconds")
        if self._open_failure is not None:
            raise self._open_failure
        if self._opened is None:
            raise MicOpenFailed("the reader thread ended before the mic opened")
        return self._opened

    def first_chunk(self, timeout: float, open_timeout: float) -> AudioChunk:
        """Wait for the first chunk, which shares the open time limit."""
        try:
            return self._next(timeout)
        except queue.Empty:
            self._time_limit_ran_out = True
            raise MicOpenFailed(
                f"the mic opened but delivered no first chunk within {open_timeout:g} seconds"
            ) from None

    def next_chunk(self, timeout: float) -> AudioChunk:
        try:
            return self._next(timeout)
        except queue.Empty:
            self._time_limit_ran_out = True
            raise MicReadTimedOut(f"no chunk arrived within {timeout:g} seconds") from None

    def stop(self, timeout: float) -> bool:
        """Tell the thread to stop and say whether it ended.

        After a time limit ran out the thread may be stuck in a mic call, so the
        wait is kept short and the caller hears about the failure on time.
        """
        self._stop.set()
        limit = settings.ABANDON_WAIT_SECONDS if self._time_limit_ran_out else timeout
        self._thread.join(limit)
        return not self._thread.is_alive()

    def _next(self, timeout: float) -> AudioChunk:
        item = self._chunks.get(timeout=timeout)
        if isinstance(item, MicError):
            raise item
        return item

    def _run(self) -> None:
        source: AudioSource | None = None
        try:
            try:
                listed = find_mic(self._mic, self._mics())
                if self._stop.is_set():
                    return
                logger.info("L3 capture: opening mic %r", listed.name)
                source = self._make_source(listed)
                source.open(settings.AUDIO_SAMPLE_RATE, settings.AUDIO_CHANNELS, CHUNK_SAMPLES)
                self._opened = listed
            except MicError as error:
                self._open_failure = error
                return
            except Exception as error:
                logger.error("L3 capture: opening mic %r failed: %r", self._mic, error)
                self._open_failure = MicOpenFailed(f"opening the mic failed: {error!r}")
                self._open_failure.__cause__ = error
                return
            finally:
                self._open_done.set()
            self._read_chunks(listed, source)
        finally:
            if source is not None:
                self._close(source)

    def _close(self, source: AudioSource) -> None:
        try:
            source.close()
        except Exception as error:
            logger.error("L3 capture: closing mic %r failed: %r", self._mic, error)

    def _read_chunks(self, listed: ListedMic, source: AudioSource) -> None:
        try:
            while not self._stop.is_set():
                samples, overflowed = source.read()
                _check_format(listed, samples)
                if overflowed:
                    logger.warning("L3 capture: mic %r lost audio before this chunk", listed.name)
                self._hand_over(AudioChunk(samples, self._clock(), overflowed))
        except MicError as error:
            logger.error("L3 capture: reading mic %r stopped: %s", self._mic, error)
            self._hand_over(error)
        except Exception as error:
            logger.error("L3 capture: reading mic %r failed: %r", self._mic, error)
            failure = MicReadFailed(f"reading the mic failed: {error!r}")
            failure.__cause__ = error
            self._hand_over(failure)

    def _hand_over(self, item: AudioChunk | MicError) -> None:
        waited = False
        while not self._stop.is_set():
            try:
                self._chunks.put(item, timeout=settings.STOP_CHECK_SECONDS)
            except queue.Full:
                if not waited:
                    waited = True
                    logger.warning(
                        "L3 capture: the reader of mic %r is behind; a chunk is waiting", self._mic
                    )
                continue
            return
