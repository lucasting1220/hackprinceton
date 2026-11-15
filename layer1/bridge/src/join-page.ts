/**
 * Add a laptop's pages: Join a home on the new laptop (type the home laptop's address; no mDNS),
 * with its QR code, setup and Joined pages, and the Laptops section of the home laptop's page.
 * Every value is escaped through html.ts, and no token, key or ticket reaches a page: the join
 * QR code holds only public keys and IDs. No scripts: waiting pages reload with a meta refresh.
 */
import { type Html, html, page, trustedHtml } from "./html.ts";
import type { Laptop, LaptopView, MissingItem, Sensors } from "./laptop.ts";
import type { PhoneAccess } from "./phone-access.ts";
import { qrSvg } from "./qr.ts";
import {
  type DeviceCheckRead,
  type DeviceOutcome,
  type ListedDevice,
  PICK_NONE,
  pickedName,
  pickerChoices,
  pickValue,
  sshHint,
  startedOverSsh,
} from "./sensor-check.ts";
import * as settings from "./settings.ts";
import type { PageReply, PageRoute } from "./setup-server.ts";

const TITLE = "Join a home";
const RELOAD_SECONDS = settings.JOIN_POLL_MS / 1000;
const SENSORS_TITLE = "Camera and mic";
const CHECK_TITLE = "Check sensors";
const LEAVE_TITLE = "Leave this home";

/** A form that posts the page's token, `fields` and nothing else to `action`. */
function button(action: string, token: string, label: string): Html {
  return html`<form method="post" action="${action}"><input type="hidden" name="token" value="${token}"><button>${label}</button></form>`;
}

function missingList(missing: readonly MissingItem[]): Html {
  if (missing.length === 0) return html``;
  const items = missing.map(
    (item) =>
      html`<li>${item.id} (${item.required ? "required" : "optional"}): ${item.reason}</li>`,
  );
  return html`<ul>${items}</ul>`;
}

/** The Join a home form: the home laptop's address, as its page shows it, and this laptop's name. */
function joinForm(token: string, notice: string | undefined): Html {
  const said = notice === undefined ? "" : html`<p>${notice}</p>`;
  return html`${said}<p>On the home laptop, its page shows its address under Laptops. Type it here.</p>
<form method="post" action="/join/start"><input type="hidden" name="token" value="${token}">
<p><label>Home laptop's address <input name="address" required placeholder="192.168.1.20"></label></p>
<p><label>This laptop's name <input name="name" required maxlength="64" placeholder="Kitchen laptop"></label></p>
<button>Continue</button></form>
<p><a href="/">Back</a></p>`;
}

const CONSENT_BOX = html`<p><label><input type="checkbox" name="consent" value="yes"> The resident agrees to this camera and mic</label></p>
<p>Without the resident's agreement, no camera or mic is saved. Saving runs Layer 3's device check, then restarts the worker.</p>`;

/**
 * The camera and mic form with typed names: the fallback when Layer 3's device list can't be
 * read. It doesn't reload, so typing isn't lost, and the consent box always starts unchecked.
 */
export function sensorsForm(sensors: Sensors, token: string, notice?: string): Html {
  const said = notice === undefined ? "" : html`<p><strong>${notice}</strong></p>`;
  const most = settings.SENSOR_NAME_MAX_CHARS;
  return html`${said}<p>Now: camera ${sensors.camera ?? "none"}, mic ${sensors.mic ?? "none"}.</p>
<p>Type each name exactly as the operating system shows it, for example <code>j5 WebCam JVCU100</code> for the camera and <code>Audio Streaming</code> for the mic on the demo laptop. Only the devices named here are used; a built-in camera or mic is never used unless named. Leave a field empty for none.</p>
<form method="post" action="/join/sensors"><input type="hidden" name="token" value="${token}">
<p><label>Camera <input name="camera" maxlength="${most}" value="${sensors.camera ?? ""}"></label></p>
<p><label>Mic <input name="mic" maxlength="${most}" value="${sensors.mic ?? ""}"></label></p>
${CONSENT_BOX}
<button>Save</button></form>
<p><a href="/join">Back</a></p>`;
}

