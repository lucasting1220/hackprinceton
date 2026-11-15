/**
 * The camera laptop's live view sender control: on live_view_open from the home laptop's bridge it
 * serves the sender page at GET /live-sender on the local server and opens it in its own Chrome (or
 * Edge on Windows) window; on live_view_close, at the session's end or when the bridge stops, it
 * stops serving the page and kills that window. A window that can't start, or closes by itself,
 * is reported to the hub so the session ends as lost. The sender token lives only in memory and in
 * the page; log lines name session IDs and browser paths only.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { errorMessage, JsonFileError, readJsonFile } from "./json-file.ts";
import type { LinkCommand, LiveViewOpen } from "./live-view-commands.ts";
import { renderSenderPage, senderPageCsp } from "./live-sender-page.ts";
import * as settings from "./settings.ts";

/** A started browser: kill() ends it, and `exited` resolves with how it ended. */
export interface BrowserProcess {
  kill(): void;
  readonly exited: Promise<string>;
}

/** Starts `file` with `args`, never through a shell; tests pass a fake. */
export type BrowserSpawner = (file: string, args: readonly string[]) => BrowserProcess;

/** The sender page and the Content-Security-Policy it is served under. */
export type SenderReply = Readonly<{ page: string; csp: string }>;

export interface LiveSenderOptions {
  readonly stateDir: string;
  /** The sender page's address on this laptop's local server. */
  readonly pageUrl: string;
  /** worker.json, for frame_feed_port. */
  readonly workerConfigFile: string;
  /** Called with a session whose window couldn't start or closed by itself. */
  readonly onLost: (sessionId: string) => void;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
  readonly spawn?: BrowserSpawner;
  /** Chrome's or Edge's path, or undefined; findBrowser() on this laptop by default. */
  readonly findBrowser?: () => string | undefined;
}

