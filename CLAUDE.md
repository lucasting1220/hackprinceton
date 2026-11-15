# Debbie: master sheet for every Claude Code session

This file applies to every person and every Claude Code session working in this repository, on any machine. Read it fully before doing anything. Then read your own layer's doc in `docs/`. If this file and a layer doc disagree, this file wins; tell your human so the layer doc gets fixed.

Words like **must**, **never** and **only** in this file are rules, not advice. If a rule blocks you, stop and tell your human. Do not work around it.

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
_GS=""
for _D in "${GSTACK_ROOT:-}" "$HOME/.claude/skills/gstack" "$HOME/.codex/skills/gstack" "$HOME/.factory/skills/gstack" "$HOME/.kiro/skills/gstack" "$HOME/.config/opencode/skills/gstack" "$HOME/.slate/skills/gstack" "$HOME/.cursor/skills/gstack" "$HOME/.openclaw/skills/gstack" "$HOME/.hermes/skills/gstack" "$HOME/.gbrain/skills/gstack" "$HOME/.copilot/skills/gstack" "$HOME/.gemini/antigravity-cli/skills/gstack" "$HOME/.gemini/skills/gstack" "$HOME/.gstack/repos/gstack"; do
  [ -z "$_GS" ] && [ -n "$_D" ] && [ -d "$_D/bin" ] && _GS="$_D"
done
[ -n "$_GS" ] && echo "GSTACK_OK: $_GS" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: section 4 below says which skill to use at each stage of work. Use /browse for all web browsing (Aside first, the bundled gstack browser as fallback).
Use the resolved install path above for gstack file paths
(default: ~/.claude/skills/gstack).

The Skill gate in .claude/settings.json runs .claude/hooks/check-gstack.cjs with
Node.js and blocks when it cannot run. If a skill is blocked with "node: not
found", tell the user to install Node.js (https://nodejs.org); if it is blocked
with "Cannot find module ... check-gstack.cjs", the hook file is missing from
this checkout. Do not work around either block.

**Every team member's machine must have:** Claude Code 2.1.295 or later, Git, Node.js on PATH (the gstack gate runs on it, even for the Python layers), gstack installed with `./setup --team`, and for Layers 2 to 4, Python 3.12 and `uv`.

## 1. The four layers

| Layer | What it is | Language | Directory | Branch prefix | Doc |
|---|---|---|---|---|---|
| 1 | Join and connect: setup page, pairing, the relay on Vultr, the whole iPhone app. Makes no decisions | Node/TypeScript, Swift | `layer1/` (the app is in the separate `debbie-ios` project) | `l1/` | `docs/layer1-join-and-connect.md` |
| 2 | Cluster: coordinator, worker, planner, dashboard, message carrying, event log storage | Python | `layer2/` | `l2/` | `docs/layer2-device-management.md` |
| 3 | Raw data: camera and mic capture, receiving watch data. Runs no AI | Python | `layer3/` | `l3/` | `docs/layer3-raw-data.md` |
| 4 | Care layer: detectors and fixed rules that produce alerts, the report, answers and live status. No agent | Python | `layer4/` | `l4/` | `docs/layer4-care-layer.md` |

Pull requests do not wait for a human review: Claude merges each one itself once the definition of done (section 5) is met. Lucas settles disagreements between layers.

## 2. How the system fits together

These are decided (the full list is in `docs/coherence-review.md`). Do not build anything that contradicts them.

- **Data path:** all fetched data goes to Layer 3, then Layer 4, which computes the decision; Layer 1 carries the result to the iPhone.
- **Alerts are triggered by fixed rules** in Layer 4, one signal at a time. A language model never decides whether to alert and is never waited on before an alert goes out.
- **Layer 4 runs on workers.** The coordinator laptop runs Layer 2's coordinator, the planner model, the event log and Layer 1's bridge, and nothing from Layers 3 or 4.
- **Layer 2's coordinator carries messages** between Layer 1's bridge and Layer 4.
- **The remote link is Layer 1's relay, a server the team runs on Vultr.** No AWS, no tunnels.
- **The system never speaks to the resident.**
- **No video or audio is stored.** Only an event log, on the coordinator.

