import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import { AlertIntake, type HomeAlerts } from "./alert-intake.ts";
import type { CreateHomeOptions, Home } from "./home.ts";
import { createHome, HomeError, HomeExistsError, loadHome } from "./home.ts";
import { HandoffIntake } from "./handoff-intake.ts";
import { type Html, html, page } from "./html.ts";
import { JoinPage, laptopsSection } from "./join-page.ts";
import { errorMessage } from "./json-file.ts";
import { Laptop, type LaptopOptions } from "./laptop.ts";
import { CoordinatorLauncher, type CoordinatorStatus } from "./launcher.ts";
import { readJsonBody } from "./network-server.ts";
import type { PhoneAccess } from "./phone-access.ts";
import { PairingPage } from "./pairing-page.ts";
import * as settings from "./settings.ts";
import path from "node:path";

/** Sent with every response: nothing is loaded from elsewhere, cached, framed or kept open. */
const HEADERS = {
  "cache-control": "no-store",
  connection: "close",
  "content-security-policy":
    "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  // Not no-referrer: under it, Chrome and Firefox send this page's own form with "Origin: null".
  "referrer-policy": "same-origin",
};

export interface SetupServerOptions {
  readonly stateDir: string;
  /** The repository whose coordinator, or its stub, the launcher runs. */
  readonly repoRoot: string;
  /** settings.BRIDGE_LOCAL_PORT by default; tests pass 0, for a free port. */
  readonly port?: number;
  /** What createHome is given; tests pass free ports. */
  readonly homeOptions?: CreateHomeOptions;
  /** Gets the server's and the launcher's lines; console.log by default. */
  readonly log?: (line: string) => void;
  /** Runs once a home exists, after the coordinator starts: main.ts's home-ready hook. */
  readonly onHomeReady?: (home: Home) => Promise<void>;
  /** The phone side once the home is ready, for the Pair a phone page and the Phones section. */
  readonly phoneAccess?: () => PhoneAccess | undefined;
  /** The home's alerts once the home is ready, for POST /v1/alerts (step 4) and the handoff's. */
  readonly homeAlerts?: () => HomeAlerts | undefined;
  /** What a joining laptop is given besides the state folder and repository; tests shorten waits. */
  readonly laptop?: Omit<LaptopOptions, "stateDir" | "repoRoot">;
  /** The words after "Remote access: " (step 5's relay link); "not set up" without it. */
  readonly remoteAccess?: () => string;
}

/** A page route's answer: a page with its status, or a 303 to `redirect`. */
export type PageReply =
  | { readonly status: number; readonly body: string }
  | { readonly redirect: string }
  | MachineReply;

/** A machine route's answer: JSON, never a page. */
export type MachineReply = { readonly status: number; readonly json: object };

/**
 * A row of the setup page's route table. Every route checks the Host; a "form" route also checks
 * the Origin, the body's size and the per-run token, and gets the form's fields. A "machine" route,
 * for programs on this laptop such as Layer 2's coordinator, refuses any Origin (a browser sends one
 * with every POST), takes only JSON under the JSON request limits and gets the parsed body; other
 * methods on its path get 405, and no route sends an Access-Control header.
 */
export type PageRoute =
  | {
      readonly method: "GET" | "POST";
      readonly path: string;
      readonly guard: "view" | "form";
      readonly handle: (fields: URLSearchParams) => Promise<PageReply>;
    }
  | {
      readonly method: "POST";
      readonly path: string;
      readonly guard: "machine";
      readonly handle: (body: unknown) => Promise<MachineReply>;
    };

/** A machine route's refusal: its reason is a fixed code, never a value from the request. */
const machineRefusal = (status: number, reason: string): MachineReply => ({
  status,
  json: { type: "rejected", schema_version: 1, reason },
});

/** The machine guard: no Origin, then readJsonBody's JSON, size and parse rules. */
async function machineBody(request: IncomingMessage): Promise<MachineReply | { body: unknown }> {
  if (request.headers.origin !== undefined) return machineRefusal(403, "origin_not_allowed");
  const read = await readJsonBody(request);
  if (read.ok) return { body: read.value };
  const error: unknown = Reflect.get(read.reply.body, "error");
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : "";
  return machineRefusal(read.reply.status, String(code));
}

const welcomePage = (token: string) =>
  page(
    "Welcome",
    html`<form method="post" action="/home">
<input type="hidden" name="token" value="${token}"><button>Create a home</button></form>
<p><a href="/join">Join a home</a>: add this laptop to a home that another laptop created.</p>`,
  );
const problemPage = (message: string) => page("Setup problem", html`<p>${message}</p>`);
const RELOAD_PAGE = page(
  "Reload this page",
  html`<p>This page came from an earlier run of the bridge.
<a href="/">Reload it</a>, then try again.</p>`,
);
/** Only a home that the bridge found after it started (its files repaired, say) has none. */
const NOT_STARTED = "not started; restart the bridge to start it";

