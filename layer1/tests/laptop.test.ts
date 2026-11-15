import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  coordinatorUrl,
  hubUrl,
  joinQrPayload,
  parseCheckOutput,
  readWorkerStatus,
} from "../bridge/src/laptop.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";

const contract = (name: string) => path.join(import.meta.dirname, "..", "..", "contracts", name);

test("the typed address becomes the home laptop's bridge, on 7480 unless it names a port", () => {
  const cases = [
    ["192.168.1.20", "192.168.1.20:7480"],
    [" 192.168.1.20:7999 ", "192.168.1.20:7999"],
    ["Kitchen.local", "kitchen.local:7480"],
    ["fe80::1", "[fe80::1]:7480"],
    ["[fe80::1]:7481", "[fe80::1]:7481"],
  ] as const;
  for (const [typed, host] of cases) assert.equal(hubUrl(typed)?.host, host, typed);
  for (const typed of [
    "",
    "http://192.168.1.20",
    "a b",
    "192.168.1.20/v1",
    "user@host",
    "x:99999",
  ]) {
    assert.equal(hubUrl(typed), undefined, typed);
  }
});

test("coordinator_url is ws://<host>:<listen_port>/ws, with IPv6 in brackets", () => {
  const url = (typed: string) => coordinatorUrl(hubUrl(typed) ?? new URL("http://unused"), 7443);
  assert.equal(url("192.168.1.20"), "ws://192.168.1.20:7443/ws");
  assert.equal(url("[fe80::1]:7480"), "ws://[fe80::1]:7443/ws");
  assert.equal(url("kitchen.local"), "ws://kitchen.local:7443/ws");
});

test("the join QR code holds exactly §6.1's seven fields, exp a whole number", () => {
  const payload = joinQrPayload({
    joinId: "join-1",
    name: "Kitchen laptop",
    laptopPublic: Buffer.alloc(32, 7),
    exp: 1794669600,
    hubPublic: "hub-key",
  });
  assert.equal(
    payload,
    `{"v":1,"kind":"join","join_id":"join-1","name":"Kitchen laptop","laptop_pub":"${Buffer.alloc(32, 7).toString("base64url")}","exp":1794669600,"hub_pub":"hub-key"}`,
  );
});

test("worker-status.json: the contract's example reads, and a broken file is reported", async (t) => {
  assert.deepEqual(await readWorkerStatus(contract("worker-status.json")), {
    ok: true,
    state: "connected",
    nodeId: "node-uuid",
  });
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "worker-status.json");
  assert.deepEqual(await readWorkerStatus(file), { ok: true, state: "none" });
  const example = JSON.parse(await readFile(contract("worker-status.json"), "utf8")) as object;
  const { missing, ...withoutMissing } = example as { missing: unknown };
  for (const broken of [
    withoutMissing,
    { ...example, extra: true },
    { ...example, state: "joined" },
    { ...example, updated_at: "yesterday" },
    { missing, ...withoutMissing, schema_version: 2 },
  ]) {
    await writeFile(file, JSON.stringify(broken), "utf8");
    const read = await readWorkerStatus(file);
    assert.ok(
      !read.ok && read.problem.endsWith("doesn't match its contract"),
      JSON.stringify(broken),
    );
  }
});

test("check's output: the contract's example parses, and another shape doesn't", async () => {
  const example = await readFile(contract("check-output.json"), "utf8");
  assert.deepEqual(parseCheckOutput(example), {
    ok: true,
    allRequired: true,
    missing: [{ id: "ollama", reason: "not reachable at http://127.0.0.1:11434", required: false }],
  });
  for (const text of ["OK", "{}", '{"schema_version":1,"ok":"yes","missing":[]}']) {
    assert.equal(parseCheckOutput(text), undefined, text);
  }
});
