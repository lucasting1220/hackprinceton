import assert from "node:assert/strict";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import type { HubStatus } from "../relay/src/push.ts";
import { RelayStore } from "../relay/src/store.ts";
import { type StatusPusher, Watchdog } from "../relay/src/watchdog.ts";
import { waitFor } from "./coordinator-fixtures.ts";
import { tempDir } from "./relay-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 15, 0, 0);
const LIMIT_S = 60;

interface Pushed {
  readonly homeId: string;
  readonly status: HubStatus;
  readonly lastContactMs: number;
}

class RecordingPusher implements StatusPusher {
  readonly pushed: Pushed[] = [];

  hubStatus(homeId: string, status: HubStatus, lastContactMs: number): void {
    this.pushed.push({ homeId, status, lastContactMs });
  }
}

function openStore(t: TestContext, file = ":memory:"): RelayStore {
  const store = RelayStore.open(file);
  t.after(() => store.close());
  return store;
}

function watchdog(store: RelayStore, pusher: StatusPusher, clock: { now: number }): Watchdog {
  return new Watchdog({
    store,
    pusher,
    config: { hub_silent_limit_s: LIMIT_S, watchdog_tick_s: 60 },
    now: () => clock.now,
    log: () => undefined,
  });
}

describe("watchdog: transitions", () => {
  test("a hub silent past the limit gets one hub offline push, and its return one back online", (t) => {
    const store = openStore(t);
    store.createHome("home-a", credentialHash("hub-a"), T0);
    const pusher = new RecordingPusher();
    const clock = { now: T0 };
    const dog = watchdog(store, pusher, clock);
    dog.contact("home-a");
    assert.equal(store.home("home-a")?.lastContactAtMs, T0);

    clock.now = T0 + LIMIT_S * 1000;
    assert.deepEqual(dog.tick(), [], "silent exactly the limit is not offline yet");
    clock.now += 1;
    assert.deepEqual(dog.tick(), ["home-a"]);
    assert.deepEqual(pusher.pushed, [
      { homeId: "home-a", status: "hub_offline", lastContactMs: T0 },
    ]);
    assert.equal(store.home("home-a")?.offlineNotifiedAtMs, clock.now);
    clock.now += 600_000;
    assert.deepEqual(dog.tick(), [], "offline is pushed once");

    clock.now += 1_000;
    dog.contact("home-a");
    assert.deepEqual(pusher.pushed.at(-1), {
      homeId: "home-a",
      status: "back_online",
      lastContactMs: clock.now,
    });
    assert.equal(store.home("home-a")?.offlineNotifiedAtMs, null);
    dog.contact("home-a");
    assert.equal(pusher.pushed.length, 2, "back online is pushed once");
  });

  test("a home whose hub never made contact is not watched, and an unknown home is ignored", (t) => {
    const store = openStore(t);
    store.createHome("home-a", credentialHash("hub-a"), T0);
    const pusher = new RecordingPusher();
    const clock = { now: T0 + 86_400_000 };
    const dog = watchdog(store, pusher, clock);
    assert.deepEqual(dog.tick(), []);
    dog.contact("home-z");
    assert.deepEqual(pusher.pushed, []);
  });

  test("contact within the limit keeps a home online; each home is judged alone", (t) => {
    const store = openStore(t);
    store.createHome("home-a", credentialHash("hub-a"), T0);
    store.createHome("home-b", credentialHash("hub-b"), T0);
    const pusher = new RecordingPusher();
    const clock = { now: T0 };
    const dog = watchdog(store, pusher, clock);
    dog.contact("home-a");
    dog.contact("home-b");
    clock.now = T0 + 50_000;
    dog.contact("home-a");
    clock.now = T0 + 61_000;
    assert.deepEqual(dog.tick(), ["home-b"]);
    assert.deepEqual(
      pusher.pushed.map((push) => push.homeId),
      ["home-b"],
    );
  });
});

describe("watchdog: persistence and the timer", () => {
  test("the offline flag survives a restart: no second offline push, and back online after", async (t) => {
    const file = path.join(await tempDir(t), "relay.db");
    const first = RelayStore.open(file);
    first.createHome("home-a", credentialHash("hub-a"), T0);
    const before = new RecordingPusher();
    const clock = { now: T0 };
    const dog = watchdog(first, before, clock);
    dog.contact("home-a");
    clock.now = T0 + 61_000;
    dog.tick();
    assert.equal(before.pushed.length, 1);
    first.close();

    const store = openStore(t, file);
    const after = new RecordingPusher();
    const restarted = watchdog(store, after, clock);
    clock.now += 120_000;
    assert.deepEqual(restarted.tick(), []);
    restarted.contact("home-a");
    assert.deepEqual(
      after.pushed.map((push) => push.status),
      ["back_online"],
    );
  });

  test("the real timer pushes hub offline after a 1-second limit", async (t) => {
    const store = openStore(t);
    store.createHome("home-a", credentialHash("hub-a"), T0);
    const pusher = new RecordingPusher();
    const dog = new Watchdog({
      store,
      pusher,
      config: { hub_silent_limit_s: 1, watchdog_tick_s: 1 },
      log: () => undefined,
    });
    dog.contact("home-a");
    dog.start();
    t.after(() => dog.stop());
    await waitFor(() => pusher.pushed.length > 0, 5_000);
    assert.equal(pusher.pushed[0]?.status, "hub_offline");
    dog.stop();
    assert.ok(Date.now() - (store.home("home-a")?.lastContactAtMs ?? 0) > 1_000);
  });
});
