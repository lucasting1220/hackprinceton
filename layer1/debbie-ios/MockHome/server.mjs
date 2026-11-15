#!/usr/bin/env node
// Debbie mock home (docs/MOCK_HOME.md). DEVELOPMENT ONLY: never part of an app build.
// Plays the bridge's LAN gateway (7580), the relay (7581) and a control panel/API (7570),
// all bound to 127.0.0.1, speaking the PROPOSED phone ↔ hub contract (docs/CONTRACTS.md)
// with Node's built-in crypto only (the same primitives tools/contracts/verify-vectors.mjs
// proves byte-identical to the app's CryptoKit code).
//
//   node MockHome/server.mjs [--auto-confirm]     then open http://127.0.0.1:7570
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
// Control on 7570, the LAN gateway on 7580, the relay on 7581, the "moved" gateway on 7582 (docs/MOCK_HOME.md): never
// the real bridge's 7470 and 7480, so the two can run on one Mac. DEBBIE_MOCK_PORT_BASE moves them together (control
// at the base, the rest 10–12 above it). Debug app builds and the UI tests read the same variable and default.
const BASE = Number(process.env.DEBBIE_MOCK_PORT_BASE ?? 7570);
if (!Number.isInteger(BASE) || BASE < 1024 || BASE > 65000) throw new Error('DEBBIE_MOCK_PORT_BASE must be a port number from 1024 to 65000');
const PORTS = { control: BASE, lan: BASE + 10, relay: BASE + 11, lanMoved: BASE + 12 };
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
const autoConfirm = process.argv.includes('--auto-confirm');

// ---- crypto (CONTRACTS.md §2) -------------------------------------------------
const b64u = {
  enc: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};
const iso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z'); // the app's decoder wants no fractions
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'ascii'), len));
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
const pubKeyFromRaw = (raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u.enc(raw) }, format: 'jwk' });
const rawPub = (pub) => b64u.dec(pub.export({ format: 'jwk' }).x);
function x25519(priv, peerRaw) {
  const s = crypto.diffieHellman({ privateKey: priv, publicKey: pubKeyFromRaw(peerRaw) });
  if (s.every((b) => b === 0)) throw new Error('low-order key');
  return s;
}
const adFor = (homeID, kid, type) => Buffer.from(kid === 'pair' ? 'debbie/v1/pair' : `debbie/v1/${homeID}/${kid}/${type}`, 'ascii');
function seal(key, kid, homeID, type, obj) {
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('chacha20-poly1305', key, n, { authTagLength: 16 });
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  c.setAAD(adFor(homeID, kid, type), { plaintextLength: pt.length });
  return { v: 1, kid, n: b64u.enc(n), c: b64u.enc(Buffer.concat([c.update(pt), c.final(), c.getAuthTag()])) };
}
function open(key, env, homeID, type) {
  const c = b64u.dec(env.c);
  const d = crypto.createDecipheriv('chacha20-poly1305', key, b64u.dec(env.n), { authTagLength: 16 });
  d.setAAD(adFor(homeID, env.kid, type), { plaintextLength: c.length - 16 });
  d.setAuthTag(c.subarray(c.length - 16));
  return JSON.parse(Buffer.concat([d.update(c.subarray(0, c.length - 16)), d.final()]).toString('utf8'));
}

// ---- state ------------------------------------------------------------------------
let S;
function reset() {
  const hub = crypto.generateKeyPairSync('x25519');
  S = {
    hubPriv: hub.privateKey, hubPub: rawPub(hub.publicKey),
    homeID: 'home-' + b64u.enc(crypto.randomBytes(6)), homeName: 'Mock Home', homeKey: crypto.randomBytes(32),
    pairing: null, phones: new Map(), outbox: [], seq: 0,
    hubOnline: true, lastContact: new Date(), heartbeats: true, monitoring: 'ok', degradedReasons: [],
    lan: 'up', lastLanFetch: null, lastRelayFetch: null, liveAllowed: true, liveNext: 'ready', sessions: new Map(), joins: [], log: [], lastPush: null,
  };
  newPairing();
}
const note = (msg) => { S.log.unshift(`${iso()} ${msg}`); S.log.length = Math.min(S.log.length, 40); console.log(msg); };
function newPairing() {
  S.pairing = { secret: crypto.randomBytes(16), exp: Math.floor(Date.now() / 1000) + 600, pending: null };
  return qrPayload();
}
const qrPayload = () => JSON.stringify({ v: 1, addrs: [`${HOST}:${S.lan === 'moved' ? PORTS.lanMoved : PORTS.lan}`], hub_pub: b64u.enc(S.hubPub), secret: b64u.enc(S.pairing.secret), exp: S.pairing.exp });

