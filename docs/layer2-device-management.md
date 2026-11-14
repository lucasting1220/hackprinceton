# Layer 2: Cluster

**Status: draft for team review. Nothing is built.** Items under "Decided" come from the design interviews of Nov 13 and 14. Items marked proposed and those under "Open questions" are not yet agreed. Updated to match `layer4-care-layer.md` and the cross-layer decisions in `coherence-review.md`.

## Summary

Layer 2 turns two or three home laptops into one pool of compute. A coordinator program on one laptop manages the hardware; the other laptops (workers) do the AI work. An AI planner on the coordinator decides where each piece of work runs and how large a language model the home can hold, and re-plans whenever a laptop joins.

## The four layers

| Layer | What it is | Owner's main output |
|---|---|---|
| 1. Join and connect | Setup page, pairing, the AWS relay and the whole iPhone app. No decision-making | Paired laptops with Layer 2 started on each, and a phone that receives what Layer 4 sends |
| **2. Cluster** | **This document.** Coordinator, worker program, planner, dashboard | Somewhere to run jobs and a way to ask for compute |
| 3. Raw data | Opens the webcam and mic, receives watch data, and hands all of it to Layer 4. Runs no AI | Three raw feeds |
| 4. Care layer | Detectors (fall model, speech-to-text with a help check, heart-rate check) and a simple rules layer | Alerts, the daily report, answers and live status |

## Decided

| Topic | Decision |
|---|---|
| Coordinator laptop | Manages the hardware and stores data. It runs the coordinator program, the small planner model, the event log, and Layer 1's bridge. It runs none of Layer 3 or Layer 4. It may lend memory to a split model when there is only one worker |
| Workers | Laptops and desktops, a mix of Mac and Windows, 16 GB of memory at the weakest. Two or three laptops in total, including the coordinator |
| Sensors | One j5create USB HD webcam with a built-in mic, attached to any worker |
| What Layer 2 does with work | All three: place whole jobs on a laptop, fan one large job out in parallel, and split one large model across laptops |
| Fan-out job | The daily report: the day's event log is cut into time blocks that different laptops summarise at the same time |
| Planner | An AI. It decides which laptop runs each job, which model size to load, whether to split a model, and how to fan work out |
| When the planner runs | When the home's laptops change (one joins, a new kind of job starts), not for every request |
| Safety net | Code checks every plan. An invalid or late plan is replaced by a simple rule-based plan |
| Short on hardware | The planner chooses what gives way, except that the safety work is never dropped |
| Camera and model placement | The planner may run the fall model or speech-to-text on a different laptop from the one holding the webcam or mic; Layer 3's capture job on that laptop forwards the video or audio |
| Care layer placement | Layer 4's jobs run on workers and can be moved |
| Carrying messages | The coordinator carries messages between Layer 1's bridge and Layer 4, wherever Layer 4 runs |
| Laptop joins mid-run | The planner makes a new plan and running jobs move. A gap of a few seconds while a job moves is acceptable |
| Laptop lost mid-run | Not part of the demo. The design leaves room for jobs to move automatically later |
| Model quality | Layer 4 chooses a quality level for each request; Layer 2 provides it |
| Language model tools | Ollama on each worker. llama.cpp's multi-machine mode for a split model |
| Language | Python for Layers 2, 3 and 4 |
| Worker setup | Everything is installed before the demo. Layer 1 connects and installs; Layer 2 checks what is present and reports what is missing |
| Layer 1 handoff | Layer 1 pairs the laptop, then starts Layer 2's worker program with the coordinator's address and a credential |
| Remote access | Layer 1's AWS relay. Layer 2 has no tunnel and no public address |
| Dashboard | A web page on the coordinator laptop showing each laptop with its specs, and what each is running |
| Network | Venue Wi-Fi, with a phone hotspot as the fallback if the venue blocks laptops from reaching each other |
| Builders | One or two people prompting Claude |

**Safety work (proposed wording).** The original decision was that fall detection and sound recognition are never dropped. With sound detection now a stretch goal, this document reads it as: Layer 3's capture job, the fall model, speech-to-text, Layer 4's rules job, and the message path to Layer 1 are never dropped. The language models can be shrunk or dropped, because a fall alert no longer depends on one.

## Parts

```
   Caregiver's iPhone ◀──▶ AWS relay ◀──▶ Layer 1 bridge
                                              │ local calls
┌──────────────── COORDINATOR LAPTOP ─────────┴────────────────┐
│ coordinator program: laptop table, planner (AI + checks),    │
│   job control, request router, message carrying,             │
│   event log storage, dashboard web page                      │
│ small planner model (Ollama)                                 │
└───────────────────────────────────────────────────────────────┘
        │ start/stop jobs, requests            ▲ status, results, messages
        ▼                                      │
┌──── WORKER PROGRAM (each worker laptop) ───────────────────┐
│ reports specs, sensors and installed tools                  │
│ starts and stops: Layer 3 capture, Layer 4 jobs (fall model,│
│   speech-to-text, rules), Ollama models,                    │
│   llama.cpp parts of a split model                          │
│ reports load every 2 seconds                                │
└──────────────────────────────────────────────────────────────┘
```

