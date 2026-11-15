"""Layer 4 alerts: the template alert a rule produces, and the time text it shows.

Field names follow the alert message in Layer 1's doc. Times in the text are in the worker
laptop's local zone unless a zone is given; detected_at is always UTC.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from enum import StrEnum

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class AlertKind(StrEnum):
    FALL = "fall"
    HELP = "help"
    HEART_RATE = "heart_rate"
    MONITORING = "monitoring"


class Severity(StrEnum):
    URGENT = "urgent"


@dataclass(frozen=True)
class Alert:
    alert_id: str
    kind: AlertKind
    severity: Severity
    detected_at: datetime
    title: str
    body: str
    update: bool


def format_time(moment: datetime, tz: tzinfo | None = None) -> str:
    """Return a clock time such as "3:12 AM". None means the laptop's local zone."""
    local = moment.astimezone(tz)
    hour = local.hour % 12 or 12
    half = "AM" if local.hour < 12 else "PM"
    return f"{hour}:{local.minute:02d} {half}"


def format_date(moment: datetime, tz: tzinfo | None = None) -> str:
    """Return a date such as "Nov 13". None means the laptop's local zone."""
    local = moment.astimezone(tz)
    return f"{_MONTHS[local.month - 1]} {local.day}"


def new_alert(kind: AlertKind, detected_at: datetime, title: str, body: str) -> Alert:
    """Build a new urgent template alert with a fresh ID, its time converted to UTC."""
    if detected_at.utcoffset() is None:
        raise ValueError(f"detected_at must have a time zone, got {detected_at!r}")
    return Alert(
        alert_id=str(uuid.uuid4()),
        kind=kind,
        severity=Severity.URGENT,
        detected_at=detected_at.astimezone(UTC),
        title=title,
        body=body,
        update=False,
    )
