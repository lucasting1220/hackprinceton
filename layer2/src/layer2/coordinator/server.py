"""The coordinator's two web apps.

Control app (WebSocket /ws on 0.0.0.0:listen_port): workers join with `hello` and report with
`status`; a connection's first status re-plans, and each status is answered with the `start`
and `stop` orders that worker needs (coordinator/plan.py). Jobs reach the event log through
their worker with `log_append` and `log_read`, and read the home's state with `state_read`,
each answered with a `reply`. Dashboard app
(127.0.0.1:dashboard_port): the dashboard page, GET /api/state (the
Layer 1 contract) and GET /api/hardware (Layer 2 only).
Neither ever logs a token, a whole `hello` or raw text a client chose.
"""

import asyncio
import logging
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import Field, TypeAdapter, ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.websockets import WebSocketDisconnected

from layer2 import settings
from layer2.contracts import (
    AcceptedWorkers,
    CoordinatorConfig,
    Hello,
    LogAppend,
    LoggedEvent,
    LogRead,
    Reply,
    StateRead,
    StatusMessage,
    WelcomeAccepted,
    WelcomeRejected,
)
from layer2.coordinator.dashboard import PAGE
from layer2.coordinator.event_log import EventLog, EventTooLargeError
from layer2.coordinator.plan import Placement
from layer2.coordinator.registry import Registry
from layer2.files import ConfigError, load_json_model
from layer2.tokens import find_node_id

log = logging.getLogger(__name__)

# Close codes the worker can tell apart (4000-4999 are free for applications, RFC 6455).
# Only a `welcome` with accepted=false means the token was rejected.
REPLACED = 4001  # the same laptop joined again on a newer connection
BAD_HELLO = 4002  # the first message was not a valid hello
HELLO_TIMEOUT = 4003  # no hello within HELLO_TIMEOUT_S
REJECTED = 4004  # sent after welcome-rejected
SERVER_ERROR = 4005  # accepted-workers.json could not be read

_MAX_LOGGED_PARTS = 3
_MAX_LOGGED_PART = 40

_REJECTED = WelcomeRejected(
    type="welcome", schema_version=1, accepted=False, reason="unknown_token"
).model_dump_json()


def _problems(error: ValidationError) -> str:
    """Field names (shortened, escaped) and error kinds only: never the input, which may hold
    a token, and never raw text a client chose."""
    items = error.errors(include_input=False, include_url=False)
    shown = []
    for item in items[:_MAX_LOGGED_PARTS]:
        where = ".".join(repr(str(part))[:_MAX_LOGGED_PART] for part in item["loc"])
        shown.append(f"{where or 'message'}: {item['type']}")
    more = len(items) - len(shown)
    return "; ".join(shown) + (f"; and {more} more" if more > 0 else "")


def _only_the_token_is_wrong(error: ValidationError) -> bool:
    return all(item["loc"] == ("token",) for item in error.errors(include_input=False))


async def _receive_text(socket: WebSocket) -> str | None:
    """The next text message, or None for a binary one. Raises WebSocketDisconnect on close."""
    message = await socket.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    text = message.get("text")
    return text if isinstance(text, str) else None


async def _close_quietly(socket: WebSocket, code: int, reason: str = "") -> None:
    """Close a socket that may already be gone; a dead peer must never break the caller."""
    try:
        await socket.close(code=code, reason=reason)
    except (RuntimeError, WebSocketDisconnect, OSError):
        return


def create_control_app(
    config: CoordinatorConfig,
    registry: Registry[WebSocket],
    placement: Placement | None = None,
    events: EventLog | None = None,
) -> FastAPI:
    plan = placement if placement is not None else Placement(lambda: [])
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    accepted_file = Path(config.accepted_workers_file)

    @app.websocket("/ws")
    async def join(socket: WebSocket) -> None:
        await socket.accept()
        try:
            first = await asyncio.wait_for(_receive_text(socket), settings.HELLO_TIMEOUT_S)
        except TimeoutError:
            log.info("L2 coordinator: no hello within %s s; closing", settings.HELLO_TIMEOUT_S)
            await _close_quietly(socket, HELLO_TIMEOUT)
            return
        except WebSocketDisconnect:
            return
        if first is None:
            log.info("L2 coordinator: first message was binary, not a hello; closing")
            await _close_quietly(socket, BAD_HELLO)
            return
        try:
            hello = Hello.model_validate_json(first)
        except ValidationError as error:
            if _only_the_token_is_wrong(error):
                log.info("L2 coordinator: rejected a hello with a malformed token")
                await socket.send_text(_REJECTED)
                await _close_quietly(socket, REJECTED)
                return
            log.info("L2 coordinator: first message is not a valid hello: %s", _problems(error))
            await _close_quietly(socket, BAD_HELLO)
            return
        try:
            accepted = await asyncio.to_thread(load_json_model, accepted_file, AcceptedWorkers)
        except ConfigError as error:
            log.error("L2 coordinator: cannot check the token: %s", error)
            await _close_quietly(socket, SERVER_ERROR)
            return
        node_id = find_node_id(hello.token, accepted)
        if node_id is None:
            log.info("L2 coordinator: rejected a hello with an unknown token")
            await socket.send_text(_REJECTED)
            await _close_quietly(socket, REJECTED)
            return
        approved = next(worker for worker in accepted.workers if worker.node_id == node_id)
        hello = hello.model_copy(update={"display_name": approved.display_name})
        previous = registry.join(node_id, hello, socket)
        try:
            if previous is not None:
                log.info(
                    "L2 coordinator: laptop %s joined again; closing its old connection", node_id
                )
                await _close_quietly(previous, REPLACED, "replaced by a newer connection")
            welcome = WelcomeAccepted(
                type="welcome", schema_version=1, accepted=True, node_id=node_id
            )
            await socket.send_text(welcome.model_dump_json())
            log.info("L2 coordinator: laptop %s joined", node_id)
            await _receive(socket, node_id, registry, plan, events)
        finally:
            if registry.is_current(node_id, socket):
                registry.leave(node_id, socket)
                log.info("L2 coordinator: laptop %s disconnected", node_id)

    return app


