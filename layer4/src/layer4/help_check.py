"""Layer 4 help check: does a transcript contain a call for help? The quick model decides.

Only a plain YES or NO from the model counts. Anything else, or no model at all, means the
check failed; once it has failed for the gap, health() reports the help check as stopped so
the monitoring rule raises "monitoring degraded". Transcripts are never logged.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from layer4 import settings
from layer4.ports import Model, PortError, Quality
from layer4.signals import HelpSignal, MonitoringSignal

logger = logging.getLogger(__name__)

WHAT_STOPPED = "help check"


class HelpCheckFailed(Exception):
    """The model was unavailable or did not answer YES or NO."""


def help_prompt(transcript: str) -> str:
    tail = transcript[-settings.HELP_TRANSCRIPT_MAX_CHARS :]
    return (
        "Below is speech transcribed from a microphone in an older person's home.\n"
        "Is the person asking for help, for example calling out that they have fallen,\n"
        "are hurt, or need someone to come? Answer with one word: YES or NO.\n\n"
        f"Transcript:\n{tail}\n"
    )


def parse_verdict(text: str) -> bool | None:
    """True for YES, False for NO, None for anything else."""
    word = text.strip().strip(".!").upper()
    if word == "YES":
        return True
    if word == "NO":
        return False
    return None


def _now() -> datetime:
    return datetime.now(UTC)


class HelpCheck:
    def __init__(
        self,
        model: Model,
        gap: timedelta = settings.HELP_CHECK_GAP,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._model = model
        self._gap = gap
        self._clock = clock
        self.failing_since: datetime | None = None

    def check(self, transcript: str, heard_at: datetime) -> HelpSignal | None:
        """The verdict on one transcript. None when there was nothing to check."""
        if not transcript.strip():
            return None
        try:
            answer = self._model.ask(help_prompt(transcript), Quality.QUICK)
        except PortError as err:
            self._failed()
            raise HelpCheckFailed(f"model unavailable: {err}") from err
        verdict = parse_verdict(answer)
        if verdict is None:
            self._failed()
            raise HelpCheckFailed("model did not answer YES or NO")
        self.failing_since = None
        return HelpSignal(is_call_for_help=verdict, detected_at=heard_at)

    def _failed(self) -> None:
        if self.failing_since is None:
            self.failing_since = self._clock()
        logger.warning("L4 help check: no verdict for a transcript")

    def health(self) -> MonitoringSignal | None:
        """A monitoring signal once the check has kept failing for the gap."""
        if self.failing_since is None:
            return None
        now = self._clock()
        if now - self.failing_since < self._gap:
            return None
        return MonitoringSignal(
            what_stopped=WHAT_STOPPED, stopped_at=self.failing_since, checked_at=now
        )
