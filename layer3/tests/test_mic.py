"""Tests for the mic capture code and the audio reader, using a fake mic. No hardware needed."""

import json
import logging
import platform
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Generator, Iterator, Sequence
from contextlib import closing
from datetime import UTC, datetime, timedelta
from itertools import islice
from pathlib import Path

import numpy as np
import pytest

from layer3 import audio_reader, mic, settings
from layer3.mic import (
    AudioChunk,
    ListedMic,
    MicFormatMismatch,
    MicNotFound,
    MicOpenFailed,
    MicReadFailed,
    MicReadTimedOut,
    Samples,
    chunks,
)

WEBCAM_MIC = ListedMic("Audio Streaming", 0, 16000.0)
BUILT_IN = ListedMic("MacBook Air Microphone", 1, 48000.0)
SHORT_TIMEOUT: float = 0.1
WAIT_LIMIT: float = 2.0
IDLE_READ_SECONDS: float = 0.005
LAYER_DIRECTORY: Path = Path(__file__).resolve().parents[1]


def samples(value: int = 0, count: int = 8000, channels: int = 1) -> Samples:
    return np.full((count, channels), value, dtype=np.int16)


class FakeSource:
    """A mic that delivers the chunks it is given, then silence. An unset gate blocks a call."""

    def __init__(
        self,
        chunks: Sequence[Samples] = (),
        *,
        overflow_on: Sequence[int] = (),
        open_gate: threading.Event | None = None,
        read_gate: threading.Event | None = None,
        open_error: OSError | None = None,
        read_error: OSError | None = None,
        close_error: OSError | None = None,
    ) -> None:
        self.chunks: list[Samples] = list(chunks)
        self.overflow_on: Sequence[int] = overflow_on
        self.open_gate: threading.Event | None = open_gate
        self.read_gate: threading.Event | None = read_gate
        self.open_error: OSError | None = open_error
        self.read_error: OSError | None = read_error
        self.close_error: OSError | None = close_error
        self.opened_with: tuple[int, int, int] | None = None
        self.reads: int = 0
        self.closed: threading.Event = threading.Event()
        self.close_calls: int = 0
        self.read_waiting: threading.Event = threading.Event()

    def open(self, sample_rate: int, channels: int, chunk_samples: int) -> None:
        if self.open_gate is not None:
            self.open_gate.wait(WAIT_LIMIT)
        if self.open_error is not None:
            raise self.open_error
        self.opened_with = (sample_rate, channels, chunk_samples)

    def read(self) -> tuple[Samples, bool]:
        if self.read_gate is not None:
            if not self.read_gate.is_set():
                self.read_waiting.set()
            self.read_gate.wait(WAIT_LIMIT)
        self.reads += 1
        overflowed = self.reads in self.overflow_on
        if self.chunks:
            return self.chunks.pop(0), overflowed
        if self.read_error is not None:
            raise self.read_error
        time.sleep(IDLE_READ_SECONDS)
        return samples(), overflowed

    def close(self) -> None:
        self.close_calls += 1
        self.closed.set()
        if self.close_error is not None:
            raise self.close_error


def stream(
    source: FakeSource,
    wanted: str = WEBCAM_MIC.name,
    *,
    listed: Sequence[ListedMic] = (WEBCAM_MIC, BUILT_IN),
    mics: Callable[[], Sequence[ListedMic]] | None = None,
    clock: Callable[[], datetime] = mic.utc_now,
    opened: list[ListedMic] | None = None,
    open_timeout: float = WAIT_LIMIT,
    chunk_timeout: float = WAIT_LIMIT,
) -> Generator[AudioChunk, None, None]:
    def make_source(chosen: ListedMic) -> FakeSource:
        if opened is not None:
            opened.append(chosen)
        return source

    return chunks(
        wanted,
        clock=clock,
        mics=mics if mics is not None else lambda: listed,
        make_source=make_source,
        open_timeout=open_timeout,
        chunk_timeout=chunk_timeout,
    )


