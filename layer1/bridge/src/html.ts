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

/** The sidebar's icons, exactly as contracts/sidebar.json gives them. */
export const ICON_SVG_ATTRIBUTES =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const ICONS = {
  overview:
    '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  setup: '<circle cx="12" cy="12" r="9"/><path d="M12 8 V16 M8 12 H16"/>',
  devices: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5 H13"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19 H22"/>',
} as const;
const icon = (name: keyof typeof ICONS) => `<svg ${ICON_SVG_ATTRIBUTES}>${ICONS[name]}</svg>`;

/** One sidebar item (contracts/sidebar.json): `page` is the program that serves `path`. */
export type SidebarItem = Readonly<{
  id: "overview" | "setup" | "devices";
  label: string;
  page: "dashboard" | "setup";
  path: string;
  icon: keyof typeof ICONS;
  homeLaptopOnly: boolean;
}>;

/** The Home group, in the contract's order. */
export const HOME_ITEMS: readonly SidebarItem[] = [
  {
    id: "overview",
    label: "Overview",
    page: "dashboard",
    path: "/#overview",
    icon: "overview",
    homeLaptopOnly: true,
  },
  { id: "setup", label: "Set up", page: "setup", path: "/", icon: "setup", homeLaptopOnly: false },
  {
    id: "devices",
    label: "Devices",
    page: "setup",
    path: "/devices",
    icon: "devices",
    homeLaptopOnly: false,
  },
];

/** A laptop in the Laptops group: its node ID and display name, from accepted-workers.json. */
export type SidebarLaptop = Readonly<{ nodeId: string; displayName: string }>;

/** What only the home laptop's sidebar has: the dashboard's origin and the laptops. */
export type HomeSidebar = Readonly<{ dashboard: string; laptops: readonly SidebarLaptop[] }>;

/** Plain code-point order, as contracts/sidebar.json sorts the Laptops group. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const step = (x[i] ?? 0) - (y[i] ?? 0);
    if (step !== 0) return step;
  }
  return x.length - y.length;
}

/** The Laptops group's order: by display name, then node ID. */
export const sidebarOrder = (a: SidebarLaptop, b: SidebarLaptop) =>
  byCodePoint(a.displayName, b.displayName) || byCodePoint(a.nodeId, b.nodeId);

/** The laptop drawn beside each page's title, the same as on Layer 2's dashboard. */
const MACHINE = `<svg viewBox="0 0 200 130" class="machine" aria-hidden="true"><defs><linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e8e93"/><stop offset="1" stop-color="#48484a"/></linearGradient></defs><rect x="30" y="8" width="140" height="92" rx="7" fill="url(#metal)"/><rect x="37" y="15" width="126" height="78" rx="3" fill="#0b1a2e"/><path d="M8 104 H192 L184 118 Q182 121 177 121 H23 Q18 121 16 118 Z" fill="url(#metal)"/><rect x="86" y="104" width="28" height="4" rx="2" fill="#3a3a3c"/></svg>`;

/** The sidebar shared with Layer 2's dashboard; Overview and Laptops only with `home`. */
export function sidebar(active: PageLayout["active"] = "setup", home?: HomeSidebar): string {
  const lines = [
    `<nav data-active="${active}"><div class="brand">Debbie</div>`,
    '<div class="group">Home</div>',
  ];
  for (const item of HOME_ITEMS) {
    if (item.page === "dashboard" && home === undefined) continue;
    const href = item.page === "dashboard" ? `${home?.dashboard ?? ""}${item.path}` : item.path;
    const on = item.id === active ? ' class="on"' : "";
    lines.push(
      `<a href="${escapeHtml(href)}" id="nav-${item.id}"${on}>${icon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`,
    );
  }
  if (home !== undefined) {
    lines.push('<div class="group">Laptops</div>');
    for (const laptop of [...home.laptops].sort(sidebarOrder)) {
      const href = `${home.dashboard}/#${encodeURIComponent(laptop.nodeId)}`;
      lines.push(
        `<a href="${escapeHtml(href)}">${icon("laptop")}<span>${escapeHtml(laptop.displayName)}</span></a>`,
      );
    }
  }
  lines.push("</nav>");
  return lines.join("\n");
}

/** The start of the sidebar that page() draws, naming its highlighted item. */
const NAV_START = /<body><nav data-active="(setup|devices)">/;

/** `pageText` with the home laptop's sidebar in place of the page's own, once a home exists. */
export function withHomeSidebar(pageText: string, home: HomeSidebar): string {
  const found = NAV_START.exec(pageText);
  const end = found === null ? -1 : pageText.indexOf("</nav>", found.index);
  if (found === null || end === -1) return pageText;
  const active = found[1] === "devices" ? "devices" : "setup";
  const before = pageText.slice(0, found.index);
  return `${before}<body>${sidebar(active, home)}${pageText.slice(end + "</nav>".length)}`;
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