function enqueue(type, plain, extra = {}) {
  const msg_id = crypto.randomUUID();
  const body = { ...plain, msg_id, sent_at: iso(), type };
  const w = { v: 1, msg_id, type, sent_at: iso(), envelope: seal(S.homeKey, 'home', S.homeID, type, body), ...extra };
  S.outbox.push({ seq: ++S.seq, w });
  return w;
}
function heartbeat() {
  if (!S.heartbeats || !S.hubOnline) return;
  const degraded = S.monitoring !== 'ok';
  enqueue('heartbeat', {
    state: degraded ? 'degraded' : 'ok', camera: 'up', mic: 'up', fall_detection: degraded ? 'stopped' : 'running', sound_detection: 'running',
    language_model_available: true, sent_at: iso(),
    laptops: [{ node_id: 'n1', display_name: 'Kitchen laptop', reporting: !degraded, last_status_at: iso(Date.now() - (degraded ? 120e3 : 2e3)) },
              { node_id: 'n2', display_name: 'Living room laptop', reporting: true, last_status_at: iso() }],
  });
  S.lastContact = new Date();
  S.outbox = S.outbox.filter((m, i, all) => m.w.type !== 'heartbeat' || all.findLastIndex((x) => x.w.type === 'heartbeat') === i);
}
function alert({ kind = 'fall', severity = 'urgent', title = 'Possible fall', body = 'Debbie asked "Are you okay?" in the living room and heard no answer.', alert_id, update = false, lateMinutes = 0 } = {}) {
  const id = alert_id ?? 'a-' + b64u.enc(crypto.randomBytes(5));
  const w = enqueue('alert', { alert_id: id, kind, severity, detected_at: iso(Date.now() - lateMinutes * 60e3), title, body, update }, { collapse_id: id });
  S.lastPush = { aps: { alert: { title: 'Debbie', body: 'New alert from Debbie' }, 'mutable-content': 1, 'interruption-level': 'time-sensitive', sound: 'default', 'thread-id': 'alerts' }, debbie: { v: 1, home_id: S.homeID, w } };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'push-latest.json'), JSON.stringify({ 'Simulator Target Bundle': process.env.DEBBIE_BUNDLE_ID ?? 'com.example.debbie', ...S.lastPush }, null, 2));
  note(`alert ${id} ${kind}/${severity}${update ? ' (update)' : ''}${lateMinutes ? ` (late ${lateMinutes} min)` : ''}`);
  return id;
}

// ---- HTTP helpers ---------------------------------------------------------------------
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
const err = (res, status, code) => send(res, status, { v: 1, error: { code } });
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok(null); } }); });
const page = (after, limit = 50) => {
  const from = Number(after ?? 0) || 0;
  const items = S.outbox.filter((m) => m.seq > from).slice(0, limit);
  return { messages: items.map((m) => m.w), next: items.length ? String(items.at(-1).seq) : (after ?? null), hub: { online: S.hubOnline, last_contact_at: iso(S.lastContact) } };
};
// LAN requests are envelopes under the phone's own key (kid = device_id); freshness ±5 min (CONTRACTS §5).
function openPhoneRequest(w, res) {
  const phone = w?.envelope && S.phones.get(w.envelope.kid);
  if (!phone) { err(res, 403, 'unknown_device'); return null; }
  if (phone.removed) { err(res, 403, 'device_removed'); return null; }
  try {
    const plain = open(phone.key, w.envelope, S.homeID, w.type);
    if (Math.abs(Date.now() - Date.parse(plain.sent_at)) > 300e3) { err(res, 400, 'stale'); return null; }
    return { phone, plain };
  } catch { err(res, 400, 'bad_envelope'); return null; }
}
function command(phone, type, plain) {
  if (type === 'ack') note(`${phone.name}: acknowledged ${plain.alert_id}${plain.false_alarm ? ' (false alarm)' : ''}`);
  else if (type === 'live_view_setting') { S.liveAllowed = !!plain.enabled; note(`${phone.name}: live view ${S.liveAllowed ? 'on' : 'off'}`); }
  else if (type === 'laptop_approval') { note(`${phone.name}: approved laptop ${plain.name}`); S.joins = S.joins.filter((j) => j.join_id !== plain.join_id); }
  else if (type === 'unpair') { phone.removed = true; note(`${phone.name}: unpaired itself`); }
  else note(`${phone.name}: ${type}`);
}

