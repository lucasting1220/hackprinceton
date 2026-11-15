import { renderSVG } from "uqr";
import { QR_BORDER_MODULES, QR_DISPLAY_PX, QR_ERROR_CORRECTION } from "./settings.ts";

/**
 * Draws `payload` as a QR code in inline SVG, as contracts/phone-hub.md §2.1 has it: its UTF-8
 * bytes in byte mode, at error correction level M, with a 4-module light border. The SVG is one
 * white rect and one black path that set only fill attributes, so a page shows it with no style
 * attribute and no script. The payload appears only as dark squares, never as text, so a secret
 * in it stays out of the page's text.
 */
export function qrSvg(payload: string): string {
  // uqr keeps an array of bytes in byte mode, but may draw a string in a smaller mode.
  const svg = renderSVG([...Buffer.from(payload, "utf8")], {
    ecc: QR_ERROR_CORRECTION,
    border: QR_BORDER_MODULES,
  });
  // uqr's SVG has only a viewBox, so a page would stretch it to its full width, too big for a phone
  // camera to frame. Plain width and height attributes size it; the page's CSP allows no style.
  return svg.replace("<svg ", `<svg width="${QR_DISPLAY_PX}" height="${QR_DISPLAY_PX}" `);
}
