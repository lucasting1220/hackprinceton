"""Handing Layer 4's messages for phones to Layer 1's bridge, on this laptop at `bridge_url`.

Paths follow the Layer 1 doc ("Handoff to Layer 4"): POST /v1/alerts, /v1/replies, /v1/status
and /v1/reports, each with one JSON object. Layer 2 carries the object as it is: its fields are
Layers 1 and 4's. The bridge keeps an outbox until the relay confirms, so one attempt here is
enough; a failure goes back to the job, which decides whether to retry. Message contents are
never logged: they are about the resident. Blocking: call through `asyncio.to_thread`.
"""

import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Mapping

from pydantic import JsonValue

from layer2 import settings

KINDS = ("alerts", "replies", "status", "reports")
_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class BridgeError(Exception):
    """The bridge was unreachable, slow, or refused the message; the text says which."""


def post(bridge_url: str, kind: str, body: Mapping[str, JsonValue]) -> None:
    if kind not in KINDS:
        raise BridgeError(f"kind must be one of {', '.join(KINDS)}")
    request = urllib.request.Request(
        f"{bridge_url.rstrip('/')}/v1/{kind}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _NO_PROXY.open(request, timeout=settings.BRIDGE_TIMEOUT_S):
            return
    except urllib.error.HTTPError as error:
        raise BridgeError(f"the bridge refused it ({error.code})") from None
    except TimeoutError:
        raise BridgeError(
            f"the bridge did not answer within {settings.BRIDGE_TIMEOUT_S} s"
        ) from None
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise BridgeError(f"cannot reach the bridge ({type(error).__name__})") from None