**Coordinator program.** Keeps a table of connected laptops, asks the planner for a plan, tells workers what to start and stop, routes each model request to a laptop that can serve it, and serves the dashboard. It also stores the event log, and passes messages between Layer 1's bridge (on the same laptop) and Layer 4 (on whichever worker it runs).

**Worker program.** Started by Layer 1. It connects out to the coordinator, reports what the laptop has, and runs whatever it is told to. It contains no decision logic.

## Kinds of work

| Kind | Example | How Layer 2 handles it |
|---|---|---|
| Capture (Layer 3) | Reading the webcam or mic | An always-on job fixed to the laptop that holds the sensor. It forwards video or audio to wherever the model runs |
| Always-on job (Layer 4) | Fall model, speech-to-text, the rules job | A script that runs continuously on whichever worker the planner picks |
| Model service | The language models Layer 4 uses | Loaded on one worker through Ollama, or split across laptops through llama.cpp |
| Request | The help check; an alert rewrite; a caregiver question | Routed to a loaded model that meets the quality level Layer 4 asked for |
| Fan-out batch | The daily report's time blocks | A list of items is divided among workers, run at the same time, and the results are returned together |
| Message | An alert going to the phone; a question coming from it | Carried between Layer 1's bridge and Layer 4 |

**Quality levels (proposed).** Layer 4 marks each request `quick` or `deep`.
- `quick`: a model that fits on one laptop (roughly 7 to 8 billion parameters on a 16 GB laptop) and answers in a second or two. Used for the help check and alert rewrites.
- `deep`: the largest model the laptops can hold together, split across them if needed. Used for the daily report and caregiver questions.

If `deep` cannot be provided at that moment, the request is answered by the `quick` model and the reply says so.

The safety work and a split deep model may not all fit in two 16 GB workers at once. The planner then has to choose, for example by loading the deep model only while a report is being written.

## The plan

**What the planner is given:** each laptop's memory, processor, graphics capability, operating system, attached sensors, installed tools and current load; the list of work Layers 3 and 4 have asked for; and the previous plan.

**What it returns:** a plan in a fixed format.

```json
{
  "jobs":   [{"job": "capture", "node_id": "<id-a>"},
             {"job": "fall_model", "node_id": "<id-a>"},
             {"job": "speech_to_text", "node_id": "<id-b>"},
             {"job": "care_rules", "node_id": "<id-b>"}],
  "models": [{"quality": "quick", "model": "<name>", "shares": {"<id-b>": 1.0}},
             {"quality": "deep",  "model": "<name>", "shares": {"<id-a>": 0.5, "<id-b>": 0.5}}],
  "fan_out": {"report_blocks": ["<id-a>", "<id-b>"]},
  "dropped": [{"work": "…", "reason": "…"}]
}
```

**Checks made by code before a plan is used:**
- every laptop named is connected and has the tools that work needs
- the memory needed on each laptop fits, with headroom left for the operating system
- a split model's shares add up to the whole model
- the coordinator laptop appears only as a lender to a split model, and only when there is a single worker
- the safety work is all placed; a plan that drops any of it is rejected
- a sensor the resident declined at setup is not a failure: its jobs are listed under `dropped` with the reason `declined`
- anything else left out is listed under `dropped` with a reason

**Fallback.** If the plan fails a check, the planner takes longer than 20 seconds, or Ollama is unreachable, a rule-based plan is used at once: the fall model and speech-to-text go to the laptop holding their sensor, the rules job and the quick model go to the worker with the most free memory, nothing is split, and fan-out items are dealt out in turn.

**Applying a new plan.** The coordinator compares the new plan with the current one and sends only the differences. A job that moves is stopped on the old laptop and then started on the new one, so it is not running for a few seconds. Requests already in progress are allowed to finish first.

**Lost laptop (later).** The same re-plan path handles it: when a worker's connection drops, the planner runs again without that laptop. It is out of the demo but needs no new mechanism.

## Contracts with the other layers

Proposals for the owners of each layer to agree.

**Layer 1 to Layer 2.** Layer 1's doc is the reference for joining and connecting. It asks Layer 2 for ten things. The proposed answer to each, for Lucas to confirm:

| Layer 1's ask | Proposed answer |
|---|---|
| Start the coordinator and worker from config files (`coordinator.json`, `worker.json`), plus a `check` mode that installs nothing | Accept |
| Check a worker's token against `accepted-workers.json` on each `hello`; reply `welcome` with accept or reject; never log tokens | Accept |
| The worker writes a small status file (connected, rejected, disconnected, and anything missing) | Accept |
| A disconnected worker keeps running and retries; a repeat `hello` replaces the old connection | Accept |
| The dashboard's data as JSON at `/api/state` | Accept |
| A local frame feed from the capture job, for live view | Passed to Layer 3, which now owns capture |
| Use the Ollama server already running on the laptop | Accept |
| Never exit because something is missing; agreed exit codes; a stop file | Accept |
| A requirements list (Python version, packages, model names) early | Accept |
| The client endpoint Layer 4 uses listens on `127.0.0.1` only | Changed: Layer 4 runs on workers, so it reaches the coordinator over the home network through the worker program's existing connection |

