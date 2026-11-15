"""Layer 4 alert rewrite: the quick model's fuller text, sent as an update to the same alert.

The template alert has already gone out. If the event log or the model fails, or the model's
text is unusable, no update is sent and the template simply stands.
"""

import dataclasses
import logging
from collections.abc import Sequence
from datetime import tzinfo

from layer4 import settings
from layer4.alerts import Alert
from layer4.events import Event, describe
from layer4.ports import EventLog, Model, Phone, PortError, Quality

logger = logging.getLogger(__name__)


def rewrite_prompt(alert: Alert, recent: Sequence[Event], tz: tzinfo | None = None) -> str:
    lines = "\n".join(describe(event, tz) for event in recent) or "(nothing else recorded)"
    return (
        "You write short alerts for a family caregiver about the person they look after.\n"
        "Rewrite the alert below in one or two plain sentences. Use only the facts given.\n"
        "Do not guess causes, give medical advice or add anything not listed.\n\n"
        f"Alert: {alert.title}. {alert.body}\n\n"
        f"Events in the last {int(settings.REWRITE_CONTEXT.total_seconds() // 60)} minutes:\n"
        f"{lines}\n"
    )


def clean_rewrite(text: str) -> str | None:
    """The model's text made safe to show, or None when it is unusable."""
    printable = "".join(ch if ch.isprintable() else " " for ch in text)
    cleaned = " ".join(printable.split())
    if not cleaned or len(cleaned) > settings.REWRITE_MAX_CHARS:
        return None
    return cleaned


def rewrite_alert(
    alert: Alert, event_log: EventLog, model: Model, tz: tzinfo | None = None
) -> Alert | None:
    """The update for an alert, or None when the template should stand."""
    try:
        recent: Sequence[Event] = event_log.read_since(alert.detected_at - settings.REWRITE_CONTEXT)
    except PortError as err:
        logger.warning("L4 rewrite: event log unreadable for alert %s: %s", alert.alert_id, err)
        recent = []
    try:
        text = model.ask(rewrite_prompt(alert, recent, tz), Quality.QUICK)
    except PortError as err:
        logger.warning(
            "L4 rewrite: no rewrite for alert %s, template stands: %s", alert.alert_id, err
        )
        return None
    body = clean_rewrite(text)
    if body is None:
        logger.warning("L4 rewrite: unusable rewrite for alert %s, template stands", alert.alert_id)
        return None
    return dataclasses.replace(alert, body=body, update=True)


def send_rewrite(
    alert: Alert, event_log: EventLog, model: Model, phone: Phone, tz: tzinfo | None = None
) -> Alert | None:
    """Rewrite an alert and send the update. Returns the update that was sent, or None."""
    update = rewrite_alert(alert, event_log, model, tz)
    if update is None:
        return None
    try:
        phone.send_alert(update)
    except PortError as err:
        logger.error("L4 rewrite: update for alert %s not sent: %s", alert.alert_id, err)
        return None
    return update
