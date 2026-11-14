"""The coordinator's two web apps.

Control app (WebSocket /ws on 0.0.0.0:listen_port): workers join with `hello` and report with
`status`. Dashboard app (127.0.0.1:dashboard_port): the dashboard page and GET /api/state.
Neither ever logs a token or a whole `hello`.
"""

import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import ValidationError

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

# WebSocket close codes (RFC 6455).
POLICY_VIOLATION = 1008
SERVER_ERROR = 1011


def _problems(error: ValidationError) -> str:
    """Field names and error kinds only: never the input, which may hold a token."""
    return "; ".join(
        f"{'.'.join(str(part) for part in item['loc']) or 'message'}: {item['type']}"
        for item in error.errors(include_input=False, include_url=False)
    )


def create_control_app(config: CoordinatorConfig, registry: Registry[WebSocket]) -> FastAPI:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    accepted_file = Path(config.accepted_workers_file)

    @app.websocket("/ws")
    async def join(socket: WebSocket) -> None:
        await socket.accept()
        try:
            first = await asyncio.wait_for(socket.receive_text(), settings.HELLO_TIMEOUT_S)
        except TimeoutError:
            log.info("L2 coordinator: no hello within %s s; closing", settings.HELLO_TIMEOUT_S)
            await socket.close(code=POLICY_VIOLATION)
            return
        except WebSocketDisconnect:
            return
        try:
            hello = Hello.model_validate_json(first)
        except ValidationError as error:
            log.info("L2 coordinator: first message is not a valid hello: %s", _problems(error))
            await socket.close(code=POLICY_VIOLATION)
            return
        try:
            accepted = await asyncio.to_thread(load_json_model, accepted_file, AcceptedWorkers)
        except ConfigError as error:
            log.error("L2 coordinator: cannot check the token: %s", error)
            await socket.close(code=SERVER_ERROR)
            return
        node_id = find_node_id(hello.token, accepted)
        if node_id is None:
            log.info("L2 coordinator: rejected a hello with an unknown token")
            rejected = WelcomeRejected(
                type="welcome", schema_version=1, accepted=False, reason="unknown_token"
            )
            await socket.send_text(rejected.model_dump_json())
            await socket.close(code=POLICY_VIOLATION)
            return
        approved = next(worker for worker in accepted.workers if worker.node_id == node_id)
        hello = hello.model_copy(update={"display_name": approved.display_name})
        welcome = WelcomeAccepted(type="welcome", schema_version=1, accepted=True, node_id=node_id)
        await socket.send_text(welcome.model_dump_json())
        previous = registry.join(node_id, hello, socket)
        log.info("L2 coordinator: laptop %s joined", node_id)
        if previous is not None:
            await _close_quietly(previous)
        await _receive_status(socket, node_id, registry)

    return app


async def _close_quietly(socket: WebSocket) -> None:
    try:
        await socket.close(code=POLICY_VIOLATION, reason="replaced by a newer connection")
    except RuntimeError:
        return  # already closed


async def _receive_status(socket: WebSocket, node_id: str, registry: Registry[WebSocket]) -> None:
    try:
        while True:
            text = await socket.receive_text()
            try:
                message = StatusMessage.model_validate_json(text)
            except ValidationError as error:
                log.info(
                    "L2 coordinator: ignored a bad message from %s: %s", node_id, _problems(error)
                )
                continue
            registry.status(node_id, socket, message)
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass  # closed by a newer connection for the same laptop
    finally:
        registry.leave(node_id, socket)
        log.info("L2 coordinator: laptop %s disconnected", node_id)


def create_dashboard_app(registry: Registry[WebSocket]) -> FastAPI:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get("/api/state")
    async def api_state() -> JSONResponse:
        return JSONResponse(registry.api_state().model_dump(mode="json"))

    @app.get("/")
    async def page() -> HTMLResponse:
        return HTMLResponse(PAGE)

    return app
