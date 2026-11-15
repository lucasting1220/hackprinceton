"""Reporting that a detector stopped, shared by Layer 4's jobs.

The stop goes to the rules as a monitoring signal, which alert once it has lasted long enough.
It is reported until that alert has gone out, then not again until the detector runs again:
the rules keep no state, so without this a long stop would alert on every check.
"""

from datetime import datetime

from layer4.signals import MonitoringSignal
from layer4.upper_tier import UpperTier


class StopReporter:
    """Hands "<what> stopped" to the rules until an alert for it has gone out."""

    def __init__(self, upper: UpperTier, what_stopped: str) -> None:
        self._upper = upper
        self._what_stopped = what_stopped
        self._alerted = False

    def stopped(self, since: datetime, now: datetime) -> None:
        if self._alerted:
            return
        signal = MonitoringSignal(what_stopped=self._what_stopped, stopped_at=since, checked_at=now)
        handled = self._upper.handle(signal)
        self._alerted = handled.alert is not None and handled.alert_sent

    def running(self) -> None:
        self._alerted = False
