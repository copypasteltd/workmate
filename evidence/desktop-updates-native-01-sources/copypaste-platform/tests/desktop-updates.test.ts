import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import {
  updateCanonical,
  updateProtocol,
  updateAppId,
  verifyUpdateEnvelope,
  parseUpdateKeys,
  updateChunkBytes,
  type UpdatePayload,
} from "../src/desktop-update-contract.js";
import {
  createNativeBackup,
  exportErasureLedger,
  restoreNativeBackup,
} from "../src/native-recovery.js";
import { verifyBackup } from "../src/native-recovery-archive.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { z } from "zod";
import { desktopUpdateEnvelopeSchema } from "../src/desktop-update-schema.js";
const pair = generateKeyPairSync("ed25519"),
  digest = (v: Uint8Array | string) =>
    createHash("sha256").update(v).digest("hex");
const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  key_id = digest(pair.publicKey.export({ type: "spki", format: "der" })),
  keys = { [key_id]: pem };
const artifact = Buffer.concat([
  Buffer.from("MZsynthetic-installer-not-executable\n"),
  Buffer.alloc(updateChunkBytes + 13, 97),
]);
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  system: Awaited<ReturnType<typeof buildApp>>,
  sequence = 100;
type Client = { id: string; cookie: string; csrf: string; role: string };
const all = [
  "admin.desktop_updates.read",
  "admin.desktop_updates.stage",
  "admin.desktop_updates.publish",
];
const prefix = "/v1/admin/desktop-updates";
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key: string = randomUUID(),
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: system.db.config.ADMIN_ORIGIN,
      "idempotency-key": key,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return {
    status: raw.statusCode,
    body: raw.headers["content-type"]?.includes("application/json")
      ? raw.json()
      : raw.rawPayload,
    raw,
  };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key?: string,
) {
  const r = await call(c, method, url, body, key);
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.body));
  return r.body;
}
async function admin(permissions = all, scope = "global") {
  const address = "desktop-release-" + randomUUID() + "@example.invalid",
    secret = new OTPAuth.Secret({ size: 20 });
  const principal = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic release operator',$2) RETURNING id",
      [address, seal(system.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  const role = "release_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(permissions)],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [principal.id, role, scope, scope === "global" ? null : randomUUID()],
  );
  const ch = await ok(undefined, "POST", "/v1/admin/auth/challenge", {
      email: address,
    }),
    mail = JSON.parse(
      await readFile(
        path.join(
          system.db.config.DATA_DIR,
          "mailbox",
          ch.challenge_id + ".json",
        ),
        "utf8",
      ),
    );
  const login = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }).generate(),
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const cookie = login.raw.cookies.find((c) => c.name === "cp_admin_session")!;
  return {
    id: principal.id,
    role,
    cookie: cookie.name + "=" + cookie.value,
    csrf: login.body.csrf_token,
  };
}
function envelope(extra: Partial<UpdatePayload> = {}, bytes = artifact) {
  const payload: UpdatePayload = {
    protocol: updateProtocol,
    app_id: updateAppId,
    channel: "stable",
    platform: "windows-x64",
    sequence: ++sequence,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    action: "install",
    rollout_basis_points: 10000,
    release: {
      version: "0.7.0",
      minimum_version: "0.5.0",
      sha256: digest(bytes),
      bytes: bytes.length,
      signer_sha256: "a".repeat(64),
      notes: {
        en: "Synthetic release for native workflow checks.",
        zh: "供本機流程核查的模擬版本。",
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
const stage = (c: Client, e = envelope(), key?: string) =>
  ok(
    c,
    "POST",
    prefix,
    { envelope: e, reason: "Controlled release check" },
    key,
  );
async function upload(c: Client, r: any, bytes = artifact) {
  for (let i = 0; i < Math.ceil(bytes.length / updateChunkBytes); i++) {
    const b = bytes.subarray(i * updateChunkBytes, (i + 1) * updateChunkBytes);
    await ok(c, "PUT", `${prefix}/${r.id}/parts/${i}`, {
      base64: b.toString("base64"),
      sha256: digest(b),
    });
  }
  return ok(c, "POST", `${prefix}/${r.id}/finalize`, {});
}
async function publish(c: Client, r: any, key?: string) {
  const listing = await ok(c, "GET", prefix + "?channel=" + r.channel);
  return ok(
    c,
    "POST",
    `${prefix}/${r.id}/publish`,
    {
      expected_revision: listing.head.revision,
      confirmed_sha256: r.envelope_sha256,
      reason: "Reviewed exact signed release",
    },
    key,
  );
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
      DESKTOP_UPDATE_PUBLIC_KEYS: JSON.stringify(keys),
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await system?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("offline envelope trust binds exact app, key fingerprint, version, expiry, sequence and notes", () => {
  const e = envelope();
  assert.deepEqual(verifyUpdateEnvelope(e, parseUpdateKeys(keys)), e);
  const forged = structuredClone(e);
  forged.payload.release!.notes.en = "A different installer promise";
  assert.throws(() => verifyUpdateEnvelope(forged, keys), {
    code: "UPDATE_SIGNATURE_INVALID",
  });
  assert.throws(() => verifyUpdateEnvelope(e, {}), {
    code: "UPDATE_KEY_UNTRUSTED",
  });
  assert.throws(
    () =>
      verifyUpdateEnvelope(e, keys, {
        minimumSequence: e.payload.sequence + 1,
      }),
    { code: "UPDATE_MANIFEST_REPLAYED" },
  );
  assert.throws(
    () =>
      verifyUpdateEnvelope(e, keys, { now: Date.parse(e.payload.expires_at) }),
    { code: "UPDATE_MANIFEST_EXPIRED" },
  );
  assert.throws(() => parseUpdateKeys({ ["0".repeat(64)]: pem }), {
    code: "UPDATE_TRUST_INVALID",
  });
  const invalid = envelope({
    release: { ...e.payload.release!, version: "1.0.0-beta.1" },
  });
  assert.throws(() => verifyUpdateEnvelope(invalid, keys), {
    code: "UPDATE_VERSION_INVALID",
  });
});
test("the documented envelope schema matches runtime input and Desktop uses the identical verifier source", async () => {
  const mirror = JSON.parse(
    await readFile("contracts/desktop-updates-schemas.json", "utf8"),
  );
  assert.deepEqual(
    mirror.schemas.DesktopUpdateEnvelope,
    z.toJSONSchema(desktopUpdateEnvelopeSchema, { io: "input" }),
  );
  assert.deepEqual(
    await readFile("src/desktop-update-contract.ts"),
    await readFile("../copypaste-desktop/src/desktop-update-contract.ts"),
  );
});
test("only current global permissions and recent MFA can read, stage or publish; explicit denies win", async () => {
  assert.equal((await call(undefined, "GET", prefix)).status, 401);
  const observer = await admin([all[0]]),
    scoped = await admin(all, "tenant");
  assert.equal(
    (
      await call(observer, "POST", prefix, {
        envelope: envelope(),
        reason: "No staging authority",
      })
    ).status,
    403,
  );
  assert.equal((await call(scoped, "GET", prefix)).status, 403);
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [observer.id, observer.role, randomUUID()],
  );
  assert.equal((await call(observer, "GET", prefix)).status, 403);
  const stale = await admin();
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '2 hours' WHERE admin_id=$1",
    [stale.id],
  );
  assert.equal((await call(stale, "GET", prefix)).status, 403);
  await assert.rejects(
    system.db.app.query("SELECT * FROM desktop_update_releases"),
    /permission denied/i,
  );
});
test("staging, chunk retry, full hash finalization and publication replay retain one immutable history", async () => {
  const c = await admin(),
    e = envelope(),
    key = randomUUID(),
    r = await stage(c, e, key);
  assert.equal((await stage(c, e, key)).id, r.id);
  assert.equal(
    (await call(c, "POST", `${prefix}/${r.id}/finalize`, {})).status,
    409,
  );
  const first = artifact.subarray(0, updateChunkBytes),
    b = { base64: first.toString("base64"), sha256: digest(first) };
  await ok(c, "PUT", `${prefix}/${r.id}/parts/0`, b);
  await ok(c, "PUT", `${prefix}/${r.id}/parts/0`, b);
  const conflict = Buffer.from(first);
  conflict[10] ^= 1;
  assert.equal(
    (
      await call(c, "PUT", `${prefix}/${r.id}/parts/0`, {
        base64: conflict.toString("base64"),
        sha256: digest(conflict),
      })
    ).status,
    409,
  );
  await upload(c, r);
  const listing = await ok(c, "GET", prefix),
    body = {
      expected_revision: listing.head.revision,
      confirmed_sha256: r.envelope_sha256,
      reason: "Reviewed test installer and scope",
    },
    pubkey = randomUUID();
  const published = await ok(
    c,
    "POST",
    `${prefix}/${r.id}/publish`,
    body,
    pubkey,
  );
  assert.deepEqual(
    await ok(c, "POST", `${prefix}/${r.id}/publish`, body, pubkey),
    published,
  );
  const feed = await ok(undefined, "GET", "/v1/public/desktop-updates/stable");
  assert.deepEqual(feed.envelope, e);
  const download = await call(
    undefined,
    "GET",
    "/v1/public/desktop-updates/artifacts/" + e.payload.release!.sha256,
  );
  assert.equal(download.status, 200);
  assert.deepEqual(download.body, artifact);
  assert.equal(download.raw.headers["cache-control"], "no-store");
  assert.equal(
    Number(
      (
        await system.db.control.query(
          "SELECT count(*) FROM desktop_update_publications WHERE release_id=$1",
          [r.id],
        )
      ).rows[0].count,
    ),
    1,
  );
  await assert.rejects(
    system.db.control.query(
      "UPDATE desktop_update_releases SET envelope='{}' WHERE id=$1",
      [r.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    system.db.control.query(
      "DELETE FROM desktop_update_publications WHERE release_id=$1",
      [r.id],
    ),
    /immutable/,
  );
});
test("concurrent publication uses exact revision and never rolls a channel sequence backwards", async () => {
  const c = await admin(),
    a = await stage(c),
    b = await stage(c);
  await upload(c, a);
  await upload(c, b);
  const listing = await ok(c, "GET", prefix),
    body = (r: any) => ({
      expected_revision: listing.head.revision,
      confirmed_sha256: r.envelope_sha256,
      reason: "Concurrent release review",
    });
  const outcomes = await Promise.all([
    call(c, "POST", `${prefix}/${a.id}/publish`, body(a)),
    call(c, "POST", `${prefix}/${b.id}/publish`, body(b)),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const head = (await ok(c, "GET", prefix)).head,
    live = (await ok(undefined, "GET", "/v1/public/desktop-updates/stable"))
      .envelope;
  assert.equal(head.revision, listing.head.revision + 1);
  const old = envelope({ sequence: live.payload.sequence });
  assert.equal(
    (
      await call(c, "POST", prefix, {
        envelope: old,
        reason: "Reject reused signed sequence",
      })
    ).status,
    409,
  );
});
test("signed withdrawal disables old installer access; rollback requires an exact historical published artifact", async () => {
  const c = await admin(),
    prior = (await ok(undefined, "GET", "/v1/public/desktop-updates/stable"))
      .envelope;
  const withdrawal = await stage(
    c,
    envelope({ action: "withdraw", release: null }),
  );
  await publish(c, withdrawal);
  assert.equal(
    (await ok(undefined, "GET", "/v1/public/desktop-updates/stable")).envelope
      .payload.action,
    "withdraw",
  );
  assert.equal(
    (
      await call(
        undefined,
        "GET",
        "/v1/public/desktop-updates/artifacts/" + prior.payload.release.sha256,
      )
    ).status,
    404,
  );
  const foreign = envelope({
      action: "rollback",
      release: {
        ...prior.payload.release,
        notes: { en: "Changed historical notes", zh: "變更歷史說明" },
      },
    }),
    bad = await stage(c, foreign);
  await upload(c, bad);
  const h = await ok(c, "GET", prefix);
  const rejected = await call(c, "POST", `${prefix}/${bad.id}/publish`, {
    expected_revision: h.head.revision,
    confirmed_sha256: bad.envelope_sha256,
    reason: "Rollback must preserve artifact details",
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, "UPDATE_ROLLBACK_UNPUBLISHED");
  const good = await stage(
    c,
    envelope({ action: "rollback", release: prior.payload.release }),
  );
  await upload(c, good);
  await publish(c, good);
  assert.equal(
    (await ok(undefined, "GET", "/v1/public/desktop-updates/stable")).envelope
      .payload.action,
    "rollback",
  );
});
test("malformed signatures, missing bytes, wrong chunks and fake Windows headers cannot publish", async () => {
  const c = await admin(),
    bad = envelope();
  bad.signature = "A".repeat(86);
  assert.equal(
    (
      await call(c, "POST", prefix, {
        envelope: bad,
        reason: "Invalid offline signature",
      })
    ).status,
    400,
  );
  const bytes = Buffer.from("not a Windows executable"),
    r = await stage(c, envelope({ channel: "preview" }, bytes));
  assert.equal(
    (
      await call(c, "PUT", `${prefix}/${r.id}/parts/0`, {
        base64: bytes.toString("base64"),
        sha256: "a".repeat(64),
      })
    ).status,
    400,
  );
  await ok(c, "PUT", `${prefix}/${r.id}/parts/0`, {
    base64: bytes.toString("base64"),
    sha256: digest(bytes),
  });
  assert.equal(
    (await call(c, "POST", `${prefix}/${r.id}/finalize`, {})).status,
    400,
  );
});
test("native encrypted backup restores signed publication and exact installer bytes, resets only incomplete upload parts", async () => {
  const c = await admin(),
    partial = await stage(c, envelope({ channel: "preview" })),
    part = artifact.subarray(0, updateChunkBytes);
  await ok(c, "PUT", `${prefix}/${partial.id}/parts/0`, {
    base64: part.toString("base64"),
    sha256: digest(part),
  });
  const parent = path.resolve(".data/desktop-update-recovery"),
    id = randomUUID().replaceAll("-", ""),
    directory = path.join(parent, id);
  await mkdir(directory, { recursive: true });
  const o = {
    config: system.db.config,
    ownerURL: isolated.env.OWNER_DATABASE_URL!,
    backupKey: randomBytes(32).toString("hex"),
    pgBinDir: path.resolve(".data/recovery-tools/bin"),
  };
  const name = "workmate_recovery_" + randomUUID().replaceAll("-", "");
  let made = false;
  try {
    const backup = await createNativeBackup(o, directory),
      verified = await verifyBackup(backup.directory, o.backupKey);
    assert.equal(
      verified.manifest.files.filter((f) => f.kind === "desktop_update").length,
      1,
    );
    const ledger = await exportErasureLedger(o, directory),
      target = path.join(directory, "restored");
    made = true;
    const result = await restoreNativeBackup(o, {
      backup: backup.directory,
      ledger: ledger.file,
      incidentAt: new Date().toISOString(),
      databaseName: name,
      targetDataDir: target,
      acknowledgeIsolation: true,
    });
    assert.equal(result.outcome, "quarantined");
    assert.deepEqual(
      await readFile(
        path.join(target, "desktop-updates", digest(artifact) + ".exe"),
      ),
      artifact,
    );
    const u = new URL(o.ownerURL);
    u.pathname = "/" + name;
    const db = new pg.Client({ connectionString: u.href });
    await db.connect();
    try {
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM desktop_update_parts WHERE release_id=$1",
            [partial.id],
          )
        ).rows[0].n,
        0,
      );
      assert.deepEqual(
        (await db.query("SELECT * FROM desktop_update_heads ORDER BY channel"))
          .rows,
        (
          await system.db.control.query(
            "SELECT * FROM desktop_update_heads ORDER BY channel",
          )
        ).rows,
      );
    } finally {
      await db.end();
    }
  } finally {
    if (made) {
      const u = new URL(o.ownerURL);
      u.pathname = "/postgres";
      const db = new pg.Client({ connectionString: u.href });
      await db.connect();
      try {
        await db.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await db.end();
      }
    }
    await removeOwnedUUIDDirectory(parent, id);
  }
});
