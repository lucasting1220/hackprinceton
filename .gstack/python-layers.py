"""Run a command in every Python layer (layerN/ with a pyproject.toml), for /verify and /ship.

Usage:
  python-layers.py <command...>     run `uv run <command...>` inside each Python layer
  python-layers.py --tests <files>  run the whole pytest suite of each layer the files belong to;
                                    for files in Layer 1 (Node, layer1/package.json), run every
                                    check layer1/README.md lists: format, lint, type check, tests
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 600
NODE_LAYER = ROOT / "layer1"
NODE_CHECKS = (["run", "format:check"], ["run", "lint"], ["run", "typecheck"], ["test"])


def python_layer(name: str) -> Path | None:
    parts = Path(name).parts
    if not parts:
        return None
    layer = ROOT / parts[0]
    return layer if (layer / "pyproject.toml").is_file() else None


def in_node_layer(name: str) -> bool:
    parts = Path(name).parts
    return bool(parts) and ROOT / parts[0] == NODE_LAYER and (NODE_LAYER / "package.json").is_file()


def run(layer: Path, args: list[str]) -> int:
    print(f"== {layer.name}: uv run {' '.join(args)}", flush=True)
    done = subprocess.run(["uv", "run", "--project", str(layer), *args], cwd=layer, timeout=TIMEOUT_S)
    return done.returncode


def run_node_checks() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print(f"== {NODE_LAYER.name}: npm is not on PATH", flush=True)
        return 1
    install = [] if (NODE_LAYER / "node_modules").is_dir() else [["ci"]]
    for args in [*install, *NODE_CHECKS]:
        print(f"== {NODE_LAYER.name}: npm {' '.join(args)}", flush=True)
        done = subprocess.run([npm, *args], cwd=NODE_LAYER, timeout=TIMEOUT_S)
        if done.returncode != 0:
            return done.returncode
    return 0


def main(argv: list[str]) -> int:
    node = False
    if argv[:1] == ["--tests"]:
        layers = {layer for name in argv[1:] if (layer := python_layer(name))}
        jobs = [(layer, ["pytest"]) for layer in sorted(layers)]
        node = any(in_node_layer(name) for name in argv[1:])
    else:
        jobs = [(layer.parent, argv) for layer in sorted(ROOT.glob("layer*/pyproject.toml"))]
    failed = [layer.name for layer, args in jobs if run(layer, args) != 0]
    if node and run_node_checks() != 0:
        failed.append(NODE_LAYER.name)
    if failed:
        print(f"== failed in: {', '.join(failed)}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
