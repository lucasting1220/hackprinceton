import assert from "node:assert/strict";
import { createSecretKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import {
  type AcceptedWorker,
  acceptedWorkers,
  createHome,
  readHomeSecrets,
} from "../bridge/src/home.ts";
import { HubJoin } from "../bridge/src/hub-join.ts";
import { JsonFileError } from "../bridge/src/json-file.ts";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import { openTicket } from "../bridge/src/laptop.ts";
import type { Reply } from "../bridge/src/network-server.ts";
import {
  fromBase64url,
  KEY_BYTES,
  rawPublicKey,
  toBase64url,
  tokenSha256,
} from "../bridge/src/phone-crypto.ts";
import type { PhoneLookup, PhoneRole } from "../bridge/src/phones.ts";
import * as settings from "../bridge/src/settings.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";
import { phoneWrapper } from "./fake-phone.ts";

const START_MS = Date.UTC(2026, 10, 14, 15, 10, 0);

function code(reply: Reply): unknown {
  const error: unknown = Reflect.get(reply.body, "error");
  return error === undefined ? undefined : Reflect.get(Object(error), "code");
}

/** A home in a temporary folder, its HubJoin with a test clock, and a LAN gateway that uses it. */
async function fixture(t: TestContext, addWorker?: (worker: AcceptedWorker) => Promise<void>) {
  const stateDir = await makeTempDir();
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const home = await createHome(stateDir);
  const { hubPrivateKey } = await readHomeSecrets(stateDir);
  const clock = { ms: START_MS };
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const join = new HubJoin({
    home,
    hubPrivateKey,
    now: () => clock.ms,
    log,
    ...(addWorker === undefined ? {} : { addWorker }),
  });
  const keys = new Map<string, { role: PhoneRole; phoneKey: ReturnType<typeof createSecretKey> }>();
  const phones = {
    lookup: (deviceId: string): PhoneLookup => {
      const phone = keys.get(deviceId);
      return phone === undefined ? { state: "unknown" } : { state: "paired", ...phone };
    },
    remove: async () => undefined,
  };
  const handlers = { laptop_approval: join.approve.bind(join) };
  const gateway = new LanGateway({
    homeId: home.homeId,
    phones,
    now: () => clock.ms,
    log,
    handlers,
  });
  /** A laptop that asks to join: its key pair and the hub's answer. */
  const laptop = (name = "Kitchen laptop") => {
    const { privateKey } = generateKeyPairSync("x25519");
    const laptopPublic = rawPublicKey(privateKey);
    const reply = join.request({ v: 1, name, laptop_pub: toBase64url(laptopPublic) });
    const joinId = String(Reflect.get(reply.body, "join_id"));
    return { privateKey, laptopPublic, reply, joinId, name };
  };
  /** A paired phone's laptop_approval for `asked`, through the gateway. */
  const phone = (role: PhoneRole = "caregiver") => {
    const deviceId = `phone-${keys.size}`;
    const phoneKey = createSecretKey(randomBytes(32));
    keys.set(deviceId, { role, phoneKey });
    return (
      asked: ReturnType<typeof laptop>,
      fields: Record<string, unknown> = {},
      msgId?: string,
    ) =>
      gateway.commands(
        phoneWrapper(phoneKey, {
          homeId: home.homeId,
          deviceId,
          ...(msgId === undefined ? {} : { msgId }),
          type: "laptop_approval",
          sentAt: utcSeconds(new Date(clock.ms)),
          fields: {
            join_id: asked.joinId,
            laptop_pub: toBase64url(asked.laptopPublic),
            name: asked.name,
            approve: true,
            ...fields,
          },
        }),
      );
  };
  const status = (joinId: string) => join.status({ v: 1, join_id: joinId });
  return { home, join, clock, lines, laptop, phone, status };
}

test("a join request is checked, answered with join_id, a whole-number exp and hub_pub", async (t) => {
  const f = await fixture(t);
  const asked = f.laptop();
  assert.equal(asked.reply.status, 202);
  const exp = Math.floor((START_MS + settings.JOIN_CODE_LIFETIME_MS) / 1000);
  assert.deepEqual(asked.reply.body, {
    v: 1,
    join_id: asked.joinId,
    exp,
    hub_pub: f.home.hubPublicKey,
  });
  const key = toBase64url(asked.laptopPublic);
  for (const body of [
    { v: 1, name: "", laptop_pub: key },
    { v: 1, name: "a‮b", laptop_pub: key },
    { v: 1, name: "Laptop", laptop_pub: toBase64url(Buffer.alloc(32)) },
    { v: 1, name: "Laptop", laptop_pub: "short" },
    { name: "Laptop", laptop_pub: key },
    [],
  ]) {
    assert.equal(code(f.join.request(body)), "bad_request", JSON.stringify(body));
  }
  assert.equal(
    code(f.join.request({ v: 2, name: "Laptop", laptop_pub: key })),
    "unsupported_version",
  );
  assert.deepEqual(f.status(asked.joinId), { status: 202, body: { v: 1, status: "waiting", exp } });
  assert.equal(f.status("nobody").status, 404);
});

test("at most 8 joins wait at once; an expired one stops counting and answers 410", async (t) => {
  const f = await fixture(t);
  const first = f.laptop();
  for (let index = 1; index < settings.JOINS_PENDING_MAX; index += 1) {
    assert.equal(f.laptop().reply.status, 202);
  }
  const refused = f.laptop().reply;
  assert.deepEqual([refused.status, code(refused)], [429, "too_many_joins"]);
  f.clock.ms += settings.JOIN_CODE_LIFETIME_MS;
  assert.equal(f.laptop().reply.status, 202);
  assert.deepEqual([f.status(first.joinId).status, code(f.status(first.joinId))], [410, "expired"]);
  const late = await f.phone()(first);
  assert.deepEqual([late.status, code(late)], [400, "expired"]);
});

test("an approval mints one token, lists its hash first, and the ticket opens with the laptop's key", async (t) => {
  const f = await fixture(t);
  const asked = f.laptop();
  const approve = f.phone();
  const [one, two] = await Promise.all([approve(asked), approve(asked)]);
  assert.deepEqual(
    [one, two],
    [
      { status: 202, body: { v: 1, accepted: true } },
      { status: 202, body: { v: 1, accepted: true } },
    ],
  );
  const workers = await acceptedWorkers(f.home);
  assert.equal(workers.length, 1, "two approvals at once minted two tokens");
  const answer = f.status(asked.joinId);
  assert.equal(answer.status, 200);
  const session = {
    privateKey: asked.privateKey,
    laptopPublic: asked.laptopPublic,
    joinId: asked.joinId,
    hubPublic: fromBase64url(f.home.hubPublicKey, KEY_BYTES),
  };
  const ticket = openTicket(Reflect.get(answer.body, "ticket"), session);
  assert.deepEqual(workers[0], {
    node_id: ticket.node_id,
    display_name: "Kitchen laptop",
    token_sha256: tokenSha256(ticket.join_token),
  });
  assert.deepEqual([ticket.home_id, ticket.coordinator_port], [f.home.homeId, f.home.listenPort]);
  const other = { ...session, privateKey: generateKeyPairSync("x25519").privateKey };
  assert.throws(() => openTicket(Reflect.get(answer.body, "ticket"), other), /doesn't open/);
  assert.throws(() => openTicket(Reflect.get(answer.body, "ticket"), { ...session, joinId: "x" }));
  // Approved already: 202 again, and nothing new is minted.
  assert.equal((await approve(asked)).status, 202);
  assert.equal((await acceptedWorkers(f.home)).length, 1);
  const logged = f.lines.join("\n");
  assert.ok(
    !logged.includes(ticket.join_token) && !logged.includes(tokenSha256(ticket.join_token)),
  );
  assert.ok(!logged.includes("Kitchen laptop"), "a laptop's chosen name was logged");
});

test("approval refusals are 400s with their codes, a repeat is 409, and never 403", async (t) => {
  const f = await fixture(t);
  const asked = f.laptop();
  const refusedBy = async (reply: Promise<Reply>, status: number, expected: string) => {
    const answer = await reply;
    assert.deepEqual([answer.status, code(answer)], [status, expected]);
  };
  await refusedBy(f.phone("resident")(asked), 400, "forbidden");
  const approve = f.phone();
  await refusedBy(approve(asked, { join_id: "nobody" }), 400, "unknown_join");
  await refusedBy(approve(asked, { name: "Other laptop" }), 400, "join_mismatch");
  const otherKey = rawPublicKey(generateKeyPairSync("x25519").privateKey);
  await refusedBy(approve(asked, { laptop_pub: toBase64url(otherKey) }), 400, "join_mismatch");
  await refusedBy(approve(asked, { approve: "yes" }), 400, "bad_request");
  await refusedBy(approve(asked, { name: "" }), 400, "bad_request");
  assert.equal(f.status(asked.joinId).status, 202, "a refused approval changed the join");
  // The opener refuses a repeated msg_id before the handler sees it.
  assert.equal((await approve(asked, { approve: false }, "decline-1")).status, 202);
  await refusedBy(approve(asked, { approve: false }, "decline-1"), 409, "duplicate");
  assert.deepEqual(
    [f.status(asked.joinId).status, code(f.status(asked.joinId))],
    [409, "declined"],
  );
  await refusedBy(approve(asked), 400, "expired");
  assert.deepEqual(await acceptedWorkers(f.home), []);
});

test("while the accepted-workers write is held no ticket exists, and a failed write leaves the join waiting", async (t) => {
  let release: () => void = () => undefined;
  let fail = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async () => {
    await held;
    if (fail) throw new JsonFileError("accepted-workers.json: EACCES", "accepted-workers.json");
  });
  const asked = f.laptop();
  fail = true;
  const approval = f.phone()(asked);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.status(asked.joinId).status, 202, "a ticket existed before the write");
  release();
  const answer = await approval;
  assert.deepEqual([answer.status, code(answer)], [500, "internal"]);
  assert.equal(f.status(asked.joinId).status, 202);
  assert.match(f.join.listing().problem ?? "", /couldn't add a laptop to the home/);
  fail = false;
  assert.equal((await f.phone()(asked)).status, 202, "the caregiver can approve again");
  assert.equal(f.status(asked.joinId).status, 200);
  assert.equal(f.join.listing().problem, undefined);
});

test("an accepted-workers.json that already breaks Layer 2's rules is left untouched", async (t) => {
  const f = await fixture(t);
  const broken = '{"schema_version":1,"workers":[{"node_id":"a"}]}';
  await writeFile(f.home.acceptedWorkersFile, broken, "utf8");
  const answer = await f.phone()(f.laptop());
  assert.equal(answer.status, 500);
  assert.equal(await readFile(f.home.acceptedWorkersFile, "utf8"), broken);
  assert.match(f.join.listing().problem ?? "", /is not valid: workers\[0\]/);
});
