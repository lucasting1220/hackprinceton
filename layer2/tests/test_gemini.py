"""The Gemini client: requests, answers, refusals, and where the key comes from."""

import json
from pathlib import Path

import pytest
from conftest import FakeGemini, closed_port

from layer2 import settings
from layer2.gemini import ModelError, api_key, generate

KEY = "AIza-test-key"


def test_sends_the_prompt_with_the_key_in_a_header_and_returns_the_text(
    fake_gemini: type[FakeGemini],
) -> None:
    fake_gemini.text = "Fall in the kitchen."
    assert generate(KEY, "gemini-x", "Rewrite: fall") == "Fall in the kitchen."
    [request] = fake_gemini.seen
    assert request["path"] == "/v1beta/models/gemini-x:generateContent"
    assert request["key"] == KEY
    assert request["body"] == {"contents": [{"role": "user", "parts": [{"text": "Rewrite: fall"}]}]}


def test_thought_parts_are_left_out(fake_gemini: type[FakeGemini]) -> None:
    parts = [{"text": "thinking...", "thought": True}, {"text": "A"}, {"text": "B"}]
    fake_gemini.body = json.dumps({"candidates": [{"content": {"parts": parts}}]}).encode()
    assert generate(KEY, "gemini-x", "p") == "AB"


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (
            403,
            {"error": {"code": 403, "message": f"bad key {KEY}", "status": "PERMISSION_DENIED"}},
            "Gemini refused the request for gemini-x: HTTP 403 PERMISSION_DENIED",
        ),
        (500, "not json", "Gemini refused the request for gemini-x: HTTP 500"),
        (200, {"promptFeedback": {"blockReason": "SAFETY"}}, "blocked the prompt"),
        (200, {"candidates": []}, "had no text"),
        (200, "not json", "could not answer"),
    ],
)
def test_refusals_and_empty_answers_raise_without_echoing_the_key(
    fake_gemini: type[FakeGemini], status: int, body: object, expected: str
) -> None:
    fake_gemini.status = status
    fake_gemini.body = (body if isinstance(body, str) else json.dumps(body)).encode()
    with pytest.raises(ModelError) as error:
        generate(KEY, "gemini-x", "p")
    assert expected in str(error.value)
    assert KEY not in str(error.value)


def test_unreachable_or_late_raises(
    fake_gemini: type[FakeGemini], monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_gemini.delay = 1.0
    with pytest.raises(ModelError, match="did not answer within"):
        generate(KEY, "gemini-x", "p", timeout=0.2)
    monkeypatch.setattr(settings, "GEMINI_URL", f"http://127.0.0.1:{closed_port()}")
    with pytest.raises(ModelError, match="could not answer"):
        generate(KEY, "gemini-x", "p")


def test_the_key_comes_from_the_environment_then_the_state_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert api_key(tmp_path) is None
    (tmp_path / settings.GEMINI_KEY_FILE).write_text(" from-file\n", encoding="utf-8")
    assert api_key(tmp_path) == "from-file"
    monkeypatch.setenv("GEMINI_API_KEY", "from-env")
    assert api_key(tmp_path) == "from-env"
    monkeypatch.setenv("GEMINI_API_KEY", "  ")
    (tmp_path / settings.GEMINI_KEY_FILE).write_text("\n", encoding="utf-8")
    assert api_key(tmp_path) is None
