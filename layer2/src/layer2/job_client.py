"""The calls a job (Layer 3 or Layer 4) makes to Layer 2, from inside a job that Layer 2's worker
started. Plain blocking Python.

    from layer2.job_client import Layer2

    layer2 = Layer2.from_env()
    layer2.log_event({"kind": "fall", "confidence": 0.93})
    recent = layer2.read_log(since=datetime.now(UTC) - timedelta(minutes=10))

    answer = layer2.ask("Rewrite this alert: ...", quality="quick")

    home = layer2.status()     # the same data as the coordinator's /api/state
    layer2.to_phone("alerts", {...})   # to Layer 1's bridge: alerts, replies, status, reports
    layer2.on_request(handle)          # each request from a phone, forever (Layer 4)
    reading = layer2.receive("watch-data")   # the next watch reading or None (Layer 3)

    for frame in layer2.feed("camera"):   # frame.data (JPEG), frame.captured_at (UTC)

So far: the event log, ask(), status(), to_phone(), receive(), on_request() and feed().
fan_out() comes with a later build step. feed() uses the websockets package, installed with
layer2; everything else is the standard library.
"""

import json
import os
import socket
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from websockets.exceptions import WebSocketException
from websockets.sync.client import connect as ws_connect

_TIMEOUT_S = 15.0
_ASK_TIMEOUT_S = 135.0  # longer than the worker's own limit on a model answer


@dataclass(frozen=True)
class Answer:
    text: str
    quality: Literal["quick", "deep"]
    """The quality that actually answered: `deep` may be answered by `quick`."""


@dataclass(frozen=True)
class FeedItem:
    """One camera frame or mic chunk from Layer 3's capture job."""

    data: bytes
    captured_at: datetime


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_FEED_OPEN_TIMEOUT_S = 5.0
_FEED_MAX_MESSAGE_BYTES = 4 * 1024 * 1024
_FEED_RETRY_S = 1.0


def _feed_item(message: str | bytes) -> FeedItem | None:
    """8 bytes of big-endian capture time in microseconds since 1970 UTC, then the data.
    Anything else (text, or too short) is skipped."""
    if isinstance(message, str) or len(message) <= 8:
        return None
    micros = int.from_bytes(message[:8], "big", signed=True)
    try:
        captured_at = _EPOCH + timedelta(microseconds=micros)
    except OverflowError:
        return None
    return FeedItem(data=bytes(message[8:]), captured_at=captured_at)


class Layer2Error(Exception):
    """Layer 2 refused or could not carry out the call; the message says why."""


class Layer2:
    def __init__(self, address: str, token: str, frame_feed: str | None = None) -> None:
        host, _, port = address.rpartition(":")
        self._address = (host, int(port))
        self._token = token
        self._frame_feed = frame_feed

    @classmethod
    def from_env(cls) -> "Layer2":
        """Read the gateway address and secret that Layer 2's worker gave this job."""
        try:
            return cls(
                os.environ["LAYER2_GATEWAY"],
                os.environ["LAYER2_GATEWAY_TOKEN"],
                os.environ.get("LAYER2_FRAME_FEED"),
            )
        except KeyError:
            raise Layer2Error("not started by Layer 2's worker (LAYER2_GATEWAY not set)") from None

    def feed(self, name: Literal["camera", "mic"]) -> Iterator[FeedItem]:
        """Camera frames (`data` is a 640x480 JPEG) or mic chunks (`data` is 0.5 s of 16 kHz
        mono 16-bit little-endian PCM) from Layer 3's capture job on this laptop, as they come
        (contracts/frame-feed.json). Runs forever: if the capture job is not there yet or
        restarts, it reconnects. A reader that falls behind gets the newest, never a backlog.
        Stop by leaving the loop."""
        if name not in ("camera", "mic"):
            raise ValueError("name must be camera or mic")
        if not self._frame_feed:
            raise Layer2Error("no frame feed on this laptop (LAYER2_FRAME_FEED not set)")
        url = f"ws://{self._frame_feed}/{name}"
        while True:
            try:
                with ws_connect(
                    url,
                    open_timeout=_FEED_OPEN_TIMEOUT_S,
                    max_size=_FEED_MAX_MESSAGE_BYTES,
                    proxy=None,
                ) as connection:
                    for message in connection:
                        item = _feed_item(message)
                        if item is not None:
                            yield item
            except (OSError, TimeoutError, WebSocketException):
                pass
            time.sleep(_FEED_RETRY_S)

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

    def to_phone(
        self, kind: Literal["alerts", "replies", "status", "reports"], message: dict[str, Any]
    ) -> None:
        """Hand one message for the caregiver's phone to Layer 1's bridge (POST /v1/<kind>),
        through the coordinator. Returns once the bridge has accepted it; raises Layer2Error
        if it could not be delivered, so the caller can retry."""
        self._call({"type": "phone_send", "kind": kind, "body": message})

    def receive(
        self, kind: Literal["requests", "watch-data"], wait_s: float = 25.0
    ) -> dict[str, Any] | None:
        """The next message from Layer 1's bridge of this kind, waiting up to `wait_s` (at most
        30 s); None if none came. The first call makes this job the one that takes `kind`."""
        reply = self._call({"type": "receive", "kind": kind, "wait_s": wait_s}, wait_s + 10.0)
        message: dict[str, Any] | None = reply.get("message")
        return message

    def on_request(self, handle: Callable[[dict[str, Any]], None]) -> None:
        """Call `handle` with each request from a phone, forever. A Layer2Error (for example
        while the worker reconnects) is retried after a short pause."""
        while True:
            try:
                message = self.receive("requests")
            except Layer2Error:
                time.sleep(1.0)
                continue
            if message is not None:
                handle(message)

    def status(self) -> dict[str, Any]:
        """Which laptops the coordinator knows (with `last_status_at`, so a quiet one can be
        spotted), the jobs each runs, and the work the plan dropped: the /api/state data
        (contracts/api-state.json)."""
        state: dict[str, Any] = self._call({"type": "state_read"})["state"]
        return state

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
