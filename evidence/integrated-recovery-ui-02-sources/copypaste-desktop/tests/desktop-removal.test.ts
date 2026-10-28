import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  DesktopRemovalController,
  type RemovalIO,
  type RemovalJournal,
} from "../src/desktop-removal.js";
import {
  verifyDisconnectProof,
  type DesktopDisconnectRequest,
} from "../src/desktop-disconnect-contract.js";
import { UpdateAdmission } from "../src/update-admission.js";
import {
  pairingProtocol,
  pairingMessage,
  type PairingRequest,
} from "../src/desktop-pairing-contract.js";
import { sign } from "node:crypto";

const pair = generateKeyPairSync("ed25519"),
  private_key = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
function fixture(count = 2) {
  let journal: RemovalJournal | null = null,
    marked = false,
    blocked = false,
    consent = true,
    online = true,
    malformed = false,
    cacheFails = false,
    hostFails = false,
    markFails = false,
    unmarkFails = false;
  let snapshot = {
    refresh_token: "s".repeat(43),
    private_key,
    devices: Object.fromEntries(
      Array.from({ length: count }, () => [randomUUID(), randomUUID()]),
    ),
  };
  const events: string[] = [],
    posts: DesktopDisconnectRequest[] = [];
  const gate = new UpdateAdmission(() => !blocked);
  const io: RemovalIO = {
    read: async () => structuredClone(journal),
    write: async (next) => {
      events.push("write");
      journal = structuredClone(next);
    },
    marked: async () => marked,
    mark: async () => {
      events.push("mark");
      if (markFails) throw new Error("disk unavailable");
      marked = true;
    },
    unmark: async () => {
      if (unmarkFails) throw new Error("disk unavailable");
      marked = false;
    },
    exclusive: (fn) => fn(),
    acquire: () => gate.acquire(),
    block: (v) => {
      blocked = v;
    },
    confirm: async (clearCache) => ({ confirmed: consent, clearCache }),
    capture: async () => {
      events.push("capture");
      return structuredClone(snapshot);
    },
    withdraw: async () => {
      assert.ok(marked);
      events.push("withdraw");
      snapshot = { refresh_token: "", private_key, devices: {} };
    },
    unregister: async () => {
      events.push("unregister");
      if (hostFails) throw new Error("registry unavailable");
      return "removed";
    },
    clearCache: async () => {
      events.push("clear-cache");
      if (cacheFails) throw new Error("cache in use");
    },
    post: async (body) => {
      events.push("post");
      posts.push(structuredClone(body));
      if (!online) throw new Error("offline");
      return {
        ok: true,
        request_id: malformed ? randomUUID() : body.request_id,
        devices: body.devices.map((d) => ({
          tenant_id: d.tenant_id,
          device_id: d.device_id,
          status: "revoked",
        })),
      };
    },
    changed: () => {},
  };
  const controller = new DesktopRemovalController(io);
  return {
    controller,
    io,
    gate,
    events,
    posts,
    get journal() {
      return journal;
    },
    get marked() {
      return marked;
    },
    get blocked() {
      return blocked;
    },
    set consent(v: boolean) {
      consent = v;
    },
    set online(v: boolean) {
      online = v;
    },
    set malformed(v: boolean) {
      malformed = v;
    },
    set cacheFails(v: boolean) {
      cacheFails = v;
    },
    set hostFails(v: boolean) {
      hostFails = v;
    },
    set markFails(v: boolean) {
      markFails = v;
    },
    set unmarkFails(v: boolean) {
      unmarkFails = v;
    },
    set snapshot(v: typeof snapshot) {
      snapshot = v;
    },
  };
}
test("cancelling native confirmation leaves credentials, grants, registry, cache and cloud untouched", async () => {
  const f = fixture();
  f.consent = false;
  const result = await f.controller.prepare(true);
  assert.equal(result.cancelled, true);
  assert.equal(result.disabled, false);
  assert.equal(f.journal, null);
  assert.deepEqual(f.events, []);
  assert.equal(f.posts.length, 0);
  await f.gate.run(async () => {});
});
test("confirmed removal durably signs each device before auth withdrawal and returns no credentials or original paths", async () => {
  const f = fixture(),
    result = await f.controller.prepare(true);
  assert.equal(result.disabled, true);
  assert.equal(result.remote, "disconnected");
  assert.equal(result.cache, "cleared");
  assert.equal(f.posts.length, 1);
  assert.ok(f.events.indexOf("write") < f.events.indexOf("mark"));
  assert.ok(f.events.indexOf("mark") < f.events.indexOf("withdraw"));
  assert.ok(f.events.indexOf("withdraw") < f.events.indexOf("post"));
  assert.ok(
    f.posts[0].devices.every((d) =>
      verifyDisconnectProof(f.posts[0], d, publicKey),
    ),
  );
  assert.equal(f.journal?.pending.length, 0);
  assert.ok(!JSON.stringify(result).includes("refresh_token"));
  assert.ok(!JSON.stringify(f.journal).includes("PRIVATE KEY"));
  await assert.rejects(
    f.gate.run(async () => {}),
    /DESKTOP_DISCONNECTED/,
  );
});
test("large installation inventories use distinct bounded 64-device requests and retire every device exactly once", async () => {
  const f = fixture(130);
  await f.controller.prepare(false);
  assert.deepEqual(
    f.posts.map((p) => p.devices.length),
    [64, 64, 2],
  );
  assert.equal(new Set(f.posts.map((p) => p.request_id)).size, 3);
  assert.equal(
    new Set(f.posts.flatMap((p) => p.devices.map((d) => d.device_id))).size,
    130,
  );
});
test("offline retirement still stops local work and retains the exact encrypted-store payload for idempotent retry", async () => {
  const f = fixture();
  f.online = false;
  const pending = await f.controller.prepare(false);
  assert.equal(pending.remote, "pending");
  assert.equal(pending.disabled, true);
  assert.equal(pending.cache, "retained");
  const original = f.posts[0];
  f.online = true;
  const done = await f.controller.retry();
  assert.equal(done.remote, "disconnected");
  assert.deepEqual(f.posts[1], original);
  assert.equal(f.journal?.pending.length, 0);
  assert.equal(f.events.filter((e) => e === "capture").length, 1);
});
test("a malformed or unverified acknowledgement cannot erase the withdrawal credential", async () => {
  const f = fixture();
  f.malformed = true;
  assert.equal((await f.controller.prepare(false)).remote, "pending");
  assert.equal(f.journal?.pending.length, 1);
  f.malformed = false;
  f.io.post = async (body) => ({
    ok: true,
    request_id: body.request_id,
    devices: body.devices.map((d) => ({
      tenant_id: d.tenant_id,
      device_id: d.device_id,
      status: "unverified",
    })),
  });
  assert.equal((await f.controller.retry()).remote, "unverified");
  assert.equal(f.journal?.pending.length, 1);
});
test("missing identity fails before local auth or customer files can be cleared", async () => {
  const f = fixture();
  f.snapshot = {
    refresh_token: "",
    private_key: "",
    devices: { [randomUUID()]: randomUUID() },
  };
  await assert.rejects(
    f.controller.prepare(true),
    /DISCONNECT_IDENTITY_UNAVAILABLE/,
  );
  assert.equal(f.journal, null);
  assert.equal(f.marked, false);
  assert.ok(!f.events.includes("withdraw"));
});
test("a crash between durable outbox and marker creation resumes local withdrawal before any cloud request", async () => {
  const f = fixture();
  f.markFails = true;
  await assert.rejects(f.controller.prepare(false), /disk unavailable/);
  assert.ok(f.journal?.pending.length);
  assert.equal(f.posts.length, 0);
  assert.equal(f.marked, false);
  f.markFails = false;
  const resumed = new DesktopRemovalController(f.io);
  await resumed.initialize();
  assert.equal(f.marked, true);
  assert.equal(f.blocked, true);
  await resumed.retry();
  assert.ok(f.events.indexOf("withdraw") < f.events.indexOf("post"));
  assert.equal(f.journal?.pending.length, 0);
});
test("cache and registry failures stay individually unfinished and are retried without regenerating device proofs", async () => {
  const f = fixture();
  f.cacheFails = true;
  f.hostFails = true;
  const first = await f.controller.prepare(true);
  assert.equal(first.cache, "retry");
  assert.equal(first.host, "retry");
  assert.equal(first.disabled, true);
  f.cacheFails = false;
  f.hostFails = false;
  const second = await f.controller.retry();
  assert.equal(second.cache, "cleared");
  assert.equal(second.host, "removed");
  assert.equal(f.events.filter((e) => e === "capture").length, 1);
});
test("another installation's Chrome registration is retained and is an explicit completed local outcome", async () => {
  const f = fixture();
  f.io.unregister = async () => "foreign";
  assert.equal((await f.controller.prepare(false)).host, "foreign");
});
test("admission blocks removal during another IPC and blocks new file work while native confirmation is open", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = f.gate.run(() => new Promise<void>((r) => (release = r)));
  await assert.rejects(
    f.controller.prepare(false),
    /UPDATE_LOCAL_WORK_PENDING/,
  );
  release();
  await pending;
  await new Promise((r) => setImmediate(r));
  let confirm!: () => void;
  f.io.confirm = async () => {
    await new Promise<void>((r) => (confirm = r));
    return { confirmed: false, clearCache: false };
  };
  const removing = f.controller.prepare(false);
  await assert.rejects(
    f.gate.run(async () => {}),
    /UPDATE_INSTALLATION_IN_PROGRESS/,
  );
  confirm();
  await removing;
  await f.gate.run(async () => {});
});
test("fresh sign-in reactivates without restoring prior grants, while old offline requests retire only the old family", async () => {
  const f = fixture();
  f.online = false;
  await f.controller.prepare(false);
  const old = f.journal!.pending[0].refresh_token;
  let signed = false;
  await f.gate.run(
    () =>
      f.controller.activate(async () => {
        signed = true;
        f.snapshot = {
          refresh_token: "new".repeat(15),
          private_key,
          devices: {},
        };
      }),
    true,
  );
  assert.equal(signed, true);
  assert.equal(f.marked, false);
  assert.equal(f.blocked, false);
  f.online = true;
  await f.controller.retry();
  assert.ok(f.posts.every((p) => p.refresh_token === old));
  await f.gate.run(async () => {});
});
test("a failed marker removal durably queues and locally withdraws the newly accepted login rather than orphaning it", async () => {
  const f = fixture();
  await f.controller.prepare(false);
  f.unmarkFails = true;
  const newToken = "n".repeat(43);
  await assert.rejects(
    f.controller.activate(async () => {
      f.snapshot = { refresh_token: newToken, private_key, devices: {} };
    }),
    /disk unavailable/,
  );
  assert.equal(f.blocked, true);
  assert.equal(f.journal?.pending[0].refresh_token, newToken);
  assert.equal(f.journal?.pending[0].devices.length, 0);
  await f.controller.retry();
  assert.equal(f.journal?.pending.length, 0);
});

