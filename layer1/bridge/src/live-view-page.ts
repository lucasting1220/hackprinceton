/**
 * The Live view section of "Home created": the resident's consent and the switch that changes it,
 * on the coordinator laptop's setup page only. No scripts: the switch is a form with the page's
 * per-run token, like every other form on the page.
 */
import { type Html, html } from "./html.ts";
import { JsonFileError } from "./json-file.ts";
import type { LiveViewConsent } from "./live-view-consent.ts";
import type { PageReply, PageRoute } from "./setup-server.ts";

export class LiveViewPage {
  readonly #consent: () => LiveViewConsent | undefined;
  readonly #token: string;

  /** `consent` gives the setting once the home is ready; `token` is the page's per-run token. */
  constructor(consent: () => LiveViewConsent | undefined, token: string) {
    this.#consent = consent;
    this.#token = token;
  }

  /** The Live view section: whether it is on, why it can't be read, and the switch. */
  section(): Html {
    const heading = html`<h2>Live view</h2>`;
    const consent = this.#consent();
    if (consent === undefined) {
      return html`${heading}<p>Live view is off: the home isn't ready; restart the bridge.</p>`;
    }
    const on = consent.enabled();
    const state = on
      ? html`<p>Live view is on: a caregiver can watch the camera for up to 5 minutes at a time.</p>`
      : html`<p>Live view is off. Turn it on only when the resident agrees.</p>`;
    const problem = consent.problem();
    const notice = problem === undefined ? "" : html`<p>Live view setting: ${problem}.</p>`;
    const next = on ? "off" : "on";
    const button = html`<form method="post" action="/live-view"><input type="hidden" name="token" value="${this.#token}"><input type="hidden" name="enabled" value="${next}"><button>Turn live view ${next}</button></form>`;
    return html`${heading}${state}${notice}${button}`;
  }

  /** POST /live-view, behind the form guard. */
  routes(): PageRoute[] {
    return [
      {
        method: "POST",
        path: "/live-view",
        guard: "form",
        handle: (fields) => this.#change(fields.get("enabled") ?? ""),
      },
    ];
  }

  async #change(value: string): Promise<PageReply> {
    const consent = this.#consent();
    if (consent === undefined || (value !== "on" && value !== "off")) return { redirect: "/" };
    try {
      await consent.set(value === "on", { by: "setup_page" });
    } catch (error) {
      if (!(error instanceof JsonFileError)) throw error;
      // set() logged the failure and kept the old value; the section shows its problem().
      return { redirect: "/" };
    }
    return { redirect: "/" };
  }
}
