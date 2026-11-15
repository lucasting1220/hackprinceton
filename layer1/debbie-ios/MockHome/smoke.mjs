#!/usr/bin/env node
// Smoke test for the mock home (fastlane `test` lane). Starts MockHome/server.mjs and plays a phone with
// Node's built-in crypto (proven byte-identical to the app's CryptoKit by tools/contracts/verify-vectors.mjs):
// pair → LAN fetch + decrypt → alert via relay → ack over LAN → heart rate over LAN → live view → removed phone.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const b64u = { enc: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64') };
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'ascii'), len));
const adFor = (homeID, kid, type) => Buffer.from(kid === 'pair' ? 'debbie/v1/pair' : `debbie/v1/${homeID}/${kid}/${type}`, 'ascii');
function seal(key, kid, homeID, type, obj) {
  const n = crypto.randomBytes(12), pt = Buffer.from(JSON.stringify(obj));
  const c = crypto.createCipheriv('chacha20-poly1305', key, n, { authTagLength: 16 }); c.setAAD(adFor(homeID, kid, type), { plaintextLength: pt.length });
  return { v: 1, kid, n: b64u.enc(n), c: b64u.enc(Buffer.concat([c.update(pt), c.final(), c.getAuthTag()])) };
}
function open(key, env, homeID, type) {
  const c = b64u.dec(env.c), d = crypto.createDecipheriv('chacha20-poly1305', key, b64u.dec(env.n), { authTagLength: 16 });
  d.setAAD(adFor(homeID, env.kid, type), { plaintextLength: c.length - 16 }); d.setAuthTag(c.subarray(c.length - 16));
  return JSON.parse(Buffer.concat([d.update(c.subarray(0, c.length - 16)), d.final()]).toString());
}
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` (${extra})` : ''}`); };
const req = async (url, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The smoke test starts its own mock on its own ports (7670 unless DEBBIE_MOCK_PORT_BASE says otherwise), so it runs
// beside a mock already up on the default 7570, and never touches the real bridge's 7470 and 7480.
const BASE = Number(process.env.DEBBIE_MOCK_PORT_BASE ?? 7670);
const CONTROL = `http://127.0.0.1:${BASE}/control/`;