/** One picker: no device preselected, None on this laptop, then external devices first. */
function picker(field: "camera" | "mic", word: string, offered: readonly ListedDevice[]): Html {
  const options = offered.map(
    (device) =>
      html`<option value="${pickValue(device.name)}">${device.name} (${device.kind})</option>`,
  );
  return html`<p><label>${word[0]?.toUpperCase()}${word.slice(1)} <select name="${field}" required><option value="" disabled selected>Choose the ${word}</option><option value="${PICK_NONE}">No ${word} on this laptop</option>${options}</select></label></p>`;
}

/** What the page says about one kind of device: none plugged in, or names two devices share. */
function pickerNotes(word: string, offered: number, flagged: readonly string[]): Html {
  const none =
    offered === 0
      ? html`<p>No external ${word} is listed. Plug in the ${word === "camera" ? "webcam" : word}, then refresh this page.</p>`
      : html``;
  const same = flagged.map(
    (name) =>
      html`<p>Two or more ${word}s are named <strong>${name}</strong>, so neither is offered. Unplug the others, then refresh this page.</p>`,
  );
  return html`${none}${same}`;
}

/**
 * The camera and mic form with pickers from Layer 3's device list (contracts/device-list.json):
 * external and unknown devices only, external first, never preselected, and two devices with one
 * name flagged rather than offered. The consent box always starts unchecked.
 */
export function sensorPickers(
  sensors: Sensors,
  list: Readonly<{
    cameras: readonly ListedDevice[];
    mics: readonly ListedDevice[];
    problems: readonly string[];
  }>,
  token: string,
  notice?: string,
): Html {
  const said = notice === undefined ? "" : html`<p><strong>${notice}</strong></p>`;
  const cameras = pickerChoices(list.cameras);
  const mics = pickerChoices(list.mics);
  const problems =
    list.problems.length === 0
      ? html``
      : html`<ul>${list.problems.map((p) => html`<li>${p}</li>`)}</ul>`;
  return html`${said}<p>Now: camera ${sensors.camera ?? "none"}, mic ${sensors.mic ?? "none"}.</p>
${problems}${pickerNotes("camera", cameras.offered.length, cameras.flagged)}${pickerNotes("mic", mics.offered.length, mics.flagged)}
<p>Pick the camera and the mic this laptop watches with. They are separate devices, each with its own name. A built-in camera or mic, an iPhone's camera or a virtual device is never offered.</p>
<form method="post" action="/join/sensors"><input type="hidden" name="token" value="${token}"><input type="hidden" name="picked" value="yes">
${picker("camera", "camera", cameras.offered)}
${picker("mic", "mic", mics.offered)}
${CONSENT_BOX}
<button>Save and check</button></form>
<form method="post" action="/join/sensors"><input type="hidden" name="token" value="${token}"><input type="hidden" name="picked" value="yes"><input type="hidden" name="camera" value="${PICK_NONE}"><input type="hidden" name="mic" value="${PICK_NONE}"><button>No sensors on this laptop</button></form>
<p><a href="/join">Back</a></p>`;
}

function outcomeLine(word: string, outcome: DeviceOutcome): Html {
  if (outcome.result === "none") return html`<p>${word}: none on this laptop.</p>`;
  const fix = outcome.fix === null ? html`` : html` ${outcome.fix}.`;
  const similar =
    outcome.similar.length === 0
      ? html``
      : html` It may now be named: ${outcome.similar.join(" or ")}; pick it again.`;
  const shown =
    outcome.result === "ok" ? html`<strong>${outcome.message}</strong>` : html`${outcome.message}.`;
  return html`<p>${word}: ${shown}${fix}${similar}</p>`;
}

