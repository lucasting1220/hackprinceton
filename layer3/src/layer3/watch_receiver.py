"""Watch data receiver: takes in the watch readings the iPhone app sends, drops repeats, and
hands each new reading on with the time it was measured and the time data last arrived.

One batch is the body of Layer 1's `POST /v1/watch-data` (docs/layer1-join-and-connect.md).
Nothing is stored on disk, a gap in data is never an error, and bad watch data never raises.
"""

import logging
import math
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import ClassVar

from layer3 import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HeartRateReading:
    """Shaped as Layer 4's HeartRateSignal expects: a whole number above 0, a time in UTC."""

    kind: ClassVar[str] = "heart_rate"
    measured_at: datetime
    bpm: int


@dataclass(frozen=True)
class SleepReading:
    kind: ClassVar[str] = "sleep"
    night_of: date
    asleep_minutes: int
    bedtime_at: datetime
    wake_at: datetime
    interruptions: int


@dataclass(frozen=True)
class StepsReading:
    kind: ClassVar[str] = "steps"
    measured_at: datetime
    steps_today: int


Reading = HeartRateReading | SleepReading | StepsReading


@dataclass(frozen=True)
class WatchItem:
    """One item of the `watch` feed: a new reading, and when a new reading last arrived."""

    reading: Reading
    last_received_at: datetime

    @property
    def kind(self) -> str:
        return self.reading.kind


def _time(entry: dict[str, object], field: str) -> datetime:
    value = entry.get(field)
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a time written as text, got {value!r}")
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} is not an ISO 8601 time, got {value!r}") from None
    if moment.utcoffset() is None:
        raise ValueError(f"{field} has no time zone, got {value!r}")
    # Compared before converting: converting a time near year 1 or year 9999 to UTC overflows.
    if not settings.EARLIEST_READING_TIME <= moment <= settings.LATEST_READING_TIME:
        raise ValueError(f"{field} is outside the range Layer 4 accepts, got {value!r}")
    return moment.astimezone(UTC)


def _count(entry: dict[str, object], field: str, minimum: int) -> int:
    """A whole number of at least `minimum`. A decimal is rounded to the nearest whole number."""
    value = entry.get(field)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{field} must be a number, got {value!r}")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number, got {value!r}")
    whole = round(value)
    if whole < minimum:
        raise ValueError(f"{field} must be {minimum} or more, got {value!r}")
    return whole


def _heart_rate(entry: dict[str, object]) -> HeartRateReading:
    return HeartRateReading(measured_at=_time(entry, "measured_at"), bpm=_count(entry, "bpm", 1))


def _sleep(entry: dict[str, object]) -> SleepReading:
    night = entry.get("night_of")
    if not isinstance(night, str):
        raise ValueError(f"night_of must be a date written as text, got {night!r}")
    try:
        night_of = date.fromisoformat(night)
    except ValueError:
        raise ValueError(f"night_of is not an ISO 8601 date, got {night!r}") from None
    return SleepReading(
        night_of=night_of,
        asleep_minutes=_count(entry, "asleep_minutes", 0),
        bedtime_at=_time(entry, "bedtime_at"),
        wake_at=_time(entry, "wake_at"),
        interruptions=_count(entry, "interruptions", 0),
    )


def _steps(entry: dict[str, object]) -> StepsReading:
    return StepsReading(
        measured_at=_time(entry, "measured_at"), steps_today=_count(entry, "steps_today", 0)
    )


_PARSERS: dict[str, Callable[[dict[str, object]], Reading]] = {
    HeartRateReading.kind: _heart_rate,
    SleepReading.kind: _sleep,
    StepsReading.kind: _steps,
}


def _measured_time(reading: Reading) -> datetime:
    """The time that tells one reading of a kind from another. For sleep, the wake-up time."""
    return reading.wake_at if isinstance(reading, SleepReading) else reading.measured_at


class WatchReceiver:
    """Takes in watch-data batches and returns the readings it has not passed on before."""

    def __init__(self, seen_limit: int = settings.WATCH_SEEN_LIMIT) -> None:
        self._seen: OrderedDict[tuple[str, datetime], None] = OrderedDict()
        self._seen_limit: int = seen_limit
        self.last_received_at: datetime | None = None
        """When a batch last passed on a new reading, in UTC. None until one has."""
        self.refused_count: int = 0
        """How many readings, lists and batches have been refused as malformed."""

    def receive(self, batch: object, received_at: datetime) -> list[WatchItem]:
        """Return one item for each reading in the batch that is well formed and new.

        A repeat is the same kind with the same measured time. Raises ValueError only when
        `received_at` has no time zone, which is a bug in the caller and not bad watch data.
        """
        if received_at.utcoffset() is None:
            raise ValueError(f"received_at needs a time zone, got {received_at!r}")
        if not isinstance(batch, dict):
            self._refuse("batch refused: it is not a JSON object")
            return []
        arrived = repeats = 0
        refused_before = self.refused_count
        new: list[Reading] = []
        for kind, parse in _PARSERS.items():
            entries = batch.get(kind, [])
            if not isinstance(entries, list):
                self._refuse(f"{kind} refused: it is not a list")
                continue
            for entry in entries:
                arrived += 1
                try:
                    if not isinstance(entry, dict):
                        raise ValueError(f"it is not a JSON object, got {entry!r}")
                    reading = parse(entry)
                except ValueError as error:
                    self._refuse(f"{kind} reading refused: {error}")
                    continue
                identity = (kind, _measured_time(reading))
                if identity in self._seen:
                    repeats += 1
                    continue
                self._seen[identity] = None
                if len(self._seen) > self._seen_limit:
                    self._seen.popitem(last=False)
                new.append(reading)
        logger.info(
            "L3 watch receiver: %d readings arrived: %d passed on, %d repeats dropped, %d refused",
            arrived,
            len(new),
            repeats,
            self.refused_count - refused_before,
        )
        if not new:
            return []
        arrived_at = received_at.astimezone(UTC)
        self.last_received_at = arrived_at
        return [WatchItem(reading, arrived_at) for reading in new]

    def _refuse(self, reason: str) -> None:
        self.refused_count += 1
        logger.warning("L3 watch receiver: %s", reason)