// ---- LAN gateway + pairing (7580; "moved" re-listens on 7582) ---------------------------
async function lanHandler(req, res) {
  if (S.lan === 'unreachable' || !S.hubOnline) { req.socket.destroy(); return; }
  if (S.lan === 'blackhole') return; // accept, never answer
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/v1/hello') return send(res, 200, { v: 1, hub: b64u.enc(S.hubPub).slice(0, 8) });
  const body = await readBody(req);
  if (body === null) return err(res, 400, 'bad_json');
  if (req.method === 'POST' && url.pathname === '/v1/pair') return pair(body, res);
  if (req.method === 'POST' && url.pathname === '/v1/lan/messages') {
    const r = openPhoneRequest(body, res); if (!r) return;
    S.lastLanFetch = Date.now();
    return send(res, 200, page(r.plain.after, r.plain.limit));
  }
  if (req.method === 'POST' && url.pathname === '/v1/lan/commands') {
    const r = openPhoneRequest(body, res); if (!r) return;
    command(r.phone, body.type, r.plain); return send(res, 200, { v: 1, ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/v1/lan/heart-rate') {
    const r = openPhoneRequest(body, res); if (!r) return;
    const samples = Array.isArray(r.plain.samples) ? r.plain.samples : [];
    const last = samples.at(-1);
    if (last) enqueue('care_status', { heart_rate: { bpm: last.bpm, at: last.t, trend: 'steady' }, no_heart_data: false, no_heart_data_since: null });
    note(`${r.phone.name}: ${samples.length} heart-rate samples (LAN only)`);
    return send(res, 200, { v: 1, accepted: samples.length });
  }
  err(res, 404, 'not_found');
}
function pair(body, res) {
  const p = S.pairing;
  if (!p || Date.now() / 1000 > p.exp) return err(res, 410, 'expired');
  let phonePub, shared;
  try { phonePub = b64u.dec(body.phone_pub); shared = x25519(S.hubPriv, phonePub); } catch { return err(res, 403, 'bad_proof'); }
  const expect = hmac(p.secret, Buffer.concat([phonePub, Buffer.from(body.role ?? '', 'ascii'), Buffer.from([0]), Buffer.from(String(body.name ?? '').normalize('NFC'), 'utf8')]));
  const proof = b64u.dec(body.proof ?? '');
  if (proof.length !== expect.length || !crypto.timingSafeEqual(proof, expect)) return err(res, 403, 'bad_proof');
  if (p.pending && p.pending.phonePub !== body.phone_pub) return err(res, 409, 'in_progress');
  if (p.declined) return err(res, 410, 'declined');
  if (!p.pending) {
    const code = String(hkdf(shared, p.secret, 'debbie/v1/code', 4).readUInt32BE(0) % 10000).padStart(4, '0');
    p.pending = { phonePub: body.phone_pub, name: body.name, role: body.role, code, key: hkdf(shared, p.secret, 'debbie/v1/phone-key', 32), confirmed: false };
    note(`pairing: ${body.name} (${body.role}) shows code ${code}${autoConfirm ? ' — auto-confirming' : ' — press Confirm'}`);
    if (autoConfirm) setTimeout(() => { if (S.pairing === p && p.pending) p.pending.confirmed = true; }, 1500);
  }
  if (!p.pending.confirmed) return send(res, 202, { v: 1, status: 'awaiting' });
  const deviceID = 'd-' + b64u.enc(crypto.randomBytes(6));
  const credential = b64u.enc(crypto.randomBytes(24));
  S.phones.set(deviceID, { deviceID, name: p.pending.name, role: p.pending.role, key: p.pending.key, credentialHash: crypto.createHash('sha256').update(credential).digest('hex'), removed: false });
  const bundle = { v: 1, msg_id: crypto.randomUUID(), sent_at: iso(), home_id: S.homeID, device_id: deviceID, role: p.pending.role, device_credential: credential,
    relay_url: `http://${HOST}:${PORTS.relay}`, home_key: p.pending.role === 'caregiver' ? b64u.enc(S.homeKey) : null, home_name: S.homeName,
    lan: { addrs: [`${HOST}:${S.lan === 'moved' ? PORTS.lanMoved : PORTS.lan}`] } };
  note(`paired ${p.pending.name} as ${deviceID}`);
  S.pairing = { secret: crypto.randomBytes(16), exp: Math.floor(Date.now() / 1000) + 600, pending: null }; // one use only
  send(res, 200, { v: 1, status: 'confirmed', bundle: seal(p.pending.key, 'pair', null, 'pair', bundle) });
}

// ---- relay (7581): device credential in headers, never the LAN (CONTRACTS §6) -----------
async function relayHandler(req, res) {
  if (S.relay === 'blackhole') return; // the laptop is off: accept, never answer
  const url = new URL(req.url, 'http://x');
  const phone = S.phones.get(req.headers['x-debbie-device']);
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!phone || crypto.createHash('sha256').update(bearer).digest('hex') !== phone.credentialHash) return err(res, 401, 'unauthorized');
  if (phone.removed) return err(res, 401, 'device_removed');
  const body = await readBody(req);
  const m = url.pathname.match(/^\/v1\/live-view\/sessions\/([\w-]+)$/);
  if (req.method === 'GET' && url.pathname === '/v1/home') return send(res, 200, { v: 1, hub: { online: S.hubOnline, last_contact_at: iso(S.lastContact) } });
  if (req.method === 'GET' && url.pathname === '/v1/messages') S.lastRelayFetch = Date.now();
  if (req.method === 'GET' && url.pathname === '/v1/messages') return send(res, 200, page(url.searchParams.get('after'), Number(url.searchParams.get('limit') ?? 50)));
  if (req.method === 'POST' && url.pathname === '/v1/commands') {
    if (!S.hubOnline) return err(res, 503, 'hub_offline');
    const r = openPhoneRequest(body, res); if (!r) return;
    command(r.phone, body.type, r.plain); return send(res, 202, { v: 1, accepted: true });
  }
  if (req.method === 'POST' && url.pathname === '/v1/push-tokens') { note(`${phone.name}: push token (${body?.environment ?? '?'})`); return send(res, 204); }
  if (req.method === 'POST' && url.pathname === '/v1/unpair') { phone.removed = true; return send(res, 204); }
  if (req.method === 'POST' && url.pathname === '/v1/live-view/sessions') {
    if (phone.role !== 'caregiver') return err(res, 403, 'forbidden');
    const r = openPhoneRequest(body, res); if (!r) return;
    const id = crypto.randomUUID();
    const outcome = S.liveAllowed ? S.liveNext : 'denied';
    S.sessions.set(id, { id, created: Date.now(), outcome, ended: null, phone: phone.deviceID });
    note(`${phone.name}: live view requested → ${outcome}`);
    return send(res, 201, { v: 1, session_id: id, state: 'requested' });
  }
  if (m && req.method === 'GET') {
    const s = S.sessions.get(m[1]); if (!s) return err(res, 404, 'not_found');
    const age = Date.now() - s.created, expires = iso(s.created + 300e3);
    const base = { v: 1, session_id: s.id, expires_at: expires };
    if (s.ended) return send(res, 200, { ...base, state: 'ended', reason: s.ended });
    if (age < 1500) return send(res, 200, { ...base, state: 'requested' });
    if (s.outcome === 'denied') return send(res, 200, { ...base, state: 'denied', reason: 'live_view_off' });
    if (s.outcome === 'fail') return send(res, 200, { ...base, state: 'failed', reason: 'camera_unavailable' });
    if (age > 300e3) return send(res, 200, { ...base, state: 'ended', reason: 'expired' });
    return send(res, 200, { ...base, state: 'ready', viewer: { signaling_url: `ws://${HOST}:${PORTS.relay}/kvs`, client_id: s.phone, ice_servers: [] } });
  }
  if (m && req.method === 'DELETE') { const s = S.sessions.get(m[1]); if (s && !s.ended) s.ended = 'stopped'; return send(res, 204); }
  err(res, 404, 'not_found');
}

// ---- control panel + API (7570) ----------------------------------------------------------
const controls = {
  'pairing/new': () => ({ qr: newPairing() }),
  'pairing/confirm': () => { if (S.pairing.pending) S.pairing.pending.confirmed = true; return { ok: !!S.pairing.pending }; },
  'pairing/cancel': () => { S.pairing.declined = true; return { ok: true }; },
  alert: (b) => ({ alert_id: alert(b) }),
  'alert/update': (b) => ({ alert_id: alert({ ...b, update: true }) }),
  'alert/late': (b) => ({ alert_id: alert({ kind: 'no_movement', severity: 'attention', title: 'No movement noticed', body: 'No movement in the kitchen for 2 hours.', lateMinutes: b.minutes ?? 14 }) }),
  'hub/offline': () => { S.hubOnline = false; note('hub offline'); return { ok: true }; },
  'hub/online': () => { S.hubOnline = true; heartbeat(); note('hub online'); return { ok: true }; },
  'monitoring/degraded': (b) => { S.monitoring = 'degraded'; S.degradedReasons = b.reasons ?? ['laptop_silent']; heartbeat(); return { ok: true }; },
  'monitoring/ok': () => { S.monitoring = 'ok'; heartbeat(); return { ok: true }; },
  'heartbeat/stop': () => { S.heartbeats = false; return { ok: true }; },
  'heartbeat/start': () => { S.heartbeats = true; heartbeat(); return { ok: true }; },
  'phone/remove': (b) => { for (const p of S.phones.values()) if (!b.device_id || p.deviceID === b.device_id) p.removed = true; note('phone removed'); return { ok: true }; },
  'lan/unreachable': () => { S.lan = 'unreachable'; return { ok: true }; },
  'lan/blackhole': () => { S.lan = 'blackhole'; return { ok: true }; },
  // The laptop switched off mid-session (owner, 23:5x): nothing on the LAN or the relay answers any more.
  'home/off': () => { S.lan = 'blackhole'; S.relay = 'blackhole'; note('home off'); return { ok: true }; },
  'home/on': () => { S.lan = 'up'; S.relay = 'up'; advertise(PORTS.lan); note('home on'); return { ok: true }; },
  'lan/moved': () => { S.lan = 'moved'; advertise(PORTS.lanMoved); return { ok: true, port: PORTS.lanMoved }; },
  'lan/restore': () => { S.lan = 'up'; advertise(PORTS.lan); return { ok: true }; },
  'live/allow': () => { S.liveAllowed = true; return { ok: true }; },
  'live/deny': () => { S.liveAllowed = false; return { ok: true }; },
  'live/next': (b) => { S.liveNext = b.outcome ?? 'ready'; return { ok: true }; },
  'live/end': (b) => { for (const s of S.sessions.values()) if (!s.ended) s.ended = b.reason ?? 'resident_turned_off'; return { ok: true }; },
  'laptop/new': (b) => { const j = { v: 1, kind: 'join', join_id: crypto.randomUUID(), name: b.name ?? 'Bedroom laptop', laptop_pub: b64u.enc(rawPub(crypto.generateKeyPairSync('x25519').publicKey)), exp: Math.floor(Date.now() / 1000) + 600 }; S.joins.push(j); return { qr: JSON.stringify(j) }; },
  push: (b) => new Promise((ok) => execFile('xcrun', ['simctl', 'push', b.udid ?? 'booted', process.env.DEBBIE_BUNDLE_ID ?? 'com.example.debbie', path.join(outDir, 'push-latest.json')], (e, so, se) => ok({ ok: !e, output: String(se || so).trim() }))),
  reset: () => { reset(); return { ok: true }; },
};
const state = () => ({
  home_id: S.homeID, hub_online: S.hubOnline, lan: S.lan, last_lan_fetch_ms: S.lastLanFetch, last_relay_fetch_ms: S.lastRelayFetch, now_ms: Date.now(), monitoring: S.monitoring, heartbeats: S.heartbeats, live_allowed: S.liveAllowed, live_next: S.liveNext,
  pairing: { qr: qrPayload(), awaiting_code: S.pairing.pending?.code ?? null, confirmed: !!S.pairing.pending?.confirmed },
  phones: [...S.phones.values()].map((p) => ({ device_id: p.deviceID, name: p.name, role: p.role, removed: p.removed })),
  outbox: S.outbox.length, sessions: [...S.sessions.values()].map((s) => ({ id: s.id, outcome: s.outcome, ended: s.ended })), log: S.log,
}); // never includes keys, secrets or credentials
async function controlHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PANEL); }
  if (req.method === 'GET' && url.pathname === '/control/state') return send(res, 200, state());
  const action = url.pathname.replace(/^\/control\//, '');
  if (req.method === 'POST' && controls[action]) return send(res, 200, await controls[action]((await readBody(req)) ?? {}));
  err(res, 404, 'not_found');
}
const PANEL = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Debbie mock home</title>
<style>body{font:15px -apple-system,system-ui;margin:24px;max-width:760px;color:#10201a;background:#f3f7f5}h1{font-size:20px}button{font:inherit;margin:3px;padding:8px 12px;border-radius:10px;border:1px solid #0b6e4f;background:#fff;color:#0b5a41}pre{background:#fff;padding:12px;border-radius:10px;white-space:pre-wrap;word-break:break-all}</style>
<h1>Debbie mock home <small>(development only, 127.0.0.1)</small></h1><div id=b></div><h2>State</h2><pre id=s></pre>
<script>const A=${JSON.stringify(Object.keys(controls))};const b=document.getElementById('b');
for(const a of A){const x=document.createElement('button');x.textContent=a;x.onclick=async()=>{const body=a==='live/next'?{outcome:prompt('ready | denied | fail','ready')}:a==='live/end'?{reason:prompt('expired | stopped | resident_turned_off | lost','resident_turned_off')}:{};await fetch('/control/'+a,{method:'POST',body:JSON.stringify(body)});load()};b.append(x)}
async function load(){document.getElementById('s').textContent=JSON.stringify(await (await fetch('/control/state')).json(),null,2)}load();setInterval(load,2000)</script>`;

// ---- Bonjour, like the real bridge: _debbie._tcp, TXT hub=<first 8 b64url chars> --------
let dnssd;
function advertise(port) {
  dnssd?.kill();
  dnssd = spawn('dns-sd', ['-P', 'Debbie Mock Home', '_debbie._tcp', 'local', String(port), 'debbie-mock.local', HOST, `hub=${b64u.enc(S.hubPub).slice(0, 8)}`], { stdio: 'ignore' });
  dnssd.on('error', () => note('dns-sd not available; Bonjour advertisement skipped'));
}

// ---- start ------------------------------------------------------------------------------
// It advertises and prints its pairing code only once every port is listening. If any port can't be had (another
// mock, or the real bridge), it stops the Bonjour advertiser and exits 1: a mock that crashed after advertising had left
// dns-sd announcing it (the build-8 review).
reset();
process.on('SIGINT', () => { dnssd?.kill(); process.exit(0); });
process.on('SIGTERM', () => { dnssd?.kill(); process.exit(0); });
process.on('exit', () => dnssd?.kill());
const servers = [[PORTS.lan, (q, r) => (S.lan === 'moved' ? q.socket.destroy() : lanHandler(q, r))], [PORTS.lanMoved, (q, r) => (S.lan === 'moved' ? lanHandler(q, r) : q.socket.destroy())], [PORTS.relay, relayHandler], [PORTS.control, controlHandler]];
let listening = 0;
for (const [port, handler] of servers) {
  const server = http.createServer((q, r) => handler(q, r).catch?.((e) => { console.error(e); err(r, 500, 'internal'); }));
  server.on('error', (e) => { console.error(`mock home: can't listen on ${HOST}:${port} (${e.code ?? e.message}); stopping`); dnssd?.kill(); process.exit(1); });
  server.listen(port, HOST, () => {
    if (++listening < servers.length) return;
    setInterval(heartbeat, 15_000); heartbeat();
    advertise(PORTS.lan);
    console.log(`Debbie mock home on ${HOST}: LAN ${PORTS.lan}, relay ${PORTS.relay}, control http://${HOST}:${PORTS.control}`);
    console.log(`Pairing QR payload (paste into a Debug build, or set DEBBIE_DEBUG_QR):\n${qrPayload()}`);
  });
}
