# Layer 4 handoff

This is the Layer 4 working note, kept in the repository so work can continue on another machine. It was last updated on 2026-11-14 at about 19:30 EST. Read the root `CLAUDE.md` first, then `docs/layer4-care-layer.md`, then this note.

## To resume on a new machine

1. `git clone https://github.com/lucasting1220/hackprinceton.git`, then from the repo, `git switch main && git pull`.
2. Check the prerequisites (CLAUDE.md, "gstack"): gstack installed with `./setup --team`, plus Node.js, Python 3.12 and `uv`.
3. Run `cd layer4 && uv sync`. Layer 4 depends on `../layer2` through a uv path source.
4. In Claude Code: run `/guard` on `layer4/`, then say "continue layer 4, read layer4/HANDOFF.md".

## First thing to do: PR #49 is open

**PR #49, `l4/layer2-adapters`** ("L4: reach Layer 2's event log and models through its job client"). It was pushed and opened, and CI was pending when work paused. It is not merged.

- If CI passes: merge `origin/main` into the branch, rerun the checks, wait for CI, then `gh pr merge 49 --merge --delete-branch`.
- If CI fails: check out `l4/layer2-adapters`, fix it, and push.

## What is on main (all Layer 4 PRs merged with CI green on Windows and macOS)

| PR | What |
|---|---|
| #16 | pregate lane for layer4 |
| #17 | the Layer 4 project skeleton |
| #21 | `settings.py` (thresholds, `RuleThresholds`), `signals.py` (four validated signals), `_checks.py` |
| #24 | `alerts.py` (`Alert`, template text, `format_time`/`format_date`), `rules.py` (`decide`); D5 doc edit |
| #22 | signal times bounded to 1970-01-02..2999-12-31 UTC (Windows OS-clock limit); naive `new_alert` rejected |
| #37 | `events.py` (`Event`, `new_event`, `occurred_at`), `ports.py` (`EventLog`, `Phone`, `Model`, `PortError`, `Quality`), `upper_tier.py` (`UpperTier.handle`: alert first, then log every signal), `tests/fakes.py` |
| #41 | `fall.py`: `FallDetector` over Layer 3 frames with a pluggable `FallModel`; one signal per 1 s window, carrying the peak confidence; stale frames skipped; `health()` reports "fall detection" stopped |
| #42 | `rewrite.py`: the quick model rewrites an alert as an update (same `alert_id`); output is cleaned or refused; the template stands on any failure; `events.describe()` |
| #45 | `help_check.py`: the quick model reads a transcript, and only YES or NO counts; a failure is never read as "no"; `health()` reports "help check" stopped; transcripts are never logged |
| #46 | `layer2` path dependency (for `layer2.job_client`) |
| #49 (open) | `records.py` (Layer 4's event record format), `layer2_ports.py` (`Layer2EventLog`, `Layer2Model`, `from_environment()`) |

After #49 merges there are 180 tests.

## What is left, in build order (docs/layer4-care-layer.md)

### Can build now

