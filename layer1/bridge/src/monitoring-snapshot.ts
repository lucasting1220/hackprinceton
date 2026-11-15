/**
 * The hub's monitoring snapshot (phone-hub.md §3): what the caregiver's app shows under Devices and
 * as Home's monitoring status. The hub reads Layer 2's GET /api/state (contracts/api-state.json)
 * every MONITORING_POLL_MS, asks Ollama whether it answers, maps both to the app's fields, and sends
 * the snapshot, sealed with the home key, when it changes and at least every
 * MONITORING_SNAPSHOT_MAX_S seconds. A change means any field but sent_at and the laptops'
 * last_status_at, which moves with every worker status (every 2 s) and would send every poll.
 *
 *   poll ─▶ /api/state ─ok─▶ map(body, now, Ollama) ─changed or 60 s─▶ send ─▶ outbox (latest only)
 *               │ failed
 *               └─▶ the last body read, mapped again with now (one log line per failing stretch)
 *
 * A failed read maps the last body again, so a laptop that stops being heard turns not reporting
 * as time passes. Before the first good read nothing is sent.
 */
import { errorKind } from "./link.ts";
import type { ApiStateRead } from "./live-view-hub.ts";
import * as settings from "./settings.ts";
import { utcSeconds } from "./wire.ts";
import { canonicalJson } from "./home-messages.ts";

/** A camera's or mic's state in the app's decoder; the hub never sends "declined" yet. */
export type SensorState = "up" | "down" | "declined" | "none";

/** A detection job's state in the app's decoder. */
export type DetectionState = "running" | "stopped" | "unplaced";

/** "starting" before Layer 2 lists any laptop, then "ok" or "degraded". */
export type MonitoringState = "starting" | "ok" | "degraded";

export type MonitoringLaptop = Readonly<{
  node_id: string;
  display_name: string;
  reporting: boolean;
  last_status_at: string | null;
}>;

/** The snapshot's fields besides msg_id, sent_at and type, which sealing adds. */
export type MonitoringFields = Readonly<{
  state: MonitoringState;
  laptops: readonly MonitoringLaptop[];
  camera: SensorState;
  mic: SensorState;
  fall_detection: DetectionState;
  sound_detection: DetectionState;
  language_model_available: boolean;
}>;

