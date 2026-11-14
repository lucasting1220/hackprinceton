import json
import platform
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
from conftest import closed_port, contract

from layer2 import settings
from layer2.specs import (
    UnsupportedPlatformError,
    collect_specs,
    collect_tools,
    missing_items,
    ollama_answers,
)
from layer2.tokens import read_token_file

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


def _serve_once(reply: bytes, delay_s: float = 0.0) -> str:
    """A one-shot TCP server that sends `reply` byte by byte, `delay_s` apart."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)

    def answer() -> None:
        with listener:
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            with conn:
                try:
                    for byte in reply:
                        conn.sendall(bytes([byte]))
                        time.sleep(delay_s)
                except OSError:
                    return

    threading.Thread(target=answer, daemon=True).start()
    return f"http://127.0.0.1:{listener.getsockname()[1]}"


def test_ollama_error_status_is_not_answering(ollama_url: str) -> None:
    assert not ollama_answers(ollama_url + "/not-ollama")


def test_non_http_reply_is_not_answering(tmp_path: Path) -> None:
    url = _serve_once(b"SSH-2.0-OpenSSH_9.6\r\n")
    assert not ollama_answers(url)
    [item] = missing_items(write_worker_config(tmp_path, _serve_once(b"SSH-2.0-x\r\n")))
    assert (item.id, item.required) == ("ollama", False)


def test_slow_reply_hits_the_overall_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OLLAMA_CHECK_TIMEOUT_S", 0.5)
    url = _serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", delay_s=0.1)
    started = time.monotonic()
    assert not ollama_answers(url)
    assert time.monotonic() - started < 1.5


def test_proxy_settings_are_ignored(ollama_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    dead_proxy = f"http://127.0.0.1:{closed_port()}"
    for name in ("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, dead_proxy)
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    assert ollama_answers(ollama_url)


def test_other_platforms_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    with pytest.raises(UnsupportedPlatformError):
        collect_specs()


@pytest.mark.skipif(sys.platform != "darwin", reason="Mac sysctl paths")
def test_mac_falls_back_when_sysctl_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken_run(*args: object, **kwargs: object) -> object:
        raise OSError("no sysctl")

    monkeypatch.setattr(subprocess, "run", broken_run)
    monkeypatch.setattr(platform, "machine", lambda: "arm64")
    found = collect_specs()
    assert found.cpu == platform.processor()
    assert found.gpu == "apple-silicon"


@pytest.mark.skipif(sys.platform != "darwin", reason="Mac sysctl paths")
def test_apple_silicon_is_found_under_rosetta(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        stdout = "1\n" if command[-1] == "hw.optional.arm64" else "Apple M2\n"
        return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")
    assert collect_specs().gpu == "apple-silicon"


def test_busy_token_file_is_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "worker-token"
    path.write_text(TOKEN, encoding="utf-8")
    real_read_text = Path.read_text
    failures = [PermissionError("busy")]

    def flaky_read_text(self: Path, encoding: str | None = None, errors: str | None = None) -> str:
        if failures:
            raise failures.pop()
        return real_read_text(self, encoding=encoding, errors=errors)

    monkeypatch.setattr(Path, "read_text", flaky_read_text)
    assert read_token_file(path) == TOKEN
