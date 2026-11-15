"""Layer 4 events: the record the upper tier keeps for every signal, urgent or not.

Below-threshold signals reach the event log only, and the daily report is built from it.
How an event is written on the wire belongs to the event log contract, not to this module.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import assert_never

from layer4.alerts import Alert
from layer4.signals import FallSignal, HeartRateSignal, HelpSignal, MonitoringSignal, Signal


@dataclass(frozen=True)
class Event:
    """One signal the upper tier saw, when it happened (UTC), and the alert it sent, if any."""

    event_id: str
    signal: Signal
    occurred_at: datetime
    alert_id: str | None

    @property
    def urgent(self) -> bool:
        return self.alert_id is not None


def occurred_at(signal: Signal) -> datetime:
    """When the signal's event happened, in UTC: the same time an alert would carry."""
    match signal:
        case FallSignal() | HelpSignal():
            moment = signal.detected_at
        case HeartRateSignal():
            moment = signal.measured_at
        case MonitoringSignal():
            moment = signal.stopped_at
        case _:
            assert_never(signal)
    return moment.astimezone(UTC)


def new_event(signal: Signal, alert: Alert | None) -> Event:
    """Record a signal, with the alert the rules produced for it, or None below threshold."""
    return Event(
        event_id=str(uuid.uuid4()),
        signal=signal,
        occurred_at=occurred_at(signal),
        alert_id=None if alert is None else alert.alert_id,
    )
