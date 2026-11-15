"""How a job on this worker reaches the coordinator: a local gateway, and the relay behind it.

The gateway listens on 127.0.0.1 at a port chosen at start. Each connection sends one JSON
object per line and gets one JSON line back. Every request carries the gateway's secret, which
is new for each worker run; jobs get the address and the secret in LAYER2_GATEWAY and
LAYER2_GATEWAY_TOKEN. Requests:

    {"token": "...", "type": "log_append", "event": {...}}
    {"token": "...", "type": "log_read", "since": "<ISO time>"}   or   "day": "YYYY-MM-DD"
    {"token": "...", "type": "state_read"}   (answer: "state", the /api/state data)
    {"token": "...", "type": "phone_send", "kind": "alerts", "body": {...}}   (to Layer 1's bridge)
    {"token": "...", "type": "receive", "kind": "requests" | "watch-data" | "watch-readings",
     "wait_s": 25}
        (from the bridge or another job: subscribes this worker, then answers "message": {...}
        or null)
    {"token": "...", "type": "pass_on", "kind": "watch-readings", "body": {...}}
        (to the job that takes the kind; fails when no job takes it)
    {"token": "...", "type": "ask", "prompt": "...", "quality": "quick" | "deep"}

Answers: {"ok": true, "truncated": false}, with "events": [...] for a read (truncated is true
when the oldest were left out), or {"ok": false, "error": "..."}. The relay forwards each
request over the current coordinator connection and waits up to GATEWAY_REPLY_TIMEOUT_S for
the reply with the same id. While the worker is disconnected, requests fail at once: the job
decides whether to retry.
"""

import asyncio
import contextlib
import hmac
import json
import logging
import secrets
import uuid
from typing import Any

from pydantic import ValidationError
from websockets.asyncio.client import ClientConnection
from websockets.exceptions import ConnectionClosed

from layer2 import settings
from layer2.contracts import (
    Deliver,
    InboundKind,
    LogAppend,
    LogRead,
    PassOn,
    PhoneSend,
    Reply,
    StateRead,
    Subscribe,
)
from layer2.ollama import ModelError, generate

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = 2 * settings.EVENT_MAX_BYTES


class NotConnectedError(Exception):
    pass


class Relay:
    """Requests from jobs, sent on the coordinator connection of the moment; and the bridge's
    messages for jobs on this worker, kept per kind until a job takes them."""

    def __init__(self) -> None:
        self._connection: ClientConnection | None = None
        self._pending: dict[str, asyncio.Future[Reply]] = {}
        self._subscribed: set[InboundKind] = set()
        self._inbox: dict[InboundKind, asyncio.Queue[dict[str, Any]]] = {}

    def attach(self, connection: ClientConnection) -> None:
        self._connection = connection

    async def resubscribe(self) -> None:
        """Tell a new connection which kinds this worker's jobs take."""
        for kind in sorted(self._subscribed):
            await self._send_subscribe(kind)

    async def subscribe(self, kind: InboundKind) -> None:
        """A job here takes `kind`. Sent now if connected, and again after each reconnect."""
        if kind in self._subscribed:
            return
        self._subscribed.add(kind)
        await self._send_subscribe(kind)

    async def _send_subscribe(self, kind: InboundKind) -> None:
        connection = self._connection
        if connection is None:
            return  # sent by resubscribe() once connected
        message = Subscribe(type="subscribe", schema_version=1, kind=kind)
        with contextlib.suppress(ConnectionClosed):
            await connection.send(message.model_dump_json())

    def deliver(self, message: Deliver) -> None:
        """Keep a message from the bridge until a job takes it; the oldest goes when full."""
        queue = self._inbox.setdefault(message.kind, asyncio.Queue())
        if queue.qsize() >= settings.INBOX_MAX_MESSAGES:
            queue.get_nowait()
            log.warning("L2 worker: no job took %s in time; dropped the oldest", message.kind)
        queue.put_nowait(message.body)

    async def take(self, kind: InboundKind, wait_s: float) -> dict[str, Any] | None:
        """The next message of `kind`, waiting up to `wait_s`; None if none came."""
        queue = self._inbox.setdefault(kind, asyncio.Queue())
        try:
            return await asyncio.wait_for(queue.get(), wait_s)
        except TimeoutError:
            return None

    def detach(self) -> None:
        self._connection = None
        for waiting in self._pending.values():
            if not waiting.done():
                waiting.set_exception(NotConnectedError("the coordinator connection closed"))
        self._pending.clear()

    def resolve(self, reply: Reply) -> None:
        waiting = self._pending.get(reply.id)
        if waiting is not None and not waiting.done():
            waiting.set_result(reply)

    async def ask(self, request: dict[str, Any]) -> Reply:
        """Send a log_append, log_read, state_read, phone_send or pass_on (without its id) and
        wait for the reply."""
        request_id = uuid.uuid4().hex
        message = _REQUESTS[request["type"]].model_validate(
            {**request, "schema_version": 1, "id": request_id}
        )
        connection = self._connection
        if connection is None:
            raise NotConnectedError("not connected to the coordinator")
        waiting: asyncio.Future[Reply] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = waiting
        try:
            await connection.send(message.model_dump_json(exclude_none=True))
            return await asyncio.wait_for(waiting, settings.GATEWAY_REPLY_TIMEOUT_S)
        except ConnectionClosed:
            raise NotConnectedError("the coordinator connection closed") from None
        finally:
            self._pending.pop(request_id, None)