**Which document wins.** Each layer's own doc is the reference for what that layer does. For anything that crosses layers, `docs/coherence-review.md` and this file win.

**Still undecided: do not build these.** If your next step needs one, stop and tell your human.

1. Settled Nov 15, no longer undecided: the items under "Proposed, not yet confirmed" in the Layer 3 doc (timestamps, audio chunk length, retry interval, recognising a repeated reading) are decided as proposed. Build with them.
2. The rule threshold values in the Layer 4 doc (use the proposed values only as named settings, never hardcoded).
3. Sound detection: a stretch goal. Build it last and let nothing depend on it.

## 3. Words to use

Use these exact words in code, file names, messages, logs and docs. Do not use the alternatives.

| Use | Means | Do not use |
|---|---|---|
| coordinator | the one laptop that runs Layer 2's coordinating program | central agent, hub laptop, master |
| worker | any other laptop in the home | node, slave, agent |
| home (`home_id`) | one coordinator, its workers and its paired phones | cluster (except in Layer 2's internal planner code) |
| caregiver | the person with the iPhone app | caretaker, user, family |
| resident | the person being looked after | elder, patient, user |
| bridge | Layer 1's Node program on each laptop | |
| hub | the coordinator's bridge, acting for the whole home | |
| relay | Layer 1's server on Vultr that connects phones to the home | |
| care layer | Layer 4's programs | care agent, agent |
| job | something a worker runs continuously | task, service |
| `node_id` | a laptop's ID | worker-a, laptop_id |

## 4. Skills to use at each stage

These are required, not optional. If a skill fails or is unavailable, stop and tell your human; do not do the stage by hand instead.

| When | Run | What it does for you |
|---|---|---|
| Start of every session | `/guard`, giving it your layer's directory (for example `layer2/`) | Blocks edits outside your directory and warns before destructive commands |
| Resuming earlier work | `/context-restore` | Brings back what the last session saved |
| Any bug, failing test, error or crash | Describe the failure to Claude; gstack's router handles it | Finds the root cause first, then writes a failing test, then fixes. Never patch the symptom |
| Before every commit | `/verify` | Runs your layer's checks (section 5) until they pass |
| Before a pull request that touches tokens, keys, pairing, encryption, credentials or the relay server | `/cso` | Security review. Layer 1 needs this on most pull requests |
| Testing a page or local API you built (the setup page, the dashboard, `/api/state`) | `/qa`, or `/qa-only` to report without fixing | Drives the real page and finds bugs |
| Any web browsing | `/browse` | |
| Editing your own layer doc | `/unfreeze`, edit only `docs/layerN-*.md`, then `/guard` again | |
| Ending a session with work unfinished | `/context-save` | |

**Never run** `/ship`, `/land-and-deploy`, `/setup-deploy`, `/canary` or `/document-release` in this repository. `/ship` writes `VERSION` and `CHANGELOG.md` at the repo root, which every branch would then conflict on; the others deploy or edit shared docs. Open pull requests with `gh pr create`, as section 6 describes.

## 5. Definition of done

A build step is done only when **every** item below is true. "Mostly done" is not done.

1. Every changed file is inside your layer's directory, plus your layer doc if the behaviour differs from it.
2. Every new behaviour has a test that would fail without it. Every bug fix starts with a test that fails before the fix.
3. Your layer's checks all pass with zero errors and zero warnings:
   - **Python layers**, from the layer's directory: `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy .`, `uv run pytest`
   - **Layer 1**: the format, lint, type-check (`tsc --noEmit` with `"strict": true`) and test commands listed in `layer1/README.md`
4. `/verify` passed after your last change.
5. `/cso` was run, if section 4 requires it.
6. You merged the latest `main` into your branch once, before opening the pull request, and the checks still pass after that merge. CI catches anything `main` changes later.
7. The pull request description is complete (section 6).

**Never make checks pass by weakening them.** None of these may appear in a pull request unless it is listed on its own line in the description, with the reason, and Lucas approves it: deleting or skipping a test, `pytest.mark.skip` or `xfail`, `# noqa`, `# type: ignore`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, the type `any` in TypeScript, `Any` in Python, loosening `ruff.toml`, a `mypy` setting or `tsconfig.json`, raising a timeout or threshold, or catching a broad exception to hide a failure.

## 6. Git and pull requests

**Branches**
- `main` is protected on GitHub: no direct pushes, no force-pushes. Changes reach it only by pull request.
- Work on short-lived branches, one per build step, created from the latest `main` and named with your layer's prefix and a short topic: `l2/worker-status`, `l4/fall-rule`, `all/ruff-config` for shared files.
- A branch lives for hours, not days. It is deleted automatically when its pull request merges; start the next step on a new branch from `main`.
- Never commit to, push to or merge another person's branch.
- The old `layer-1` to `layer-4` branches are retired. Do not use them.

**Starting a build step**
1. `git fetch origin`
2. `git switch -c l2/<topic> origin/main` (your prefix)
3. Run your layer's checks once before changing anything, so you know the starting point passes.

**Commits**
- One logical change per commit. Message format: `L2: add worker status reporting`, with the prefix `L1` to `L4`, or `ALL:` for shared files, then an imperative summary under 72 characters.
- Run `/verify` before every commit. Every commit must leave the checks passing.
- Commit, push, open the pull request and merge it once the definition of done is met; you do not need to ask your human first.

**Never**
- force-push, or push straight to `main`
- rebase or amend a commit that has been pushed
- squash-merge or rebase-merge (GitHub only allows merge commits)
- commit merge-conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)

