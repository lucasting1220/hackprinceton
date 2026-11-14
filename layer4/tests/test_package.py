import importlib.metadata
from pathlib import Path

import layer4


def test_package_is_installed_from_this_layer() -> None:
    package_dir = Path(layer4.__file__).resolve().parent
    layer_dir = Path(__file__).resolve().parent.parent
    assert package_dir == layer_dir / "src" / "layer4"
    assert importlib.metadata.version("layer4") == "0.1.0"


def test_package_declares_type_hints() -> None:
    assert (Path(layer4.__file__).resolve().parent / "py.typed").is_file()
