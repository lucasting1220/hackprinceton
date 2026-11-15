"""Types for the parts of MediaPipe that Layer 4 uses. The library ships none of its own.

tests/test_library_stubs.py checks these files against the installed library with
mypy.stubtest.
"""

import enum

import numpy as np
from numpy.typing import NDArray

class ImageFormat(enum.IntEnum):
    SRGB = 1

class Image:
    def __init__(self, image_format: ImageFormat, data: NDArray[np.uint8]) -> None: ...
