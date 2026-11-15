# Layer 2: Cluster agent

**Status: draft for team review. Nothing is built.** This version replaces the earlier phone-and-browser design. It is based on the interview answers listed under "Decided". Items under "Proposed" and "Open questions" are not yet agreed.

## Summary

Layer 2 turns two or three home laptops into one pool of compute. A central agent on one laptop coordinates; the other laptops (workers) do the AI work. An AI planner on the central agent decides where each piece of work runs and how large a language model the cluster can hold, and re-plans whenever a laptop joins.

## The four layers

| Layer | What it is | Owner's main output |
|---|---|---|
| 1. Join | iPhone app and npm bridge. Pairs a laptop, installs what it needs, then starts Layer 2's worker program | A running worker program that knows the central agent's address |
| **2. Cluster agent** | **This document.** Central agent, worker program, planner, dashboard | Somewhere to run models and a way to ask for compute |
| 3. AI models | Fall detection, sound recognition, health analysis | Model scripts that Layer 2 can start on any worker |
| 4. Care agent | Watches the model outputs, reasons with a language model, answers the iPhone app | Alerts, reports and answers |

## Decided

| Topic | Decision |
|---|---|
| Central agent | Runs on one laptop in the home. It coordinates only, with two exceptions: it runs the small planner model, and it may lend memory to a split model when there is only one worker |
| Workers | Laptops and desktops, a mix of Mac and Windows, 16 GB of memory at the weakest. Two or three laptops in total, including the central agent's |
| Sensors | A Logitech webcam and a mic, attached to any worker. Apple Watch data comes through Apple Health in the iPhone app |
| What the cluster does | All three: place whole jobs on a laptop, fan one large job out in parallel, and split one large model across laptops |
| Fan-out jobs | Three specialist analyses at once when something happens (vision, sound, health); and a long recording reviewed in chunks for the daily report |
| Planner | An AI. It decides which laptop runs each job, which model size to load, whether to split a model, and how to fan work out |
| When the planner runs | When the cluster changes (a laptop joins, a new kind of job starts), not for every request |
| Safety net | Code checks every plan. An invalid or late plan is replaced by a simple rule-based plan |
| Short on hardware | The planner chooses what gives way, except that fall detection and sound recognition are never dropped |
| Camera and model placement | The planner may run the vision or sound model on a different laptop from the one holding the webcam or mic; that laptop forwards the video or audio |
| Laptop joins mid-run | The planner makes a new plan and running jobs move. A gap of a few seconds while a job moves is acceptable |
| Laptop lost mid-run | Not part of the demo. The design leaves room for jobs to move automatically later |
| Model quality | Layer 4 chooses a quality level for each request; Layer 2 provides it |
| Language model tools | Ollama on each worker. llama.cpp's multi-machine mode for a split model |
| Language | Python for Layers 2, 3 and 4 |
| Worker setup | Everything is installed before the demo. Layer 1 connects and installs; Layer 2 checks what is present and reports what is missing |
| Layer 1 handoff | Layer 1 pairs the laptop, then starts Layer 2's worker program with the central agent's address and a credential |
| Dashboard | A web page on the central agent's laptop showing each laptop with its specs, and what each is running |
| Network | Venue Wi-Fi, with a phone hotspot as the fallback if the venue blocks laptops from reaching each other |
| Builders | One or two people prompting Claude |

## Parts

```
        iPhone app ── Layer 4 care agent ── Layer 3 model scripts
                              │ asks for compute
┌──────────── CENTRAL AGENT (coordinator laptop) ─────────────┐
│ connection server   cluster table   planner (AI + checks)   │
│ request router      job control     dashboard web page      │
│ small planner model (Ollama)                                │
└──────────────────────────────────────────────────────────────┘
        │ start/stop jobs, requests            ▲ status, results, events
        ▼                                      │
┌──── WORKER PROGRAM (each worker laptop) ───────────────────┐
│ reports specs, sensors and installed tools                  │
│ starts and stops: Layer 3 model scripts, Ollama models,     │
│                   llama.cpp parts of a split model          │
│ reports load every 2 seconds                                │
└──────────────────────────────────────────────────────────────┘
```

**Central agent.** Keeps a table of connected laptops, asks the planner for a plan, tells workers what to start and stop, routes each request to the laptop that can serve it, and serves the dashboard.

**Worker program.** Started by Layer 1. It connects out to the central agent, reports what the laptop has, and runs whatever it is told to. It contains no decision logic.

## Kinds of work

| Kind | Example | How Layer 2 handles it |
|---|---|---|
| Capture | Reading the webcam or mic | A small always-on job fixed to the laptop that holds the sensor. It forwards video or audio through the central agent to wherever the model runs, and does nothing extra when the model is on the same laptop |
| Always-on job | Fall detection, sound recognition | A Layer 3 script that runs continuously on whichever worker the planner picks and emits events |
| Model service | The language model Layer 4 thinks with | Loaded on one worker through Ollama, or split across laptops through llama.cpp |
| Request | "Summarize what just happened" | Routed to a loaded model that meets the quality level Layer 4 asked for |
| Fan-out batch | Three specialist analyses; a day of recordings in chunks | A list of items is divided among workers, run at the same time, and the results are returned together |

**Quality levels (proposed).** Layer 4 marks each request `quick` or `deep`.
- `quick`: a model that fits on one laptop (roughly 7 to 8 billion parameters on a 16 GB laptop) and answers in a second or two.
- `deep`: the largest model the cluster can hold, split across laptops if needed.

If the cluster cannot provide `deep` at that moment, the request is answered by the `quick` model and the reply says so.

A quick model, a split deep model and the vision and sound jobs may not all fit in two 16 GB workers at once. The planner then has to choose, for example by loading the deep model only while a report is being written.

