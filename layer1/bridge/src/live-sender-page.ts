/**
 * The live-view sender page (phone-hub.md §7): the camera laptop's kiosk window. It shows the
 * resident the full-screen live notice, draws Layer 3's /live frames on a canvas, plays its /mic
 * audio into a WebRTC audio track, and streams both to the caregiver's phone through the relay's
 * signaling WebSocket and TURN server. One-way audio: the page never plays anything aloud.
 */

import { createHash } from "node:crypto";
import { micMessageToSamples } from "./live-sender-audio.ts";
import * as settings from "./settings.ts";

/** What one session's sender page needs; the bridge serves it at GET /live-sender while it is open. */
export interface SenderPageParams {
  readonly sessionId: string;
  readonly senderToken: string;
  readonly signalingUrl: string;
  readonly expiresAt: string;
  readonly frameFeedPort: number;
  readonly liveViewTimeLimitS: number;
}

/** The page's words, in one place so tests and the docs can match them. */
export const SENDER_PAGE_TEXT = {
  watching: "Live: your caregiver is watching",
  hearing: "Your caregiver can see and hear this room",
  turnOff: "Turn off live view",
  off: "Live view is off",
  ended: "Live view ended",
} as const;

/** The id of the inert JSON block that carries the session's values to the page's script. */
const CONFIG_ID = "live-config";

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: #0f1b2d; color: #f2f5f9; font: 20px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
main { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 32px; text-align: center; }
h1 { margin: 0; font-size: 56px; font-weight: 600; }
.lead { margin: 0; font-size: 32px; color: #c9d4e3; }
.time { margin: 0; font-size: 28px; color: #9fb0c6; font-variant-numeric: tabular-nums; }
canvas { width: 320px; max-width: 60vw; aspect-ratio: 4 / 3; border-radius: 12px; background: #000; }
button { font: inherit; font-size: 32px; font-weight: 600; padding: 24px 56px; border: 0; border-radius: 18px; background: #f2f5f9; color: #0f1b2d; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
.status { margin: 0; font-size: 18px; color: #9fb0c6; }
body.over .live { display: none; }
`;

const SCRIPT = `
"use strict";
${micMessageToSamples.toString()}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const config = JSON.parse(document.getElementById("${CONFIG_ID}").textContent);
const headline = document.getElementById("headline");
const timeLeft = document.getElementById("time-left");
const statusLine = document.getElementById("status");
const offButton = document.getElementById("turn-off");
const canvas = document.getElementById("preview");

let finished = false;
let signalState = "Connecting to the relay";
let cameraState = "connecting";
let micState = "connecting";
const timers = [];
const feeds = new Set();

function showStatus() {
  statusLine.textContent = signalState + " · Camera " + cameraState + " · Room sound " + micState;
}
function setSignalState(text) {
  signalState = text;
  showStatus();
}
function reportError(what, error) {
  setSignalState(what + ": " + (error instanceof Error ? error.message : String(error)));
}

function openSocket(url) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const timer = setTimeout(() => {
    if (socket.readyState === WebSocket.CONNECTING) socket.close();
  }, config.connectTimeoutMs);
  socket.addEventListener("open", () => clearTimeout(timer));
  socket.addEventListener("close", () => clearTimeout(timer));
  return socket;
}

function openFeed(path, setState, onMessage) {
  if (finished) return;
  const socket = openSocket("ws://" + config.feedHost + ":" + config.frameFeedPort + path);
  feeds.add(socket);
  socket.addEventListener("open", () => setState("on"));
  socket.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) onMessage(event.data);
  });
  socket.addEventListener("close", () => {
    feeds.delete(socket);
    if (finished) return;
    setState("not connected, trying again");
    timers.push(setTimeout(() => openFeed(path, setState, onMessage), config.feedRetryMs));
  });
}

canvas.width = config.width;
canvas.height = config.height;
const drawing = canvas.getContext("2d");
drawing.fillStyle = "#000";
drawing.fillRect(0, 0, canvas.width, canvas.height);
let newestFrame = null;
let decoding = false;
function drawNewest() {
  if (decoding || newestFrame === null) return;
  const frame = newestFrame;
  newestFrame = null;
  decoding = true;
  createImageBitmap(new Blob([frame], { type: "image/jpeg" }))
    .then(
      (bitmap) => {
        drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
      },
      (error) => {
        cameraState = "sent a frame that could not be read (" + String(error) + ")";
        showStatus();
      },
    )
    .finally(() => {
      decoding = false;
    });
}
timers.push(setInterval(drawNewest, MS_PER_SECOND / config.maxFps));
const videoTrack = canvas.captureStream(config.maxFps).getVideoTracks()[0];
openFeed(config.videoPath, (state) => { cameraState = state; showStatus(); }, (frame) => {
  newestFrame = frame;
});

const audio = new AudioContext();
const audioOut = audio.createMediaStreamDestination();
const audioTrack = audioOut.stream.getAudioTracks()[0];
let playAt = 0;
audio.resume().catch((error) => reportError("Room sound could not start", error));
function playChunk(message) {
  const samples = micMessageToSamples(message, config.micHeaderBytes);
  if (samples.length === 0 || audio.state === "closed") return;
  const buffer = audio.createBuffer(1, samples.length, config.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audioOut);
  const now = audio.currentTime;
  if (playAt < now || playAt > now + config.audioMaxLeadS) playAt = now + config.audioLeadS;
  source.start(playAt);
  playAt += buffer.duration;
}
openFeed(config.audioPath, (state) => { micState = state; showStatus(); }, playChunk);

let peer = null;
let iceServers = [];
let pendingCandidates = [];
let signalQueue = Promise.resolve();
const signal = openSocket(config.signalingUrl);

function send(message) {
  if (signal.readyState === WebSocket.OPEN) signal.send(JSON.stringify(message));
}

function closePeer() {
  if (peer !== null) peer.close();
  peer = null;
  pendingCandidates = [];
}

function usesTurn(servers) {
  return servers.some((server) =>
    [].concat(server.urls).some((url) => typeof url === "string" && /^turns?:/.test(url)),
  );
}

async function startPeer() {
  closePeer();
  const pc = new RTCPeerConnection({
    iceServers,
    iceTransportPolicy: usesTurn(iceServers) ? "relay" : "all",
  });
  peer = pc;
  const stream = new MediaStream([videoTrack, audioTrack]);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate === null || peer !== pc) return;
    send({
      type: "candidate",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  });
  pc.addEventListener("connectionstatechange", () => {
    if (peer !== pc) return;
    if (pc.connectionState === "connected") setSignalState("Streaming to the caregiver's phone");
    if (pc.connectionState === "failed") setSignalState("The connection to the caregiver's phone failed");
  });
  setSignalState("Connecting to the caregiver's phone");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (peer === pc) send({ type: "offer", sdp: pc.localDescription.sdp });
}

