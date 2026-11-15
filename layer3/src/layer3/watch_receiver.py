"""Watch data receiver: takes in the watch readings the iPhone app sends, drops repeats, and
hands each new reading on with the time it was measured and the time a new reading last arrived.

One batch is the body of Layer 1's `POST /v1/watch-data` (docs/layer1-join-and-connect.md).
Nothing is stored on disk, a gap in data is never an error, and bad watch data never raises.
"""

import heapq
import logging
import math
import reprlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import ClassVar

from layer3 import settings

logger = logging.getLogger(__name__)

# The one top-level name of a batch, besides the three kinds, that is expected and not read.
_UNREAD_NAMES: frozenset[str] = frozenset({"device_id"})

# A refused value as it is written to the log: cut short however long or deeply nested it is.
_short: Callable[[object], str] = reprlib.Repr(
    maxstring=settings.WATCH_LOG_VALUE_LIMIT,
    maxlong=settings.WATCH_LOG_VALUE_LIMIT,
    maxother=settings.WATCH_LOG_VALUE_LIMIT,
).repr


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
        raise ValueError(f"{field} must be a time written as text, got {_short(value)}")
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} is not an ISO 8601 time, got {_short(value)}") from None
    if moment.utcoffset() is None:
        raise ValueError(f"{field} has no time zone, got {_short(value)}")
    # Compared before converting: converting a time near year 1 or year 9999 to UTC overflows.
    if not settings.EARLIEST_READING_TIME <= moment <= settings.LATEST_READING_TIME:
        raise ValueError(f"{field} is outside the range Layer 4 accepts, got {_short(value)}")
    return moment.astimezone(UTC)


def _count(entry: dict[str, object], field: str, minimum: int) -> int:
    """A whole number of at least `minimum`. A decimal is rounded to the nearest, halves up."""
    value = entry.get(field)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{field} must be a number, got {_short(value)}")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number, got {_short(value)}")
    if value < minimum:
        raise ValueError(f"{field} must be {minimum} or more, got {_short(value)}")
    return value if isinstance(value, int) else math.floor(value + 0.5)


def _heart_rate(entry: dict[str, object]) -> HeartRateReading:
    return HeartRateReading(measured_at=_time(entry, "measured_at"), bpm=_count(entry, "bpm", 1))


def _sleep(entry: dict[str, object]) -> SleepReading:
    night = entry.get("night_of")
    if not isinstance(night, str):
        raise ValueError(f"night_of must be a date written as text, got {_short(night)}")
    try:
        night_of = date.fromisoformat(night)
    except ValueError:
        raise ValueError(f"night_of is not an ISO 8601 date, got {_short(night)}") from None
    earliest, latest = settings.EARLIEST_READING_TIME.date(), settings.LATEST_READING_TIME.date()
    if not earliest <= night_of <= latest:
        raise ValueError(f"night_of is outside the range Layer 4 accepts, got {_short(night)}")
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
    """Takes in watch-data batches and returns the readings it has not passed on before.

    It remembers the newest `seen_limit` measured times of each kind. A reading older than the
    oldest time it remembers counts as passed on already, so nothing is passed on twice while
    the receiver runs.
    """

    def __init__(self, seen_limit: int = settings.WATCH_SEEN_LIMIT) -> None:
        if seen_limit < 1:
            raise ValueError(f"seen_limit must be 1 or more, got {seen_limit!r}")
        self._seen_limit: int = seen_limit
        self._seen: dict[str, set[datetime]] = {kind: set() for kind in _PARSERS}
        self._oldest_first: dict[str, list[datetime]] = {kind: [] for kind in _PARSERS}
        self._forgotten_up_to: dict[str, datetime] = {}
        self.last_received_at: datetime | None = None
        """When a batch last passed on a new reading, in UTC. None until one has."""
        self.refused_count: int = 0
        """How many readings, lists, names and batches have been refused as malformed."""

    def receive(self, batch: object, received_at: datetime) -> list[WatchItem]:
        """Return one item for each reading in the batch that is well formed and new.

        A repeat is the same kind with the same measured time. The caller must deliver every
        item returned: the receiver counts those readings as passed on and will not return
        them again. Nothing is remembered until the whole batch has been read. Raises
        ValueError only when `received_at` has no time zone, which is a bug in the caller and
        not bad watch data.
        """
        if received_at.utcoffset() is None:
            raise ValueError(f"received_at needs a time zone, got {received_at!r}")
        arrived_at = received_at.astimezone(UTC)
        if not isinstance(batch, dict):
            logger.warning("L3 watch receiver: batch refused: it is not a JSON object")
            self.refused_count += 1
            return []
        arrived = refused_readings = refused_others = repeats = 0
        new: list[Reading] = []
        pending: dict[str, set[datetime]] = {kind: set() for kind in _PARSERS}
        for kind, parse in _PARSERS.items():
            entries = batch.get(kind, [])
            if not isinstance(entries, list):
                logger.warning("L3 watch receiver: %s refused: it is not a list", kind)
                refused_others += 1
                continue
            for entry in entries:
                arrived += 1
                try:
                    if not isinstance(entry, dict):
                        raise ValueError(f"it is not a JSON object, got {_short(entry)}")
                    reading = parse(entry)
                except ValueError as error:
                    # Only the first few are logged, so one bad batch cannot flood the log.
                    if refused_readings < settings.WATCH_REFUSALS_LOGGED_PER_BATCH:
                        logger.warning("L3 watch receiver: %s reading refused: %s", kind, error)
                    refused_readings += 1
                    continue
                moment = _measured_time(reading)
                if moment in pending[kind] or self._passed_on_before(kind, moment):
                    repeats += 1
                    continue
                pending[kind].add(moment)
                new.append(reading)
        unread = [name for name in batch if name not in _PARSERS and name not in _UNREAD_NAMES]
        if unread:
            logger.warning(
                "L3 watch receiver: %d top-level names are not read, such as %s",
                len(unread),
                _short(unread[0]),
            )
            refused_others += 1
        logger.info(
            "L3 watch receiver: %d readings arrived: %d passed on, %d repeats dropped, %d refused",
            arrived,
            len(new),
            repeats,
            refused_readings,
        )
        self.refused_count += refused_readings + refused_others
        if not new:
            return []
        for kind, moments in pending.items():
            self._remember(kind, moments)
        self.last_received_at = arrived_at
        return [WatchItem(reading, arrived_at) for reading in new]

    def _passed_on_before(self, kind: str, moment: datetime) -> bool:
        forgotten_up_to = self._forgotten_up_to.get(kind)
        if forgotten_up_to is not None and moment <= forgotten_up_to:
            return True
        return moment in self._seen[kind]

    def _remember(self, kind: str, moments: set[datetime]) -> None:
        seen, oldest_first = self._seen[kind], self._oldest_first[kind]
        for moment in moments:
            seen.add(moment)
            heapq.heappush(oldest_first, moment)
        while len(seen) > self._seen_limit:
            oldest = heapq.heappop(oldest_first)
            seen.discard(oldest)
            self._forgotten_up_to[kind] = oldest