/** The home, its coordinator's state and latest failure (A2), its phones and alerts, and its laptops. */
function homePage(
  home: Home,
  status: CoordinatorStatus | undefined,
  sections: Html,
  laptops: Html,
  remote = "not set up",
): string {
  const dashboard = `http://${settings.LOCAL_HOST}:${home.dashboardPort}/`;
  const stub = status?.program === "stub" ? "STUB (Layer 2's coordinator isn't built yet), " : "";
  const state = status?.state === "restarting" ? "restarting after a crash" : status?.state;
  const why = status?.lastErrorLine ? `; last error: ${status.lastErrorLine}` : "";
  return page(
    "Home created",
    html`<p>Home ID: <code>${home.homeId}</code></p>
<p>Remote access: ${remote}</p>
<p>Coordinator: ${stub}${(state ?? NOT_STARTED).replace("_", " ")}${why}</p>
<p>Dashboard: <a href="${dashboard}">${dashboard}</a></p>
${sections}
${laptops}`,
  );
}

/** Serves the setup page on 127.0.0.1 (R2, D4, D7), or rejects if its port is in use. */
export async function startSetupServer(options: SetupServerOptions) {
  const { stateDir, repoRoot, homeOptions, port = settings.BRIDGE_LOCAL_PORT } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const token = randomBytes(settings.SETUP_TOKEN_BYTES).toString("base64url");
  const server = createServer({
    requestTimeout: settings.SETUP_REQUEST_TIMEOUT_MS,
    // The machine route reads JSON with readJsonBody, which needs the JSON request limits.
    headersTimeout: settings.JSON_REQUEST_HEADERS_TIMEOUT_MS,
    connectionsCheckingInterval: settings.JSON_REQUEST_TIMEOUT_CHECK_MS,
  });
  try {
    await once(server.listen(port, settings.LOCAL_HOST), "listening");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) throw error;
    const taken = `${settings.LOCAL_HOST}:${port} is in use, probably by another bridge`;
    throw new Error(`${taken}: stop it, then start again`, { cause: error });
  }
  const { address, port: bound } = server.address() as AddressInfo;
  const bridgeUrl = `http://${address}:${bound}`; // coordinator.json's bridge_url
  const url = `${bridgeUrl}/`;
  const hosts: string[] = settings.SETUP_HOST_NAMES.map((name) => `${name}:${bound}`);
  const origins = hosts.map((host) => `http://${host}`);
  const pairingPage = new PairingPage(options.phoneAccess ?? (() => undefined), token);
  const alerts = new AlertIntake({ ready: options.homeAlerts ?? (() => undefined), log });
  const handoff = new HandoffIntake({ ready: options.homeAlerts ?? (() => undefined), log });
  const homeSections = () =>
    html`${pairingPage.phonesSection()}${alerts.section()}${handoff.section()}`;
  let launcher: CoordinatorLauncher | undefined;
  let closed = false;
  // Add a laptop (step 3). The role lock (A4): a laptop joining a home can't create one, and the
  // home laptop, or one creating its home, can't join one.
  const laptop = new Laptop({ log, ...options.laptop, stateDir, repoRoot });
  let creating = false;
  const roleTaken = () =>
    creating || existsSync(path.join(stateDir, settings.STATE_NAMES.home))
      ? "This laptop is already the home laptop, so it can't join another home."
      : undefined;
  const joinPage = new JoinPage(laptop, token, roleTaken);
  const homeView = (home: Home) =>
    homePage(
      home,
      launcher?.status(),
      homeSections(),
      laptopsSection(options.phoneAccess?.(), home.hubPublicKey),
      options.remoteAccess?.(),
    );

  async function startCoordinator(home: Home): Promise<void> {
    if (closed) return;
    const { coordinatorConfigFile: configFile, stopFile, dashboardPort } = home;
    launcher ??= new CoordinatorLauncher({ repoRoot, configFile, stopFile, dashboardPort, log });
    // start() fails if it cannot use the stop file or Layer 2's pyproject.toml; status() says why.
    await launcher.start().catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error)) throw error;
      log(`L1 setup: cannot start the coordinator: ${error.message}`);
    });
  }

  /** Once a home exists: starts its coordinator, then runs the home-ready hook. */
  async function homeReady(home: Home): Promise<void> {
    await startCoordinator(home);
    if (!closed) await options.onHomeReady?.(home);
  }

  /** The page for what the state folder holds: no home, the home, or why it cannot be read. */
  async function currentPage(): Promise<string> {
    try {
      const home = await loadHome(stateDir);
      if (home === undefined) return joinPage.currentPage() ?? welcomePage(token);
      return homeView(home);
    } catch (error) {
      if (!(error instanceof HomeError)) throw error;
      return problemPage(error.message);
    }
  }

  async function createHomeReply(): Promise<PageReply> {
    if (laptop.busy()) {
      return { status: 409, body: problemPage("This laptop is already joining a home.") };
    }
    creating = true;
    try {
      const home = await createHome(stateDir, { ...homeOptions, bridgeUrl });
      await homeReady(home);
      return { status: 200, body: homeView(home) };
    } catch (error) {
      if (error instanceof HomeExistsError) return { status: 409, body: await currentPage() };
      if (!(error instanceof HomeError)) throw error;
      return { status: 500, body: problemPage(error.message) };
    } finally {
      creating = false;
    }
  }

  const showPage = async (): Promise<PageReply> => ({ status: 200, body: await currentPage() });
  /** The route table: Create a home leaves the browser at /home, so GET shows the page there too. */
  const routes: PageRoute[] = [
    { method: "GET", path: "/", guard: "view", handle: showPage },
    { method: "GET", path: "/home", guard: "view", handle: showPage },
    { method: "POST", path: "/home", guard: "form", handle: createHomeReply },
    ...pairingPage.routes(),
    alerts.route(),
    ...joinPage.routes(),
    ...handoff.routes(),
  ];

  function refuse(why: string): PageReply {
    log(`L1 setup: refused a request: ${why}`);
    return { status: 403, body: problemPage(`This request was refused: ${why}. Open ${url}`) };
  }

  async function respond(request: IncomingMessage): Promise<PageReply> {
    const { method, url: target, headers } = request;
    if (!hosts.includes(headers.host ?? "")) return refuse("it was not for this page's address");
    const route = routes.find((row) => row.method === method && row.path === target);
    if (route === undefined) {
      const machine = routes.some((row) => row.path === target && row.guard === "machine");
      if (machine) return machineRefusal(405, "method_not_allowed");
      return { status: 404, body: problemPage("No such page.") };
    }
    if (route.guard === "view") return route.handle(new URLSearchParams());
    if (route.guard === "machine") {
      const read = await machineBody(request);
      return "body" in read ? route.handle(read.body) : read;
    }
    if (!origins.includes(headers.origin ?? "")) return refuse("it did not come from this page");
    const length = Number(headers["content-length"]); // NaN without one, so that is refused too
    if (!(length <= settings.SETUP_MAX_BODY_BYTES)) {
      return { status: 413, body: problemPage("Too large.") };
    }
    const fields = new URLSearchParams(await text(request));
    if (fields.get("token") !== token) return { status: 403, body: RELOAD_PAGE };
    return route.handle(fields);
  }

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let reply: PageReply;
    try {
      reply = await respond(request);
    } catch (error) {
      log(`L1 setup: could not answer a request: ${errorMessage(error)}`);
      reply = { status: 500, body: problemPage("The bridge could not answer; its log says why.") };
    }
    if ("redirect" in reply) {
      response.writeHead(303, { ...HEADERS, location: reply.redirect }).end();
    } else if ("json" in reply) {
      const json = { ...HEADERS, "content-type": "application/json" };
      response.writeHead(reply.status, json).end(JSON.stringify(reply.json));
    } else {
      response.writeHead(reply.status, HEADERS).end(reply.body);
    }
  }

  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    answer(request, response).catch((error: unknown) => {
      log(`L1 setup: could not send a reply: ${errorMessage(error)}`);
    });
  });
  return {
    url,
    startCoordinator,
    homeReady,
    /** On a laptop that joined a home: starts its worker again, with its node ID and token. */
    resumeLaptop: () => laptop.resume(),
    /** Stops answering, then stops the coordinator, or this laptop's worker. */
    async close(): Promise<void> {
      closed = true;
      server.close();
      server.closeAllConnections();
      await launcher?.stop();
      await laptop.close();
    },
  };
}