_FromWorker = TypeAdapter[StatusMessage | LogAppend | LogRead | StateRead](
    Annotated[StatusMessage | LogAppend | LogRead | StateRead, Field(discriminator="type")]
)


async def _receive(
    socket: WebSocket,
    node_id: str,
    registry: Registry[WebSocket],
    placement: Placement,
    events: EventLog | None,
) -> None:
    """Handle a worker's messages until the connection closes: each status is recorded and
    answered with the orders this worker needs; each event log request gets a reply. Bad
    messages are ignored, and logged once per connection."""
    logged_bad = False
    planned = False
    try:
        while True:
            text = await _receive_text(socket)
            try:
                if text is None:
                    raise ValueError("binary message")
                message = _FromWorker.validate_json(text)
            except (ValidationError, ValueError) as error:
                if not logged_bad:
                    logged_bad = True
                    detail = _problems(error) if isinstance(error, ValidationError) else str(error)
                    log.info(
                        "L2 coordinator: ignored a bad message from %s (%s); "
                        "further ones on this connection are not logged",
                        node_id,
                        detail,
                    )
                continue
            if not registry.is_current(node_id, socket):
                continue
            if isinstance(message, StateRead):
                state = registry.api_state(placement.plan.dropped)
                reply = Reply(type="reply", schema_version=1, id=message.id, ok=True, state=state)
                await socket.send_text(reply.model_dump_json(exclude_none=True))
                continue
            if not isinstance(message, StatusMessage):
                reply = await _answer(message, events)
                await socket.send_text(reply.model_dump_json(exclude_none=True))
                continue
            registry.status(node_id, socket, message)
            if not planned:
                planned = True  # its memory is known now, so the plan can use this laptop
                placement.request_replan(lambda: (registry.connected(), registry.known()))
            for order in placement.orders(node_id, registry.job_reports()):
                log.info("L2 coordinator: %s job %s on %s", order.type, order.job, node_id)
                await socket.send_text(order.model_dump_json())
    except (WebSocketDisconnect, WebSocketDisconnected):
        return


async def _answer(request: LogAppend | LogRead, events: EventLog | None) -> Reply:
    def failed(error: str) -> Reply:
        return Reply(type="reply", schema_version=1, id=request.id, ok=False, error=error)

    if events is None:
        return failed("this coordinator keeps no event log")
    try:
        if isinstance(request, LogAppend):
            await asyncio.to_thread(events.append, request.event)
            return Reply(type="reply", schema_version=1, id=request.id, ok=True)
        if request.since is not None:
            found = await asyncio.to_thread(events.since, request.since)
        else:
            assert request.day is not None  # LogRead checks exactly one is given
            found = await asyncio.to_thread(events.day, request.day)
    except EventTooLargeError as error:
        return failed(str(error))
    except OSError as error:
        log.error("L2 coordinator: event log error: %s", error.strerror or type(error).__name__)
        return failed("the event log could not be read or written")
    kept, truncated = _fit(found)
    return Reply(
        type="reply", schema_version=1, id=request.id, ok=True, events=kept, truncated=truncated
    )


def _fit(events: list[LoggedEvent]) -> tuple[list[LoggedEvent], bool]:
    """The newest events whose JSON fits in REPLY_MAX_BYTES, oldest first."""
    kept: list[LoggedEvent] = []
    size = 0
    for event in reversed(events):
        size += len(event.model_dump_json().encode("utf-8")) + 1
        if size > settings.REPLY_MAX_BYTES:
            break
        kept.append(event)
    kept.reverse()
    return kept, len(kept) < len(events)


def create_dashboard_app(
    registry: Registry[WebSocket], placement: Placement | None = None
) -> FastAPI:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    # Only this machine may read it, by address: a web page using DNS rebinding cannot.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.get("/api/state")
    async def api_state() -> JSONResponse:
        dropped = placement.plan.dropped if placement is not None else ()
        return JSONResponse(registry.api_state(dropped).model_dump(mode="json"))

    @app.get("/api/hardware")
    async def hardware() -> JSONResponse:
        return JSONResponse(registry.hardware().model_dump(mode="json"))

    @app.get("/")
    async def page() -> HTMLResponse:
        return HTMLResponse(PAGE)

    return app
