"""The calls a job (Layer 3 or Layer 4) makes to Layer 2, from inside a job that Layer 2's worker
started. Plain blocking Python with no dependencies beyond the standard library.

    from layer2.job_client import Layer2

    layer2 = Layer2.from_env()
    layer2.log_event({"kind": "fall", "confidence": 0.93})
    recent = layer2.read_log(since=datetime.now(UTC) - timedelta(minutes=10))

    answer = layer2.ask("Rewrite this alert: ...", quality="quick")

So far: the event log and ask(). fan_out(), feed(), to_phone(), on_request() and status() come
with later build steps.
"""

import json
import os
import socket
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal

_TIMEOUT_S = 15.0
_ASK_TIMEOUT_S = 135.0  # longer than the worker's own limit on a model answer


@dataclass(frozen=True)
class Answer:
    text: str
    quality: Literal["quick", "deep"]
    """The quality that actually answered: `deep` may be answered by `quick`."""


class Layer2Error(Exception):
    """Layer 2 refused or could not carry out the call; the message says why."""


class Layer2:
    def __init__(self, address: str, token: str) -> None:
        host, _, port = address.rpartition(":")
        self._address = (host, int(port))
        self._token = token

    @classmethod
    def from_env(cls) -> "Layer2":
        """Read the gateway address and secret that Layer 2's worker gave this job."""
        try:
            return cls(os.environ["LAYER2_GATEWAY"], os.environ["LAYER2_GATEWAY_TOKEN"])
        except KeyError:
            raise Layer2Error("not started by Layer 2's worker (LAYER2_GATEWAY not set)") from None

    def log_event(self, event: dict[str, Any]) -> None:
        """Store one event in the home's event log, on the coordinator."""
        self._call({"type": "log_append", "event": event})

    def read_log(
        self, since: datetime | None = None, day: date | None = None
    ) -> list[dict[str, Any]]:
        """Events logged since a time (with a time zone), or on one UTC day: give exactly one.
        Each is {"logged_at": "<UTC time>", "event": {...}}, oldest first. If there were too
        many for one answer, the oldest are left out."""
        if (since is None) == (day is None):
            raise ValueError("give exactly one of since and day")
        request: dict[str, Any] = {"type": "log_read"}
        if since is not None:
            if since.tzinfo is None:
                raise ValueError("since needs a time zone")
            request["since"] = since.isoformat()
        else:
            assert day is not None
            request["day"] = day.isoformat()
        events: list[dict[str, Any]] = self._call(request).get("events", [])
        return events

    def ask(self, prompt: str, quality: Literal["quick", "deep"] = "quick") -> Answer:
        """One language model request. Can take many seconds: never call it before sending
        an alert."""
        reply = self._call({"type": "ask", "prompt": prompt, "quality": quality}, _ASK_TIMEOUT_S)
        return Answer(text=str(reply["text"]), quality=reply["quality"])

    def _call(self, request: dict[str, Any], timeout: float = _TIMEOUT_S) -> dict[str, Any]:
        line = json.dumps({**request, "token": self._token}).encode("utf-8") + b"\n"
        try:
            with socket.create_connection(self._address, timeout=timeout) as connection:
                connection.sendall(line)
                with connection.makefile("rb") as replies:
                    answer = replies.readline()
        except OSError as error:
            raise Layer2Error(f"cannot reach Layer 2's worker: {error}") from error
        try:
            reply: dict[str, Any] = json.loads(answer)
        except ValueError:
            raise Layer2Error("Layer 2's worker closed the connection without answering") from None
        if not reply.get("ok"):
            raise Layer2Error(str(reply.get("error", "unknown error")))
        return reply
