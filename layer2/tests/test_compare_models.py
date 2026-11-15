import json
from typing import Any

import pytest

from layer2 import compare_models
from layer2.compare_models import homes, main, try_planner, try_quick
from layer2.coordinator.plan import Plan, rule_plan
from layer2.ollama import ModelError


def test_homes_are_varied_and_the_same_for_every_model() -> None:
    first, again = homes(30), homes(30)
    assert first == again
    sizes = {len(laptops) for _, laptops in first}
    assert sizes == {1, 2, 3}
    assert any(not laptop.sensors for _, laptops in first for laptop in laptops)


def good_answer(needs: Any, laptops: Any) -> str:
    plan = rule_plan(needs, laptops, {laptop.node_id for laptop in laptops}, Plan())
    return json.dumps(
        {"jobs": [{"job": j, "node_id": n} for j, n in plan.jobs.items()], "reasoning": "rules"}
    )


def test_planner_answers_are_scored_by_the_real_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    cases = iter(homes(6))
    calls = iter(range(6))

    def fake_generate(url: str, model: str, prompt: str, **kwargs: object) -> str:
        needs, laptops = next(cases)
        n = next(calls)
        if n == 0:
            raise ModelError(f"model {model} did not answer within 20.0 s")
        if n == 1:
            return "not json"
        return good_answer(needs, laptops)

    monkeypatch.setattr(compare_models, "generate", fake_generate)
    monkeypatch.setattr(compare_models, "loaded_memory_gb", lambda url, model: 2.1)
    result = try_planner("http://ollama", "small:3b", 6)
    assert (result.runs, result.passed, result.memory_gb) == (6, 4, 2.1)
    assert result.failures["timeout"] == 1
    assert sum(result.failures.values()) == 2


def test_quick_answers_are_timed_and_empty_ones_count_as_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answers = iter(["A fall in the kitchen.", "  ", "yes"])
    monkeypatch.setattr(compare_models, "generate", lambda *a, **k: next(answers))
    monkeypatch.setattr(compare_models, "loaded_memory_gb", lambda url, model: None)
    result = try_quick("http://ollama", "quick:8b", 3)
    assert (result.runs, result.passed, dict(result.failures)) == (3, 2, {"empty answer": 1})


def test_the_command_prints_a_table(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(compare_models, "generate", lambda *a, **k: "not json")
    monkeypatch.setattr(compare_models, "loaded_memory_gb", lambda url, model: None)
    assert main(["--planner", "a:1b", "--quick", "b:1b", "--runs", "2"]) == 0
    out = capsys.readouterr().out
    assert "Planner models (2 runs each)" in out and "Quick models" in out
    assert "a:1b" in out and "0/2" in out and "2/2" in out
    with pytest.raises(SystemExit):
        main([])