/** The device check's result: Camera OK and Mic OK, or each reason and what to change. */
export function checkResultBody(check: DeviceCheckRead, overSsh: boolean): Html {
  const again = html`<p><a href="/join/sensors">Change the camera and mic, or check again</a> · <a href="/join">Back</a></p>`;
  if (!check.ok) {
    return html`<p>Saved. The device check couldn't run: ${check.message}.</p>
<p>The worker started with the camera and mic saved; fix that, then check them again.</p>${again}`;
  }
  const hint = sshHint(check, overSsh);
  const ssh = hint === undefined ? html`` : html`<p><strong>${hint}</strong></p>`;
  const summary = check.allOk
    ? html`<p>Saved and checked. The worker is starting.</p>`
    : html`<p>Saved, but the check found a problem. The worker is starting; fix it, then check again.</p>`;
  return html`${summary}${outcomeLine("Camera", check.camera)}${outcomeLine("Mic", check.mic)}${ssh}${again}`;
}

/** The page for a laptop's join `view`, and how often it reloads. */
export function joinBody(view: LaptopView, token: string): { body: Html; reload?: number } {
  const again = (label: string) => button("/join/reset", token, label);
  switch (view.step) {
    case "none":
      return { body: joinForm(token, undefined) };
    case "finding":
      return {
        body: html`<p>Contacting the home laptop at ${view.address}…</p>`,
        reload: RELOAD_SECONDS,
      };
    case "waiting": {
      const body = html`<p>Open the Debbie app on a caregiver's iPhone, tap Add a Laptop and scan this code. It expires at ${view.expiresAt}.</p>
<div class="qr">${trustedHtml(qrSvg(view.qr))}</div>
<p>Home code: <strong>${view.homeCode}</strong>. Check that the home laptop's page at ${view.address} shows the same code.</p>
<details><summary>The code as text, for the app's Debug paste field</summary><pre>${view.qr}</pre></details>
${again("Cancel")}`;
      return { body, reload: RELOAD_SECONDS };
    }
    case "failed":
      return { body: html`<p>${view.message}</p>${again("Show a new code")}` };
    case "setting_up":
      return { body: html`<p>${view.doing}…</p>`, reload: RELOAD_SECONDS };
    case "check_failed":
      return {
        body: html`<p>${view.message}</p>${missingList(view.missing)}${button("/join/check", token, "Check again")}${again("Join again")}`,
      };
    case "joined": {
      if (view.rejected) {
        return { body: html`<p>The home rejected this laptop's token.</p>${again("Join again")}` };
      }
      const body = html`<p>${view.connection}</p>
<p>Name: ${view.name}. Node ID: <code>${view.nodeId}</code>. Home laptop: ${view.homeAddress}.</p>
<p>Link to the home laptop: ${view.link}.</p>
<p>Camera: ${view.sensors.camera ?? "none"}. Mic: ${view.sensors.mic ?? "none"}. <a href="/join/sensors">Change the camera and mic</a></p>
<p><a href="/join/leave">Leave this home</a></p>`;
      return { body, reload: RELOAD_SECONDS };
    }
  }
}

export class JoinPage {
  readonly #laptop: Laptop;
  readonly #token: string;
  /** Why this laptop can't join: it is the home laptop, or Create a home is running (A4). */
  readonly #roleTaken: () => string | undefined;
  /** Whether this bridge was started over SSH, for the device check's Terminal.app hint. */
  readonly #overSsh: boolean;

  constructor(
    laptop: Laptop,
    token: string,
    roleTaken: () => string | undefined,
    overSsh = startedOverSsh(),
  ) {
    this.#laptop = laptop;
    this.#token = token;
    this.#roleTaken = roleTaken;
    this.#overSsh = overSsh;
  }

  /** The page "/" shows while this laptop joins or has joined, else undefined. */
  currentPage(): string | undefined {
    return this.#laptop.busy() ? this.#show().body : undefined;
  }

