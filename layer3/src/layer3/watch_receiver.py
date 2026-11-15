"""Watch data receiver: takes in the watch readings the iPhone app sends, drops repeats, and
hands each new reading on with the time it was measured and the time a new reading last arrived.

One batch is the body of Layer 1's `POST /v1/watch-data` (docs/layer1-join-and-connect.md),
which Layer 2 hands to a job through `receive("watch-data")`.
Nothing is stored on disk, a gap in data is never an error, and bad watch data never raises.
"""

import logging
import math
import reprlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import ClassVar

from layer3 import settings

logger = logging.getLogger(__name__)

# Top-level names of a batch, besides the three kinds, that are expected and not read.
_UNREAD_NAMES: frozenset[str] = frozenset(
    {"device_id", "type", "schema_version", "msg_id", "sent_at"}
)

_CUT_MARK: str = "..."
_REPR = reprlib.Repr(
    maxlevel=settings.WATCH_LOG_NESTING_LIMIT,
    maxlist=settings.WATCH_LOG_ITEMS_LIMIT,
    maxtuple=settings.WATCH_LOG_ITEMS_LIMIT,
    maxdict=settings.WATCH_LOG_ITEMS_LIMIT,
    maxstring=settings.WATCH_LOG_VALUE_LIMIT,
    maxlong=settings.WATCH_LOG_VALUE_LIMIT,
    maxother=settings.WATCH_LOG_VALUE_LIMIT,
)


def _short(value: object) -> str:
    """A refused value as it is written to the log: at most WATCH_LOG_VALUE_LIMIT characters,
    however long, wide or deeply nested the value is."""
    try:
        text = _REPR.repr(value)
    except ValueError:
        # Python will not write out a whole number of more than a few thousand digits.
        return f"a {type(value).__name__} too long to write out"
    limit = settings.WATCH_LOG_VALUE_LIMIT
    return text if len(text) <= limit else text[: limit - len(_CUT_MARK)] + _CUT_MARK


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


def _count(entry: dict[str, object], field: str, lowest: int) -> int:
    """A whole number of at least `lowest`. A decimal is rounded to the nearest, halves up."""
    value = entry.get(field)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{field} must be a number, got {_short(value)}")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number, got {_short(value)}")
    if value < lowest:
        raise ValueError(f"{field} must be {lowest} or more, got {_short(value)}")
    if isinstance(value, int):
        return value
    whole = math.floor(value)
    return whole + (value - whole >= 0.5)


def _heart_rate(entry: dict[str, object]) -> HeartRateReading:
    return HeartRateReading(
        measured_at=_time(entry, "measured_at"),
        bpm=_count(entry, "bpm", settings.WATCH_LOWEST_BPM),
    )


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
        asleep_minutes=_count(entry, "asleep_minutes", settings.WATCH_LOWEST_COUNT),
        bedtime_at=_time(entry, "bedtime_at"),
        wake_at=_time(entry, "wake_at"),
        interruptions=_count(entry, "interruptions", settings.WATCH_LOWEST_COUNT),
    )


def _steps(entry: dict[str, object]) -> StepsReading:
    return StepsReading(
        measured_at=_time(entry, "measured_at"),
        steps_today=_count(entry, "steps_today", settings.WATCH_LOWEST_COUNT),
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

    It remembers the newest `seen_limit` measured times of each kind. Once it has had to forget
    some, a reading measured at or before the newest time it forgot counts as passed on already,
    so a reading is not passed on twice while the receiver runs. The one exception is a reading
    dated later than the moment its batch arrived: once forgotten, it can pass again. Not safe
    to call from two threads at once.
    """

    def __init__(self, seen_limit: int = settings.WATCH_SEEN_LIMIT) -> None:
        if seen_limit < 1:
            raise ValueError(f"seen_limit must be 1 or more, got {seen_limit!r}")
        self._seen_limit: int = seen_limit
        self._seen: dict[str, set[datetime]] = {kind: set() for kind in _PARSERS}
        self._forgotten_up_to: dict[str, datetime] = {}
        self.last_received_at: datetime | None = None
        """When a batch last passed on a new reading, in UTC. None until one has."""
        self.refused_count: int = 0
        """How many times something malformed was refused: a reading, a list, a whole batch, or
        a batch for carrying unexpected names."""

    def receive(self, batch: object, received_at: datetime) -> list[WatchItem]:
        """Return one item for each reading in the batch that is well formed and new.

        A repeat is the same kind with the same measured time. Items come back kind by kind
        (heart rate, then sleep, then steps), each kind in the batch's own order, not in order
        of measured time. The caller must deliver every
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
        arrived = refused_readings = refused_others = repeats = older_than_memory = 0
        new: list[Reading] = []
        pending: dict[str, set[datetime]] = {kind: set() for kind in _PARSERS}
        for kind, parse in _PARSERS.items():
            entries = batch.get(kind, [])
            if not isinstance(entries, list):
                logger.warning("L3 watch receiver: %s refused: it is not a list", kind)
                refused_others += 1
                continue
            forgotten_up_to = self._forgotten_up_to.get(kind)
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
                if moment in pending[kind] or moment in self._seen[kind]:
                    repeats += 1
                elif forgotten_up_to is not None and moment <= forgotten_up_to:
                    repeats += 1
                    older_than_memory += 1
                else:
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
        if older_than_memory:
            logger.warning(
                "L3 watch receiver: %d readings were measured at or before a time the receiver "
                "has forgotten, so they were dropped as repeats",
                older_than_memory,
            )
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
            self._remember(kind, moments, arrived_at)
        self.last_received_at = arrived_at
        return [WatchItem(reading, arrived_at) for reading in new]

    def _remember(self, kind: str, moments: set[datetime], arrived_at: datetime) -> None:
        """Keep the newest `seen_limit` times of this kind and note the newest one forgotten."""
        if not moments:
            return
        newest_first = sorted(self._seen[kind] | moments, reverse=True)
        self._seen[kind] = set(newest_first[: self._seen_limit])
        if len(newest_first) > self._seen_limit:
            # Never later than now, so readings dated in the future cannot block the readings
            # measured from now on.
            forgotten = min(newest_first[self._seen_limit], arrived_at)
            self._forgotten_up_to[kind] = max(forgotten, self._forgotten_up_to.get(kind, forgotten))