1. **Monitoring check (step 6).** Read `layer2.status()`, whose data matches `contracts/api-state.json`. Report as stopped: laptops whose `last_status_at` is old, any Layer 4 job missing or not `running`, and anything under `dropped`. A tracker remembers when each item first went down, and that time becomes `stopped_at`. Also add `status()` to the `JobClient` protocol in `layer2_ports.py`, and add a test that loads `contracts/api-state.json` (CLAUDE.md section 9).
2. **Job descriptions and entry points.** Write `layer4/jobs/<name>/job.json` per `contracts/job.json` (`name`, `start_command`, `kind`, `memory_gb`, `sensor`), with modules under `layer4.jobs.*`. The contract's own example is `fall_model`, started with `uv run --project ../.. python -m layer4.jobs.fall_model`, with `sensor: "camera"`. Open design point: Layer 2 has no channel from one job to another yet, so a detector job may need to run the `UpperTier` in-process (decide, then send, then log) rather than as a separate "upper tier" job.
3. **Live status and "check now" (step 6).** A `LiveStatus` built from `FallDetector.activity`/`activity_at` and the latest health readings, each with its age. `check_now` sends a fresh status.
4. **Caregiver questions (step 7).** Answer from live status only, using the `deep` model. The reply is `request_id, title, body`. If the model fails, send a plain reply built from live status.
5. **Daily report (step 8).** Read the day's events (`read_log(day=...)`), split them into time blocks (a setting), summarise each block (`fan_out`, which Layer 2 has not built yet; do it sequentially until then), then combine them with `deep`. If the model fails, fall back to counts per kind. The report time is a setting (doc proposal 5).
6. **Layer 4 doc update.** The status line ("Nothing is built"), and the lifecycle step 1 order: the alert is now sent before the log write (#37). Do this with `/unfreeze`, editing only `docs/layer4-care-layer.md`, then `/guard`.

### Blocked (do not build yet)

- **Phone adapter.** Sending alerts, replies and live status needs `layer2.job_client.to_phone()` / `on_request()`, which Layer 2 lists as "later build steps", and an alert contract. The draft is in `layer4/CONTRACT-DRAFTS.md`.
- **Real fall model and speech-to-text.** Which models to use is open question 2 in the Layer 4 doc. `FallModel` is the plug.
- **Frame feed.** Layer 3's `l3/capture-frames` (PR #38, not merged yet) defines `Frame(image, captured_at)`. `fall.CameraFrame` already matches it structurally. Getting frames into a job needs `feed()` from Layer 2, which it has not built yet.
- **Word-match fallback for the help check.** Still "proposed, not yet confirmed" in the doc.
- **Sound detection.** A stretch goal, built last.

### Cheap follow-ups

- Normalise signal times to UTC when each signal is built.
- `Alert.__post_init__` self-validation (step 5).
- Validate `tz` once at config load.

## Questions waiting for the owner (real Layer 4 decisions)

1. **Home time zone.** Alert text uses the zone of whichever worker runs the upper tier, with no zone label. The proposal is a `home_time_zone` setting.
2. **Rejected signals.** A `ValueError` from a bad signal (for example a reading from an unsynced clock) must be reported, not only logged, before the rules job is live. How?
3. **Dates on fall and help.** Should fall and help bodies say "on {date}", as heart rate does?
4. **Redelivery.** Does D4 (stateless, no repeat handling) also cover a signal delivered twice, which gives two alerts?
5. **Fall model and speech-to-text model** (open question 2).
6. **For the team:** watch bpm as an integer (Layer 3 contract), clock-skew tolerance, a fall confidence just above 1.0, threshold sanity bounds, staleness bounds, and event log retention.

## How the owner wants work done

- Keep building without stopping or asking. Approve routine steps, and interrupt only for important decisions.
- Skip the multi-agent `/review` ("don't do reviews, just build"). Each PR description says "/review: NOT RUN (Layer 4 owner asked to skip)". `/verify`, the four checks and CI still run every time.
- Never ask gstack setup or preference questions.
- Pushing and merging Layer 4 PRs is approved.

## How each PR is shipped

1. Branch from the latest `origin/main` as `l4/<topic>`.
2. Build, then from `layer4/` run `uv run ruff format .`, then `ruff format --check .`, `ruff check .`, `mypy .` and `pytest`.
3. `/verify` (`~/.claude/skills/gstack/bin/gstack-checks run`), then commit (`L4: ...`, ending with the Co-Authored-By line).
4. `git fetch`, then merge `origin/main` if it moved, and rerun the checks. Check the size with `git diff origin/main --numstat`; it must be under 400 lines.
5. Push, and `gh pr create` with the six-section description (CLAUDE.md section 6).
6. Wait for CI on both OSes: `gh pr checks <n> --watch`.
7. Merge only if `git rev-list --count HEAD..origin/main` is 0. Otherwise go back to step 4.

Write PR bodies to an untracked file in `layer4/` and delete it after use. The guard blocks writes elsewhere.

## Decisions (Nov 14)

- `kind` is fall, help, heart_rate or monitoring, and `severity` is always urgent. The title is a short fixed name; the body is the doc's template line.
- `{time}` is in the worker laptop's local time, and `detected_at` is in UTC.
- D4: the rules are stateless, with no repeat-alert handling.
- D5: the heart-rate body ends "on {date}".
- D6: bpm is an int.
- D8: reject bool in number fields.
- D9: validate `RuleThresholds`.
- D10: a monitoring alert's `detected_at` is `stopped_at`.

## Gotchas

- Do not use `strftime("%-I")`: it fails on Windows.
- Do not use `ZoneInfo` in tests, because Windows has no tzdata. `tests/conftest.py` has a hand-written fold-aware tzinfo.
- Two aware datetimes that share one tzinfo compare and subtract by wall clock. Convert to UTC first.
- `/verify` reads `.gstack/pregate.json` from `origin/main`, not from the working tree.
- Tests import the fakes with `from fakes import ...` (from `layer4/tests/`).
- Windows CI runs only in UTC.
- In zsh, a command stored in a variable needs `${=c}` to split into words.

## Other files in this folder

- `layer4/CONTRACT-DRAFTS.md`: proposed `contracts/alert.json` and the event-log entry shape, plus questions for the other owners. The owner sends these to Lucas.
- `layer4/plan-step1-rules.md`: step 1's reviewed plan and the decision ledger (D4 to D10).
