import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Script, runInNewContext } from "node:vm";
import { micMessageToSamples } from "../bridge/src/live-sender-audio.ts";
import {
  renderSenderPage,
  SENDER_PAGE_TEXT,
  type SenderPageParams,
  senderPageCsp,
} from "../bridge/src/live-sender-page.ts";
import * as settings from "../bridge/src/settings.ts";

const TOKEN = 'tok</script><script>alert("x")</script>&<!--';
const SIGNALING = "wss://relay.example.test/v1/live-view/sessions/s-1/signal";
const PARAMS: SenderPageParams = {
  sessionId: "s-1",
  senderToken: TOKEN,
  signalingUrl: SIGNALING,
  expiresAt: "2099-01-01T00:00:00Z",
  frameFeedPort: 7461,
  liveViewTimeLimitS: 300,
};
const TURN_SERVERS = [
  { urls: ["stun:relay.example.test:3478"] },
  { urls: ["turn:relay.example.test:3478?transport=udp"], username: "u", credential: "c" },
];

/** The page's executable script, the text between its last <script> and </script>. */
function pageScript(page: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(page);
  assert.ok(match?.[1] !== undefined, "the page has an inline script");
  return match[1];
}

/** The session's values in the page's inert JSON block. */
interface PageConfig {
  readonly sessionId: unknown;
  readonly senderToken: unknown;
  readonly signalingUrl: unknown;
  readonly expiresAt: unknown;
  readonly frameFeedPort: unknown;
  readonly liveViewTimeLimitS: unknown;
}

/** The page's inert JSON block, parsed. */
function pageConfig(page: string): PageConfig {
  const match = /<script type="application\/json" id="live-config">([\s\S]*?)<\/script>/.exec(page);
  assert.ok(match?.[1] !== undefined, "the page has its JSON block");
  return JSON.parse(match[1]) as PageConfig;
}

test("the page holds the live notice's words and the Turn off live view button", () => {
  const page = renderSenderPage(PARAMS);
  assert.ok(page.startsWith("<!doctype html>"));
  for (const text of [
    "Live: your caregiver is watching",
    "Your caregiver can see and hear this room",
    "Turn off live view",
  ]) {
    assert.ok(page.includes(text), text);
  }
  assert.ok(page.includes(`<button id="turn-off" type="button">${SENDER_PAGE_TEXT.turnOff}`));
});

test("the session's values are escaped JSON that cannot leave its script block", () => {
  const page = renderSenderPage(PARAMS);
  assert.equal(page.split("</script>").length - 1, 2, "only the page's own two blocks close");
  assert.ok(!page.includes("<!--"));
  assert.ok(!page.includes('alert("x")</script>'));
  const config = pageConfig(page);
  assert.equal(config.senderToken, TOKEN);
  assert.equal(config.signalingUrl, SIGNALING);
  assert.equal(config.sessionId, "s-1");
  assert.equal(config.expiresAt, PARAMS.expiresAt);
  assert.equal(config.frameFeedPort, 7461);
  assert.equal(config.liveViewTimeLimitS, 300);
});

test("the page loads nothing: no URL but the frame feed's and the relay's WebSockets", () => {
  const page = renderSenderPage({ ...PARAMS, senderToken: "t" });
  assert.doesNotMatch(page, /\s(?:src|href|action)=/i);
  assert.doesNotMatch(page, /@import|url\(/i);
  const urls = page.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<)]*/gi) ?? [];
  assert.deepEqual([...new Set(urls)].sort(), [SIGNALING, "ws://"].sort());
});

test("the page's script parses as JavaScript, and the CSP allows exactly it and its style", () => {
  const page = renderSenderPage(PARAMS);
  const script = pageScript(page);
  assert.doesNotThrow(() => new Script(script));
  const csp = senderPageCsp(PARAMS);
  const hash = createHash("sha256").update(script).digest("base64");
  assert.ok(csp.includes(`script-src 'sha256-${hash}'`), csp);
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? "";
  const styleHash = createHash("sha256").update(style).digest("base64");
  assert.ok(csp.includes(`style-src 'sha256-${styleHash}'`), csp);
  assert.ok(csp.includes("connect-src ws://127.0.0.1:7461 wss://relay.example.test;"), csp);
  assert.ok(csp.startsWith("default-src 'none';"));
});

