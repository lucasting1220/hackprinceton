import { once } from "node:events";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import os, { type NetworkInterfaceInfo } from "node:os";
import * as settings from "./settings.ts";

/** What a route answers: an HTTP status and a JSON object. */
export interface Reply {
  readonly status: number;
  readonly body: object;
}

/** A row of the route table. Later steps add POST /v1/pair, the LAN gateway and step 3's joins. */
export interface Route {
  readonly method: "GET" | "POST";
  /** The exact path: a request with a query string matches no route. */
  readonly path: string;
  /** Gets the JSON body (undefined for GET) and the address the request arrived on, "a.b.c.d:port". */
  readonly handle: (body: unknown, localAddress: string) => Reply | Promise<Reply>;
}

/** readJsonBody's result: the parsed body, or the error reply that refuses it. */
export type JsonBody =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reply: Reply };

export interface NetworkSide {
  readonly server: http.Server;
  /** The port it listens on: the one asked for, or the one the system chose for port 0. */
  readonly port: number;
  /** Stops listening and closes every connection. */
  close(): Promise<void>;
}

/** An error reply with phone-hub.md §1's body. The message is fixed and never repeats the request. */
export function errorReply(status: number, code: string, message: string): Reply {
  return { status, body: { v: 1, error: { code, message } } };
}

/** The refusals of the HTTP rules (phone-hub.md §4 and §4.6). */
const REFUSED = {
  notFound: errorReply(404, "not_found", "There is no such path."),
  method: errorReply(405, "method_not_allowed", "This path takes another method."),
  notJson: errorReply(415, "unsupported_media_type", "The body must be JSON."),
  tooLarge: errorReply(413, "too_large", "The body is too large."),
  badJson: errorReply(400, "bad_json", "The body isn't valid JSON."),
  internal: errorReply(500, "internal", "Something went wrong in the hub."),
};

const PRIVATE_IPV4 = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
const LINK_LOCAL_IPV4 = /^169\.254\./;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Starts the bridge's network side on every IPv4 interface: GET /v1/hello, which carries the hub
 * tag of `hubPublicKey` (base64url, as Home has it), and `routes`, under the HTTP rules of
 * phone-hub.md §4. It throws the system's error if it can't listen, such as EADDRINUSE.
 */
export async function startNetworkSide(
  hubPublicKey: string,
  routes: readonly Route[] = [],
  port = settings.BRIDGE_NETWORK_PORT,
): Promise<NetworkSide> {
  const hub = hubPublicKey.slice(0, settings.HUB_TAG_CHARS);
  const hello: Route = {
    method: "GET",
    path: "/v1/hello",
    handle: () => ({ status: 200, body: { v: 1, service: "debbie-bridge", hub } }),
  };
  const table = [hello, ...routes];
  const server = http.createServer(
    {
      headersTimeout: settings.JSON_REQUEST_HEADERS_TIMEOUT_MS,
      requestTimeout: settings.JSON_REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: settings.JSON_REQUEST_TIMEOUT_CHECK_MS,
    },
    (request, response) => {
      answer(table, request, response).catch((error: unknown) => {
        console.error(`L1 network-server: a request failed with ${errorClass(error)}`);
        if (!response.headersSent) send(response, REFUSED.internal);
      });
    },
  );
  server.listen(port, settings.BRIDGE_NETWORK_HOST);
  await once(server, "listening");
  // Without a listener, an error such as running out of file handles would end the bridge.
  server.on("error", (error) => {
    console.error(`L1 network-server: the server failed with ${errorClass(error)}`);
  });
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}

/**
 * Reads a request's body under the JSON request limits: application/json (else 415), at most
 * `maxBytes` (else 413) and valid JSON in UTF-8 (else 400 bad_json). The rest of a body over the
 * limit is read and dropped, so the sender gets the refusal rather than a reset connection. It
 * rejects if the request breaks off. Only the server's request time limit bounds the wait, so a
 * server that uses it must set the JSON request limits, as startNetworkSide does.
 */
export function readJsonBody(
  request: http.IncomingMessage,
  maxBytes: number = settings.JSON_REQUEST_MAX_BYTES,
): Promise<JsonBody> {
  const mediaType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return Promise.resolve(refused(REFUSED.notJson));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
      else resolve(refused(REFUSED.tooLarge));
    });
    request.on("end", () => {
      if (size <= maxBytes) resolve(parsed(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

/** What lanAddresses reads of each entry in os.networkInterfaces(). */
type InterfaceAddress = Pick<NetworkInterfaceInfo, "address" | "family" | "internal">;

/**
 * The addresses phones reach this laptop at, for the pairing QR code: each non-internal IPv4
 * address as "a.b.c.d:port", private ranges first and link-local after, at most LAN_ADDRESSES_MAX.
 * The app refuses plain HTTP to any other address, so the rest are left out (phone-hub.md §2.1).
 */
export function lanAddresses(
  port = settings.BRIDGE_NETWORK_PORT,
  interfaces: NodeJS.Dict<readonly InterfaceAddress[]> = os.networkInterfaces(),
): string[] {
  const ipv4 = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  const ordered = [
    ...ipv4.filter((address) => PRIVATE_IPV4.test(address)),
    ...ipv4.filter((address) => LINK_LOCAL_IPV4.test(address)),
  ];
  return ordered.slice(0, settings.LAN_ADDRESSES_MAX).map((address) => `${address}:${port}`);
}

/** Answers one request through the route table, checking the HTTP rules in the contract's order. */
async function answer(table: Route[], req: http.IncomingMessage, res: http.ServerResponse) {
  const route = table.find((row) => row.path === req.url && row.method === req.method);
  if (route === undefined) {
    const allowed = table.filter((row) => row.path === req.url).map((row) => row.method);
    if (allowed.length === 0) send(res, REFUSED.notFound);
    else send(res, REFUSED.method, { Allow: allowed.join(", ") });
    return;
  }
  const { localAddress, localPort } = req.socket;
  if (localAddress === undefined || localPort === undefined) throw new Error("connection closed");
  const read = route.method === "POST" ? await readJsonBody(req) : undefined;
  if (read?.ok === false) return send(res, read.reply);
  send(res, await route.handle(read?.value, `${localAddress}:${localPort}`));
}

/** Sends a reply as JSON that no cache keeps. The network side never sends CORS headers. */
function send(response: http.ServerResponse, reply: Reply, headers: http.OutgoingHttpHeaders = {}) {
  const text = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    ...headers,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function parsed(bytes: Buffer): JsonBody {
  try {
    return { ok: true, value: JSON.parse(utf8.decode(bytes)) };
  } catch {
    return refused(REFUSED.badJson);
  }
}

const refused = (reply: Reply): JsonBody => ({ ok: false, reply });

/** The class of what was thrown: all a log line says of a failed request, never the request. */
const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
