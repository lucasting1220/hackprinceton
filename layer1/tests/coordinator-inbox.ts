/**
 * A fake of Layer 2's coordinator inbox on 127.0.0.1 (layer2/src/layer2/coordinator/inbox.py), for
 * tests: POST /v1/requests and POST /v1/watch-data, each answered with the status a test sets (202
 * once handed to a worker, 503 when no job takes it), or never, to test the bridge's time limit.
 */
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import type { TestContext } from "node:test";

export type Received = Readonly<{ path: string; host: string; body: unknown }>;

export async function startCoordinatorInbox(t: TestContext) {
  const received: Received[] = [];
  const state: { status: number | "never" } = { status: 202 };
  const held: ServerResponse[] = [];
  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    const raw = await text(request);
    received.push({
      path: request.url ?? "",
      host: request.headers.host ?? "",
      body: JSON.parse(raw),
    });
    if (state.status === "never") {
      held.push(response);
      return;
    }
    const body = state.status === 202 ? { accepted: true } : { error: "no job" };
    response.writeHead(state.status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      response.writeHead(400).end(String(error));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  };
  t.after(close);
  return { port, received, state, held, close };
}
