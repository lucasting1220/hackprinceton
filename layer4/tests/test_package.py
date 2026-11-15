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


def test_layer2_job_client_is_importable() -> None:
    from layer2.job_client import Layer2, Layer2Error

    assert issubclass(Layer2Error, Exception)
    assert callable(Layer2.from_env)
