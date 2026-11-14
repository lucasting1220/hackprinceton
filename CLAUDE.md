# Debbie: master sheet for every Claude Code session

This file applies to every person and every Claude Code session working in this repository, on any machine. Read it fully before doing anything. Then read your own layer's doc in `docs/`. If this file and a layer doc disagree, this file wins; tell your human so the layer doc gets fixed.

## 1. The four layers

| Layer | What it is | Language | Directory | Branch | Doc |
|---|---|---|---|---|---|
| 1 | Join and connect: setup page, pairing, AWS relay, the whole iPhone app. Makes no decisions | Node/TypeScript, Swift | `layer1/` (the app is in the separate `debbie-ios` project) | `layer-1` | `docs/layer1-join-and-connect.md` |
| 2 | Cluster: coordinator, worker, planner, dashboard, message carrying, event log storage | Python | `layer2/` | `layer-2` | `docs/layer2-device-management.md` |
| 3 | Raw data: camera and mic capture, receiving watch data. Runs no AI | Python | `layer3/` | `layer-3` | `docs/layer3-raw-data.md` |
| 4 | Care layer: detectors and fixed rules that produce alerts, the report, answers and live status. No agent | Python | `layer4/` | `layer-4` | `docs/layer4-care-layer.md` |

Lucas reviews every pull request into `main` and settles disagreements between layers.

## 2. How the system fits together

These are decided (the full list is in `docs/coherence-review.md`). Do not build anything that contradicts them.

- **Data path:** all fetched data goes to Layer 3, then Layer 4, which computes the decision; Layer 1 carries the result to the iPhone.
- **Alerts are triggered by fixed rules** in Layer 4, one signal at a time. A language model never decides whether to alert and is never waited on before an alert goes out.
- **Layer 4 runs on workers.** The coordinator laptop runs Layer 2's coordinator, the planner model, the event log and Layer 1's bridge, and nothing from Layers 3 or 4.
- **Layer 2's coordinator carries messages** between Layer 1's bridge and Layer 4.
- **The remote link is Layer 1's AWS relay.** No tunnels.
- **The system never speaks to the resident.**
- **No video or audio is stored.** Only an event log, on the coordinator.

**Which document wins.** Each layer's own doc is the reference for what that layer does. For anything that crosses layers, `docs/coherence-review.md` and this file win.

**Still undecided: do not build these.** If your next step needs one, stop and tell your human.

1. The items under "Proposed, not yet confirmed" in the Layer 3 doc (timestamps, audio chunk length, retry interval, recognising a repeated reading).
2. The rule threshold values in the Layer 4 doc (use the proposed values only as named settings, never hardcoded).
3. Layer 2's answers to Layer 1's ten asks, until Lucas confirms them.
4. Sound detection: a stretch goal. Build it last and let nothing depend on it.

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
| relay | Layer 1's AWS services | |
| care layer | Layer 4's programs | care agent, agent |
| job | something a worker runs continuously | task, service |
| `node_id` | a laptop's ID | worker-a, laptop_id |

## 4. Git rules

**Branches**
- `main` is always in a working state. Nobody commits to it directly. Changes arrive only by pull request.
- Each layer works on its own branch: `layer-1`, `layer-2`, `layer-3`, `layer-4`.
- Never commit to, push to, or rebase another layer's branch.

**Every session, before writing code**
1. `git fetch origin`
2. `git checkout layer-N` (your layer)
3. `git pull`
4. `git merge origin/main`, and resolve conflicts before starting

**Never**
- force-push
- rebase or amend commits that have been pushed
- squash-merge a layer branch into `main` (the layer branches are long-lived; squashing makes every later merge conflict). Use a normal merge commit.
- commit or push unless your human asked you to

**Commits**
- One logical change per commit. Format: `L2: add worker status reporting`, with the layer prefix `L1` to `L4`, then an imperative summary under 72 characters. Use `ALL:` only for shared files.
- The repository must still run after every commit.

**Pull requests into `main`**
- Open one each time a build step from your layer doc works. Small and often: aim for under 400 changed lines.
- A layer's pull request touches only that layer's directory and that layer's doc. Any change to a shared file (section 5) goes in its own separate pull request.
- Title: the same format as a commit, for example `L2: route quick requests to Ollama`.
- Description, in this order:
  1. **What changed** in two or three sentences.
  2. **Contract changes:** "none", or exactly which shared file and field.
  3. **How it was tested:** the command, the machine and operating system, and the actual result. If something was not tested, say so.
  4. **Stubs:** anything standing in for another layer.

