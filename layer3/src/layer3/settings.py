"""Layer 3 settings: every default, limit and fixed value the capture code uses."""

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