test("a /mic message becomes float samples, its 8-byte captured_at left out", () => {
  const bytes = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40, 0xff, 0xff, 0x09,
  ]);
  const samples = micMessageToSamples(bytes.buffer, settings.LIVE_SENDER_MIC_HEADER_BYTES);
  assert.deepEqual([...samples], [0, 32767 / 32768, -1, 0.5, -1 / 32768]);
  assert.equal(micMessageToSamples(new ArrayBuffer(5), 8).length, 0);
  assert.equal(micMessageToSamples(new ArrayBuffer(8), 8).length, 0);
});

test("the page inlines the same PCM conversion the tests check", () => {
  const script = pageScript(renderSenderPage(PARAMS));
  assert.ok(script.includes("function micMessageToSamples(message"));
});

type Listener = (event: Record<string, unknown>) => void;

class FakeTarget {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  fire(name: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

/** Runs the page's script against stand-ins for the browser's DOM, WebSocket, audio and WebRTC. */
function runPage(params: SenderPageParams) {
  const page = renderSenderPage(params);
  const configText = /id="live-config">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "";
  const sockets: FakeSocket[] = [];
  const peers: FakePeer[] = [];
  const buffers: { rate: number; samples: Float32Array }[] = [];
  const track = (kind: string) => ({
    kind,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  });
  const videoTrack = track("video");
  const audioTrack = track("audio");

  class FakeSocket extends FakeTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readyState = 0;
    binaryType = "blob";
    readonly sent: unknown[] = [];
    readonly url: string;
    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
    }
    send(text: string): void {
      this.sent.push(JSON.parse(text));
    }
    close(): void {
      this.readyState = 3;
    }
    open(): void {
      this.readyState = 1;
      this.fire("open");
    }
  }
  class FakePeer extends FakeTarget {
    readonly tracks: unknown[] = [];
    closed = false;
    localDescription: { sdp: string } | null = null;
    remoteDescription: unknown = null;
    readonly options: { iceTransportPolicy: string; iceServers: unknown };
    constructor(options: { iceTransportPolicy: string; iceServers: unknown }) {
      super();
      this.options = options;
      peers.push(this);
    }
    addTrack(added: unknown): void {
      this.tracks.push(added);
    }
    async createOffer() {
      return { type: "offer", sdp: `v=0 offer ${peers.length}` };
    }
    async setLocalDescription(description: { sdp: string }) {
      this.localDescription = description;
    }
    close(): void {
      this.closed = true;
    }
  }
  class FakeElement extends FakeTarget {
    textContent: string;
    disabled = false;
    constructor(textContent: string) {
      super();
      this.textContent = textContent;
    }
    getContext() {
      return { fillRect: () => undefined, drawImage: () => undefined };
    }
    captureStream() {
      return { getVideoTracks: () => [videoTrack] };
    }
  }
  const elements = new Map<string, FakeElement>();
  const element = (id: string) => {
    let found = elements.get(id);
    if (found === undefined) {
      found = new FakeElement(id === "live-config" ? configText : "");
      elements.set(id, found);
    }
    return found;
  };
  const bodyClasses = new Set<string>();
  const context = {
    document: {
      getElementById: element,
      body: { classList: { add: (name: string) => bodyClasses.add(name) } },
    },
    WebSocket: FakeSocket,
    RTCPeerConnection: FakePeer,
    MediaStream: class {
      readonly tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
      getTracks() {
        return this.tracks;
      }
    },
    AudioContext: class {
      currentTime = 0;
      state = "running";
      createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [audioTrack] } });
      resume = async () => undefined;
      close = async () => {
        this.state = "closed";
      };
      createBuffer(_channels: number, length: number, rate: number) {
        const entry = { rate, samples: new Float32Array(length) };
        buffers.push(entry);
        return {
          duration: length / rate,
          copyToChannel: (from: Float32Array) => entry.samples.set(from),
        };
      }
      createBufferSource = () => ({ connect: () => undefined, start: () => undefined });
    },
    createImageBitmap: async () => ({ close: () => undefined }),
    Blob,
    ArrayBuffer,
    Promise,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    Date,
  };
  runInNewContext(pageScript(page), context);
  const at = (path: string) => sockets.find((socket) => socket.url.endsWith(path));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { sockets, peers, buffers, elements, bodyClasses, at, flush, videoTrack, audioTrack };
}

