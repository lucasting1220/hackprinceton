/**
 * The setup page's Devices tab: what is connected to this laptop, read only. On the home laptop,
 * its paired phones and the laptops that joined it; on a laptop that joined a home, its link to the
 * home laptop and its camera and mic. Every value is escaped through html.ts, and no key, token or
 * credential reaches the page. Changing anything stays on the Set up tab's pages.
 */
import { type Html, html, page } from "./html.ts";
import type { LaptopView } from "./laptop.ts";
import type { PhoneAccess } from "./phone-access.ts";

const TITLE = "Devices";

/** What the Devices tab is shown for: the home laptop, a laptop that joined, or neither yet. */
export type DevicesFor =
  | { readonly kind: "home"; readonly access: PhoneAccess | undefined }
  | { readonly kind: "laptop"; readonly view: LaptopView }
  | { readonly kind: "none" };

/** One device: a status dot, its name, and what is known about it. */
const device = (dot: string, name: string, about: Html | string) =>
  html`<div class="device"><span class="dot ${dot}"></span><div class="device-text"><div>${name}</div><div class="muted">${about}</div></div></div>`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function homeDevices(access: PhoneAccess | undefined): { lead: Html; body: Html } {
  const state = access?.state();
  if (access === undefined || state?.on !== true) {
    const why = state === undefined || state.on ? "the network side isn't running" : state.reason;
    const body = html`<section class="panel"><h2>Phones and laptops</h2><p class="muted">No device can connect: ${why}.</p></section>`;
    return { lead: html`<div class="sub">Nothing can connect right now</div>`, body };
  }
  const phones = state.phones.list();
  const phoneRows =
    phones.length === 0
      ? html`<p class="muted">No phones are paired yet. Pair one from Set up.</p>`
      : phones.map((phone) => device("ok", phone.name, `${phone.role}, paired ${phone.pairedAt}`));
  const { joins } = state.join.listing();
  const names = new Map(
    joins.flatMap((join) => (join.nodeId === null ? [] : [[join.nodeId, join.name]])),
  );
  const linked = [...state.link.linked().values()];
  const linkedIds = new Set(linked.map((laptop) => laptop.nodeId));
  const laptopRows = linked.map((laptop) =>
    device(
      laptop.state === "connected" ? "ok" : "off",
      names.get(laptop.nodeId) ?? "Laptop",
      html`node <code>${laptop.nodeId}</code>, ${laptop.state.replace("_", " ")}, reported ${laptop.reportedAt}`,
    ),
  );
  const waitingRows = joins
    .filter((join) => join.nodeId === null || !linkedIds.has(join.nodeId))
    .map((join) =>
      device(join.state === "approved" ? "wait" : "", join.name, `joining: ${join.state}`),
    );
  const laptops =
    laptopRows.length + waitingRows.length === 0
      ? html`<p class="muted">No laptops have joined yet. Add one from Set up.</p>`
      : html`${laptopRows}${waitingRows}`;
  const lead = html`<div class="sub">${count(phones.length, "phone", "phones")} and ${count(linked.length, "laptop", "laptops")} connected to this home</div>`;
  const body = html`<section class="panel"><h2>Phones</h2>${phoneRows}</section>
<section class="panel"><h2>Laptops</h2>${laptops}</section>`;
  return { lead, body };
}

function laptopDevices(view: LaptopView): { lead: Html; body: Html } {
  if (view.step !== "joined") {
    const body = html`<section class="panel"><h2>Home laptop</h2><p class="muted">This laptop is still joining a home. <a href="/join">See how far it got</a></p></section>`;
    return { lead: html`<div class="sub">Not connected yet</div>`, body };
  }
  const linked = view.link === "connected" && !view.rejected;
  const home = device(
    linked ? "ok" : "off",
    view.homeAddress,
    `link: ${view.rejected ? "rejected" : view.link}`,
  );
  const camera = device(
    view.sensors.camera === null ? "" : "ok",
    "Camera",
    view.sensors.camera ?? "none",
  );
  const mic = device(view.sensors.mic === null ? "" : "ok", "Mic", view.sensors.mic ?? "none");
  const body = html`<section class="panel"><h2>Home laptop</h2>${home}</section>
<section class="panel"><h2>Camera and mic</h2>${camera}${mic}<p><a href="/join/sensors">Change the camera and mic</a></p></section>`;
  return { lead: html`<div class="sub">${view.name}, linked to the home laptop</div>`, body };
}

/** The Devices tab's page. */
export function devicesPage(shown: DevicesFor): string {
  const none = {
    lead: html`<div class="sub">Nothing is connected yet</div>`,
    body: html`<section class="panel"><h2>No devices</h2><p class="muted">Create a home or join one from Set up; its phones and laptops then show here.</p></section>`,
  };
  const { lead, body } =
    shown.kind === "home"
      ? homeDevices(shown.access)
      : shown.kind === "laptop"
        ? laptopDevices(shown.view)
        : none;
  return page(TITLE, body, undefined, { lead, grid: true, active: "devices" });
}