**Layers 3 and 4 to Layer 2: jobs.** Each job is a folder containing its script and a short description file:

| Field | Meaning |
|---|---|
| name | for example `fall_model` |
| start command | how to launch the script |
| kind | always-on, or per-item (used in fan-out) |
| memory needed | so the planner and the checks can budget |
| sensor needed | camera, mic or none |

**Layer 4 to Layer 2: calls.** A small Python client:

| Call | Purpose |
|---|---|
| `ask(prompt, quality)` | one language model request at `quick` or `deep` |
| `fan_out(job, items)` | run a per-item job over a list in parallel and get all results |
| `feed(name)` | receive a raw feed from Layer 3 (camera frames, mic audio, watch readings) wherever the job runs |
| `to_phone(message)` and `on_request(handler)` | send a message to Layer 1's bridge for the phone; receive requests coming from it |
| `log` read and write | the event log, stored on the coordinator |
| `status()` | which laptops are connected and what is running |

**Layer 1's bridge and the coordinator.** They are on the same laptop and talk through local calls. The coordinator hands over whatever Layer 4 sends with `to_phone`, and passes the bridge's incoming requests and watch readings on to Layers 4 and 3.

## Messages between the coordinator and a worker

| Direction | Message | Carries |
|---|---|---|
| Worker to coordinator | `hello` | the join token, laptop name, specs, sensors, installed tools |
| Coordinator to worker | `welcome` | accepted or rejected, and the laptop's `node_id` |
| Worker to coordinator | `status` (every 2 seconds) | memory free, processor load, state of each job |
| Worker to coordinator | `result` | the answer to a request or a fan-out item |
| Coordinator to worker | `start` / `stop` | a job, a model, or one part of a split model |
| Coordinator to worker | `request` | a prompt or a fan-out item |
| Both ways | `message` | something travelling between Layer 4 and Layer 1's bridge |
| Both ways | `media` | forwarded video frames or audio, on a separate connection so it cannot delay the messages above |

## Dashboard

One web page served by the coordinator, with the same data as JSON at `/api/state`:
- each connected laptop with its memory, processor, operating system and attached camera or mic
- what each laptop is running, and its load, updated live
- anything the worker setup check found missing, and anything the plan dropped, with the reason

The planner's reasoning is written to a log file, not shown on the page.

## Risks

| Risk | What it would break | Mitigation |
|---|---|---|
| Venue Wi-Fi stops laptops reaching each other | Everything | Test on arrival; fall back to a phone hotspot; download all models beforehand |
| llama.cpp's multi-machine mode is untested on a Mac and Windows mix, and its own documentation warns against running it on an open network | The split model | Run on the hotspot. Try it on the real laptops early. If it fails, `deep` requests go to the largest single-laptop model |
| A split model is slow over Wi-Fi or a hotspot | `deep` answers | Measure it; `deep` is never on the alert path |
| The small planner model returns bad plans | Placement quality | The code checks and the rule-based fallback |
| Mac and Windows differ in camera access and process handling | Worker program | Test the worker program on one of each from the first step |
| Not enough memory for everything at once | Some work is dropped | The planner lists what it dropped; the dashboard shows it |
| Every alert passes through the coordinator on its way to the phone | Alerts, if the coordinator fails | Accepted for the demo. Layer 1's cloud check tells the caregiver the home is offline |

## Build order

| Step | What | Depends on |
|---|---|---|
| 1 | Worker program connects with its token, reports specs and status; dashboard and `/api/state` list laptops | none |
| 2 | Start and stop a job on a worker, using the rule-based plan | 1 |
| 3 | Route `quick` requests to an Ollama model | 2 |
| 4 | AI planner with code checks, falling back to the rules from step 2 | 2 |
| 5 | Re-plan and move jobs when a laptop joins | 4 |
| 6 | Fan-out batches | 3 |
| 7 | Carry messages between Layer 1's bridge and Layer 4; store the event log | 2 |
| 8 | Split model for `deep` requests | 3, 4 |

Steps 1, 2 and 7 are what a fall alert needs to reach the phone, so they come first in practice. Step 8 carries the most risk and can be dropped without affecting the others.

## Open questions

1. **Planner model.** Which small model runs on the coordinator for planning.
2. **Layer 1's asks.** Lucas to confirm the proposed answers above.
3. **Quality levels.** `quick` and `deep` are a proposal.
4. **Safety work wording.** Confirm the reading above.
5. **Coordinator memory.** Whether one laptop has room for the coordinator, the planner model, Layer 1's bridge and a lent share of a split model. Needs the real laptops' numbers.
