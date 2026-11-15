/**
 * A stand-in for Apple's push service: an HTTP/2 server on 127.0.0.1 with a self-signed
 * certificate made here, so no test reaches Apple. It records every request and answers each with
 * the next scripted reply (200 when none is left). Also: APNs keys made for the test, written
 * where the test relay.json names them; the real key is never read.
 */
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import type { ApnsConfig } from "../relay/src/config.ts";
import type { Environment } from "../relay/src/store.ts";

export interface RecordedRequest {
  readonly headers: http2.IncomingHttpHeaders;
  readonly body: string;
}

/** A scripted answer: a status with Apple's reason, or no answer at all. */
export type FakeReply = Readonly<{ status: number; reason?: string }> | "hang";

// A minimal DER encoder, enough for one self-signed P-256 certificate.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : body.length < 0x100
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

const sequence = (...parts: Buffer[]) => der(0x30, ...parts);

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) groups.unshift((value & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return der(0x17, Buffer.from(`${text}Z`, "ascii"));
}

const ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";

/** A self-signed certificate for 127.0.0.1 and localhost, valid for a day, and its key. */
function selfSigned(): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = sequence(der(0x31, sequence(oid("2.5.4.3"), der(0x0c, Buffer.from("fake apns")))));
  const now = Date.now();
  const altNames = sequence(
    der(0x82, Buffer.from("localhost")),
    der(0x87, Buffer.from([127, 0, 0, 1])),
  );
  const extensions = der(
    0xa3,
    sequence(
      sequence(
        oid("2.5.29.19"),
        der(0x01, Buffer.from([0xff])),
        der(0x04, sequence(der(0x01, Buffer.from([0xff])))),
      ),
      sequence(oid("2.5.29.17"), der(0x04, altNames)),
    ),
  );
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    sequence(oid(ECDSA_WITH_SHA256)),
    name,
    sequence(utcTime(new Date(now - 60_000)), utcTime(new Date(now + 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const signature = sign("sha256", tbs, privateKey);
  const cert = sequence(
    tbs,
    sequence(oid(ECDSA_WITH_SHA256)),
    der(0x03, Buffer.from([0]), signature),
  );
  const lines = cert.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export class FakeApns {
  readonly requests: RecordedRequest[] = [];
  readonly #replies: FakeReply[] = [];
  readonly #byToken = new Map<string, FakeReply>();
  readonly #server: http2.Http2SecureServer;
  readonly #ca: string;
  #port = 0;

  private constructor() {
    const { cert, key } = selfSigned();
    this.#ca = cert;
    this.#server = http2.createSecureServer({ cert, key }, (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        this.requests.push({
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        const path = String(request.headers[":path"]);
        const reply = this.#byToken.get(path.slice(path.lastIndexOf("/") + 1)) ??
          this.#replies.shift() ?? { status: 200 };
        if (reply === "hang") return;
        const apnsId = request.headers["apns-id"];
        if (typeof apnsId === "string") response.setHeader("apns-id", apnsId);
        if (reply.reason === undefined) {
          response.writeHead(reply.status).end();
        } else {
          response.writeHead(reply.status, { "content-type": "application/json" });
          response.end(JSON.stringify({ reason: reply.reason }));
        }
      });
    });
  }

  /** A fake APNs on 127.0.0.1 port 0, closed when the test ends. */
  static async start(t: TestContext): Promise<FakeApns> {
    const fake = new FakeApns();
    fake.#server.listen(0, "127.0.0.1");
    await once(fake.#server, "listening");
    fake.#port = (fake.#server.address() as AddressInfo).port;
    t.after(async () => {
      const closed = once(fake.#server, "close");
      fake.#server.close();
      for (const session of fake.#sessions) session.destroy();
      await closed;
    });
    fake.#server.on("session", (session) => fake.#sessions.add(session));
    return fake;
  }

  readonly #sessions = new Set<http2.ServerHttp2Session>();

  /** Both environments' origins, for ApnsClient's `origins`. */
  origins(): Record<Environment, string> {
    const origin = `https://127.0.0.1:${this.#port}`;
    return { production: origin, sandbox: origin };
  }

  /** TLS options that trust this fake's certificate, for ApnsClient's `tls`. */
  tls(): http2.SecureClientSessionOptions {
    return { ca: this.#ca };
  }

  /** The answer to every request for this device token, ahead of the scripted ones. */
  replyTo(token: string, reply: FakeReply): void {
    this.#byToken.set(token, reply);
  }

  /** The next requests' answers, in order. */
  reply(...replies: FakeReply[]): void {
    this.#replies.push(...replies);
  }
}

/** Test APNs keys, written as .p8 files at the paths `apns` names; returns their public keys. */
export async function writeTestKeys(apns: ApnsConfig): Promise<Record<Environment, KeyObject>> {
  const publicKeys: Partial<Record<Environment, KeyObject>> = {};
  for (const env of ["production", "sandbox"] as const) {
    const file = apns.keys[env]?.key_file;
    if (file === undefined) continue;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await writeFile(file, pem, { encoding: "utf8", mode: 0o600 });
    publicKeys[env] = publicKey;
  }
  const { production, sandbox } = publicKeys;
  if (production === undefined || sandbox === undefined) throw new Error("both keys are needed");
  return { production, sandbox };
}