/** Chrome at its standard macOS place, or Chrome then Edge in Windows' program folders. */
export function findBrowser(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string | undefined {
  if (platform === "darwin") {
    const file = settings.LIVE_SENDER_MACOS_BROWSER;
    return exists(file) ? file : undefined;
  }
  if (platform !== "win32") return undefined;
  for (const browser of settings.LIVE_SENDER_WINDOWS_BROWSERS) {
    for (const [name, usual] of settings.LIVE_SENDER_WINDOWS_PROGRAM_DIRS) {
      const file = path.win32.join(env[name] ?? usual, ...browser);
      if (exists(file)) return file;
    }
  }
  return undefined;
}

/** The sender window's arguments: one app window on the page, with its own profile folder. */
export function senderBrowserArgs(url: string, stateDir: string): string[] {
  const profile = path.join(stateDir, settings.LIVE_SENDER_BROWSER_DIR);
  return [`--app=${url}`, `--user-data-dir=${profile}`, ...settings.LIVE_SENDER_BROWSER_FLAGS];
}

/** The real spawner: no shell, no output kept. */
export const spawnBrowser: BrowserSpawner = (file, args) => {
  const child = spawn(file, [...args], { shell: false, stdio: "ignore" });
  const exited = new Promise<string>((resolve) => {
    child.once("exit", (code, signal) => resolve(`it ended with ${String(code ?? signal)}`));
    child.once("error", (error) => resolve(`it couldn't run: ${errorMessage(error)}`));
  });
  return { kill: () => child.kill(), exited };
};

/** worker.json's frame_feed_port, or the usual port when the file can't say. */
async function frameFeedPort(file: string): Promise<number> {
  try {
    const config = await readJsonFile(file);
    const port: unknown =
      typeof config === "object" && config !== null
        ? Reflect.get(config, "frame_feed_port")
        : undefined;
    const valid = typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65_536;
    return valid ? port : settings.FRAME_FEED_PORT;
  } catch (error) {
    if (!(error instanceof JsonFileError)) throw error;
    return settings.FRAME_FEED_PORT;
  }
}

interface Session {
  readonly command: LiveViewOpen;
  readonly frameFeedPort: number;
  readonly timer: NodeJS.Timeout;
  browser: BrowserProcess | undefined;
}

export class LiveSender {
  readonly #options: LiveSenderOptions;
  readonly #log: (line: string) => void;
  readonly #now: () => number;
  #session: Session | undefined;
  /** Commands run one at a time, in the order they came. */
  #work: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(options: LiveSenderOptions) {
    this.#options = options;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#now = options.now ?? Date.now;
  }

  /** Runs a command from the link; resolves once it is done. */
  handle(command: LinkCommand): Promise<void> {
    const run = () =>
      command.type === "live_view_open"
        ? this.#open(command)
        : this.#close(command.session_id, command.reason);
    const next = this.#work.then(run).catch((error: unknown) => {
      this.#log(`L1 live sender: ${command.type} failed: ${errorMessage(error)}`);
    });
    this.#work = next;
    return next;
  }

  /** The open session's ID, or undefined. */
  sessionId(): string | undefined {
    return this.#session?.command.session_id;
  }

  /** The sender page while a session is open, else undefined (GET /live-sender answers 404). */
  reply(): SenderReply | undefined {
    const session = this.#session;
    if (session === undefined) return undefined;
    const { command } = session;
    const params = {
      sessionId: command.session_id,
      senderToken: command.sender_token,
      signalingUrl: command.signaling_url,
      expiresAt: command.expires_at,
      frameFeedPort: session.frameFeedPort,
      liveViewTimeLimitS: Math.round(settings.LIVE_VIEW_SESSION_MS / 1000),
    };
    return { page: renderSenderPage(params), csp: senderPageCsp(params) };
  }

  /** Kills the window and stops serving the page, for good: the bridge is stopping. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#work;
    await this.#stop();
  }

  async #open(command: LiveViewOpen): Promise<void> {
    const id = command.session_id;
    if (this.#closed || this.#session?.command.session_id === id) return;
    const untilEnd = Date.parse(command.expires_at) - this.#now();
    if (untilEnd <= 0) {
      this.#log(`L1 live sender: session ${id} had already ended; not opened`);
      return;
    }
    await this.#stop();
    const port = await frameFeedPort(this.#options.workerConfigFile);
    const timer = setTimeout(() => {
      const expired = { type: "live_view_close", session_id: id, reason: "expired" } as const;
      this.handle(expired).catch((error: unknown) => {
        this.#log(`L1 live sender: couldn't close session ${id}: ${errorMessage(error)}`);
      });
    }, untilEnd);
    const session: Session = { command, frameFeedPort: port, timer, browser: undefined };
    this.#session = session;
    const file = (this.#options.findBrowser ?? findBrowser)();
    if (file === undefined) {
      this.#log(
        `L1 live sender: no Chrome (or Edge on Windows) found, so live view session ${id} can't start; install Google Chrome`,
      );
      await this.#stop();
      this.#options.onLost(id);
      return;
    }
    const args = senderBrowserArgs(this.#options.pageUrl, this.#options.stateDir);
    const browser = (this.#options.spawn ?? spawnBrowser)(file, args);
    session.browser = browser;
    this.#log(`L1 live sender: opened the sender window for session ${id} with ${file}`);
    browser.exited.then(
      (how) => {
        if (this.#session !== session) return; // closed on purpose
        this.#log(`L1 live sender: the sender window for session ${id} closed: ${how}`);
        clearTimeout(session.timer);
        this.#session = undefined;
        this.#options.onLost(id);
      },
      (error: unknown) => {
        this.#log(`L1 live sender: can't watch the sender window: ${errorMessage(error)}`);
      },
    );
  }

  async #close(sessionId: string, reason: string): Promise<void> {
    if (this.#session?.command.session_id !== sessionId) return;
    this.#log(`L1 live sender: closing the sender window for session ${sessionId}: ${reason}`);
    await this.#stop();
  }

  /** Forgets the session, then kills its window and waits a moment for it to exit. */
  async #stop(): Promise<void> {
    const session = this.#session;
    if (session === undefined) return;
    this.#session = undefined;
    clearTimeout(session.timer);
    const browser = session.browser;
    if (browser === undefined) return;
    browser.kill();
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("still running"), settings.LIVE_SENDER_BROWSER_EXIT_WAIT_MS);
    });
    const how = await Promise.race([browser.exited, waited]);
    clearTimeout(timer);
    if (how === "still running") {
      this.#log("L1 live sender: the previous sender window didn't exit in time");
    }
  }
}