def reader_thread_ended() -> bool:
    deadline = time.monotonic() + WAIT_LIMIT
    while time.monotonic() < deadline:
        if not any(thread.name == mic.READER_THREAD_NAME for thread in threading.enumerate()):
            return True
        time.sleep(0.01)
    return False


def warnings_about(caplog: pytest.LogCaptureFixture, text: str) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING and text in record.getMessage()
    ]


def test_the_mic_with_exactly_that_name_is_opened_with_the_format_from_settings() -> None:
    source = FakeSource([samples(1)])
    opened: list[ListedMic] = []

    with closing(stream(source, BUILT_IN.name, opened=opened)) as chunk_stream:
        next(chunk_stream)

    assert opened == [BUILT_IN]
    assert source.opened_with == (16000, 1, 8000)


@pytest.mark.parametrize(
    ("wanted", "listed", "problem"),
    [
        ("Audio", (WEBCAM_MIC, BUILT_IN), "was not found"),
        (WEBCAM_MIC.name, (), "mics found: none"),
        (
            WEBCAM_MIC.name,
            (WEBCAM_MIC, ListedMic(WEBCAM_MIC.name, 2, 16000.0)),
            "matches more than one mic",
        ),
    ],
)
def test_no_single_match_is_mic_not_found_and_nothing_is_opened(
    wanted: str, listed: Sequence[ListedMic], problem: str
) -> None:
    opened: list[ListedMic] = []

    with pytest.raises(MicNotFound, match=problem) as failure:
        next(stream(FakeSource([samples()]), wanted, listed=listed, opened=opened))

    assert opened == []
    assert repr(wanted) in str(failure.value)
    for candidate in listed:
        assert f"{candidate.name!r} (index {candidate.index})" in str(failure.value)
    assert reader_thread_ended()


def fake_library_listing(monkeypatch: pytest.MonkeyPatch) -> None:
    interface = settings.AUDIO_HOST_INTERFACES[platform.system()]
    devices = [
        {
            "name": "Audio Streaming",
            "hostapi": 0,
            "max_input_channels": 1,
            "default_samplerate": 16000.0,
        },
        {
            "name": "MacBook Air Microphone",
            "hostapi": 0,
            "max_input_channels": 1,
            "default_samplerate": 48000.0,
        },
        {
            "name": "MacBook Air Speakers",
            "hostapi": 0,
            "max_input_channels": 0,
            "default_samplerate": 48000.0,
        },
        {
            "name": "Audio Streaming",
            "hostapi": 1,
            "max_input_channels": 1,
            "default_samplerate": 16000.0,
        },
    ]
    monkeypatch.setattr(mic.sounddevice, "query_devices", lambda: devices)
    monkeypatch.setattr(
        mic.sounddevice, "query_hostapis", lambda: ({"name": interface}, {"name": "Other"})
    )