## 5. Who owns which files

| Path | Owner | Who may change it |
|---|---|---|
| `layer1/`, `layer2/`, `layer3/`, `layer4/` | that layer | that layer only |
| `docs/layerN-*.md` | that layer | that layer only |
| `contracts/` | all layers jointly | only through a pull request that every affected layer's owner approves |
| `CLAUDE.md`, `docs/coherence-review.md`, `.gitignore`, `.gitattributes` | Lucas | Lucas, by pull request |

Never create, edit or delete a file in another layer's directory, even to fix an obvious bug. Tell your human, who tells that layer's owner.

## 6. Contracts between layers

A contract is anything two layers both depend on: a config file format, a message, an HTTP call, a port, a job name.

- Every cross-layer contract has one example file in `contracts/`, with a `schema_version`. That file is the truth; code follows it.
- Do not invent a field, rename one, or change its meaning in code. If a contract looks wrong or incomplete, stop, and write the problem and your proposed change in the pull request description or tell your human. Change the code only after the contract file has changed on `main`.
- When another layer's code does not exist yet, write a stub inside your own directory under `stubs/`, named for what it replaces (for example `layer4/stubs/fake_layer2_client.py`). A stub must follow the contract file exactly, must say it is a stub in its first line and in its log output, and never counts as an integration test.
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

## 7. Code rules for every layer

**Runs on both macOS and Windows**
- Build paths with `pathlib` (Python) or `path` (Node). Never join paths with `/` or `\` by hand, and never hardcode a home directory.
- No shell-only commands (`rm`, `cp`, `&&` chains) inside code. Use the language's own file and process functions.
- Read and write text as UTF-8, stated explicitly.
- Do not rely on Unix signals to stop a process; honour the stop file in your config.

**Configuration**
- No hardcoded ports, addresses, file paths, model names or time limits. They come from the config file or from named constants at the top of one settings module per layer.
- A program never exits because something optional is missing. It runs what it can and reports what is missing.

**Secrets**
- Never commit and never log: join tokens, device credentials, the home key, AWS credentials, the APNs key, or whole `hello` messages.
- Secrets never appear on a command line.

**Python (Layers 2, 3, 4)**
- Python 3.12. Dependencies are managed with `uv`; `pyproject.toml` and `uv.lock` are committed in each layer's directory.
- Format and lint with `ruff` before every commit. Type hints on every function signature.
- Tests use `pytest`, in `layerN/tests/`, runnable with `uv run pytest` from the layer's directory.
- Use `logging`, not `print`. One line per event, starting with the layer and component, for example `L2 planner: plan rejected, memory over budget on <node_id>`.

**TypeScript (Layer 1)**
- The Node version is pinned in `layer1/.nvmrc`; the lockfile is committed.
- Format and lint before every commit with the tools configured in `layer1/`.

**Dependencies**
- Adding a dependency is named in the pull request description with one line on why.
- Never commit model files, virtual environments, `node_modules`, build output, recordings or screenshots.

**Tests**
- Each build step in your layer doc ends with a test that proves it. Run it before saying the step is done.
- Report results honestly in the pull request: PASS, FAIL, BLOCKED or NOT RUN, with the machine it ran on. A test that was not run is NOT RUN, never PASS.

## 8. How to work in a session

1. Read this file, then your layer's doc. Build only your layer, in the build order your doc gives, and nothing your doc lists as out of scope.
2. Before writing code, say in a few lines what you are about to build and which contract files it touches.
3. If the doc is unclear or two docs disagree, ask your human. Do not guess and do not pick a side.
4. Keep changes small. Finish and test one build step before starting the next.
5. At the end of a session, tell your human: what was built, what was tested and the result, what is stubbed, and anything another layer's owner needs to know.

## 9. Repository setup still to do

These do not exist yet. Lucas adds them to `main` in one pull request before layer work starts.

- `.gitattributes` containing `* text=auto eol=lf`, so Mac and Windows machines do not fight over line endings.
- `.gitignore` covering `.venv/`, `node_modules/`, `__pycache__/`, `.DS_Store`, `*.gguf`, state directories, token files and certificates.
- `contracts/`, seeded with the example files from the Layer 1 doc once Layer 2 has accepted them.
