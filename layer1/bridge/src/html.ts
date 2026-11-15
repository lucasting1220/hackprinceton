/**
 * The setup page's HTML, in one place: every value placed in a template is escaped, unless it is
 * already Html made by the template itself (or the QR code's SVG, through trustedHtml).
 */

/** Markup that is safe to place as it is. */
export class Html {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

export const escapeHtml = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A value as markup: Html as it is, a list piece by piece, anything else escaped. */
function place(value: unknown): string {
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(place).join("");
  return escapeHtml(value);
}

/** A template in which every value placed is escaped, unless it is Html. */
export function html(parts: TemplateStringsArray, ...values: unknown[]): Html {
  return new Html(parts.reduce((done, part, index) => done + place(values[index - 1]) + part));
}

/** Markup made by the bridge's own code, never from a request: only the QR code's SVG. */
export const trustedHtml = (text: string) => new Html(text);

/** Where every page loads its stylesheet from; the CSP allows styles from this page only. */
export const STYLE_PATH = "/setup.css";

/** How a page is laid out besides its title and body. */
export interface PageLayout {
  /** Shown under the title, beside the laptop drawing. */
  readonly lead?: Html;
  /** The body is panels side by side, as on Layer 2's dashboard, instead of one card. */
  readonly grid?: boolean;
  /** The sidebar tab the page belongs to; Set up by default. */
  readonly active?: "setup" | "devices";
}

/** The sidebar icons, drawn as on Layer 2's dashboard. */
const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SETUP_ICON = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M12 8 V16 M8 12 H16"/></svg>`;
const DEVICES_ICON = `<svg ${ICON_ATTRS}><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5 H13"/></svg>`;
const DASHBOARD_ICON = `<svg ${ICON_ATTRS}><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>`;

/** The laptop drawn beside each page's title, the same as on Layer 2's dashboard. */
const MACHINE = `<svg viewBox="0 0 200 130" class="machine" aria-hidden="true"><defs><linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e8e93"/><stop offset="1" stop-color="#48484a"/></linearGradient></defs><rect x="30" y="8" width="140" height="92" rx="7" fill="url(#metal)"/><rect x="37" y="15" width="126" height="78" rx="3" fill="#0b1a2e"/><path d="M8 104 H192 L184 118 Q182 121 177 121 H23 Q18 121 16 118 Z" fill="url(#metal)"/><rect x="86" y="104" width="28" height="4" rx="2" fill="#3a3a3c"/></svg>`;

function sidebar(active: PageLayout["active"] = "setup"): string {
  const on = (tab: PageLayout["active"]) => (tab === active ? ' class="on"' : "");
  return `<nav><div class="brand">Debbie</div>
<div class="group">Home</div>
<a href="/"${on("setup")}>${SETUP_ICON}<span>Set up</span></a>
<a href="/devices"${on("devices")}>${DEVICES_ICON}<span>Devices</span></a>
</nav>`;
}

/** `pageText` with a sidebar link to Layer 2's dashboard at `dashboard`, once a home exists. */
export function withDashboardLink(pageText: string, dashboard: string): string {
  const link = `<a href="${escapeHtml(dashboard)}">${DASHBOARD_ICON}<span>Dashboard</span></a>\n</nav>`;
  return pageText.replace("\n</nav>", () => `\n${link}`);
}

/**
 * A whole page titled `title`, laid out like Layer 2's dashboard: a sidebar, then the title beside
 * a laptop drawing, then the body. With `reloadSeconds`, the browser reloads it that often.
 */
export function page(
  title: string,
  body: Html,
  reloadSeconds?: number,
  layout: PageLayout = {},
): string {
  const reload =
    reloadSeconds === undefined ? "" : `<meta http-equiv="refresh" content="${reloadSeconds}">`;
  const lead = layout.lead?.text ?? "";
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${reload}
<title>Debbie: ${escapeHtml(title)}</title><link rel="stylesheet" href="${STYLE_PATH}">
<body>${sidebar(layout.active)}
<main><header class="hero">${MACHINE}<div class="hero-text"><h1>${escapeHtml(title)}</h1>
${lead}</div></header>
<div class="${layout.grid === true ? "grid" : "card"}">
${body.text}
</div></main></body>
</html>
`;
}
