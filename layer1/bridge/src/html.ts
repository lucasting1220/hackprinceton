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

/** A whole page titled `title`; with `reloadSeconds`, the browser reloads it that often. */
export function page(title: string, body: Html, reloadSeconds?: number): string {
  const reload =
    reloadSeconds === undefined ? "" : `<meta http-equiv="refresh" content="${reloadSeconds}">`;
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">${reload}
<title>Debbie: ${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1>
${body.text}
</html>
`;
}
