import json
import sys
from pathlib import Path

import pytest
from conftest import closed_port, contract

from layer2 import settings
from layer2.specs import collect_specs, collect_tools, missing_items, ollama_answers

TOKEN: str = contract("hello.json")["token"]


def write_worker_config(tmp_path: Path, ollama_url: str, token: str = TOKEN) -> Path:
    token_file = tmp_path / "worker-token"
    token_file.write_text(token, encoding="utf-8")
    config = {**contract("worker.json"), "ollama_url": ollama_url}
    for key in ("python", "status_file", "stop_file", "state_dir"):
        config[key] = str(tmp_path / key)
    config["token_file"] = str(token_file)
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    return path


def test_nothing_missing(tmp_path: Path, ollama_url: str) -> None:
    assert missing_items(write_worker_config(tmp_path, ollama_url)) == []


def test_ollama_down_is_reported_but_not_required(tmp_path: Path) -> None:
    url = f"http://127.0.0.1:{closed_port()}"
    [item] = missing_items(write_worker_config(tmp_path, url))
    assert (item.id, item.required, item.reason) == ("ollama", False, f"not reachable at {url}")


def test_bad_token_file_is_required(tmp_path: Path, ollama_url: str) -> None:
    [item] = missing_items(write_worker_config(tmp_path, ollama_url, token=TOKEN + "\n"))
    assert (item.id, item.required) == ("token", True)


def test_bad_config_is_required(tmp_path: Path) -> None:
    path = tmp_path / "worker.json"
    path.write_text("{}", encoding="utf-8")
    [item] = missing_items(path)
    assert (item.id, item.required) == ("config", True)


def test_wrong_python_is_required(
    tmp_path: Path, ollama_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "REQUIRED_PYTHON", (3, 99))
    [item] = missing_items(write_worker_config(tmp_path, ollama_url))
    assert (item.id, item.required) == ("python", True)


def test_ollama_answers(ollama_url: str) -> None:
    assert ollama_answers(ollama_url)
    assert not ollama_answers(f"http://127.0.0.1:{closed_port()}")
    assert not ollama_answers("not a url")


def test_tools_report_python_and_ollama(ollama_url: str) -> None:
    tools = collect_tools(ollama_url)
    assert tools.python.startswith("3.12.")
    assert tools.ollama


@pytest.mark.skipif(sys.platform != "darwin", reason="checks values only a Mac reports")
def test_specs_on_this_mac() -> None:
    found = collect_specs()
    assert found.os == "macos"
    assert found.cores >= 1
    assert found.memory_gb >= 1
    assert found.cpu


def test_relative_path_in_config_is_required(tmp_path: Path, ollama_url: str) -> None:
    path = write_worker_config(tmp_path, ollama_url)
    config = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps({**config, "status_file": "status.json"}), encoding="utf-8")
    [item] = missing_items(path)
    assert (item.id, item.required) == ("config", True)


@pytest.mark.skipif(sys.platform != "win32", reason="checks values only Windows reports")
def test_specs_on_this_windows_machine() -> None:
    found = collect_specs()
    assert found.os == "windows"
    assert found.os_version
    assert found.cores >= 1
    assert found.memory_gb >= 1
    assert found.cpu
