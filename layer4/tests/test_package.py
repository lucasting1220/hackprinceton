import importlib.metadata
import tomllib
from pathlib import Path

import layer4


def test_package_is_installed_from_this_layer() -> None:
    package_dir = Path(layer4.__file__).resolve().parent
    layer_dir = Path(__file__).resolve().parent.parent
    assert package_dir == layer_dir / "src" / "layer4"
    with (layer_dir / "pyproject.toml").open("rb") as pyproject:
        declared = tomllib.load(pyproject)["project"]["version"]
    assert importlib.metadata.version("layer4") == declared


def test_package_declares_type_hints() -> None:
    assert (Path(layer4.__file__).resolve().parent / "py.typed").is_file()