test("uninstall retains an unacknowledged pairing independently of known device IDs and its family receipt", async () => {
  const f = fixture(0),
    request: PairingRequest = {
      protocol: pairingProtocol,
      refresh_token: "r".repeat(43),
      input: {
        id: randomUUID(),
        tenant_id: randomUUID(),
        name: "Unacknowledged pairing",
        public_key: publicKey,
        grants: [],
      },
      signature: "",
    };
  request.signature = sign(
    null,
    pairingMessage("retire", request),
    private_key,
  ).toString("base64url");
  const capture = f.io.capture;
  f.io.capture = async () => ({ ...(await capture()), pairings: [request] });
  let online = false;
  f.io.retire = async (body) => {
    if (!online) throw Error("offline");
    return { pairing_id: body.input.id, status: "retired" };
  };
  const result = await f.controller.prepare(false);
  assert.equal(result.remote, "pending");
  assert.equal(result.pending, 1);
  assert.equal(f.journal?.pending.length, 0);
  assert.deepEqual(f.journal?.pairings, [request]);
  online = true;
  await f.controller.retry();
  assert.equal((await f.controller.status()).remote, "disconnected");
  assert.equal(f.journal?.pairings?.length, 0);
});
test("a mismatched pairing retirement receipt stays unverified rather than reporting a completed cloud withdrawal", async () => {
  const f = fixture(0),
    request: PairingRequest = {
      protocol: pairingProtocol,
      refresh_token: "r".repeat(43),
      input: {
        id: randomUUID(),
        tenant_id: randomUUID(),
        name: "Synthetic pairing",
        public_key: publicKey,
        grants: [],
      },
      signature: "",
    };
  const capture = f.io.capture;
  f.io.capture = async () => ({ ...(await capture()), pairings: [request] });
  f.io.retire = async () => ({ pairing_id: randomUUID(), status: "retired" });
  assert.equal((await f.controller.prepare(false)).remote, "unverified");
  assert.equal((await f.controller.status()).pending, 1);
  assert.equal(f.journal?.pairings?.length, 1);
});
