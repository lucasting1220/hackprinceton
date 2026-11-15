"""Messages from Layer 1's bridge, for the jobs that take them.

The bridge posts to the coordinator on 127.0.0.1:client_port (Layer 1 doc, "Handoff to Layer
4"): POST /v1/requests (phones' requests, for Layer 4) and POST /v1/watch-data (watch readings,
for Layer 3). Each body is one JSON object, carried as is. It goes to the worker whose job
subscribed to that kind (the latest subscriber wins, so a job that moves takes its messages
with it). The bridge gets 202 once the message is handed to that worker, or 503 when no job
takes that kind or its worker is gone, so the bridge can retry. Contents are never logged.
"""

import json
import logging
from collections.abc import Awaitable, Callable, Mapping

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import JsonValue
from starlette.middleware.trustedhost import TrustedHostMiddleware

from layer2 import settings
from layer2.contracts import Deliver, InboundKind

log = logging.getLogger(__name__)

Send = Callable[[str], Awaitable[None]]


class Subscriptions:
    """Which worker connection takes each kind. Runs on the coordinator's one event loop."""

    def __init__(self) -> None:
        self._by_kind: dict[InboundKind, tuple[str, Send]] = {}

    def subscribe(self, kind: InboundKind, node_id: str, send: Send) -> None:
        self._by_kind[kind] = (node_id, send)
        log.info("L2 coordinator: laptop %s now takes %s from the bridge", node_id, kind)

    def drop(self, send: Send) -> None:
        """The connection behind `send` closed: its kinds have no taker until a job subscribes."""
        for kind, (_, current) in list(self._by_kind.items()):
            if current is send:
                del self._by_kind[kind]

    def taker(self, kind: InboundKind) -> str | None:
        entry = self._by_kind.get(kind)
        return entry[0] if entry else None

    async def deliver(self, kind: InboundKind, body: Mapping[str, JsonValue]) -> bool:
        entry = self._by_kind.get(kind)
        if entry is None:
            return False
        node_id, send = entry
        message = Deliver(type="deliver", schema_version=1, kind=kind, body=dict(body))
        try:
            await send(message.model_dump_json())
        except (RuntimeError, OSError) as error:
            log.warning("L2 coordinator: could not hand %s to %s: %s", kind, node_id, error)
            self.drop(send)
            return False
        return True


def create_client_app(subscriptions: Subscriptions) -> FastAPI:
    """The bridge's side of the coordinator, on 127.0.0.1:client_port only."""
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    async def take(kind: InboundKind, request: Request) -> JSONResponse:
        raw = await request.body()
        if len(raw) > settings.INBOUND_MAX_BYTES:
            return JSONResponse({"error": "too large"}, status_code=413)
        try:
            body = json.loads(raw)
        except ValueError:
            return JSONResponse({"error": "the body must be one JSON object"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "the body must be one JSON object"}, status_code=400)
        if not await subscriptions.deliver(kind, body):
            return JSONResponse({"error": f"no job is taking {kind} right now"}, status_code=503)
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/v1/requests")
    async def requests(request: Request) -> JSONResponse:
        return await take("requests", request)

    @app.post("/v1/watch-data")
    async def watch_data(request: Request) -> JSONResponse:
        return await take("watch-data", request)

    return app
