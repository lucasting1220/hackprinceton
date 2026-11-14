"""Shared test helpers for Layer 2."""

import json
from pathlib import Path
from typing import Any

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def contract(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    return data