const server = spawn(process.execPath, [path.join(here, 'server.mjs'), '--auto-confirm'], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, DEBBIE_MOCK_PORT_BASE: String(BASE) } });
let out = ''; server.stdout.on('data', (d) => (out += d));
try {
  for (let i = 0; i < 50 && !out.includes('Pairing QR payload'); i++) await sleep(100);
  const qr = JSON.parse(out.split('\n').find((l) => l.startsWith('{"v":1')));
  check('QR payload has addrs, hub_pub, 16-byte secret, exp', qr.addrs?.length && b64u.dec(qr.hub_pub).length === 32 && b64u.dec(qr.secret).length === 16 && qr.exp > Date.now() / 1000);
  // Pairing (CONTRACTS §4).
  const kp = crypto.generateKeyPairSync('x25519');
  const phonePub = b64u.dec(kp.publicKey.export({ format: 'jwk' }).x);
  const secret = b64u.dec(qr.secret), name = 'Zoë’s iPhone', role = 'caregiver';
  const proof = crypto.createHmac('sha256', secret).update(Buffer.concat([phonePub, Buffer.from(role), Buffer.from([0]), Buffer.from(name.normalize('NFC'))])).digest();
  const shared = crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: qr.hub_pub }, format: 'jwk' }) });
  const phoneKey = hkdf(shared, secret, 'debbie/v1/phone-key', 32);
  const LAN = `http://${qr.addrs[0]}`;
  const pairBody = { v: 1, phone_pub: b64u.enc(phonePub), name, role, proof: b64u.enc(proof) };
  const bad = await req(`${LAN}/v1/pair`, { method: 'POST', body: { ...pairBody, proof: b64u.enc(crypto.randomBytes(32)) } });
  check('a wrong proof is refused', bad.status === 403 && bad.json?.error?.code === 'bad_proof');
  let r = await req(`${LAN}/v1/pair`, { method: 'POST', body: pairBody });
  check('first pairing request → 202 awaiting', r.status === 202 && r.json?.status === 'awaiting');
  const myCode = String(hkdf(shared, secret, 'debbie/v1/code', 4).readUInt32BE(0) % 10000).padStart(4, '0');
  const state0 = (await req(CONTROL + 'state')).json;
  check('laptop and phone show the same 4-digit code', state0.pairing.awaiting_code === myCode, myCode);
  await sleep(1800);
  r = await req(`${LAN}/v1/pair`, { method: 'POST', body: pairBody });
  check('after Confirm → 200 confirmed with a bundle', r.status === 200 && r.json?.status === 'confirmed' && r.json.bundle?.kid === 'pair');
  const bundle = open(phoneKey, r.json.bundle, null, 'pair');
  check('bundle decrypts under the phone key', !!bundle.device_id && !!bundle.home_key && !!bundle.device_credential);
  const again = await req(`${LAN}/v1/pair`, { method: 'POST', body: pairBody });
  check('the pairing code is single-use', again.status !== 200);
  const homeKey = b64u.dec(bundle.home_key), H = bundle.home_id, D = bundle.device_id;
  const lanReq = async (p, type, plain) => {
    const msg_id = crypto.randomUUID(), body = { ...plain, msg_id, sent_at: iso(), type };
    return req(`${LAN}${p}`, { method: 'POST', body: { v: 1, msg_id, type, sent_at: iso(), envelope: seal(phoneKey, D, H, type, body) } });
  };
  // LAN fetch.
  r = await lanReq('/v1/lan/messages', 'fetch', { after: null, limit: 50 });
  const hb = r.json?.messages?.find((m) => m.type === 'heartbeat');
  check('LAN fetch returns an encrypted heartbeat', r.status === 200 && !!hb && hb.envelope.kid === 'home');
  check('heartbeat decrypts under the home key', open(homeKey, hb.envelope, H, 'heartbeat').state === 'ok');
  const stale = await req(`${LAN}/v1/lan/messages`, { method: 'POST', body: { v: 1, msg_id: 'x', type: 'fetch', sent_at: iso(), envelope: seal(phoneKey, D, H, 'fetch', { msg_id: 'x', type: 'fetch', sent_at: '2020-01-01T00:00:00Z' }) } });
  check('a stale LAN request is refused', stale.status === 400 && stale.json?.error?.code === 'stale');
  // Alert through the relay.
  const auth = { 'X-Debbie-Device': D, Authorization: `Bearer ${bundle.device_credential}` };
  const { json: { alert_id } } = await req(CONTROL + 'alert', { method: 'POST', body: {} });
  r = await req(`${bundle.relay_url}/v1/messages?limit=50`, { headers: auth });
  const aw = r.json?.messages?.find((m) => m.type === 'alert');
  const alert = aw && open(homeKey, aw.envelope, H, 'alert');
  check('relay delivers the alert, readable only with the home key', r.status === 200 && alert?.alert_id === alert_id && alert.severity === 'urgent');
  check('the relay refuses a wrong credential', (await req(`${bundle.relay_url}/v1/messages`, { headers: { ...auth, Authorization: 'Bearer nope' } })).status === 401);
  // Acknowledge over LAN, heart rate over LAN only.
  r = await lanReq('/v1/lan/commands', 'ack', { alert_id, acked_at: iso(), false_alarm: false });
  check('acknowledgement accepted over the LAN', r.status === 200);
  r = await lanReq('/v1/lan/heart-rate', 'heart_rate', { samples: [{ t: iso(), bpm: 71 }, { t: iso(), bpm: 73 }] });
  check('heart rate accepted over the LAN gateway', r.status === 200 && r.json?.accepted === 2);
  // Live view: requesting → ready; then ended by the resident.
  const lvID = crypto.randomUUID();
  r = await req(`${bundle.relay_url}/v1/live-view/sessions`, { method: 'POST', headers: auth, body: { v: 1, msg_id: lvID, type: 'live_view_request', sent_at: iso(), envelope: seal(phoneKey, D, H, 'live_view_request', { msg_id: lvID, sent_at: iso(), type: 'live_view_request', request_id: crypto.randomUUID(), viewer_client_id: D }) } });
  const sid = r.json?.session_id;
  check('live view session created', r.status === 201 && !!sid);
  check('session starts as requested', (await req(`${bundle.relay_url}/v1/live-view/sessions/${sid}`, { headers: auth })).json?.state === 'requested');
  await sleep(1600);
  const ready = (await req(`${bundle.relay_url}/v1/live-view/sessions/${sid}`, { headers: auth })).json;
  check('session becomes ready with viewer details', ready?.state === 'ready' && !!ready.viewer?.signaling_url);
  await req(CONTROL + 'live/end', { method: 'POST', body: { reason: 'resident_turned_off' } });
  const ended = (await req(`${bundle.relay_url}/v1/live-view/sessions/${sid}`, { headers: auth })).json;
  check('resident ends live view', ended?.state === 'ended' && ended.reason === 'resident_turned_off');
  // Hub offline, then a removed phone.
  await req(CONTROL + 'hub/offline', { method: 'POST' });
  check('relay reports hub offline', (await req(`${bundle.relay_url}/v1/home`, { headers: auth })).json?.hub?.online === false);
  await req(CONTROL + 'hub/online', { method: 'POST' });
  await req(CONTROL + 'phone/remove', { method: 'POST', body: { device_id: D } });
  r = await req(`${bundle.relay_url}/v1/messages`, { headers: auth });
  check('removed phone: relay 401 device_removed', r.status === 401 && r.json?.error?.code === 'device_removed');
  r = await lanReq('/v1/lan/messages', 'fetch', { after: null, limit: 5 });
  check('removed phone: LAN 403 device_removed', r.status === 403 && r.json?.error?.code === 'device_removed');
  const st = JSON.stringify((await req(CONTROL + 'state')).json);
  check('control state never includes keys or credentials', !st.includes(bundle.home_key) && !st.includes(bundle.device_credential));
} catch (e) {
  fail++; console.log(`✗ smoke test crashed: ${e.message}`);
} finally {
  server.kill('SIGTERM');
}
console.log(`${pass}/${pass + fail} mock-home checks passed`);
process.exit(fail ? 1 : 0);
