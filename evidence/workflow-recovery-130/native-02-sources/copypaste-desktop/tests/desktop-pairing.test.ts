import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  DesktopPairingController,
  type PairingJournal,
  type PairingIO,
} from "../src/desktop-pairing.js";
import {
  verifyPairing,
  type PairingRequest,
  type PairedDevice,
} from "../src/desktop-pairing-contract.js";
const keys = generateKeyPairSync("ed25519"),
  key = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
function fixture() {
  let journal: PairingJournal | null = null,
    epoch: string | null = randomUUID(),
    lost = false,
    offline = false,
    failWrite = 0,
    malformed = false,
    connected: PairedDevice | null = null,
    legacyFail = false;
  const auth = { refresh_token: "x".repeat(43), session_epoch: epoch! },
    tenant = randomUUID();
  const base = {
    name: "Synthetic computer",
    public_key: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    grants: [
      {
        id: randomUUID(),
        label: "Customer originals",
        operations: ["file.read" as const],
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ],
  };
  const cloud = new Map<string, PairedDevice>(),
    retired = new Set<string>(),
    calls: PairingRequest[] = [],
    events: string[] = [];
  const io: PairingIO = {
    read: async () => structuredClone(journal),
    write: async (j) => {
      events.push("write");
      if (failWrite > 0 && --failWrite === 0) throw Error("disk failure");
      journal = structuredClone(j);
    },
    epoch: async () => epoch,
    pair: async (b) => {
      assert.equal(verifyPairing("pair", b), true);
      events.push("post");
      calls.push(structuredClone(b));
      if (retired.has(b.input.id)) throw Error("PAIRING_RETIRED");
      let d = cloud.get(b.input.id);
      if (!d) {
        d = {
          id: randomUUID(),
          name: b.input.name,
          client: "desktop",
          state: "active",
          grants: structuredClone(b.input.grants),
        };
        cloud.set(b.input.id, d);
      }
      if (lost) {
        lost = false;
        throw Error("lost reply");
      }
      return { pairing_id: malformed ? randomUUID() : b.input.id, device: d };
    },
    retire: async (b) => {
      assert.equal(verifyPairing("retire", b), true);
      assert.equal(verifyPairing("pair", b), false);
      events.push("retire");
      if (offline) throw Error("offline");
      retired.add(b.input.id);
      cloud.delete(b.input.id);
      return { pairing_id: b.input.id, status: "retired" };
    },
    legacy: async () => {
      events.push("legacy");
      if (legacyFail) throw Error("legacy revoke failed");
    },
    connect: async (_t, d) => {
      events.push("connect");
      connected = d;
    },
    clear: async () => {
      connected = null;
      events.push("clear");
    },
  };
  const controller = new DesktopPairingController(io);
  return {
    controller,
    io,
    auth,
    base,
    tenant,
    cloud,
    retired,
    calls,
    events,
    pair: (legacy?: string) => controller.pair(tenant, base, auth, key, legacy),
    get journal() {
      return journal;
    },
    get connected() {
      return connected;
    },
    set lost(v: boolean) {
      lost = v;
    },
    set offline(v: boolean) {
      offline = v;
    },
    set epoch(v: string | null) {
      epoch = v;
    },
    set failWrite(v: number) {
      failWrite = v;
    },
    set malformed(v: boolean) {
      malformed = v;
    },
    set legacyFail(v: boolean) {
      legacyFail = v;
    },
  };
}
test("a lost create reply retries the durable signed ID and connects exactly one server device", async () => {
  const f = fixture();
  f.lost = true;
  await assert.rejects(f.pair(), /lost reply/);
  assert.equal(f.journal!.entries[0].state, "prepared");
  assert.equal(f.connected, null);
  assert.equal(f.cloud.size, 1);
  const d = await f.pair();
  assert.equal(f.cloud.size, 1);
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.connected?.id, d.id);
  assert.ok(f.events.indexOf("write") < f.events.indexOf("post"));
});
test("failed legacy retirement prevents replacement without losing the original local mapping", async () => {
  const f = fixture();
  f.legacyFail = true;
  await assert.rejects(f.pair(randomUUID()), /legacy revoke failed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.journal, null);
  assert.deepEqual(f.events, ["legacy"]);
});
test("a failed durable prepare writes no network request", async () => {
  const f = fixture();
  f.failWrite = 1;
  await assert.rejects(f.pair(), /disk failure/);
  assert.equal(f.calls.length, 0);
});
test("a disk failure after the create reply remains recoverable from the original prepared intent", async () => {
  const f = fixture();
  f.failWrite = 2;
  await assert.rejects(f.pair(), /disk failure/);
  assert.equal(f.journal!.entries[0].state, "prepared");
  assert.equal(f.connected, null);
  await f.pair();
  assert.equal(f.cloud.size, 1);
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test("withdrawal retains a signed unknown create while offline and retires it on a new controller", async () => {
  const f = fixture();
  f.lost = true;
  await assert.rejects(f.pair());
  await f.controller.withdraw();
  f.offline = true;
  assert.equal(await f.controller.flush(), 1);
  assert.equal(f.journal!.entries.length, 1);
  f.offline = false;
  const restarted = new DesktopPairingController(f.io);
  await restarted.flush();
  assert.equal(f.cloud.size, 0);
  assert.equal(f.journal!.entries.length, 0);
  assert.equal(f.retired.size, 1);
});
test("changed grants cannot create replacement work before the earlier unknown intent is retired", async () => {
  const f = fixture();
  f.lost = true;
  await assert.rejects(f.pair());
  const id = f.calls[0].input.id;
  f.base.grants[0].label = "New folder label";
  f.offline = true;
  await assert.rejects(f.pair(), /offline/);
  assert.equal(f.calls.length, 1);
  f.offline = false;
  await f.pair();
  assert.equal(f.retired.has(id), true);
  assert.equal(f.cloud.size, 1);
  assert.notEqual(f.calls[1].input.id, id);
});
test("account changes during a late create reply cannot reconnect the old device", async () => {
  const f = fixture(),
    post = f.io.pair;
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  f.io.pair = async (b) => {
    await wait;
    return post(b);
  };
  const task = f.pair();
  while (!f.journal) await new Promise((r) => setTimeout(r, 1));
  f.epoch = randomUUID();
  const withdraw = f.controller.withdraw();
  release();
  await assert.rejects(task, /PAIRING_ACCOUNT_CHANGED/);
  await withdraw;
  assert.equal(f.connected, null);
  assert.equal(f.journal!.entries[0].state, "retiring");
  await f.controller.flush();
  assert.equal(f.cloud.size, 0);
});
test("startup marks a previous account's intent for retirement and clears only device connections", async () => {
  const f = fixture();
  await f.pair();
  f.epoch = null;
  await new DesktopPairingController(f.io).initialize();
  assert.equal(f.connected, null);
  assert.equal(f.journal!.entries[0].state, "retiring");
});
test("an invalid server receipt never activates a device and preserves its withdrawal proof", async () => {
  const f = fixture();
  f.malformed = true;
  await assert.rejects(f.pair(), /PAIRING_RECEIPT_INVALID/);
  assert.equal(f.connected, null);
  assert.equal((await f.controller.removals()).length, 1);
});
test("an explicitly server-retired pairing is not automatically recreated", async () => {
  const f = fixture();
  await f.pair();
  f.retired.add(f.calls[0].input.id);
  await assert.rejects(f.pair(), /PAIRING_RETIRED/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.cloud.size, 1);
  assert.equal(f.journal!.entries[0].state, "retiring");
});
test("known paired devices reuse their frozen intent without deleting the active device", async () => {
  const f = fixture();
  const d = await f.pair();
  await f.pair(d.id);
  assert.equal(f.events.includes("legacy"), false);
  assert.equal(f.cloud.size, 1);
  assert.equal(f.calls[0].input.id, f.calls[1].input.id);
});
test("uninstall retirement handles a durable copy after background cleanup already removed the local entry", async () => {
  const f = fixture();
  await f.pair();
  const [request] = await f.controller.removals();
  await f.controller.withdraw();
  await f.controller.flush();
  assert.equal(f.journal!.entries.length, 0);
  assert.equal((await f.controller.retire(request)).status, "retired");
});
