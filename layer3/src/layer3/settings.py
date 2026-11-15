"""Layer 3 settings: every default, limit and fixed value the capture code uses."""

from datetime import UTC, datetime

# Video format asked of the camera (docs/layer3-raw-data.md, "Video format").
FRAME_WIDTH: int = 640
FRAME_HEIGHT: int = 480
FRAMES_PER_SECOND: int = 15

# How long the caller waits for the camera to open and deliver its first frame,
# and for each frame after that.
OPEN_TIMEOUT_SECONDS: float = 10.0
FRAME_READ_TIMEOUT_SECONDS: float = 2.0

# Frames the reader thread may hold while the reader is busy.
FRAME_QUEUE_SIZE: int = 2

# How often the reader thread checks whether it has been told to stop.
STOP_CHECK_SECONDS: float = 0.05

# How long cleanup waits for the reader thread after a time limit has already run out.
ABANDON_WAIT_SECONDS: float = 0.1

# How long the frame reader runs when no length is given.
FRAME_READER_SECONDS: float = 5.0

# The worker.json schema_version this code reads.
SUPPORTED_SCHEMA_VERSION: int = 1

# The name of the OpenCV backend used to list and open cameras, by operating system.
CAMERA_BACKENDS: dict[str, str] = {
    "Darwin": "CAP_AVFOUNDATION",
    "Windows": "CAP_DSHOW",
}

# Audio format asked of the mic (docs/layer3-raw-data.md, "Audio format"), and the chunk length.
AUDIO_SAMPLE_RATE: int = 16000
AUDIO_CHANNELS: int = 1
AUDIO_SAMPLE_TYPE: str = "int16"
AUDIO_CHUNK_SECONDS: float = 0.5

# How long the caller waits for the mic to open and deliver its first chunk,
# and for each chunk after that.
AUDIO_OPEN_TIMEOUT_SECONDS: float = 10.0
AUDIO_CHUNK_TIMEOUT_SECONDS: float = 2.0

# Chunks the mic's reader thread may hold while the reader is busy.
AUDIO_QUEUE_SIZE: int = 2

# How long the audio reader runs when no length is given.
AUDIO_READER_SECONDS: float = 5.0

# The name of the audio host interface used to list and open mics, by operating system.
AUDIO_HOST_INTERFACES: dict[str, str] = {
    "Darwin": "Core Audio",
    "Windows": "Windows WASAPI",
}

# The host interface that converts a mic's own rate only when it is asked to.
AUDIO_INTERFACE_NEEDING_CONVERT_REQUEST: str = "Windows WASAPI"

# The capture job (contracts/frame-feed.json).
JPEG_QUALITY: int = 80
# Proposed in docs/layer3-raw-data.md, not yet confirmed: how long to wait before reopening a
# camera or mic that failed.
DEVICE_RETRY_SECONDS: float = 3.0
# Origins of Layer 1's live-view sender page, the only page /live accepts (Layer 1's ask T5).
LIVE_VIEW_ORIGINS: tuple[str, ...] = ("http://127.0.0.1:7470", "http://localhost:7470")
# How long a feed client waits for a new item before checking whether it should stop.
FEED_WAIT_SECONDS: float = 1.0

# How many measured times of each kind of watch reading the receiver remembers, to recognise a
# reading that is sent again. Once it has had to forget some, a reading measured at or before
# the newest time it forgot counts as a repeat.
WATCH_SEEN_LIMIT: int = 20_000

# How many characters of a refused watch value are written to the log, how deep and how wide a
# nested value is followed before that, and how many refused readings of one batch are logged.
# The batch's summary line always carries the full count.
WATCH_LOG_VALUE_LIMIT: int = 60
WATCH_LOG_NESTING_LIMIT: int = 2
WATCH_LOG_ITEMS_LIMIT: int = 3
WATCH_REFUSALS_LOGGED_PER_BATCH: int = 5

# The lowest heart rate, and the lowest of the other counts, that the receiver passes on. The
# heart-rate one mirrors Layer 4's HeartRateSignal, which takes a whole number above 0.
WATCH_LOWEST_BPM: int = 1
WATCH_LOWEST_COUNT: int = 0

# Every time on a watch reading must fall in this range. It mirrors EARLIEST_SIGNAL_TIME and
# LATEST_SIGNAL_TIME in layer4/src/layer4/settings.py, so Layer 4 accepts each reading.
EARLIEST_READING_TIME: datetime = datetime(1970, 1, 2, tzinfo=UTC)
LATEST_READING_TIME: datetime = datetime(2999, 12, 31, tzinfo=UTC)

# The watch_data job (contracts/watch-reading.json). How long one receive("watch-data") waits for
# a batch (Layer 2 allows at most 30 s), how long to pause after Layer 2 could not be reached
# before asking again, the schema_version of each reading passed on, and how many readings of
# one batch that Layer 2 could not pass on are logged one by one.
WATCH_RECEIVE_WAIT_SECONDS: float = 25.0
WATCH_RECEIVE_RETRY_SECONDS: float = 1.0
WATCH_READING_SCHEMA_VERSION: int = 1
WATCH_PASS_ON_FAILURES_LOGGED_PER_BATCH: int = 5
