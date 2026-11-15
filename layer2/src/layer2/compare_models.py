"""`layer2-compare-models`: try candidate Ollama models on this laptop before choosing
PLANNER_MODEL and QUICK_MODEL.

Planner models get the coordinator's real prompt for varied homes (one to three laptops, with
and without a camera or mic, 7 to 14 GB free so a valid plan always exists), and each answer
goes through the real code checks (coordinator/ai_plan.py), so "passed" means the coordinator
would have used it.
Quick models get short alert-rewrite style prompts and are timed. Memory comes from Ollama's
/api/ps after each model's runs. Nothing here changes a setting: read the table and decide.

    uv run --project layer2 layer2-compare-models --planner qwen2.5:3b llama3.2:3b \\
        --quick llama3.1:8b --runs 20

Pull each model first (`ollama pull <tag>`). Run it on the laptop that will use the model.
"""

import argparse
import json
import random
import statistics
import time
import urllib.request
from collections import Counter
from dataclasses import dataclass, field

from layer2 import settings
from layer2.coordinator.ai_plan import PlanError, parse_and_check, planner_prompt
from layer2.coordinator.plan import JobNeed, LaptopView, Plan, Sensor
from layer2.ollama import ModelError, generate

JOBS = [
    JobNeed("capture", 0.5, "camera"),
    JobNeed("fall_model", 2.0, "camera"),
    JobNeed("speech_to_text", 2.0, "mic"),
    JobNeed("care_rules", 0.5, None),
    JobNeed("watch_receiver", 0.2, None),
]

QUICK_PROMPTS = [
    "Rewrite this alert for a caregiver in one calm sentence: Fall detected, kitchen, 14:02.",
    "Rewrite this alert for a caregiver in one calm sentence: Heart rate 128 bpm at rest at 03:10.",
    "Does this transcript ask for help? Answer yes or no: 'I can't get up, can someone come?'",
]


@dataclass
class Result:
    model: str
    times: list[float] = field(default_factory=list)
    passed: int = 0
    failures: Counter[str] = field(default_factory=Counter)
    memory_gb: float | None = None

    @property
    def runs(self) -> int:
        return len(self.times)


def homes(runs: int, seed: int = 7) -> list[tuple[list[JobNeed], list[LaptopView]]]:
    """Varied but repeatable homes: the same list for every model."""
    rng = random.Random(seed)
    cases = []
    for _ in range(runs):
        laptops = []
        for index in range(rng.randint(1, 3)):
            sensors: set[Sensor] = set()
            if rng.random() < 0.5:
                sensors.add("camera")
            if rng.random() < 0.5:
                sensors.add("mic")
            free = round(rng.uniform(7.0, 14.0), 1)  # always room for every job: a fair test
            laptops.append(LaptopView(f"node-{index + 1}", frozenset(sensors), free))
        cases.append((list(JOBS), laptops))
    return cases


def try_planner(ollama_url: str, model: str, runs: int) -> Result:
    result = Result(model)
    for needs, laptops in homes(runs):
        started = time.monotonic()
        try:
            text = generate(
                ollama_url,
                model,
                planner_prompt(needs, laptops, Plan()),
                timeout=settings.PLANNER_TIMEOUT_S,
                json_only=True,
            )
            parse_and_check(text, needs, laptops, Plan())
            result.passed += 1
        except ModelError as error:
            result.failures["timeout" if "within" in str(error) else "ollama error"] += 1
        except PlanError as error:
            result.failures[str(error).split(":")[0].split(" is ")[0][:40]] += 1
        result.times.append(time.monotonic() - started)
    result.memory_gb = loaded_memory_gb(ollama_url, model)
    return result


def try_quick(ollama_url: str, model: str, runs: int) -> Result:
    result = Result(model)
    for index in range(runs):
        started = time.monotonic()
        try:
            text = generate(ollama_url, model, QUICK_PROMPTS[index % len(QUICK_PROMPTS)])
            if text.strip():
                result.passed += 1
            else:
                result.failures["empty answer"] += 1
        except ModelError as error:
            result.failures["timeout" if "within" in str(error) else "ollama error"] += 1
        result.times.append(time.monotonic() - started)
    result.memory_gb = loaded_memory_gb(ollama_url, model)
    return result


def loaded_memory_gb(ollama_url: str, model: str) -> float | None:
    """The model's size in memory from Ollama's /api/ps, or None if it cannot be read."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(ollama_url.rstrip("/") + "/api/ps", timeout=5) as response:
            loaded = json.load(response).get("models", [])
    except (OSError, ValueError):
        return None
    for entry in loaded:
        if entry.get("name") == model or entry.get("model") == model:
            size = entry.get("size")
            return round(size / 2**30, 1) if isinstance(size, int) else None
    return None


def table(kind: str, results: list[Result]) -> str:
    lines = [
        f"{kind} models ({results[0].runs if results else 0} runs each)",
        f"{'model':<24}{'passed':>9}{'median s':>10}{'worst s':>9}{'memory':>9}  failures",
    ]
    for r in results:
        median = statistics.median(r.times) if r.times else 0.0
        worst = max(r.times) if r.times else 0.0
        memory = f"{r.memory_gb} GB" if r.memory_gb is not None else "?"
        failures = ", ".join(f"{name} x{count}" for name, count in r.failures.most_common(3))
        lines.append(
            f"{r.model:<24}{r.passed:>4}/{r.runs:<4}{median:>10.1f}{worst:>9.1f}{memory:>9}"
            f"  {failures or '-'}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="layer2-compare-models", description=__doc__)
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    parser.add_argument("--planner", nargs="*", default=[], help="planner model tags to try")
    parser.add_argument("--quick", nargs="*", default=[], help="quick model tags to try")
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args(argv)
    if not args.planner and not args.quick:
        parser.error("give at least one --planner or --quick model")
    if args.planner:
        print(table("Planner", [try_planner(args.ollama, m, args.runs) for m in args.planner]))
        print(
            f"(passed = the coordinator would use the plan; limit {settings.PLANNER_TIMEOUT_S} s)"
        )
    if args.quick:
        if args.planner:
            print()
        print(table("Quick", [try_quick(args.ollama, m, args.runs) for m in args.quick]))
        print(f"(passed = a non-empty answer within {settings.ASK_TIMEOUT_S} s)")
    return 0


def run() -> None:
    raise SystemExit(main())
