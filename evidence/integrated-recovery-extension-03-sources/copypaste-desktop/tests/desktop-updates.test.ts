import { test } from "node:test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  DesktopUpdateController,
  type UpdateJournal,
} from "../src/desktop-updates.js";
import { UpdateAdmission } from "../src/update-admission.js";
import { resolveUpdateTrust } from "../src/update-configuration.js";
import {
  updateAppId,
  updateProtocol,
  updateCanonical,
  verifyUpdateEnvelope,
  releaseForInstallation,
  type UpdateEnvelope,
  type UpdatePayload,
  UpdateError,
} from "../src/desktop-update-contract.js";
const digest = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
const pair = generateKeyPairSync("ed25519"),
  key_id = digest(pair.publicKey.export({ type: "spki", format: "der" })),
  keys = {
    [key_id]: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
const bytes = Buffer.from("MZsynthetic-updater-download\n");
function envelope(extra: Partial<UpdatePayload> = {}): UpdateEnvelope {
  const payload: UpdatePayload = {
    protocol: updateProtocol,
    app_id: updateAppId,
    channel: "stable",
    platform: "windows-x64",
    sequence: 10,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    action: "install",
    rollout_basis_points: 10000,
    release: {
      version: "0.7.0",
      minimum_version: "0.5.0",
      bytes: bytes.length,
      sha256: digest(bytes),
      signer_sha256: "a".repeat(64),
      notes: {
        en: "A verified update for your desktop.",
        zh: "已驗證的桌面程式更新。",
      },
    },
    ...extra,
  };
  return {
    key_id,
    payload,
    signature: sign(
      null,
      Buffer.from(updateCanonical(payload)),
      pair.privateKey,
    ).toString("base64url"),
  };
}
async function fixture() {
  const parent = path.resolve(".data/update-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "owned-"));
  let journal: UpdateJournal | null = null,
    feed: UpdateEnvelope | null = envelope(),
    safe = true,
    consent = true,
    downloads = 0,
    verifications = 0,
    installs = 0,
    verifyError: string | undefined,
    networkHook: ((url: string) => Promise<Response | undefined>) | undefined;
  const requests: { url: string; init: any }[] = [],
    gate = new UpdateAdmission();
  const io = {
    origin: "http://127.0.0.1:4310",
    cache: path.join(root, "cache"),
    version: "0.6.0",
    channel: "stable" as const,
    keys,
    minimumSequence: 1,
    installerSupported: true,
    read: async () => structuredClone(journal),
    write: async (value: UpdateJournal) => {
      journal = structuredClone(value);
    },
    changed: () => {},
    checkpoint: async () => ({ safe }),
    confirm: async () => consent,
    verifyInstaller: async (file: string, sha: string, _signer: string) => {
      verifications++;
      if (verifyError) throw new UpdateError(verifyError);
      if (digest(await readFile(file)) !== sha)
        throw new UpdateError("UPDATE_ARTIFACT_MISMATCH");
    },
    install: async () => {
      installs++;
    },
    fetch: (async (url: string, init: any) => {
      requests.push({ url, init });
      const custom = await networkHook?.(url);
      if (custom) return custom;
      if (url.includes("/artifacts/")) {
        downloads++;
        return new Response(bytes, {
          headers: {
            "content-length": String(bytes.length),
            "content-type": "application/octet-stream",
          },
        });
      }
      return Response.json({ envelope: feed });
    }) as typeof fetch,
  };
  const controller = new DesktopUpdateController(io, gate);
  return {
    root,
    gate,
    io,
    controller,
    requests,
    get journal() {
      return journal;
    },
    set feed(value: UpdateEnvelope | null) {
      feed = value;
    },
    get feed() {
      return feed;
    },
    get downloads() {
      return downloads;
    },
    get installs() {
      return installs;
    },
    get verifications() {
      return verifications;
    },
    set safe(value: boolean) {
      safe = value;
    },
    set consent(value: boolean) {
      consent = value;
    },
    set verifyError(value: string | undefined) {
      verifyError = value;
    },
    set hook(value: typeof networkHook) {
      networkHook = value;
    },
    clean: async () => {
      await controller.close();
      assert.equal(path.dirname(root), parent);
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("shared protocol verifies exact signatures, bounds and deterministic rollout without an account token", () => {
  const e = envelope(),
    id = randomUUID();
  assert.deepEqual(verifyUpdateEnvelope(e, keys), e);
  assert.equal(releaseForInstallation(e, "0.6.0", id).eligible, true);
  assert.equal(
    releaseForInstallation(envelope({ rollout_basis_points: 0 }), "0.6.0", id)
      .code,
    "UPDATE_ROLLOUT_PENDING",
  );
  assert.equal(releaseForInstallation(e, "0.7.0", id).code, "UPDATE_CURRENT");
  assert.equal(
    releaseForInstallation(e, "0.4.0", id).code,
    "UPDATE_MANUAL_UPGRADE_REQUIRED",
  );
  assert.equal(
    releaseForInstallation(
      envelope({ release: { ...e.payload.release!, version: "0.5.0" } }),
      "0.6.0",
      id,
    ).code,
    "UPDATE_CURRENT",
  );
  assert.equal(
    releaseForInstallation(
      envelope({
        action: "rollback",
        release: { ...e.payload.release!, version: "0.5.0" },
      }),
      "0.6.0",
      id,
    ).eligible,
    true,
  );
  assert.throws(() =>
    verifyUpdateEnvelope(
      { ...e, payload: { ...e.payload, app_id: "foreign" } },
      keys,
    ),
  );
});
test("cancelling a real HTTP download aborts the stream and deletes its partial file", async () => {
  const f = await fixture();
  let started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  const server = createServer((req, res) => {
    if (req.url?.includes("/artifacts/")) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": bytes.length,
      });
      res.write(bytes.subarray(0, 4));
      started();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ envelope: f.feed }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const controller = new DesktopUpdateController(
    {
      ...f.io,
      origin: `http://127.0.0.1:${(server.address() as any).port}`,
      fetch: undefined,
    },
    f.gate,
  );
  try {
    await controller.check();
    const transfer = controller.download();
    await entered;
    controller.cancel();
    assert.equal((await transfer).code, "UPDATE_CANCELLED");
    assert.equal(f.journal?.prepared, undefined);
    assert.deepEqual(await readdir(f.io.cache), []);
    assert.equal(f.installs, 0);
  } finally {
    await controller.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.clean();
  }
});
test("download rechecks publication, verifies exact bytes and persists restartable installer state", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.controller.check()).state, "available");
    assert.equal((await f.controller.download()).state, "ready");
    assert.equal(f.downloads, 1);
    assert.equal(f.verifications, 1);
    assert.deepEqual(
      await readFile(path.join(f.io.cache, digest(bytes) + ".exe")),
      bytes,
    );
    const restarted = new DesktopUpdateController(f.io, f.gate);
    assert.equal((await restarted.check()).state, "ready");
    await restarted.close();
    assert.equal(f.verifications, 2);
    assert.ok(
      f.requests.every(
        (r) =>
          r.init.credentials === "omit" &&
          r.init.redirect === "error" &&
          !r.init.headers.Authorization,
      ),
    );
    assert.equal(f.journal?.channels.stable?.sequence, 10);
  } finally {
    await f.clean();
  }
});
test("a forged or replayed manifest cannot replace a trusted release, even after restart", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    f.feed = envelope({ sequence: 9 });
    assert.equal((await f.controller.check()).code, "UPDATE_MANIFEST_REPLAYED");
    f.feed = envelope({ sequence: 10, rollout_basis_points: 0 });
    assert.equal((await f.controller.check()).code, "UPDATE_SEQUENCE_CONFLICT");
    const restart = new DesktopUpdateController(f.io, f.gate);
    assert.equal((await restart.check()).code, "UPDATE_SEQUENCE_CONFLICT");
    await restart.close();
    assert.equal(f.downloads, 0);
    const forged = envelope({ sequence: 11 });
    forged.payload.release!.sha256 = "b".repeat(64);
    f.feed = forged;
    assert.equal((await f.controller.check()).code, "UPDATE_SIGNATURE_INVALID");
  } finally {
    await f.clean();
  }
});
test("withdrawal or publication change before download prevents any artifact request", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    f.feed = envelope({ sequence: 11, action: "withdraw", release: null });
    assert.equal(
      (await f.controller.download()).code,
      "UPDATE_RELEASE_CHANGED",
    );
    assert.equal(f.downloads, 0);
    assert.equal((await f.controller.check()).code, "UPDATE_WITHDRAWN");
  } finally {
    await f.clean();
  }
});
test("stream length and file hashes are checked before invoking the native signature verifier", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    f.hook = async (url) =>
      url.includes("/artifacts/")
        ? new Response(Buffer.alloc(bytes.length, 90), {
            headers: { "content-length": String(bytes.length) },
          })
        : undefined;
    assert.equal(
      (await f.controller.download()).code,
      "UPDATE_ARTIFACT_MISMATCH",
    );
    assert.equal(f.verifications, 0);
    assert.deepEqual(await readdir(f.io.cache), []);
    assert.equal(f.journal?.prepared, undefined);
  } finally {
    await f.clean();
  }
});
test("untrusted Windows signatures leave no prepared file or installation permission", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    f.verifyError = "UPDATE_AUTHENTICODE_INVALID";
    assert.equal(
      (await f.controller.download()).code,
      "UPDATE_AUTHENTICODE_INVALID",
    );
    assert.equal(f.journal?.prepared, undefined);
    assert.deepEqual(await readdir(f.io.cache), []);
    assert.equal(f.installs, 0);
  } finally {
    await f.clean();
  }
});
test("active local work blocks installation, without cancelling work or discarding its journal", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    f.safe = false;
    assert.equal(
      (await f.controller.install()).code,
      "UPDATE_LOCAL_WORK_PENDING",
    );
    assert.equal(f.installs, 0);
    assert.ok(f.journal?.prepared);
    assert.equal(await f.gate.run(async () => "still open"), "still open");
    f.safe = true;
    await f.controller.check();
    f.consent = false;
    assert.equal((await f.controller.install()).state, "ready");
    assert.equal(f.installs, 0);
  } finally {
    await f.clean();
  }
});
test("admission waits for in-flight operations and prevents a new turn while installation confirms", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    let finish!: () => void;
    const held = f.gate.run(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    assert.equal(
      (await f.controller.install()).code,
      "UPDATE_LOCAL_WORK_PENDING",
    );
    finish();
    await held;
    await f.controller.check();
    f.io.confirm = async () => {
      await assert.rejects(
        f.gate.run(async () => {}),
        { code: "UPDATE_INSTALLATION_IN_PROGRESS" },
      );
      return true;
    };
    assert.equal((await f.controller.install()).state, "installing");
    assert.equal(f.installs, 1);
    assert.equal(f.journal?.lastInstallation?.version, "0.7.0");
    await assert.rejects(
      f.gate.run(async () => {}),
      { code: "UPDATE_INSTALLATION_IN_PROGRESS" },
    );
  } finally {
    await f.clean();
  }
});
test("withdrawal immediately before install blocks a previously verified cached installer", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    f.feed = envelope({ sequence: 11, action: "withdraw", release: null });
    assert.equal((await f.controller.install()).code, "UPDATE_RELEASE_CHANGED");
    assert.equal(f.installs, 0);
    assert.equal(f.journal?.channels.stable?.sequence, 11);
  } finally {
    await f.clean();
  }
});
test("publication is checked again after native signature verification, before requesting installation", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    const original = f.io.verifyInstaller;
    f.io.verifyInstaller = async (...args) => {
      await original(...args);
      f.feed = envelope({ sequence: 11, action: "withdraw", release: null });
    };
    assert.equal((await f.controller.install()).code, "UPDATE_RELEASE_CHANGED");
    assert.equal(f.installs, 0);
    assert.equal(f.journal?.lastInstallation, undefined);
  } finally {
    await f.clean();
  }
});
test("cache tampering after download cannot survive install-time verification", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    await writeFile(path.join(f.io.cache, digest(bytes) + ".exe"), "changed");
    assert.equal(
      (await f.controller.install()).code,
      "UPDATE_ARTIFACT_MISMATCH",
    );
    assert.equal(f.installs, 0);
  } finally {
    await f.clean();
  }
});
test("portable installs stay manual and empty trust disables checks without any network access", async () => {
  const f = await fixture();
  try {
    f.io.installerSupported = false;
    const portable = new DesktopUpdateController(f.io, f.gate);
    await portable.check();
    await portable.download();
    assert.equal(
      (await portable.install()).code,
      "UPDATE_MANUAL_INSTALL_REQUIRED",
    );
    await portable.close();
    assert.equal(f.installs, 0);
    const count = f.requests.length;
    const disabled = new DesktopUpdateController({ ...f.io, keys: {} }, f.gate);
    assert.equal((await disabled.check()).state, "disabled");
    assert.equal(f.requests.length, count);
    await disabled.close();
  } finally {
    await f.clean();
  }
});
test("discard removes only its owned installer and retains anti-replay sequence across checks", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    await f.controller.download();
    await writeFile(path.join(f.root, "customer.txt"), "retained");
    assert.equal((await f.controller.discard()).state, "idle");
    assert.deepEqual(await readdir(f.io.cache), []);
    assert.equal(
      await readFile(path.join(f.root, "customer.txt"), "utf8"),
      "retained",
    );
    assert.equal(f.journal?.channels.stable?.sequence, 10);
  } finally {
    await f.clean();
  }
});
test("network failures and a missing known channel cannot erase the trusted sequence floor", async () => {
  const f = await fixture();
  try {
    await f.controller.check();
    f.feed = null;
    assert.equal(
      (await f.controller.check()).code,
      "UPDATE_RELEASE_UNAVAILABLE",
    );
    assert.equal(f.journal?.channels.stable?.sequence, 10);
    f.hook = async () => {
      throw new Error("offline");
    };
    assert.equal(
      (await f.controller.check()).code,
      "UPDATE_SERVICE_UNAVAILABLE",
    );
    assert.equal(f.journal?.channels.stable?.sequence, 10);
  } finally {
    await f.clean();
  }
});
test("packaged Desktop ignores a development trust override, keeping only its pinned release roots", async () => {
  const bundled = { keys, minimumSequence: 9 };
  assert.deepEqual(
    await resolveUpdateTrust(
      bundled,
      true,
      "Z:/untrusted/missing-public-keys.json",
    ),
    bundled,
  );
  assert.deepEqual(
    await resolveUpdateTrust(
      { keys: {}, minimumSequence: 0 },
      true,
      "Z:/untrusted/missing-public-keys.json",
    ),
    { keys: {}, minimumSequence: 0 },
  );
});
test("oversized responses and unexpected transfer encodings fail before trusting metadata", async () => {
  const f = await fixture();
  try {
    f.hook = async () =>
      new Response("x".repeat(20000), {
        headers: { "content-type": "application/json" },
      });
    assert.equal((await f.controller.check()).code, "UPDATE_MANIFEST_INVALID");
    f.hook = undefined;
    await f.controller.check();
    f.hook = async (url) =>
      url.includes("/artifacts/")
        ? new Response(bytes, {
            headers: {
              "content-length": String(bytes.length),
              "content-encoding": "gzip",
            },
          })
        : undefined;
    assert.equal(
      (await f.controller.download()).code,
      "UPDATE_DOWNLOAD_INVALID",
    );
    assert.equal(f.verifications, 0);
  } finally {
    await f.clean();
  }
});
