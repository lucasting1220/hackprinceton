"""Puts layer3/stubs on the import path: the stand-ins there are not part of the package."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "stubs"))
