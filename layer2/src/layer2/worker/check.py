"""`layer2-worker check --config <worker.json> [--json]`: what this laptop is missing.

Installs nothing and never opens the camera or mic (contracts/README.md). With --json it prints
the contracts/check-output.json shape for Layer 1's setup page. Exit 4 when a required item is
missing, else 0. The token is never printed: missing_items reports only that it is malformed.
"""

from pathlib import Path
from typing import TextIO

from layer2.contracts import CheckOutput
from layer2.specs import missing_items

EXIT_OK = 0
EXIT_MISSING = 4


def run_check(config_path: Path, as_json: bool, out: TextIO) -> int:
    missing = missing_items(config_path)
    ok = not any(item.required for item in missing)
    if as_json:
        out.write(CheckOutput(schema_version=1, ok=ok, missing=missing).model_dump_json() + "\n")
    else:
        out.write("OK\n" if ok else "MISSING REQUIRED ITEMS\n")
        for item in missing:
            kind = "required" if item.required else "optional"
            out.write(f"- {item.id} ({kind}): {item.reason}\n")
    return EXIT_OK if ok else EXIT_MISSING
