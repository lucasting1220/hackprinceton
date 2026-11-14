"""Join tokens: format check, hashing and constant-time lookup. Tokens are never logged."""

import hashlib
import hmac
import re
from pathlib import Path

from layer2.contracts import AcceptedWorkers

_TOKEN = re.compile(r"[0-9a-f]{64}")


class TokenError(Exception):
    """The token file is unreadable or does not hold a well-formed token."""


def is_well_formed(token: str) -> bool:
    return _TOKEN.fullmatch(token) is not None


def read_token_file(path: Path) -> str:
    try:
        token = path.read_text(encoding="utf-8")
    except OSError as error:
        raise TokenError(f"cannot read token file {path}: {error.strerror}") from error
    if not is_well_formed(token):
        raise TokenError(
            f"token file {path} must hold exactly 64 lowercase hex characters, no newline"
        )
    return token


def token_sha256(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def find_node_id(token: str, accepted: AcceptedWorkers) -> str | None:
    """Compare the token's hash with every entry, without stopping early."""
    digest = token_sha256(token)
    found: str | None = None
    for worker in accepted.workers:
        if hmac.compare_digest(digest, worker.token_sha256):
            found = worker.node_id
    return found