## The plan

**What the planner is given:** each laptop's memory, processor, graphics capability, operating system, attached sensors, installed tools and current load; the list of work Layers 3 and 4 have asked for; and the previous plan.

**What it returns:** a plan in a fixed format.

```json
{
  "jobs":   [{"job": "fall_detection", "laptop": "worker-a"},
             {"job": "sound_recognition", "laptop": "worker-b"}],
  "models": [{"quality": "quick", "model": "<name>", "laptops": {"worker-b": 1.0}},
             {"quality": "deep",  "model": "<name>", "laptops": {"worker-a": 0.5, "worker-b": 0.5}}],
  "fan_out": {"specialists": ["worker-a", "worker-b"], "review_chunks": ["worker-a", "worker-b"]},
  "dropped": [{"work": "…", "reason": "…"}]
}
```

**Checks made by code before a plan is used:**
- every laptop named is connected and has the tools that work needs
- the memory needed on each laptop fits, with headroom left for the operating system
- a split model's shares add up to the whole model
- the central agent's laptop appears only as a lender to a split model, and only when there is a single worker
- fall detection and sound recognition are both placed; a plan that drops either is rejected
- anything else left out is listed under `dropped` with a reason

**Fallback.** If the plan fails a check, or the planner takes longer than 20 seconds, a rule-based plan is used: fall detection and sound recognition go to the laptop holding their sensor, the quick model goes to the worker with the most free memory, nothing is split, and fan-out items are dealt out in turn.

**Applying a new plan.** The central agent compares the new plan with the current one and sends only the differences. A job that moves is stopped on the old laptop and then started on the new one, so it is not running for a few seconds. Requests already in progress are allowed to finish first.

**Lost laptop (later).** The same re-plan path handles it: when a worker's connection drops, the planner runs again without that laptop. It is out of the demo but needs no new mechanism.

## Contracts with the other layers

These are proposals for the owners of each layer to agree.

**Layer 1 to Layer 2.** Layer 1 starts the worker program with the central agent's address and a credential. Before that, it has installed Python, Ollama, llama.cpp and the model files. On start, the worker program checks each of these and reports anything missing to the dashboard; it installs nothing itself.

**Layer 3 to Layer 2.** Each model is a folder containing its script and a short description file:

| Field | Meaning |
|---|---|
| name | for example `fall_detection` |
| start command | how to launch the script |
| kind | always-on, or per-item (used in fan-out) |
| memory needed | so the planner and the checks can budget |
| sensor needed | camera, mic or none |

An always-on script prints one event per line as JSON. A per-item script takes one item and returns one result.

**Layer 4 to Layer 2.** A small Python client with four calls:

| Call | Purpose |
|---|---|
| `ask(prompt, quality)` | one language model request at `quick` or `deep` |
| `fan_out(job, items)` | run a per-item job over a list in parallel and get all results |
| `subscribe(handler)` | receive events from the always-on jobs |
| `status()` | which laptops are connected and what is running |

**Apple Health.** The iPhone app sends watch data straight to Layer 4. It does not pass through Layer 2.

## Messages between the central agent and a worker

| Direction | Message | Carries |
|---|---|---|
| Worker to central | `hello` | credential, laptop name, specs, sensors, installed tools |
| Worker to central | `status` (every 2 seconds) | memory free, processor load, state of each job |
| Worker to central | `event` | one output line from an always-on job |
| Worker to central | `result` | the answer to a request or a fan-out item |
| Central to worker | `start` / `stop` | a job, a model, or one part of a split model |
| Central to worker | `request` | a prompt or a fan-out item |
| Both ways | `media` | forwarded video frames or audio, on a separate connection so it cannot delay the messages above |

## Dashboard

One web page served by the central agent:
- each connected laptop with its memory, processor, operating system and attached camera or mic
- what each laptop is running, and its load, updated live
- anything the worker setup check found missing

The planner's reasoning is written to a log file, not shown on the page.

## Risks

| Risk | What it would break | Mitigation |
|---|---|---|
| Venue Wi-Fi stops laptops reaching each other | Everything | Test on arrival; fall back to a phone hotspot; download all models beforehand |
| llama.cpp's multi-machine mode is untested on a Mac and Windows mix | The split model | Try it on the real laptops early. If it fails, `deep` requests go to the largest single-laptop model |
| A split model is slow over Wi-Fi or a hotspot | `deep` answers | Measure it; use `deep` only for reports, never for live alerts |
| The small planner model returns bad plans | Placement quality | The code checks and the rule-based fallback |
| Mac and Windows differ in camera access and process handling | Worker program | Test the worker program on one of each from the first step |
| Not enough memory for everything at once | Some work is dropped | The planner lists what it dropped; the dashboard shows it |

## Build order

| Step | What | Depends on |
|---|---|---|
| 1 | Worker program connects, reports specs and status; dashboard lists laptops | none |
| 2 | Start and stop a job on a worker, using the rule-based plan | 1 |
| 3 | Route `quick` requests to an Ollama model | 2 |
| 4 | AI planner with code checks, falling back to the rules from step 2 | 2 |
| 5 | Re-plan and move jobs when a laptop joins | 4 |
| 6 | Fan-out batches | 3 |
| 7 | Split model for `deep` requests | 3, 4 |

Steps 1 to 5 are the base. Step 7 carries the most risk and can be dropped without affecting the others.

## Open questions

1. **Planner model.** Which small model runs on the central agent's laptop for planning.
2. **Contract sign-off.** The Layer 1, Layer 3 and Layer 4 owners need to agree the contracts above.
3. **Quality levels.** `quick` and `deep` are a proposal; Layer 4's owner may want different levels.