/** The command that opens `url` in the default browser on `platform`, run without a shell. */
export function browserCommand(url: string, platform = process.platform) {
  // explorer.exe exits 1 even when it opened the page, so there only failing to run it counts.
  if (platform === "win32") return { file: "explorer.exe", args: [url], okCodes: [0, 1] };
  if (platform === "darwin") return { file: "open", args: [url], okCodes: [0] };
  return { file: "xdg-open", args: [url], okCodes: [0] };
}

/** Opens `url` with `command` (D4). A failure is reported, never thrown: the bridge runs on. */
export async function openInBrowser(
  url: string,
  { file, args, okCodes }: ReturnType<typeof browserCommand>,
  log = (line: string) => console.error(line),
): Promise<void> {
  const timeout = settings.BROWSER_OPEN_TIMEOUT_MS;
  try {
    const opener = spawn(file, args, { shell: false, stdio: "ignore", timeout });
    const [code, signal]: unknown[] = await once(opener, "exit");
    if (typeof code === "number" && okCodes.includes(code)) return;
    log(`L1 setup: ${file} ended with ${String(code ?? signal)}; open ${url} in a browser`);
  } catch (error) {
    log(`L1 setup: cannot run ${file}: ${errorMessage(error)}; open ${url} in a browser`);
  }
}
