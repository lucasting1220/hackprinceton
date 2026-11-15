/**
 * The setup page's Pair a phone page and the Phones section of "Home created". Every value is
 * escaped through html.ts; the QR secret appears only as the QR code's dark squares, and no key or
 * credential reaches a page. No scripts: the page reloads itself with a meta refresh while it waits.
 */
import { type Html, html, page, trustedHtml } from "./html.ts";
import { errorMessage, JsonFileError } from "./json-file.ts";
import type { PhoneAccess } from "./phone-access.ts";
import type { PairingView, QrPayload } from "./pairing.ts";
import { PhonesError } from "./phones.ts";
import { qrSvg } from "./qr.ts";
import * as settings from "./settings.ts";
import type { PageReply, PageRoute } from "./setup-server.ts";

const TITLE = "Pair a phone";
const REMOTE_NOT_SET_UP =
  "Remote access isn't set up yet, so this phone reaches home only on home Wi-Fi. Pair it again after remote access is set up.";
const FIREWALL_HINT = "If macOS asked whether node may accept incoming connections, choose Allow.";
const NO_NETWORK =
  "This laptop isn't connected to a network. Connect it to the home Wi-Fi, then show a new code.";
const START_REFUSED = {
  no_addresses: NO_NETWORK,
  phone_waiting: "A phone is waiting for Confirm. Press Confirm or Cancel first.",
  collecting: "A paired phone may still be collecting its keys. Try again in a minute.",
} as const;

/** A form that posts the page's token, `fields` and nothing else to `action`. */
function form(action: string, token: string, label: string, fields: Record<string, string> = {}) {
  const hidden = Object.entries(fields).map(
    ([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`,
  );
  return html`<form method="post" action="${action}"><input type="hidden" name="token" value="${token}">${hidden}<button>${label}</button></form>`;
}

const roleWords = (role: string) => (role === "caregiver" ? "a caregiver" : "a resident");

export class PairingPage {
  readonly #access: () => PhoneAccess | undefined;
  readonly #token: string;
  /** What the last action could not do, shown once on the next page. */
  #notice: string | undefined;

  /** `access` gives the phone side once the home is ready; `token` is the page's per-run token. */
  constructor(access: () => PhoneAccess | undefined, token: string) {
    this.#access = access;
    this.#token = token;
  }

  /** The Phones section of "Home created". */
  phonesSection(): Html {
    const token = this.#token;
    const heading = html`<h2>Phones</h2>`;
    const access = this.#access();
    if (access === undefined) {
      return html`${heading}<p>Phone pairing isn't running; restart the bridge to start it.</p>`;
    }
    const state = access.state();
    if (!state.on) {
      const retry = state.retryable ? form("/pairing/start", token, "Pair a phone") : "";
      return html`${heading}<p>Phone pairing isn't available: ${state.reason}.</p>${retry}`;
    }
    const phones = state.phones.list();
    const list =
      phones.length === 0
        ? html`<p>No phones are paired yet.</p>`
        : html`<ul>${phones.map(
            (phone) =>
              html`<li>${phone.name}, ${phone.role}, paired ${phone.pairedAt} ${form("/phones/remove", token, "Remove", { device_id: phone.deviceId })}</li>`,
          )}</ul>`;
    const addresses = access.addresses();
    const reach =
      addresses.length === 0
        ? html`<p>${NO_NETWORK}</p>`
        : html`<p>Phones reach this laptop at ${addresses.join(", ")}.</p>`;
    return html`${heading}${list}${form("/pairing/start", token, "Pair a phone")}${reach}`;
  }

  /** The routes this page adds to the setup page's table, each behind its guard. */
  routes(): PageRoute[] {
    return [
      { method: "GET", path: "/pairing", guard: "view", handle: async () => this.#show() },
      { method: "POST", path: "/pairing/start", guard: "form", handle: () => this.#start() },
      {
        method: "POST",
        path: "/pairing/confirm",
        guard: "form",
        handle: (fields) => this.#confirm(fields.get("pending_id") ?? ""),
      },
      {
        method: "POST",
        path: "/pairing/cancel",
        guard: "form",
        handle: async () => this.#cancel(),
      },
      {
        method: "POST",
        path: "/phones/remove",
        guard: "form",
        handle: (fields) => this.#remove(fields.get("device_id") ?? ""),
      },
    ];
  }

  #show(): PageReply {
    const notice = this.#notice === undefined ? "" : html`<p>${this.#notice}</p>`;
    const back = html`<p><a href="/">Back to the home</a></p>`;
    const access = this.#access();
    const state = access?.state();
    if (access === undefined || state === undefined || !state.on) {
      const why = state === undefined || state.on ? "there is no home yet" : state.reason;
      const body = html`<p>Phone pairing isn't available: ${why}.</p>${back}`;
      return { status: 200, body: page(TITLE, body) };
    }
    const { pairing } = state;
    const { body, reload } = pairingBody(
      pairing.view(),
      pairing.qr(),
      this.#token,
      pairing.relayUrl,
    );
    return { status: 200, body: page(TITLE, html`${notice}${body}${back}`, reload) };
  }

  async #start(): Promise<PageReply> {
    this.#notice = undefined;
    const access = this.#access();
    if (access === undefined) return { redirect: "/pairing" };
    await access.retry();
    const state = access.state();
    if (!state.on) return { redirect: "/pairing" };
    const started = state.pairing.start(access.addresses());
    if (!started.ok) this.#notice = START_REFUSED[started.reason];
    return { redirect: "/pairing" };
  }

  async #confirm(pendingId: string): Promise<PageReply> {
    this.#notice = undefined;
    const state = this.#access()?.state();
    if (state?.on !== true) return { redirect: "/pairing" };
    const confirmed = await state.pairing.confirm(pendingId);
    if (!confirmed.ok) this.#notice = confirmed.message;
    return { redirect: "/pairing" };
  }

  #cancel(): PageReply {
    this.#notice = undefined;
    const state = this.#access()?.state();
    if (state?.on === true) state.pairing.cancel();
    return { redirect: "/pairing" };
  }

  async #remove(deviceId: string): Promise<PageReply> {
    const state = this.#access()?.state();
    if (state?.on !== true) return { redirect: "/" };
    try {
      await state.phones.remove(deviceId);
    } catch (error) {
      if (!(error instanceof JsonFileError || error instanceof PhonesError)) throw error;
      const body = html`<p>Couldn't remove the phone (${errorMessage(error)}).</p><p><a href="/">Back to the home</a></p>`;
      return { status: 500, body: page("Setup problem", body) };
    }
    return { redirect: "/" };
  }
}

