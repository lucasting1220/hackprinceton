/**
 * Hub socket test fixtures: a relay with its phone API and hub socket on one 127.0.0.1 port 0
 * server, wired as the relay's main program wires them, and a fake hub on a real WebSocket.
 */
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
import { credentialHash, seal, toBase64url } from "../bridge/src/phone-crypto.ts";
import { HUB_PATH } from "../bridge/src/relay-protocol.ts";
import { HUB_CREDENTIAL_BYTES } from "../bridge/src/settings.ts";
import { utcSeconds, type Wrapper } from "../bridge/src/wire.ts";
import { createHubSocket, type HubSocket, type HubSocketOptions } from "../relay/src/hub-socket.ts";
import { createPhoneApi } from "../relay/src/phone-api.ts";
import { RelayStore } from "../relay/src/store.ts";
import { type TestPhone, type TestRelay, tempDir, testConfig } from "./relay-fixtures.ts";

/** How long a test waits for a frame, a close or a connection. */
const WAIT_MS = 3_000;

export interface HubRelay extends TestRelay {
  /** The hub socket now running; restart() replaces it. */
  readonly hub: HubSocket;
  readonly hubUrl: string;
  readonly hubCredential: string;
  /** Each onContact call, by home. */
  readonly contacts: string[];
  /** Each onStored call: home and msg_id. */
  readonly stored: Array<readonly [string, string]>;
  /** Stops the hub socket and the server, then serves again on the same port with the same store. */
  restart(): Promise<void>;
}

/** A relay holding one home with a hub credential and `phones`; everything closes with the test. */
export async function startHubRelay(
  t: TestContext,
  phones: readonly TestPhone[] = [],
  options: Partial<Omit<HubSocketOptions, "store" | "log">> = {},
): Promise<HubRelay> {
  const store = RelayStore.open(":memory:");
  const config = testConfig(await tempDir(t));
  const homeId = randomUUID();
  const hubCredential = toBase64url(randomBytes(HUB_CREDENTIAL_BYTES));
  store.createHome(homeId, credentialHash(hubCredential), Date.now());
  store.syncDevices(
    homeId,
    phones.map((phone) => phone.entry()),
    Date.now(),
  );
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const contacts: string[] = [];
  const stored: Array<readonly [string, string]> = [];
  const serve = async (port: number) => {
    const hub = createHubSocket({
      onContact: (home, atMs) => {
        contacts.push(home);
        store.recordContact(home, atMs);
      },
      onStored: (home, wrapper) => stored.push([home, wrapper.msg_id]),
      ...options,
      store,
      log,
    });
    const server = createPhoneApi({
      store,
      config,
      log,
      commands: hub,
      onUnpair: (home, deviceId) => hub.phoneUnpaired(home, deviceId),
    });
    server.on("upgrade", (request, socket, head) => hub.handleUpgrade(request, socket, head));
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    const stop = async () => {
      hub.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    };
    return { hub, stop, port: (server.address() as AddressInfo).port };
  };
  let running = await serve(0);
  const { port } = running;
  t.after(async () => {
    await running.stop();
    store.close();
  });
  return {
    store,
    config,
    url: `http://127.0.0.1:${port}`,
    hubUrl: `ws://127.0.0.1:${port}${HUB_PATH}`,
    logs,
    homeId,
    get hub() {
      return running.hub;
    },
    hubCredential,
    contacts,
    stored,
    async restart() {
      await running.stop();
      running = await serve(port);
    },
  };
}

type Frame = Readonly<{ type: unknown; [field: string]: unknown }>;

/** Rejects after WAIT_MS, naming what was awaited. */
function within<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no ${what} within ${WAIT_MS} ms`)), WAIT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A hub on a real WebSocket: it records each frame the relay sends and sends what a test says. */
export class FakeHub {
  readonly ws: WebSocket;
  readonly #frames: Frame[] = [];
  readonly #waiting: Array<(frame: Frame) => void> = [];
  readonly #closed: Promise<number>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.#closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    ws.on("message", (data) => {
      const frame: unknown = JSON.parse(data.toString());
      if (typeof frame !== "object" || frame === null || !("type" in frame)) {
        throw new Error("not a frame");
      }
      const waiter = this.#waiting.shift();
      if (waiter === undefined) this.#frames.push({ ...frame });
      else waiter({ ...frame });
    });
  }

  /** Connects with the relay's hub credential (or `credential`) and waits for the connection. */
  static async connect(
    relay: HubRelay,
    { credential = relay.hubCredential, autoPong = true } = {},
  ): Promise<FakeHub> {
    const ws = new WebSocket(relay.hubUrl, {
      headers: { Authorization: `Bearer ${credential}` },
      autoPong,
      handshakeTimeout: WAIT_MS,
    });
    const hub = new FakeHub(ws);
    await within("connection", once(ws, "open"));
    return hub;
  }

  /** The next frame the relay sent. */
  next(): Promise<Frame> {
    const frame = this.#frames.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    return within("frame", new Promise((resolve) => this.#waiting.push(resolve)));
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** The close code, once the connection ends. */
  closed(): Promise<number> {
    return within("close", this.#closed);
  }
}

/** The HTTP status the relay answers a hub upgrade with, when it refuses one. */
export async function refusedUpgrade(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers, handshakeTimeout: WAIT_MS });
  const [, response] = await within("answer", once(ws, "unexpected-response"));
  if (!(response instanceof http.IncomingMessage)) return undefined;
  response.resume();
  return response.statusCode;
}

/** A command wrapper sealed with `phone`'s own key, as the app seals one (phone-hub.md §5.5). */
export function phoneCommand(
  phone: TestPhone,
  homeId: string,
  type: string,
  kid: string = phone.deviceId,
): Wrapper {
  const msgId = randomUUID();
  const sentAt = utcSeconds(new Date());
  const plaintext = Buffer.from(JSON.stringify({ msg_id: msgId, sent_at: sentAt, type }));
  const envelope = seal(plaintext, phone.key(), kid, { homeId, type });
  return { v: 1, msg_id: msgId, type, sent_at: sentAt, envelope };
}
