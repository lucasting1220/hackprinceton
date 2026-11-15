"""Tests for reading the camera from worker.json, including the shared contract file."""

import json
from pathlib import Path

import pytest

from layer3.worker_config import FIELDS_READ, ConfigError, load_camera

CONTRACT_FILE: Path = Path(__file__).resolve().parents[2] / "contracts" / "worker.json"


def write_config(folder: Path, config: object) -> Path:
    config_path = folder / "worker.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return config_path


def test_contract_example_gives_its_camera() -> None:
    example = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))

    assert load_camera(CONTRACT_FILE) == example["camera"]
    assert isinstance(example["camera"], str)


def test_only_the_contract_fields_in_fields_read_are_needed(tmp_path: Path) -> None:
    example = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))
    only_fields_read = {field: example[field] for field in FIELDS_READ}

    assert load_camera(write_config(tmp_path, only_fields_read)) == example["camera"]


@pytest.mark.parametrize("field", FIELDS_READ)
def test_each_contract_field_in_fields_read_is_required(tmp_path: Path, field: str) -> None:
    example = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))
    del example[field]

    with pytest.raises(ConfigError, match=field):
        load_camera(write_config(tmp_path, example))


@pytest.mark.parametrize("camera", ["j5 WebCam JVCU100", " padded name ", None])
def test_camera_is_a_name_returned_unchanged_or_none(tmp_path: Path, camera: str | None) -> None:
    config_path = write_config(tmp_path, {"schema_version": 1, "camera": camera})

    assert load_camera(config_path) == camera


@pytest.mark.parametrize("camera", [0, 3, True, False, 1.5, [], {}, "", "   "])
def test_camera_that_is_not_a_name_or_null_is_a_config_error(
    tmp_path: Path, camera: object
) -> None:
    config_path = write_config(tmp_path, {"schema_version": 1, "camera": camera})

    with pytest.raises(ConfigError, match="must be a camera name or null"):
        load_camera(config_path)


@pytest.mark.parametrize("version", [2, 0, 1.0, "1", True, None])
def test_unsupported_schema_version_is_a_config_error(tmp_path: Path, version: object) -> None:
    config_path = write_config(tmp_path, {"schema_version": version, "camera": None})

    with pytest.raises(ConfigError, match="schema_version"):
        load_camera(config_path)


def test_a_file_saved_with_a_byte_order_mark_is_read_like_layer_2_reads_it(tmp_path: Path) -> None:
    config_path = tmp_path / "worker.json"
    config_path.write_text(
        json.dumps({"schema_version": 1, "camera": "j5 WebCam JVCU100"}), encoding="utf-8-sig"
    )

    assert load_camera(config_path) == "j5 WebCam JVCU100"


def test_missing_file_is_a_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="cannot read"):
        load_camera(tmp_path / "absent.json")


@pytest.mark.parametrize(
    "text",
    ["{not json", "[" * 100_000, '{"schema_version": ' + "1" * 5000 + ', "camera": null}'],
)
def test_invalid_json_is_a_config_error(tmp_path: Path, text: str) -> None:
    config_path = tmp_path / "worker.json"
    config_path.write_text(text, encoding="utf-8")

    with pytest.raises(ConfigError, match="not valid JSON"):
        load_camera(config_path)


def test_json_that_is_not_an_object_is_a_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="one JSON object"):
        load_camera(write_config(tmp_path, ["camera"]))


def test_a_file_that_is_not_utf_8_is_a_config_error(tmp_path: Path) -> None:
    config_path = tmp_path / "worker.json"
    config_path.write_text('{"schema_version": 1, "camera": null}', encoding="utf-16")

    with pytest.raises(ConfigError, match="cannot read"):
        load_camera(config_path)