test("the page reads /live and /mic on the frame feed's port, and joins the session's signaling", () => {
  const run = runPage(PARAMS);
  const urls = run.sockets.map((socket) => socket.url).sort();
  assert.deepEqual(urls, [SIGNALING, "ws://127.0.0.1:7461/live", "ws://127.0.0.1:7461/mic"].sort());
  for (const socket of run.sockets) assert.equal(socket.binaryType, "arraybuffer");
});

test("the page says hello with the token, then offers video and audio over TURN once the phone joins", async () => {
  const run = runPage(PARAMS);
  const signal = run.at("/signal");
  assert.ok(signal !== undefined);
  signal.open();
  assert.deepEqual(signal.sent, [{ type: "hello", token: TOKEN }]);
  signal.fire("message", { data: JSON.stringify({ type: "welcome", ice_servers: TURN_SERVERS }) });
  signal.fire("message", { data: JSON.stringify({ type: "peer", state: "joined" }) });
  await run.flush();
  assert.equal(run.peers.length, 1);
  const first = run.peers[0];
  assert.ok(first !== undefined);
  assert.equal(first.options.iceTransportPolicy, "relay");
  assert.deepEqual(JSON.parse(JSON.stringify(first.options.iceServers)), TURN_SERVERS);
  assert.deepEqual(first.tracks, [run.videoTrack, run.audioTrack]);
  assert.deepEqual(signal.sent[1], { type: "offer", sdp: "v=0 offer 1" });

  signal.fire("message", { data: JSON.stringify({ type: "peer", state: "left" }) });
  signal.fire("message", { data: JSON.stringify({ type: "peer", state: "joined" }) });
  await run.flush();
  assert.equal(first.closed, true, "the old connection closes when the phone leaves");
  assert.equal(run.peers.length, 2);
  assert.deepEqual(signal.sent[2], { type: "offer", sdp: "v=0 offer 2" }, "it offers again");
});

test("Turn off live view sends bye with resident_turned_off and shows Live view is off", async () => {
  const run = runPage(PARAMS);
  const signal = run.at("/signal");
  assert.ok(signal !== undefined);
  signal.open();
  signal.fire("message", { data: JSON.stringify({ type: "welcome", ice_servers: TURN_SERVERS }) });
  signal.fire("message", { data: JSON.stringify({ type: "peer", state: "joined" }) });
  await run.flush();
  const button = run.elements.get("turn-off");
  assert.ok(button !== undefined);
  button.fire("click");
  assert.deepEqual(signal.sent.at(-1), { type: "bye", reason: "resident_turned_off" });
  assert.equal(run.elements.get("headline")?.textContent, "Live view is off");
  assert.equal(button.disabled, true);
  assert.equal(run.peers[0]?.closed, true);
  assert.ok(run.bodyClasses.has("over"));
  assert.equal(run.videoTrack.stopped, true);
});

test("the relay's end shows Live view ended", async () => {
  const run = runPage(PARAMS);
  const signal = run.at("/signal");
  assert.ok(signal !== undefined);
  signal.open();
  signal.fire("message", { data: JSON.stringify({ type: "end", reason: "stopped" }) });
  await run.flush();
  assert.equal(run.elements.get("headline")?.textContent, "Live view ended");
  assert.ok(String(run.elements.get("status")?.textContent).includes("stopped"));
});

test("room audio from /mic is played at 16 kHz into the stream's audio track", () => {
  const run = runPage(PARAMS);
  const mic = run.at("/mic");
  assert.ok(mic !== undefined);
  const message = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x40, 0x00, 0xc0]);
  mic.fire("message", { data: message.buffer });
  assert.equal(run.buffers.length, 1);
  assert.equal(run.buffers[0]?.rate, settings.LIVE_SENDER_MIC_SAMPLE_RATE);
  assert.deepEqual([...(run.buffers[0]?.samples ?? [])], [0.5, -0.5]);
});

test("the time left counts down to the session's expires_at", () => {
  const soon = new Date(Date.now() + 90_500).toISOString();
  const run = runPage({ ...PARAMS, expiresAt: soon });
  assert.equal(run.elements.get("time-left")?.textContent, "Time left: 1:31");
});
