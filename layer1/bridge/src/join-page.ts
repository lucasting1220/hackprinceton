/**
 * Add a laptop's pages: Join a home on the new laptop (type the home laptop's address; no mDNS),
 * with its QR code, setup and Joined pages, and the Laptops section of the home laptop's page.
 * Every value is escaped through html.ts, and no token, key or ticket reaches a page: the join
 * QR code holds only public keys and IDs. No scripts: waiting pages reload with a meta refresh.
 */
import { type Html, html, page, trustedHtml } from "./html.ts";
import type { Laptop, LaptopView, MissingItem } from "./laptop.ts";
import type { PhoneAccess } from "./phone-access.ts";
import { qrSvg } from "./qr.ts";
import * as settings from "./settings.ts";
import type { PageReply, PageRoute } from "./setup-server.ts";

const TITLE = "Join a home";
const RELOAD_SECONDS = settings.JOIN_POLL_MS / 1000;
const SENSORS_LATER =
  "Camera and mic: none yet. They are chosen in a later build step, once Layer 3 lists this laptop's devices.";

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
${trustedHtml(qrSvg(view.qr))}
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
<p>${SENSORS_LATER}</p>`;
      return { body, reload: RELOAD_SECONDS };
    }
  }
}

export class JoinPage {
  readonly #laptop: Laptop;
  readonly #token: string;
  /** Why this laptop can't join: it is the home laptop, or Create a home is running (A4). */
  readonly #roleTaken: () => string | undefined;

  constructor(laptop: Laptop, token: string, roleTaken: () => string | undefined) {
    this.#laptop = laptop;
    this.#token = token;
    this.#roleTaken = roleTaken;
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
      { method: "POST", path: "/join/reset", guard: "form", handle: () => this.#reset() },
    ];
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

  #check(): PageReply {
    this.#laptop.checkAgain();
    return { redirect: "/join" };
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
export function laptopsSection(access: PhoneAccess | undefined, hubPublicKey: string): Html {
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
  const joinItems = joins.map((join) => {
    const node = join.nodeId === null ? "" : html`, node <code>${join.nodeId}</code>`;
    const until = join.state === "waiting" ? `, until ${join.expiresAt}` : "";
    return html`<li>${join.name}: ${JOIN_WORDS[join.state]}${until}${node}</li>`;
  });
  const joinList = joinItems.length === 0 ? html`` : html`<ul>${joinItems}</ul>`;
  const failed =
    problem === undefined ? html`` : html`<p>The last approval failed: ${problem}.</p>`;
  const linked = [...state.link.linked().values()].map(
    (laptop) =>
      html`<li>Node <code>${laptop.nodeId}</code>: ${laptop.state.replace("_", " ")}, reported ${laptop.reportedAt}${missingList(laptop.missing)}</li>`,
  );
  const linkList = linked.length === 0 ? html`` : html`<p>Linked laptops:</p><ul>${linked}</ul>`;
  return html`${heading}${how}${joinList}${failed}${linkList}`;
}
