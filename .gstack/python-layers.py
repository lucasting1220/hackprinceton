"""Run a command in every Python layer (layerN/ with a pyproject.toml), for /verify and /ship.

Usage:
  python-layers.py <command...>     run `uv run <command...>` inside each Python layer
  python-layers.py --tests <files>  run the whole pytest suite of each layer the files belong to
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 600


def python_layer(name: str) -> Path | None:
    parts = Path(name).parts
    if not parts:
        return None
    layer = ROOT / parts[0]
    return layer if (layer / "pyproject.toml").is_file() else None


def run(layer: Path, args: list[str]) -> int:
    print(f"== {layer.name}: uv run {' '.join(args)}", flush=True)
    done = subprocess.run(["uv", "run", "--project", str(layer), *args], cwd=layer, timeout=TIMEOUT_S)
    return done.returncode


def main(argv: list[str]) -> int:
    if argv[:1] == ["--tests"]:
        layers = {layer for name in argv[1:] if (layer := python_layer(name))}
        jobs = [(layer, ["pytest"]) for layer in sorted(layers)]
    else:
        jobs = [(layer.parent, argv) for layer in sorted(ROOT.glob("layer*/pyproject.toml"))]
    failed = [layer.name for layer, args in jobs if run(layer, args) != 0]
    if failed:
        print(f"== failed in: {', '.join(failed)}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