/**
 * The Pair a phone page's body for the pairing session's `view`, with the QR code while one shows,
 * and how often the page reloads while it waits for the phone. Without `relayUrl` (no credential
 * file), a paired phone is told it reaches home only on home Wi-Fi.
 */
export function pairingBody(
  view: PairingView,
  qr: QrPayload | undefined,
  token: string,
  relayUrl = "",
): { body: Html; reload?: number } {
  const again = (label: string) => form("/pairing/start", token, label);
  const reload = settings.PAIRING_PAGE_RELOAD_SECONDS;
  switch (view.state) {
    case "none":
      return { body: html`<p>No code is showing.</p>${again("Pair a phone")}` };
    case "showing": {
      const svg =
        qr === undefined
          ? ""
          : html`<div class="qr">${trustedHtml(qrSvg(JSON.stringify(qr)))}</div>`;
      const body = html`<p>Scan this code with the Debbie app on the iPhone. It expires at ${view.expiresAt}.</p>
${svg}
<p>Phones reach this laptop at ${view.addrs.join(", ")}. ${FIREWALL_HINT}</p>
${form("/pairing/cancel", token, "Cancel")}`;
      return { body, reload };
    }
    case "pending": {
      const { name, role, code, pendingId } = view.phone;
      if (view.confirming) return { body: html`<p>Saving ${name}…</p>`, reload };
      const body = html`<p>${name} wants to pair as ${roleWords(role)}.</p>
<div class="code"><h2>${code}</h2></div>
<p>Check that the iPhone shows the same 4 digits, then press Confirm.</p>
${form("/pairing/confirm", token, "Confirm", { pending_id: pendingId })}
${form("/pairing/cancel", token, "Cancel")}`;
      return { body };
    }
    case "confirmed": {
      const { name, role } = view.phone;
      if (!view.collected && view.collecting) {
        return { body: html`<p>Waiting for ${name} to collect its keys.</p>`, reload };
      }
      if (!view.collected) {
        const body = html`<p>${name} didn't collect its keys. If it doesn't show as paired, remove it on the home page and pair it again.</p>${again("Pair another phone")}`;
        return { body };
      }
      const remote = relayUrl === "" ? html`<p>${REMOTE_NOT_SET_UP}</p>` : "";
      const body = html`<p>${name} is paired as ${roleWords(role)}.</p>${remote}${again("Pair another phone")}`;
      return { body };
    }
    case "expired":
      return { body: html`<p>This code expired.</p>${again("Show a new code")}` };
    case "cancelled":
      return { body: html`<p>Pairing was cancelled.</p>${again("Show a new code")}` };
  }
}