  routes(): PageRoute[] {
    return [
      { method: "GET", path: "/join", guard: "view", handle: async () => this.#show() },
      {
        method: "POST",
        path: "/join/start",
        guard: "form",
        handle: async (fields) => this.#start(fields),
      },
      { method: "POST", path: "/join/check", guard: "form", handle: async () => this.#check() },
      { method: "GET", path: "/join/sensors", guard: "view", handle: () => this.#sensors() },
      {
        method: "POST",
        path: "/join/sensors",
        guard: "form",
        handle: (fields) => this.#saveSensors(fields),
      },
      { method: "GET", path: "/join/leave", guard: "view", handle: async () => this.#leave() },
      { method: "POST", path: "/join/leave", guard: "form", handle: () => this.#left() },
      { method: "POST", path: "/join/reset", guard: "form", handle: () => this.#reset() },
    ];
  }

  /** Leave this home's confirm page, once joined; it doesn't reload, so it waits for an answer. */
  #leave(): PageReply {
    if (this.#laptop.view().step !== "joined") return { redirect: "/join" };
    const body = html`<p>Leaving tells the home laptop, which removes this laptop from the home, then stops the worker on this laptop and deletes its join token and files.</p>
<p>To join again, choose Join a home, and a caregiver approves this laptop again in the Debbie app.</p>
${button("/join/leave", this.#token, "Leave this home")}
<p><a href="/join">Back</a></p>`;
    return { status: 200, body: page(LEAVE_TITLE, body) };
  }

  #show(): { status: number; body: string } {
    const view = this.#laptop.view();
    const { body, reload } = joinBody(view, this.#token);
    const title = view.step === "joined" && !view.rejected ? "This laptop" : TITLE;
    return { status: 200, body: page(title, body, reload) };
  }

  #start(fields: URLSearchParams): PageReply {
    const taken = this.#roleTaken();
    if (taken !== undefined)
      return { status: 409, body: page(TITLE, html`<p>${taken}</p><p><a href="/">Back</a></p>`) };
    const started = this.#laptop.join(fields.get("address") ?? "", fields.get("name") ?? "");
    if (!started.ok) {
      const status = this.#laptop.busy() ? 409 : 400;
      return { status, body: page(TITLE, joinForm(this.#token, started.message)) };
    }
    return { redirect: "/join" };
  }

  /** The Camera and mic form: pickers from Layer 3's device list, else typed names. */
  async #sensorsForm(sensors: Sensors, notice?: string): Promise<Html> {
    const list = await this.#laptop.listDevices();
    if (list.ok) return sensorPickers(sensors, list, this.#token, notice);
    const why = `Layer 3's device list isn't available (${list.message}), so type the names. Refresh this page to try the list again.`;
    return sensorsForm(sensors, this.#token, notice === undefined ? why : `${notice} ${why}`);
  }

  async #sensors(): Promise<PageReply> {
    const view = this.#laptop.view();
    if (view.step !== "joined") return { redirect: "/join" };
    return { status: 200, body: page(SENSORS_TITLE, await this.#sensorsForm(view.sensors)) };
  }

  async #saveSensors(fields: URLSearchParams): Promise<PageReply> {
    const consent = fields.get("consent") === "yes";
    const picked = fields.get("picked") === "yes";
    const camera = picked ? pickedName(fields.get("camera")) : (fields.get("camera") ?? "");
    const mic = picked ? pickedName(fields.get("mic")) : (fields.get("mic") ?? "");
    const view = this.#laptop.view();
    const now = view.step === "joined" ? view.sensors : { camera: null, mic: null };
    if (camera === undefined || mic === undefined) {
      const body = await this.#sensorsForm(
        now,
        "Choose a camera and a mic, or No camera and No mic.",
      );
      return { status: 400, body: page(SENSORS_TITLE, body) };
    }
    const saved = await this.#laptop.saveSensors(camera, mic, consent);
    if (!saved.ok) {
      const body = await this.#sensorsForm(now, saved.message);
      return { status: 400, body: page(SENSORS_TITLE, body) };
    }
    if (saved.check === undefined) return { redirect: "/join" };
    const body = checkResultBody(saved.check, this.#overSsh);
    return { status: 200, body: page(CHECK_TITLE, body) };
  }

  #check(): PageReply {
    this.#laptop.checkAgain();
    return { redirect: "/join" };
  }

  /** Leaves; when the home laptop couldn't be told, says to remove this laptop there. */
  async #left(): Promise<PageReply> {
    if (this.#laptop.view().step !== "joined") return { redirect: "/join" };
    const told = await this.#laptop.leave();
    if (told.ok) return { redirect: "/join" };
    const body = html`<p>This laptop left the home, but the home laptop couldn't be told: ${told.reason}.</p>
<p>On the home laptop's page, under Laptops, press Remove next to this laptop.</p>
<p><a href="/join">Continue</a></p>`;
    return { status: 200, body: page(LEAVE_TITLE, body) };
  }

  async #reset(): Promise<PageReply> {
    await this.#laptop.reset();
    return { redirect: "/join" };
  }
}

const JOIN_WORDS = {
  waiting: "waiting for a caregiver to approve it in the Debbie app",
  approving: "being approved",
  approved: "approved",
  declined: "declined",
  expired: "its code expired",
} as const;

/**
 * The Laptops section of the home laptop's page: how to add one (this laptop's addresses and the
 * home code), the laptops waiting for approval or approved, and what each linked laptop reported.
 */
export function laptopsSection(
  access: PhoneAccess | undefined,
  hubPublicKey: string,
  accepted: readonly Readonly<{ nodeId: string; displayName: string }>[],
  token: string,
): Html {
  const heading = html`<h2>Laptops</h2>`;
  const state = access?.state();
  if (state?.on !== true) {
    return html`${heading}<p>Adding a laptop needs the network side, which isn't running.</p>`;
  }
  const addresses = access?.addresses() ?? [];
  const homeCode = hubPublicKey.slice(0, settings.HUB_TAG_CHARS);
  const how =
    addresses.length === 0
      ? html`<p>This laptop isn't connected to a network, so no laptop can join yet.</p>`
      : html`<p>To add a laptop, start the bridge on it, choose Join a home and type this laptop's address: ${addresses.join(" or ")}. Home code: <strong>${homeCode}</strong>.</p>`;
  const { joins, problem } = state.join.listing();
  const joinItems = joins
    .filter((join) => join.state !== "approved")
    .map((join) => {
      const node = join.nodeId === null ? "" : html`, node <code>${join.nodeId}</code>`;
      const until = join.state === "waiting" ? `, until ${join.expiresAt}` : "";
      return html`<li>${join.name}: ${JOIN_WORDS[join.state]}${until}${node}</li>`;
    });
  const joinList = joinItems.length === 0 ? html`` : html`<ul>${joinItems}</ul>`;
  const failed =
    problem === undefined ? html`` : html`<p>The last approval failed: ${problem}.</p>`;
  const linked = state.link.linked();
  const items = accepted.map((worker) => {
    const laptop = linked.get(worker.nodeId);
    const about =
      laptop === undefined
        ? html`not reporting`
        : html`${laptop.state.replace("_", " ")}, reported ${laptop.reportedAt}${missingList(laptop.missing)}`;
    const remove = html`<form method="post" action="/laptops/remove"><input type="hidden" name="token" value="${token}"><input type="hidden" name="node_id" value="${worker.nodeId}"><button>Remove</button></form>`;
    return html`<li>${worker.displayName}, node <code>${worker.nodeId}</code>: ${about}${remove}</li>`;
  });
  const joinedList =
    items.length === 0
      ? html``
      : html`<p>Joined laptops. Remove takes a laptop out of the home: its token stops working and its worker is disconnected.</p><ul>${items}</ul>`;
  return html`${heading}${how}${joinList}${failed}${joinedList}`;
}
