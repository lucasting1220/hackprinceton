import subprocess
import sys
from pathlib import Path

import pytest

LAYER_DIRECTORY = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("library", ["mediapipe", "faster_whisper"])
def test_the_stubs_match_the_installed_library(library: str) -> None:
    checked = subprocess.run(
        [
            sys.executable,
            "-m",
            "mypy.stubtest",
            library,
            "--ignore-missing-stub",
            "--mypy-config-file",
            str(LAYER_DIRECTORY / "pyproject.toml"),
        ],
        cwd=LAYER_DIRECTORY,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
        check=False,
    )
    assert checked.returncode == 0, checked.stdout + checked.stderr