_REQUESTS: dict[
    str, type[LogAppend] | type[LogRead] | type[StateRead] | type[PhoneSend] | type[PassOn]
] = {
    "phone_send": PhoneSend,
    "pass_on": PassOn,
    "log_append": LogAppend,
    "log_read": LogRead,
    "state_read": StateRead,
}


class Gateway:
    def __init__(self, relay: Relay, ollama_url: str | None = None) -> None:
        self._relay = relay
        self._ollama_url = ollama_url
        self.token = secrets.token_hex(32)
        self._server: asyncio.Server | None = None
        self.port = 0

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._handle, "127.0.0.1", 0, limit=_MAX_REQUEST_BYTES
        )
        self.port = self._server.sockets[0].getsockname()[1]

    def env(self) -> dict[str, str]:
        return {"LAYER2_GATEWAY": f"127.0.0.1:{self.port}", "LAYER2_GATEWAY_TOKEN": self.token}

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._server.wait_closed(), 1)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while line := await reader.readline():
                answer = await self._answer(line)
                writer.write(json.dumps(answer).encode("utf-8") + b"\n")
                await writer.drain()
        except (ValueError, ConnectionError):
            pass  # a line over the limit, or the job went away
        finally:
            writer.close()

    async def _answer(self, line: bytes) -> dict[str, Any]:
        try:
            request = json.loads(line)
        except ValueError:
            return {"ok": False, "error": "each request is one JSON object per line"}
        if not isinstance(request, dict):
            return {"ok": False, "error": "each request is one JSON object per line"}
        token = request.pop("token", None)
        if not isinstance(token, str) or not hmac.compare_digest(token, self.token):
            return {"ok": False, "error": "wrong or missing token"}
        if request.get("type") == "ask":
            return await self._ask(request)
        if request.get("type") == "receive":
            return await self._receive(request)
        if request.get("type") not in _REQUESTS:
            return {"ok": False, "error": "unknown request type"}
        try:
            reply = await self._relay.ask(request)
        except ValidationError:
            return {"ok": False, "error": "the request's fields are not valid"}
        except NotConnectedError as error:
            return {"ok": False, "error": str(error)}
        except TimeoutError:
            return {"ok": False, "error": "the coordinator did not answer in time"}
        return reply.model_dump(
            mode="json", exclude={"type", "schema_version", "id"}, exclude_none=True
        )

    async def _receive(self, request: dict[str, Any]) -> dict[str, Any]:
        kind, wait_s = request.get("kind"), request.get("wait_s", 0)
        if kind not in ("requests", "watch-data", "watch-readings"):
            return {"ok": False, "error": "kind must be requests, watch-data or watch-readings"}
        if not isinstance(wait_s, int | float) or isinstance(wait_s, bool) or wait_s < 0:
            return {"ok": False, "error": "wait_s must be a number of seconds"}
        await self._relay.subscribe(kind)
        message = await self._relay.take(kind, min(float(wait_s), settings.RECEIVE_MAX_WAIT_S))
        return {"ok": True, "message": message}

    async def _ask(self, request: dict[str, Any]) -> dict[str, Any]:
        prompt, quality = request.get("prompt"), request.get("quality")
        if not isinstance(prompt, str) or quality not in ("quick", "deep"):
            return {"ok": False, "error": "ask needs a prompt and a quality of quick or deep"}
        if len(prompt) > settings.ASK_MAX_PROMPT_CHARS:
            return {
                "ok": False,
                "error": f"a prompt may be at most {settings.ASK_MAX_PROMPT_CHARS} characters",
            }
        if self._ollama_url is None:
            return {"ok": False, "error": "this worker has no model service"}
        try:
            text = await asyncio.to_thread(generate, self._ollama_url, settings.QUICK_MODEL, prompt)
        except ModelError as error:
            return {"ok": False, "error": str(error)}
        return {"ok": True, "text": text, "quality": "quick"}