function candidateFrom(message) {
  const fields = typeof message.candidate === "object" && message.candidate !== null
    ? message.candidate
    : message;
  if (typeof fields.candidate !== "string") return null;
  return {
    candidate: fields.candidate,
    sdpMid: typeof fields.sdpMid === "string" ? fields.sdpMid : null,
    sdpMLineIndex: typeof fields.sdpMLineIndex === "number" ? fields.sdpMLineIndex : null,
  };
}

async function handleSignal(message) {
  if (finished) return;
  if (message.type === "welcome") {
    iceServers = Array.isArray(message.ice_servers) ? message.ice_servers : [];
    setSignalState("Waiting for the caregiver's phone");
  } else if (message.type === "peer" && message.state === "joined") {
    await startPeer();
  } else if (message.type === "peer" && message.state === "left") {
    closePeer();
    setSignalState("Waiting for the caregiver's phone");
  } else if (message.type === "answer" && peer !== null && typeof message.sdp === "string") {
    const pc = peer;
    await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
    const waiting = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of waiting) await pc.addIceCandidate(candidate);
  } else if (message.type === "candidate" && peer !== null) {
    const candidate = candidateFrom(message);
    if (candidate === null) return;
    if (peer.remoteDescription === null) pendingCandidates.push(candidate);
    else await peer.addIceCandidate(candidate);
  } else if (message.type === "end") {
    finish(config.text.ended, "The session ended (" + String(message.reason) + ")");
  }
}

signal.addEventListener("open", () => {
  send({ type: "hello", token: config.senderToken });
  setSignalState("Joining the session");
});
signal.addEventListener("message", (event) => {
  if (typeof event.data !== "string") return;
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (error) {
    reportError("The relay sent a message this page could not read", error);
    return;
  }
  signalQueue = signalQueue
    .then(() => handleSignal(message))
    .catch((error) => reportError("Live view hit an error", error));
});
signal.addEventListener("close", (event) => {
  if (!finished) finish(config.text.ended, "Lost the connection to the relay (" + event.code + ")");
});

