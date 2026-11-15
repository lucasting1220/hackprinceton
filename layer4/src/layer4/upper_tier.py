"""Layer 4 upper tier: what happens to each signal the detectors hand over.

The rules decide. An urgent alert is sent first, so it never waits on the event log or a
language model; then the event is written to the log. A failed send or write is logged and
returned to the caller, which reports it, and never stops the next signal being handled.
"""

import logging
from dataclasses import dataclass
from datetime import tzinfo

from layer4.alerts import Alert
from layer4.events import Event, new_event
from layer4.ports import EventLog, Phone, PortError
from layer4.rules import decide
from layer4.settings import RuleThresholds
from layer4.signals import Signal

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Handled:
    """What happened to one signal: its event, its alert if any, and which steps failed."""

    event: Event
    alert: Alert | None
    alert_sent: bool
    event_logged: bool


class UpperTier:
    def __init__(
        self,
        thresholds: RuleThresholds,
        event_log: EventLog,
        phone: Phone,
        tz: tzinfo | None = None,
    ) -> None:
        self._thresholds = thresholds
        self._event_log = event_log
        self._phone = phone
        self._tz = tz

    def handle(self, signal: Signal) -> Handled:
        alert = decide(signal, self._thresholds, self._tz)
        alert_sent = False
        if alert is not None:
            try:
                self._phone.send_alert(alert)
                alert_sent = True
            except PortError as err:
                logger.error(
                    "L4 upper tier: %s alert %s not sent: %s", alert.kind, alert.alert_id, err
                )
        event = new_event(signal, alert)
        event_logged = False
        try:
            self._event_log.append(event)
            event_logged = True
        except PortError as err:
            logger.error("L4 upper tier: event %s not written to the log: %s", event.event_id, err)
        return Handled(event=event, alert=alert, alert_sent=alert_sent, event_logged=event_logged)