def test_listing_mics_keeps_only_inputs_of_this_systems_host_interface(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_library_listing(monkeypatch)

    assert mic.list_mics() == [WEBCAM_MIC, BUILT_IN]


def test_listing_mics_on_a_system_with_no_host_interface_set_is_mic_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(mic.platform, "system", lambda: "Plan 9")

    with pytest.raises(MicNotFound, match="no audio host interface is set for Plan 9"):
        mic.list_mics()


def test_listing_that_blocks_is_mic_open_failed_and_the_mic_is_never_opened() -> None:
    gate = threading.Event()
    opened: list[ListedMic] = []
    started = time.monotonic()

    def blocked_listing() -> Sequence[ListedMic]:
        gate.wait(WAIT_LIMIT)
        return (WEBCAM_MIC,)

    with pytest.raises(MicOpenFailed, match="did not open within 0.1 seconds"):
        next(
            stream(
                FakeSource([samples()]),
                mics=blocked_listing,
                opened=opened,
                open_timeout=SHORT_TIMEOUT,
            )
        )

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: the time limit is the behaviour
    gate.set()
    assert reader_thread_ended()
    assert opened == []


def test_listing_that_raises_is_mic_open_failed_naming_the_failure_at_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def failing_listing() -> Sequence[ListedMic]:
        raise OSError("listing failed")

    started = time.monotonic()

    with (
        caplog.at_level(logging.ERROR, logger=mic.logger.name),
        pytest.raises(MicOpenFailed, match="listing failed"),
    ):
        next(stream(FakeSource([samples()]), mics=failing_listing))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert "listing failed" in caplog.text
    assert reader_thread_ended()


def test_every_chunk_is_passed_on_unchanged_in_order_silence_included() -> None:
    sent = [samples(1), samples(0), samples(3)]

    with closing(stream(FakeSource(sent))) as chunk_stream:
        received = list(islice(chunk_stream, 3))

    assert all(chunk.samples is original for chunk, original in zip(received, sent, strict=True))
    assert [chunk.overflowed for chunk in received] == [False, False, False]


def test_each_chunk_is_stamped_in_utc_when_its_read_returned() -> None:
    start = datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
    ticks: Iterator[datetime] = (start + timedelta(seconds=0.5 * tick) for tick in range(100))
    sent = [samples(1), samples(2), samples(3)]

    with closing(stream(FakeSource(sent), clock=lambda: next(ticks))) as chunk_stream:
        received = list(islice(chunk_stream, 3))

    assert [chunk.captured_at for chunk in received] == [
        start + timedelta(seconds=0.5 * tick) for tick in range(3)
    ]
    assert all(chunk.captured_at.utcoffset() == timedelta(0) for chunk in received)


@pytest.mark.parametrize(
    ("wrong", "delivered"),
    [
        (samples(count=4000), r"shape \(4000, 1\)"),
        (samples(channels=2), r"shape \(8000, 2\)"),
        (np.zeros((8000, 1), dtype=np.float32), "float32 samples"),
    ],
)
def test_a_chunk_in_another_format_stops_capture_and_closes_the_mic(
    wrong: Samples, delivered: str
) -> None:
    source = FakeSource([samples(1), wrong])

    with closing(stream(source)) as chunk_stream:
        next(chunk_stream)
        with pytest.raises(MicFormatMismatch, match=delivered):
            next(chunk_stream)

    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()
    assert source.close_calls == 1


@pytest.mark.parametrize(("own_rate", "warned"), [(48000.0, 1), (16000.0, 0)])
def test_a_mic_whose_own_rate_differs_is_still_opened_at_16_khz_with_one_warning(
    own_rate: float, warned: int, caplog: pytest.LogCaptureFixture
) -> None:
    source = FakeSource([samples(1)])
    listed = (ListedMic(WEBCAM_MIC.name, 0, own_rate),)

    with (
        caplog.at_level(logging.INFO, logger=mic.logger.name),
        closing(stream(source, listed=listed)) as chunk_stream,
    ):
        next(chunk_stream)

    assert source.opened_with == (16000, 1, 8000)
    assert len(warnings_about(caplog, "runs at 48000 Hz itself")) == warned


def test_audio_lost_before_a_chunk_is_marked_on_that_chunk_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource([samples(1), samples(2), samples(3)], overflow_on=(2,))

    with (
        caplog.at_level(logging.WARNING, logger=mic.logger.name),
        closing(stream(source)) as chunk_stream,
    ):
        received = list(islice(chunk_stream, 3))

    assert [chunk.overflowed for chunk in received] == [False, True, False]
    assert len(warnings_about(caplog, "lost audio")) == 1


def test_a_reader_that_falls_behind_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    source = FakeSource([samples(value) for value in range(1, 6)])

    with (
        caplog.at_level(logging.WARNING, logger=mic.logger.name),
        closing(stream(source)) as chunk_stream,
    ):
        next(chunk_stream)
        deadline = time.monotonic() + WAIT_LIMIT
        while not warnings_about(caplog, "is behind") and time.monotonic() < deadline:
            time.sleep(0.01)
        received = list(islice(chunk_stream, 4))

    assert warnings_about(caplog, "is behind")
    assert [int(chunk.samples[0, 0]) for chunk in received] == [2, 3, 4, 5]


def test_an_open_that_raises_is_mic_open_failed_naming_the_failure_at_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource(open_error=OSError("device busy"))
    started = time.monotonic()

    with (
        caplog.at_level(logging.ERROR, logger=mic.logger.name),
        pytest.raises(MicOpenFailed, match="device busy") as failure,
    ):
        next(stream(source))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert isinstance(failure.value.__cause__, OSError)
    assert "device busy" in caplog.text
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_an_open_that_blocks_is_reported_at_the_open_time_limit_not_after_cleanup() -> None:
    gate = threading.Event()
    source = FakeSource([samples()], open_gate=gate)
    started = time.monotonic()

    with pytest.raises(MicOpenFailed, match="did not open within 0.1 seconds"):
        next(stream(source, open_timeout=SHORT_TIMEOUT))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: cleanup must not add the 2 s limit
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_a_slow_first_chunk_is_allowed_the_open_time_limit_not_the_chunk_one() -> None:
    gate = threading.Event()
    wanted = samples(4)
    source = FakeSource([wanted], read_gate=gate)
    release = threading.Timer(3 * SHORT_TIMEOUT, gate.set)
    release.start()

    with closing(stream(source, chunk_timeout=SHORT_TIMEOUT)) as chunk_stream:
        assert next(chunk_stream).samples is wanted

    release.join()


def test_no_first_chunk_within_the_open_time_limit_is_mic_open_failed() -> None:
    gate = threading.Event()
    source = FakeSource([samples()], read_gate=gate)
    started = time.monotonic()

    with pytest.raises(MicOpenFailed, match="no first chunk within 0.1 seconds"):
        next(stream(source, open_timeout=SHORT_TIMEOUT))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: cleanup must not add the 2 s limit
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_a_read_that_blocks_after_the_first_chunk_is_mic_read_timed_out() -> None:
    gate = threading.Event()
    gate.set()
    source = FakeSource([samples(1)], read_gate=gate)

    with closing(stream(source, chunk_timeout=SHORT_TIMEOUT)) as chunk_stream:
        next(chunk_stream)
        gate.clear()
        assert source.read_waiting.wait(WAIT_LIMIT)
        started = time.monotonic()
        with pytest.raises(MicReadTimedOut, match="no chunk arrived within 0.1 seconds"):
            for _ in chunk_stream:
                pass

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: the time limit is the behaviour
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


@pytest.mark.parametrize("delivered_first", [1, 0])
def test_a_read_that_raises_is_mic_read_failed_naming_the_failure(
    delivered_first: int, caplog: pytest.LogCaptureFixture
) -> None:
    source = FakeSource([samples(1)] * delivered_first, read_error=OSError("device unplugged"))

    with (
        caplog.at_level(logging.ERROR, logger=mic.logger.name),
        closing(stream(source)) as chunk_stream,
    ):
        started = time.monotonic()
        with pytest.raises(MicReadFailed, match="device unplugged") as failure:
            list(islice(chunk_stream, 2))

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: must not wait out the 2 s limit
    assert isinstance(failure.value.__cause__, OSError)
    assert "device unplugged" in caplog.text
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()
    assert source.close_calls == 1


def test_stopping_early_closes_the_mic_ends_the_thread_and_says_so(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = FakeSource([samples(value) for value in range(10)])

    with (
        caplog.at_level(logging.INFO, logger=mic.logger.name),
        closing(stream(source)) as chunk_stream,
    ):
        received = list(islice(chunk_stream, 3))

    assert len(received) == 3
    assert source.closed.is_set()
    assert source.close_calls == 1
    assert reader_thread_ended()
    assert "stopped reading mic" in caplog.text


def test_stopped_reading_is_not_logged_for_a_mic_that_never_opened(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with (
        caplog.at_level(logging.INFO, logger=mic.logger.name),
        pytest.raises(MicOpenFailed),
    ):
        next(stream(FakeSource(open_error=OSError("device busy"))))

    assert "stopped reading mic" not in caplog.text


def test_stopping_while_a_read_blocks_returns_in_time_and_says_the_call_has_not_returned(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gate = threading.Event()
    gate.set()
    source = FakeSource([samples(1)], read_gate=gate)
    chunk_stream = stream(source, chunk_timeout=SHORT_TIMEOUT)
    next(chunk_stream)
    gate.clear()
    assert source.read_waiting.wait(WAIT_LIMIT)
    started = time.monotonic()

    with caplog.at_level(logging.INFO, logger=mic.logger.name):
        chunk_stream.close()

    assert time.monotonic() - started < 1.0  # gstack-timing-ok: close must not hang on the read
    assert not source.closed.is_set()
    assert "has not returned" in caplog.text
    assert "stopped reading mic" not in caplog.text
    gate.set()
    assert source.closed.wait(WAIT_LIMIT)
    assert reader_thread_ended()


def test_a_close_that_raises_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    source = FakeSource([samples(1)], close_error=OSError("close failed"))

    with (
        caplog.at_level(logging.ERROR, logger=mic.logger.name),
        closing(stream(source)) as chunk_stream,
    ):
        next(chunk_stream)

    assert reader_thread_ended()
    assert "closing mic" in caplog.text
    assert "close failed" in caplog.text


class FakeStream:
    """Stands in for sounddevice.InputStream and records what the real audio source asks of it."""

    def __init__(self, **options: object) -> None:
        self.options: dict[str, object] = options
        self.calls: list[str] = []

    def start(self) -> None:
        self.calls.append("start")

    def read(self, frames: int) -> tuple[Samples, bool]:
        self.calls.append(f"read {frames}")
        return samples(7, count=frames), True

    def stop(self) -> None:
        self.calls.append("stop")

    def close(self) -> None:
        self.calls.append("close")


@pytest.fixture
def streams(monkeypatch: pytest.MonkeyPatch) -> list[FakeStream]:
    made: list[FakeStream] = []

    def make(**options: object) -> FakeStream:
        made.append(FakeStream(**options))
        return made[-1]

    monkeypatch.setattr(mic.sounddevice, "InputStream", make)
    return made


def test_the_real_source_opens_the_device_in_the_format_asked_with_dither_off(
    streams: list[FakeStream],
) -> None:
    source = mic.sound_device_source(BUILT_IN)

    source.open(16000, 1, 8000)

    assert streams[0].options == {
        "samplerate": 16000,
        "blocksize": 8000,
        "device": BUILT_IN.index,
        "channels": 1,
        "dtype": "int16",
        "dither_off": True,
    }
    assert streams[0].calls == ["start"]


def test_the_real_source_reads_one_chunk_and_reports_lost_audio(streams: list[FakeStream]) -> None:
    source = mic.sound_device_source(WEBCAM_MIC)
    source.open(16000, 1, 8000)

    delivered, overflowed = source.read()

    assert delivered.shape == (8000, 1)
    assert overflowed is True
    assert streams[0].calls == ["start", "read 8000"]


def test_the_real_source_stops_and_closes_the_stream_exactly_once(
    streams: list[FakeStream],
) -> None:
    never_opened = mic.sound_device_source(WEBCAM_MIC)
    never_opened.close()
    source = mic.sound_device_source(WEBCAM_MIC)
    source.open(16000, 1, 8000)

    source.close()
    source.close()

    assert [stream.calls for stream in streams] == [["start", "stop", "close"]]
    with pytest.raises(MicReadFailed, match="not open"):
        source.read()


def test_chunks_with_its_defaults_lists_opens_and_stamps_in_utc(
    streams: list[FakeStream], monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_library_listing(monkeypatch)
    before = datetime.now(UTC)

    with closing(chunks(WEBCAM_MIC.name)) as chunk_stream:
        chunk = next(chunk_stream)

    assert chunk.samples.shape == (8000, 1)
    assert chunk.overflowed is True
    assert chunk.captured_at.utcoffset() == timedelta(0)
    assert before <= chunk.captured_at <= datetime.now(UTC)
    assert streams[0].options["device"] == WEBCAM_MIC.index
    assert streams[0].calls[-2:] == ["stop", "close"]


def test_the_stub_matches_the_installed_audio_library() -> None:
    checked = subprocess.run(
        [
            sys.executable,
            "-m",
            "mypy.stubtest",
            "sounddevice",
            "--ignore-missing-stub",
            "--mypy-config-file",
            str(LAYER_DIRECTORY / "pyproject.toml"),
        ],
        cwd=LAYER_DIRECTORY,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
        check=False,
    )

    assert checked.returncode == 0, checked.stdout + checked.stderr


def write_config(folder: Path, mic_value: object) -> list[str]:
    config_path = folder / "worker.json"
    config_path.write_text(json.dumps({"schema_version": 1, "mic": mic_value}), encoding="utf-8")
    return ["--config", str(config_path)]


def test_reader_exits_0_after_reading_chunks_and_says_which_were_all_zeros(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    stamp = datetime(2026, 11, 14, 3, 12, 45, tzinfo=UTC)
    now = [100.0]

    def fake_chunks(wanted: str) -> Generator[AudioChunk, None, None]:
        yield AudioChunk(samples(0), stamp, False)
        now[0] += 0.5
        yield AudioChunk(samples(5), stamp, True)
        now[0] += 0.5
        yield AudioChunk(samples(5), stamp, False)

    monkeypatch.setattr(mic, "chunks", fake_chunks)
    monkeypatch.setattr(audio_reader, "monotonic", lambda: now[0])

    with caplog.at_level(logging.INFO, logger=audio_reader.logger.name):
        code = audio_reader.main([*write_config(tmp_path, WEBCAM_MIC.name), "--seconds", "0.5"])

    assert code == 0
    assert (
        "chunk 1 has 8000 samples at 16000 Hz, captured_at 2026-11-14T03:12:45Z, all zeros: yes"
        in caplog.text
    )
    assert "chunk 2 has 8000 samples at 16000 Hz" in caplog.text
    assert "all zeros: no, audio was lost before it" in caplog.text
    assert "chunk 3 has" not in caplog.text
    assert "read 2 chunks over 0.5 seconds from the first chunk, 2.0 per second" in caplog.text


def test_reader_with_no_mic_configured_opens_nothing_and_never_loads_the_mic_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, "layer3.mic", None)

    assert audio_reader.main(write_config(tmp_path, None)) == 0


@pytest.mark.parametrize(
    ("failure", "exit_code"),
    [(MicNotFound("mic 'x' was not found"), 1), (KeyboardInterrupt(), 0)],
)
def test_reader_exits_1_on_a_mic_error_and_0_when_stopped_by_the_keyboard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: BaseException, exit_code: int
) -> None:
    def fake_chunks(wanted: str) -> Generator[AudioChunk, None, None]:
        raise failure
        yield

    monkeypatch.setattr(mic, "chunks", fake_chunks)

    assert audio_reader.main(write_config(tmp_path, WEBCAM_MIC.name)) == exit_code


def test_reader_exits_2_on_a_bad_config(tmp_path: Path) -> None:
    assert audio_reader.main(write_config(tmp_path, 3)) == 2


@pytest.mark.parametrize("seconds", ["nan", "inf", "-1", "soon"])
def test_reader_refuses_a_run_length_that_is_not_a_finite_number_of_0_or_more(
    tmp_path: Path, seconds: str
) -> None:
    with pytest.raises(SystemExit) as stopped:
        audio_reader.main([*write_config(tmp_path, WEBCAM_MIC.name), "--seconds", seconds])

    assert stopped.value.code == 2
