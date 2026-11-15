/** A browser on the setup page, for tests: its Host and Origin, its token and its forms. */
import { type IncomingMessage, request } from "node:http";
import { text } from "node:stream/consumers";

export type PageAnswer = IncomingMessage & { page: string };

const CLIENT_TIMEOUT_MS = 5_000;

export function pageClient(url: string) {
  const { port } = new URL(url);
  const browser = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
  /** Sends a request as the browser would from the setup page, with `headers` changed. */
  const send = (method: string, target: string, headers = {}, body = "") =>
    new Promise<PageAnswer>((resolve, reject) => {
      const options = { host: "127.0.0.1", port, method, path: target, timeout: CLIENT_TIMEOUT_MS };
      const form = { "content-type": "application/x-www-form-urlencoded" };
      const sent = request(
        { ...options, headers: { ...browser, ...form, ...headers } },
        (reply) => {
          text(reply).then((page) => resolve(Object.assign(reply, { page })), reject);
        },
      );
      sent.on("timeout", () => sent.destroy(new Error("no answer"))).on("error", reject);
      sent.end(body);
    });
  const get = (target: string) => send("GET", target);
  /** The page's per-run token, from its first form. */
  const token = async () =>
    /name="token" value="([^"]+)"/.exec((await get("/")).page)?.[1] ?? "no token on the page";
  /** Posts a form with the page's token and `fields`, as pressing its button does. */
  const post = async (target: string, fields: Record<string, string> = {}, headers = {}) => {
    const body = new URLSearchParams({ token: await token(), ...fields }).toString();
    return send("POST", target, headers, body);
  };
  return { send, get, token, post };
}
