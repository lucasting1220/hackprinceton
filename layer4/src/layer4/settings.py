"""Layer 4 settings: the rule thresholds and the signal time range.

The thresholds are the Layer 4 doc's proposed defaults, not medical guidance, and still need
the team's review. Rules read them through RuleThresholds, never as literals. The signal time
range is a platform limit, not a tuning value.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from layer4._checks import is_number, is_whole_number

FALL_CONFIDENCE_MIN = 0.8
HEART_RATE_HIGH_BPM = 130
HEART_RATE_LOW_BPM = 40
MONITORING_STOPPED_AFTER = timedelta(seconds=30)

# Signal times must fall in this range. Alert text turns each time into the laptop's local
# zone through the operating system's clock functions, which fail outside it on Windows.
EARLIEST_SIGNAL_TIME = datetime(1970, 1, 2, tzinfo=UTC)
LATEST_SIGNAL_TIME = datetime(2999, 12, 31, tzinfo=UTC)

# Fall detection: one signal per window carries the window's highest confidence; frames older
# than the age limit are skipped; no reading for the gap means fall detection has stopped.
FALL_SIGNAL_WINDOW = timedelta(seconds=1)
FALL_FRAME_MAX_AGE = timedelta(seconds=2)
FALL_DETECTION_GAP = timedelta(seconds=5)

# Reading body pose. Lengths are in fractions of the frame height. The torso is the line from
# mid-hip to mid-shoulder; its angle is measured from straight up. Lying down means the torso
# tilts at least the lying angle, or looks shorter than the foreshortened ratio of its last
# upright length (lying toward or away from the camera). Sitting means the hips are within the
# sitting ratio of a torso length of the knees, vertically.
POSE_MIN_VISIBILITY = 0.5
POSE_MIN_TORSO = 0.02
POSE_UPRIGHT_ANGLE_DEG = 30.0
POSE_LYING_ANGLE_DEG = 60.0
POSE_FORESHORTENED_RATIO = 0.5
POSE_SITTING_HIP_KNEE_RATIO = 0.35

# Falls from body pose. A fall is scored once the resident has been lying for the settle time.
# Standing height is the highest the hips were while upright within the slow descent before
# lying. The score is the smaller of two marks: how far the hips dropped from standing height,
# in upright torso lengths (full marks at the full drop), and how long the descent took (full
# marks at or under the fast descent, none at or over the slow one), timed from the last upright
# moment with the hips within the standing tolerance (torso lengths) of standing height. One fall
# gives one score; the next needs the resident upright.
FALL_SETTLE = timedelta(seconds=0.5)
FALL_HIP_DROP_FULL = 1.0
FALL_DESCENT_FAST = timedelta(seconds=1.2)
FALL_DESCENT_SLOW = timedelta(seconds=3)
FALL_STANDING_TOLERANCE = 0.15

# MediaPipe follows this many people per frame: one, the resident.
POSE_MODEL_PEOPLE = 1

# Alert rewrite: how much of the event log the quick model sees (proposed in the Layer 4 doc),
# and the longest rewrite the phone is sent; a longer one is dropped and the template stands.
REWRITE_CONTEXT = timedelta(minutes=10)
REWRITE_MAX_CHARS = 300

# Help check: the longest transcript tail the quick model reads, and how long the check may
# keep failing before it counts as stopped.
HELP_TRANSCRIPT_MAX_CHARS = 2000
HELP_CHECK_GAP = timedelta(seconds=5)


@dataclass(frozen=True)
class RuleThresholds:
    """The thresholds the rules compare signals with. Raises ValueError if they make no sense."""

    fall_confidence_min: float = FALL_CONFIDENCE_MIN
    heart_rate_high_bpm: int = HEART_RATE_HIGH_BPM
    heart_rate_low_bpm: int = HEART_RATE_LOW_BPM
    monitoring_stopped_after: timedelta = MONITORING_STOPPED_AFTER

    def __post_init__(self) -> None:
        if not is_number(self.fall_confidence_min) or not 0.0 <= self.fall_confidence_min <= 1.0:
            raise ValueError(
                f"fall_confidence_min must be a number from 0 to 1, "
                f"got {self.fall_confidence_min!r}"
            )
        for name, bpm in (
            ("heart_rate_high_bpm", self.heart_rate_high_bpm),
            ("heart_rate_low_bpm", self.heart_rate_low_bpm),
        ):
            if not is_whole_number(bpm):
                raise ValueError(f"{name} must be a whole number, got {bpm!r}")
        if self.heart_rate_low_bpm >= self.heart_rate_high_bpm:
            raise ValueError(
                f"heart_rate_low_bpm ({self.heart_rate_low_bpm}) must be below "
                f"heart_rate_high_bpm ({self.heart_rate_high_bpm})"
            )
        if not isinstance(
            self.monitoring_stopped_after, timedelta
        ) or self.monitoring_stopped_after <= timedelta(0):
            raise ValueError(
                f"monitoring_stopped_after must be a positive timedelta, "
                f"got {self.monitoring_stopped_after!r}"
            )


# Sending alerts: how many times to try one alert, and the wait between tries. Every try carries
# the same alert_id, which the bridge treats as the same alert (contracts/README.md, alerts).
ALERT_SEND_ATTEMPTS = 3
ALERT_RETRY_WAIT_S = 1.0

# The fall_model job. It downloads the pose model once and checks its SHA-256: the hash is the
# "latest" file that passed the webcam tests, so if Google replaces it the download is refused
# and reported instead of running an untested model. It checks every
# FALL_HEALTH_CHECK_S whether fall detection has stopped, and retries a model it cannot open
# every FALL_MODEL_RETRY_S.
POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)
POSE_MODEL_SHA256 = "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad"
POSE_MODEL_DOWNLOAD_TIMEOUT_S = 60.0
FALL_HEALTH_CHECK_S = 10.0
FALL_MODEL_RETRY_S = 30.0

# Speech-to-text (the speech_to_text job). Mic chunks are 16 kHz mono (contracts/frame-feed.json).
# A chunk is speech when the voice detector's score reaches the threshold. An utterance ends after
# the silence end or at the longest utterance. The transcriber waits on at most the queue size of
# utterances; when it falls behind, the oldest is dropped. No mic chunk for the detection gap means
# speech-to-text has stopped; that is checked every STT_HEALTH_CHECK_S, and a model that cannot
# open is retried every STT_MODEL_RETRY_S.
MIC_SAMPLE_RATE = 16000
STT_MODEL = "base.en"
STT_COMPUTE_TYPE = "int8"
STT_BEAM_SIZE = 1
STT_VAD_THRESHOLD = 0.5
STT_SILENCE_END = timedelta(seconds=1)
STT_LONGEST_UTTERANCE = timedelta(seconds=10)
STT_QUEUE_SIZE = 4
STT_DETECTION_GAP = timedelta(seconds=5)
STT_HEALTH_CHECK_S = 10.0
STT_MODEL_RETRY_S = 30.0
