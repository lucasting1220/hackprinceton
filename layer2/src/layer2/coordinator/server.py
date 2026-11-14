"""The coordinator's two web apps.

Control app (WebSocket /ws on 0.0.0.0:listen_port): workers join with `hello` and report with
`status`. Dashboard app (127.0.0.1:dashboard_port): the dashboard page, GET /api/state (the
Layer 1 contract) and GET /api/hardware (Layer 2 only).
Neither ever logs a token, a whole `hello` or raw text a client chose.
"""

import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.websockets import WebSocketDisconnected

from layer2 import settings
from layer2.contracts import (
    AcceptedWorkers,
    CoordinatorConfig,
    Hello,
    StatusMessage,
    WelcomeAccepted,
    WelcomeRejected,
)
from layer2.coordinator.dashboard import PAGE
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


def create_control_app(config: CoordinatorConfig, registry: Registry[WebSocket]) -> FastAPI:
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
            await _receive_status(socket, node_id, registry)
        finally:
            if registry.is_current(node_id, socket):
                registry.leave(node_id, socket)
                log.info("L2 coordinator: laptop %s disconnected", node_id)

    return app


async def _receive_status(socket: WebSocket, node_id: str, registry: Registry[WebSocket]) -> None:
    """Record status messages until the connection closes. Bad messages are ignored, and
    logged once per connection."""
    logged_bad = False
    try:
        while True:
            text = await _receive_text(socket)
            try:
                if text is None:
                    raise ValueError("binary message")
                message = StatusMessage.model_validate_json(text)
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
            registry.status(node_id, socket, message)
    except (WebSocketDisconnect, WebSocketDisconnected):
        return


def create_dashboard_app(registry: Registry[WebSocket]) -> FastAPI:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    # Only this machine may read it, by address: a web page using DNS rebinding cannot.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.get("/api/state")
    async def api_state() -> JSONResponse:
        return JSONResponse(registry.api_state().model_dump(mode="json"))

    @app.get("/api/hardware")
    async def hardware() -> JSONResponse:
        return JSONResponse(registry.hardware().model_dump(mode="json"))

    @app.get("/")
    async def page() -> HTMLResponse:
        return HTMLResponse(PAGE)

    return app