**Pull requests**
- One pull request per branch. Related build steps may share one pull request, with no size limit.
- Title: the same format as a commit, for example `L2: route quick requests to Ollama`.
- Description, in this order:
  1. **What changed**, in two or three sentences.
  2. **Contract changes:** "none", or exactly which shared file and field.
  3. **How it was tested:** each command, the machine and operating system, and the actual result as PASS, FAIL, BLOCKED or NOT RUN. A test that was not run is NOT RUN, never PASS.
  4. **Skills run:** `/verify`, and `/cso` or `/qa` where required, with a one-line result each.
  5. **Weakened checks:** "none", or each one on its own line with the reason (section 5).
  6. **Stubs:** anything standing in for another layer.
- **Merging:** no human approval is needed. As soon as the definition of done (section 5) is met and the pull request is open, Claude merges it with a merge commit (`gh pr merge <number> --merge --delete-branch`) without asking. This includes pull requests that change shared files.

## 7. Preventing merge conflicts

1. **Stay in your directory.** Only your layer's directory and your layer doc. `/guard` enforces this; do not unfreeze it to touch anything else.
2. **Keep branches short.** Merge within a few hours. Open and merge the pull request as soon as the work is done; do not keep adding to an open pull request.
3. **Sync once before you open a pull request.** Merge `origin/main` into your branch, rerun the checks, then open it. Do not merge `main` again while it waits; CI runs on the merge.
4. **Shared files go in their own pull request, first.** A change to `contracts/`, `CLAUDE.md`, `ruff.toml`, `.gitignore`, `.gitattributes`, `.github/` or `.claude/` is never mixed into a layer pull request. It merges first; then each layer merges `main` and adapts.
5. **No drive-by edits.** Do not reformat, re-sort imports, rename, move or re-wrap anything your step does not need to change. Run the formatter only on your own directory (`uv run ruff format .` from your layer's directory, never the repo root).
6. **Lockfiles belong to one layer each.** `pyproject.toml` and `uv.lock` live in your layer's directory, never at the repo root. Never edit a lockfile by hand. If one conflicts, take `main`'s version and regenerate it with `uv lock`.
7. **No root-level files of your own.** Nothing new at the repo root (no `VERSION`, `CHANGELOG.md`, `package.json`, `pyproject.toml`, `Makefile`). Layer-specific ignore rules go in `layerN/.gitignore`.
8. **Shared lists are append-only.** When adding to a table or list in a shared file (ports, contracts, words), add your row at the end. Never reorder, re-wrap or re-align existing rows.
9. **Markdown: one paragraph per line.** Do not hard-wrap prose in `.md` files; one changed word then rewraps a whole paragraph and conflicts with everyone.
10. **Never commit generated or local files:** build output, caches, model files, recordings, screenshots, `CLAUDE.local.md`, `.claude/settings.local.json`. The root `.gitignore` covers the common ones.
11. **Line endings are LF everywhere.** `.gitattributes` enforces it; do not override it locally.
12. **Resolving merge conflicts:** Claude resolves them itself, without asking. In your own layer's files, keep both sides' intent and rerun the checks. In a file you don't own, take `main`'s version and note it in the pull request description.

## 8. Who owns which files

| Path | Owner | Who may change it |
|---|---|---|
| `layer1/`, `layer2/`, `layer3/`, `layer4/` | that layer | that layer only |
| `docs/layerN-*.md` | that layer | that layer only |
| `contracts/` | all layers jointly | any layer, through its own `ALL:` pull request; no other owner's approval is needed |
| `CLAUDE.md`, `docs/coherence-review.md`, `ruff.toml`, `.gitignore`, `.gitattributes`, `.github/`, `.claude/` | Lucas | Lucas, by pull request |

Never create, edit or delete a file in another layer's directory, even to fix an obvious bug. Tell your human, who tells that layer's owner.

## 9. Contracts between layers

A contract is anything two layers both depend on: a config file format, a message, an HTTP call, a port, a job name.

- Every cross-layer contract has one example file in `contracts/`, with a `schema_version`. That file is the truth; code follows it.
- Do not invent a field, rename one, or change its meaning in code. If a contract looks wrong or incomplete, fix the contract file in its own `ALL:` pull request and merge it, then change the code. No other owner's approval is needed; tell your human which layers the change affects so their owners hear about it.
- When another layer's code does not exist yet, write a stub inside your own directory under `stubs/`, named for what it replaces (for example `layer4/stubs/fake_layer2_client.py`). A stub must follow the contract file exactly, must say it is a stub in its first line and in its log output, and never counts as an integration test.
- Every layer has a test that loads each contract example file it uses and checks its code reads and writes exactly those fields.
- Contracts internal to Layer 1 (phone to hub) stay in `layer1/contracts/`.

**Ports** (from the Layer 1 doc; do not hardcode them, read them from the config file)

| Port | What listens | Reachable from |
|---|---|---|
| 7443 | Layer 2 coordinator: worker control and media | the local network |
| 7450 | Layer 2 dashboard, JSON at `/api/state` | local |
| 7451 | Layer 2 coordinator: local calls from Layer 1's bridge | `127.0.0.1` only |
| 7460 | Layer 3 frame feed on the camera laptop | `127.0.0.1` only |
| 7470 | Layer 1 bridge, local side | `127.0.0.1` only |
| 7480 | Layer 1 bridge, network side | the local network |
| 11434 | Ollama | `127.0.0.1` only |

Layer 4 has no port of its own: it talks to the coordinator through the worker program.

**Data formats used in every contract**
- JSON field names are `snake_case`.
- Every message has a `type` field. Every file has a `schema_version` field.
- Times are ISO 8601 in UTC, for example `2026-11-14T03:12:45Z`. Field names for times end in `_at`.
- IDs are strings. Never put meaning in an ID's format.
- A JSON file is written whole: write to a temporary file in the same folder, then rename it over the old one.

## 10. Code rules for every layer

**Runs on both macOS and Windows**
- Build paths with `pathlib` (Python) or `path` (Node). Never join paths with `/` or `\` by hand, and never hardcode a home directory.
- No shell-only commands (`rm`, `cp`, `&&` chains) inside code. Use the language's own file and process functions.
- Read and write text as UTF-8, stated explicitly.
- Do not rely on Unix signals to stop a process; honour the stop file in your config.
- Runtime state (tokens, state directories, logs) lives outside the repository, at the paths given in the config files.

**Configuration**
- No hardcoded ports, addresses, file paths, model names, thresholds or time limits. They come from the config file or from named constants in one settings module per layer.
- A program never exits because something optional is missing. It runs what it can and reports what is missing.

**Errors**
- Never swallow an exception. Catch only the exceptions you expect, and log or report each one.
- Every network call, subprocess and wait has a timeout.
- A failure another layer or the caregiver needs to know about is reported, never only logged.

**Secrets**
- Never commit and never log: join tokens, device credentials, the home key, the hub credential, the Vultr API key, the TURN shared secret, the APNs key, or whole `hello` messages.
- Secrets never appear on a command line.

**Python (Layers 2, 3, 4)**
- Python 3.12. Dependencies are managed with `uv`; `pyproject.toml` and `uv.lock` are committed in the layer's directory.
- Formatting and linting come from the shared `ruff.toml` at the repo root, which pins the `ruff` version. Pin that same version in your layer's development dependencies. Never add a `[tool.ruff]` section to a layer's `pyproject.toml`.
- Type hints on every function signature and attribute. `mypy` runs with `disallow_untyped_defs = true` in the layer's `pyproject.toml`.
- Tests use `pytest`, in `layerN/tests/`.
- Use `logging`, never `print`. One line per event, starting with the layer and component, for example `L2 planner: plan rejected, memory over budget on <node_id>`.

**TypeScript (Layer 1)**
- The Node version is pinned in `layer1/.nvmrc`; the lockfile is committed in `layer1/`.
- `tsconfig.json` has `"strict": true`.
- `layer1/README.md` lists the exact format, lint, type-check and test commands that section 5 refers to.

**Clean code**
- No commented-out code, no debugging output, no unused code.
- No `TODO` in merged code. Put open questions in the pull request description.
- Code and comments use the words in section 3.

**Dependencies**
- Every new dependency is named in the pull request description with one line on why.
- Never commit model files, virtual environments, `node_modules`, build output, recordings or screenshots.

## 11. How to work in a session

1. Read this file, then your layer's doc. Build only your layer, in the build order your doc gives, and nothing your doc lists as out of scope.
2. Run `/guard` on your layer's directory, then start a new branch from `main` (section 6).
3. Before writing code, say in a few lines what you are about to build and which contract files it touches.
4. If the doc is unclear or two docs disagree, ask your human. Do not guess and do not pick a side.
5. Build the step, or a few related steps. Meet every item in the definition of done (section 5). Open the pull request.
6. At the end of a session, tell your human: what was built, what was tested and the result, what is stubbed, what is waiting for review, and anything another layer's owner needs to know. Run `/context-save` if work is unfinished.

## 12. Repository setup still to do

- Contract files between Layers 2, 3 and 4 (raw feeds, job descriptions, the Layer 4 client calls), as those layers reach the steps that need them. Layer 1 and Layer 2's files are in `contracts/`.

## Health Stack

Read by `/verify`. Each row runs in every Python layer directory that has a `pyproject.toml`; tests are selected per change through `.gstack/pregate.json`. Layer 1's rows are added when `layer1/README.md` lists its commands.

- format: uv run --no-project --python 3.12 .gstack/python-layers.py ruff format --check .
- lint: uv run --no-project --python 3.12 .gstack/python-layers.py ruff check .
- types: uv run --no-project --python 3.12 .gstack/python-layers.py mypy .
