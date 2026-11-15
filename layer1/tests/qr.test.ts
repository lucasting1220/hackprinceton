import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { encode } from "uqr";
import { qrSvg } from "../bridge/src/qr.ts";

// A pairing code's payload as contracts/phone-hub.md §2.1 lays it out: compact JSON, five fields.
const secret = Buffer.alloc(16, 0xa5).toString("base64url");
const payload = JSON.stringify({
  v: 1,
  addrs: ["192.168.1.20:7480", "10.0.0.5:7480"],
  hub_pub: Buffer.alloc(32, 0x5a).toString("base64url"),
  secret,
  exp: 1_794_669_600,
});

/** What an SVG from qrSvg draws: its width in modules, its squares and its dark modules. */
function drawing(svg: string): { size: number; squares: number; dark: Set<string> } {
  const [, width, height] = /^<svg [^>]*viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  const [, path] = /<path [^>]*\bd="([^"]*)"/.exec(svg) ?? [];
  assert.ok(width !== undefined && width === height && path !== undefined, "a square and a path");
  // One square per dark module, "M<x>,<y>h<side>v<side>h-<side>z", every one the same size.
  const squares = [...path.matchAll(/M(\d+),(\d+)h(\d+)v\3h-\3z/g)];
  assert.equal(squares.map(([square]) => square).join(""), path, "the path draws only squares");
  const side = Number(squares[0]?.[3]);
  const dark = new Set(
    squares.map(([, x, y, own]) => {
      assert.equal(Number(own), side);
      return `${Number(y) / side},${Number(x) / side}`;
    }),
  );
  return { size: Number(width) / side, squares: squares.length, dark };
}

/** A matrix's dark modules, as "row,column". */
function darkModules(matrix: readonly (readonly boolean[])[]): Set<string> {
  return new Set(
    matrix.flatMap((row, r) => row.flatMap((isDark, c) => (isDark ? [`${r},${c}`] : []))),
  );
}

describe("qrSvg", () => {
  test("draws one dark square per dark module of the level M matrix with a 4-module border", () => {
    const drawn = drawing(qrSvg(payload));
    const expected = encode(payload, { ecc: "M", border: 4 });
    assert.equal(drawn.size, expected.size);
    assert.deepEqual(drawn.dark, darkModules(expected.data));
    assert.equal(drawn.squares, drawn.dark.size, "a module is drawn more than once");
  });

  test("encodes the payload's bytes at the smallest version that holds them at level M", () => {
    // Byte mode holds 14 bytes in version 1 at level M, and 180 in version 9 (ISO/IEC 18004). At
    // level L 15 bytes fit version 1, at Q 14 bytes need version 2, and digits stay in byte mode.
    const cases: [string, number][] = [
      ["x".repeat(14), 1],
      ["x".repeat(15), 2],
      ["x".repeat(180), 9],
      ["x".repeat(181), 10],
      ["7".repeat(15), 2],
    ];
    for (const [text, version] of cases) {
      // A version v code is 17 + 4v modules wide, plus the border on each side.
      assert.equal(drawing(qrSvg(text)).size, 17 + 4 * version + 2 * 4, `${text.length} bytes`);
    }
  });

  test("is inline SVG with fill attributes only: no style attribute, no script, no payload", () => {
    const svg = qrSvg(payload);
    assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"), "not one svg element");
    const names = (pattern: RegExp) => new Set([...svg.matchAll(pattern)].map(([, name]) => name));
    assert.deepEqual(names(/<([A-Za-z][\w:-]*)/g), new Set(["svg", "rect", "path"]));
    assert.deepEqual(
      names(/\s([A-Za-z][\w:-]*)=/g),
      new Set(["xmlns", "viewBox", "fill", "width", "height", "d"]),
    );
    assert.ok(!svg.includes(secret), "the QR secret appears as text");
  });
});