type ApiLaptop = Readonly<{
  nodeId: string;
  displayName: string;
  lastStatusMs: number | undefined;
  sensors: readonly string[];
}>;
type ApiJob = Readonly<{ job: string; nodeId: string; state: string }>;
type ApiState = Readonly<{
  laptops: readonly ApiLaptop[];
  jobs: readonly ApiJob[];
  dropped: readonly string[];
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** contracts/api-state.json's laptops, jobs and dropped work, or undefined when it has no laptops list. */
export function parseApiState(body: unknown): ApiState | undefined {
  if (!isRecord(body)) return undefined;
  const { laptops: listed, jobs: placed, dropped: droppedWork } = body;
  if (!Array.isArray(listed)) return undefined;
  const laptops: ApiLaptop[] = [];
  for (const laptop of records(listed)) {
    const { node_id: nodeId, display_name: name, last_status_at: at, sensors } = laptop;
    if (typeof nodeId !== "string") continue;
    const parsed = typeof at === "string" ? Date.parse(at) : Number.NaN;
    laptops.push({
      nodeId,
      displayName: typeof name === "string" && name !== "" ? name : nodeId,
      lastStatusMs: Number.isNaN(parsed) ? undefined : parsed,
      sensors: Array.isArray(sensors) ? sensors.filter((item) => typeof item === "string") : [],
    });
  }
  const jobs: ApiJob[] = [];
  for (const { job, node_id: nodeId, state } of records(placed)) {
    if (typeof job === "string" && typeof nodeId === "string" && typeof state === "string") {
      jobs.push({ job, nodeId, state });
    }
  }
  const dropped = records(droppedWork).flatMap(({ work }) =>
    typeof work === "string" ? [work] : [],
  );
  return { laptops, jobs, dropped };
}

/** Whether a laptop's last status is within MONITORING_REPORTING_LIMIT_S of now. */
function reporting(laptop: ApiLaptop, nowMs: number): boolean {
  if (laptop.lastStatusMs === undefined) return false;
  return nowMs - laptop.lastStatusMs <= settings.MONITORING_REPORTING_LIMIT_S * 1000;
}

function runs(state: ApiState, job: string, nodeIds: ReadonlySet<string>): boolean {
  return state.jobs.some(
    (entry) => entry.job === job && entry.state === "running" && nodeIds.has(entry.nodeId),
  );
}

/** "up" when a reporting laptop with the sensor runs capture, "none" when no laptop has it. */
function sensorState(state: ApiState, sensor: string, live: ReadonlySet<string>): SensorState {
  const owners = state.laptops.filter((laptop) => laptop.sensors.includes(sensor));
  if (owners.length === 0) return "none";
  const liveOwners = new Set(owners.map((laptop) => laptop.nodeId).filter((id) => live.has(id)));
  return runs(state, settings.MONITORING_CAPTURE_JOB, liveOwners) ? "up" : "down";
}

/** "running" on a reporting laptop, "unplaced" when Layer 2 lists it nowhere or dropped it. */
function detection(state: ApiState, job: string, live: ReadonlySet<string>): DetectionState {
  if (runs(state, job, live)) return "running";
  const placed = state.jobs.some((entry) => entry.job === job);
  return !placed || state.dropped.includes(job) ? "unplaced" : "stopped";
}

/** The snapshot's fields from a parsed /api/state at `nowMs`, with Ollama's answer. */
export function monitoringFields(
  state: ApiState,
  nowMs: number,
  languageModelAvailable: boolean,
): MonitoringFields {
  const laptops = state.laptops.map((laptop) => ({
    node_id: laptop.nodeId,
    display_name: laptop.displayName,
    reporting: reporting(laptop, nowMs),
    last_status_at:
      laptop.lastStatusMs === undefined ? null : utcSeconds(new Date(laptop.lastStatusMs)),
  }));
  const live = new Set(
    laptops.filter((laptop) => laptop.reporting).map((laptop) => laptop.node_id),
  );
  const camera = sensorState(state, "camera", live);
  const fall = detection(state, settings.MONITORING_FALL_JOB, live);
  const allReporting = laptops.every((laptop) => laptop.reporting);
  const healthy = allReporting && camera === "up" && fall === "running";
  return {
    state: laptops.length === 0 ? "starting" : healthy ? "ok" : "degraded",
    laptops,
    camera,
    mic: sensorState(state, "mic", live),
    fall_detection: fall,
    sound_detection: detection(state, settings.MONITORING_SOUND_JOB, live),
    language_model_available: languageModelAvailable,
  };
}

/** Whether Ollama on this laptop answers GET / within MONITORING_OLLAMA_TIMEOUT_MS. */
export async function ollamaAnswers(url: string = settings.OLLAMA_URL): Promise<boolean> {
  try {
    const response = await fetch(new URL("/", url), {
      signal: AbortSignal.timeout(settings.MONITORING_OLLAMA_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch (error) {
    const expected =
      error instanceof TypeError ||
      (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name));
    if (!expected) throw error;
    return false;
  }
}

/** What counts as a change: everything but the laptops' last_status_at (sent_at isn't in fields). */
function changeKey(fields: MonitoringFields): string {
  const laptops = fields.laptops.map(({ last_status_at: _at, ...laptop }) => laptop);
  return canonicalJson({ ...fields, laptops });
}

export interface MonitoringTiming {
  readonly pollMs: number;
  readonly resendMs: number;
}

export interface MonitoringOptions {
  /** Layer 2's /api/state: readApiState(the dashboard port) in the bridge. */
  readonly readState: () => Promise<ApiStateRead>;
  /** Whether the coordinator's language model answers: ollamaAnswers() in the bridge. */
  readonly languageModel: () => Promise<boolean>;
  /** Seals the fields with the home key and queues them; resolves false when it couldn't. */
  readonly send: (fields: MonitoringFields) => Promise<boolean>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly timing?: Partial<MonitoringTiming>;
}

export class MonitoringSnapshots {
  readonly #options: MonitoringOptions;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #timing: MonitoringTiming;
  #timer: NodeJS.Timeout | undefined;
  #polling: Promise<void> | undefined;
  #lastState: ApiState | undefined;
  #lastSent: string | undefined;
  #lastSentMs = Number.NEGATIVE_INFINITY;
  #readFailing = false;

  constructor(options: MonitoringOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#timing = {
      pollMs: settings.MONITORING_POLL_MS,
      resendMs: settings.MONITORING_SNAPSHOT_MAX_S * 1000,
      ...options.timing,
    };
  }

  /** Polls now and then every pollMs until stop(). */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.#tick(), this.#timing.pollMs);
    this.#tick();
  }

  /** Stops polling and waits for a poll in flight. */
  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#polling;
  }

  /** One poll: read, map, and send when changed or due. Tests call it directly. */
  async poll(): Promise<void> {
    const read = await this.#options.readState();
    if (read.ok) {
      const parsed = parseApiState(read.body);
      this.#readResult(parsed === undefined ? "Layer 2's /api/state has no laptops" : undefined);
      if (parsed !== undefined) this.#lastState = parsed;
    } else {
      this.#readResult(read.reason);
    }
    const state = this.#lastState;
    if (state === undefined) return;
    const now = this.#now();
    const fields = monitoringFields(state, now, await this.#options.languageModel());
    const key = changeKey(fields);
    if (key === this.#lastSent && now - this.#lastSentMs < this.#timing.resendMs) return;
    if (!(await this.#options.send(fields))) return;
    this.#lastSent = key;
    this.#lastSentMs = now;
  }

  #tick(): void {
    if (this.#polling !== undefined) return;
    this.#polling = this.poll()
      .catch((error: unknown) => {
        this.#log(`L1 monitoring: a poll stopped with an error (${errorKind(error)})`);
      })
      .finally(() => {
        this.#polling = undefined;
      });
  }

  /** Logs the first failed read of a stretch, and the read that ends it. */
  #readResult(reason: string | undefined): void {
    if (reason !== undefined && !this.#readFailing) {
      this.#log(`L1 monitoring: ${reason}; the snapshot uses the last answer`);
    } else if (reason === undefined && this.#readFailing) {
      this.#log("L1 monitoring: reading Layer 2's /api/state again");
    }
    this.#readFailing = reason !== undefined;
  }
}