function finish(title, why) {
  if (finished) return;
  finished = true;
  closePeer();
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  for (const socket of feeds) socket.close();
  feeds.clear();
  videoTrack.stop();
  audioTrack.stop();
  audio.close().catch((error) => reportError("Room sound did not stop cleanly", error));
  if (signal.readyState === WebSocket.OPEN || signal.readyState === WebSocket.CONNECTING) {
    signal.close();
  }
  document.body.classList.add("over");
  headline.textContent = title;
  offButton.disabled = true;
  cameraState = "off";
  micState = "off";
  setSignalState(why === "" ? title : why);
}

offButton.addEventListener("click", () => {
  if (finished) return;
  send({ type: "bye", reason: "resident_turned_off" });
  finish(config.text.off, "");
});

const expires = Date.parse(config.expiresAt);
const deadline = Math.min(
  Number.isNaN(expires) ? Number.POSITIVE_INFINITY : expires,
  Date.now() + config.liveViewTimeLimitS * MS_PER_SECOND,
);
function tick() {
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / MS_PER_SECOND));
  const seconds = left % SECONDS_PER_MINUTE;
  timeLeft.textContent =
    "Time left: " + Math.floor(left / SECONDS_PER_MINUTE) + ":" + (seconds < 10 ? "0" : "") + seconds;
  if (left === 0) finish(config.text.ended, "The time is up");
}
tick();
timers.push(setInterval(tick, MS_PER_SECOND));
showStatus();
`;

const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** JSON that stays inert inside a <script> block: no <, > or & that could close or open a tag. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The page's own values, read by its script from the inert JSON block. */
function pageConfig(params: SenderPageParams) {
  return {
    sessionId: params.sessionId,
    senderToken: params.senderToken,
    signalingUrl: params.signalingUrl,
    expiresAt: params.expiresAt,
    frameFeedPort: params.frameFeedPort,
    liveViewTimeLimitS: params.liveViewTimeLimitS,
    feedHost: settings.LIVE_SENDER_FEED_HOST,
    videoPath: settings.LIVE_SENDER_VIDEO_PATH,
    audioPath: settings.LIVE_SENDER_AUDIO_PATH,
    width: settings.LIVE_SENDER_WIDTH,
    height: settings.LIVE_SENDER_HEIGHT,
    maxFps: settings.LIVE_SENDER_MAX_FPS,
    micHeaderBytes: settings.LIVE_SENDER_MIC_HEADER_BYTES,
    sampleRate: settings.LIVE_SENDER_MIC_SAMPLE_RATE,
    audioLeadS: settings.LIVE_SENDER_AUDIO_LEAD_S,
    audioMaxLeadS: settings.LIVE_SENDER_AUDIO_MAX_LEAD_S,
    connectTimeoutMs: settings.LIVE_SENDER_CONNECT_TIMEOUT_MS,
    feedRetryMs: settings.LIVE_SENDER_FEED_RETRY_MS,
    text: SENDER_PAGE_TEXT,
  };
}

/** One complete, self-contained HTML document: inline CSS and JS only, nothing loaded from elsewhere. */
export function renderSenderPage(params: SenderPageParams): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Debbie: Live view</title>
<style>${STYLE}</style></head>
<body><main>
<h1 id="headline">${SENDER_PAGE_TEXT.watching}</h1>
<p class="lead live">${SENDER_PAGE_TEXT.hearing}</p>
<p class="time live" id="time-left"></p>
<canvas id="preview" class="live" aria-label="What your caregiver sees"></canvas>
<button id="turn-off" type="button">${SENDER_PAGE_TEXT.turnOff}</button>
<p class="status" id="status" role="status"></p>
</main>
<script type="application/json" id="${CONFIG_ID}">${scriptSafeJson(pageConfig(params))}</script>
<script>${SCRIPT}</script>
</body></html>
`;
}

/**
 * The Content-Security-Policy to serve the page with, in place of the setup page's: its own inline
 * script and style by hash, and WebSockets only to the frame feed and the relay's signaling origin.
 */
export function senderPageCsp(params: SenderPageParams): string {
  const signaling = new URL(params.signalingUrl);
  const feed = `ws://${settings.LIVE_SENDER_FEED_HOST}:${params.frameFeedPort}`;
  return [
    "default-src 'none'",
    `script-src ${sha256(SCRIPT)}`,
    `style-src ${sha256(STYLE)}`,
    `connect-src ${feed} ${signaling.protocol}//${signaling.host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
