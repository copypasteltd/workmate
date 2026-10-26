import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash, seal, unseal } from "../src/lib.js";
import { saveAsset, copyAssetVersion } from "../src/storage.js";
import { projectAccess } from "../src/access.js";
import { resourceSnapshot } from "../src/resource-quotas.js";
import { ErasureService } from "../src/erasure.js";

type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>,
  operator: Client,
  reviewer: Client;
const grantRoot = "/v1/admin/entitlement-grants";
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const tenant = /^\/v1\/tenants\/([^/]+)/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: url.startsWith("/v1/admin")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function login(
  email = randomUUID() + "@example.invalid",
  secret?: OTPAuth.Secret,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const ch = await call(undefined, "POST", prefix + "/challenge", { email });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(
    (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
  )!;
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    email,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function administrator(
  permissions?: string[],
  kind = "global",
  scope?: string,
) {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Resource operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = "super_admin";
  if (permissions) {
    role = "quota-" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(permissions)],
    );
  }
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, kind, scope ?? null],
  );
  return { ...(await login(email, secret)), id: p.id };
}
async function approve(op: any) {
  if (op.state !== "pending_approval") {
    assert.equal(op.state, "succeeded", JSON.stringify(op));
    return op;
  }
  const p = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${op.id}/approval`,
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const r = await call(
    reviewer,
    "POST",
    `/v1/admin/approvals/${p.data.id}/decisions`,
    {
      expected_version: p.data.version,
      payload_hash: p.data.payload_hash,
      decision: "approve",
      reason: "Independent resource review",
    },
  );
  assert.equal(r.data.state, "succeeded", JSON.stringify(r.data));
  return r.data;
}
async function plan(seats = 2, storage = 16, family = randomUUID()) {
  const d = await call(operator, "POST", "/v1/admin/plans/drafts", {
    plan_id: family,
    name: "Bound resource plan",
    allowances: {
      feature_ids: ["text", "local_files"],
      allowed_role_ids: ["assistant"],
      seat_limit: seats,
      task_concurrency: 2,
      storage_bytes: storage,
      included_credit: { currency: "HKD", amount_micros: "0" },
      credit_policy: "no_automatic_credit",
    },
    reason: "Define resource limits",
  });
  assert.equal(d.status, 202, JSON.stringify(d.data));
  const v = (
    await call(operator, "GET", "/v1/admin/plans/" + d.data.result_ids[0])
  ).data;
  const b = {
    expected_version: v.version,
    reason: "Publish resource definition",
  };
  const p = await call(
    operator,
    "POST",
    `/v1/admin/plans/${v.id}/publication-previews`,
    b,
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const o = await call(
    operator,
    "POST",
    `/v1/admin/plans/${v.id}/publications`,
    b,
    { "x-admin-preview-id": p.data.preview_id },
  );
  assert.equal(o.status, 202, JSON.stringify(o.data));
  await approve(o.data);
  return v;
}
async function grant(
  subject: { kind: "tenant" | "user"; id: string },
  v: any,
  extra: Record<string, unknown> = {},
) {
  const r = await call(
    operator,
    "GET",
    `${grantRoot}/subjects/${subject.kind}/${subject.id}`,
  );
  const b = {
    subject,
    plan_version_id: v.id,
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    overlap_policy: "reject",
    source: "manual",
    auto_renew: false,
    expected_subject_version: r.data.version,
    reason: "Assign resource capacity",
    ...extra,
  };
  const p = await call(operator, "POST", "/v1/admin/entitlement-previews", b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const o = await call(operator, "POST", grantRoot, b, {
    "x-admin-preview-id": p.data.preview_id,
  });
  assert.equal(o.status, 202, JSON.stringify(o.data));
  const op = await approve(o.data);
  return (await call(operator, "GET", grantRoot + "/" + op.result_ids[0])).data;
}
async function workspace(v?: any) {
  const u = await login(),
    r = await call(u, "POST", "/v1/tenants", {
      name: "Resource workspace",
      project_name: "Quota project",
    });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const w = {
    u,
    tenant: r.data.tenant.id as string,
    project: r.data.project.id as string,
    base: `/v1/tenants/${r.data.tenant.id}`,
  };
  if (v) await grant({ kind: "tenant", id: w.tenant }, v);
  return w;
}
type Workspace = Awaited<ReturnType<typeof workspace>>;
async function usage(w: Workspace, c = w.u) {
  const r = await call(c, "GET", w.base + "/resource-usage");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.raw.headers["cache-control"], "no-store");
  return r.data;
}
async function invite(w: Workspace, u: Client) {
  const r = await call(w.u, "POST", w.base + "/invites", {
    email: u.email,
    role: "member",
    project_ids: [w.project],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const delivery = (
    await s.db.control.query(
      "SELECT token_cipher FROM invitation_deliveries WHERE invite_id=$1",
      [r.data.id],
    )
  ).rows[0];
  return {
    id: r.data.id,
    token: unseal(s.db.config.MASTER_KEY!, delivery.token_cipher),
  };
}
const accept = (u: Client, i: { token: string }, k = randomUUID()) =>
  call(
    u,
    "POST",
    "/v1/invites/accept",
    { token: i.token },
    { "idempotency-key": k },
  );
async function bytes(
  w: Workspace,
  content: string,
  extra: Record<string, any> = {},
) {
  return s.db.tx(async (tx) => {
    await projectAccess(
      tx,
      { id: w.u.id, authVersion: 1 } as any,
      w.tenant,
      w.project,
      "write",
    );
    return saveAsset(tx, s.storage, {
      tenant: w.tenant,
      project: w.project,
      user: w.u.id,
      name: "quota.txt",
      mime: "text/plain",
      bytes: Buffer.from(content),
      ...extra,
    });
  }, w.tenant);
}
async function upload(
  w: Workspace,
  content: string,
  extra: Record<string, any> = {},
  k = randomUUID(),
) {
  return call(
    w.u,
    "POST",
    `${w.base}/projects/${w.project}/uploads`,
    {
      project_id: w.project,
      filename: "commitment.txt",
      content_type: "text/plain",
      size_bytes: Buffer.byteLength(content),
      sha256: hash(content),
      ...extra,
    },
    { "idempotency-key": k },
  );
}
async function finish(w: Workspace, id: string, content: string) {
  const url = `${w.base}/projects/${w.project}/uploads/${id}`;
  const part = await call(w.u, "POST", url + "/parts/0", {
    sha256: hash(content),
    base64: Buffer.from(content).toString("base64"),
  });
  assert.equal(part.status, 200, JSON.stringify(part.data));
  return call(w.u, "POST", url + "/complete", {
    size_bytes: Buffer.byteLength(content),
    sha256: hash(content),
  });
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
    }),
    { worker: false },
  );
  operator = await administrator();
  reviewer = await administrator();
});
after(async () => {
  if (s) await s.app.close();
  if (isolated) await isolated.cleanup();
});

test("tenant resource totals retain fixed UUIDs and compatibility ceilings are explicitly labelled", async () => {
  const legacy = await workspace();
  assert.equal((await usage(legacy)).legacy_compatibility_limits, true);
  const v = await plan(3, 1024),
    w = await workspace(v),
    r = await usage(w);
  assert.deepEqual(r.plan_version_ids, [v.id]);
  assert.equal(r.scope, "tenant");
  assert.equal(r.data_mode, "configured_services");
  assert.deepEqual(r.seats, {
    used: 1,
    limit: 3,
    remaining: 2,
    over_limit: false,
  });
  assert.deepEqual(r.storage, {
    used_bytes: "0",
    reserved_bytes: "0",
    total_bytes: "0",
    limit_bytes: "1024",
    remaining_bytes: "1024",
    over_limit: false,
  });
  assert.equal(r.legacy_compatibility_limits, false);
  assert.ok(!JSON.stringify(r).includes("created_by"));
});

test("two valid invitations race for one remaining seat; rejection retains the invitation and retry can succeed after a removal", async () => {
  const w = await workspace(await plan()),
    a = await login(),
    b = await login(),
    ia = await invite(w, a),
    ib = await invite(w, b);
  assert.equal((await usage(w)).seats.used, 1);
  const k = randomUUID(),
    results = await Promise.all([accept(a, ia, k), accept(b, ib, k)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? a : b,
    loser = winner === a ? b : a,
    inv = winner === a ? ib : ia;
  assert.equal(
    results.find((r) => r.status === 409)!.data.error.code,
    "PLAN_SEAT_LIMIT",
  );
  assert.equal(
    (
      await s.db.control.query("SELECT consumed_at FROM invites WHERE id=$1", [
        inv.id,
      ])
    ).rows[0].consumed_at,
    null,
  );
  const m = (
    await s.db.control.query(
      "SELECT version FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [w.tenant, winner.id],
    )
  ).rows[0];
  const removed = await call(w.u, "PATCH", w.base + "/members/" + winner.id, {
    role: "member",
    status: "removed",
    version: m.version,
    project_ids: [],
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal((await accept(loser, inv, k)).status, 201);
  assert.equal((await usage(w)).seats.used, 2);
});

test("personal VIP cannot enlarge tenant seats, and a global user freeze does not release an active seat", async () => {
  const w = await workspace(await plan()),
    a = await login(),
    b = await login();
  assert.equal((await accept(a, await invite(w, a))).status, 201);
  await grant({ kind: "user", id: w.u.id }, await plan(100, 1000000));
  await s.db.control.query("UPDATE users SET status='suspended' WHERE id=$1", [
    a.id,
  ]);
  assert.equal((await usage(w)).seats.used, 2);
  assert.equal(
    (await accept(b, await invite(w, b))).data.error.code,
    "PLAN_SEAT_LIMIT",
  );
});

test("an existing active seat can change role at capacity, while removed and administrator-suspended seats need current capacity", async () => {
  const w = await workspace(await plan(2)),
    a = await login(),
    b = await login();
  const accepted = await accept(a, await invite(w, a));
  assert.equal(accepted.status, 201);
  const updated = await call(w.u, "PATCH", w.base + "/members/" + a.id, {
    role: "viewer",
    status: "active",
    version: accepted.data.auth_version,
    project_ids: [w.project],
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  await s.db.control.query(
    "UPDATE memberships SET status='removed',admin_suspended=true,version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant, a.id],
  );
  assert.equal((await accept(b, await invite(w, b))).status, 201);
  const m = (
    await s.db.control.query(
      "SELECT version FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [w.tenant, a.id],
    )
  ).rows[0];
  const command = {
    user_id: a.id,
    expected_version: m.version,
    state: "active",
    role: "member",
    project_ids: [w.project],
    reason: "Restore an occupied seat",
  };
  const preview = await call(
    operator,
    "POST",
    `/v1/admin/tenants/${w.tenant}/memberships/preview`,
    command,
  );
  assert.equal(preview.data.error.code, "PLAN_SEAT_LIMIT");
  await assert.rejects(
    s.db.control.query(
      "UPDATE memberships SET status='active',admin_suspended=false WHERE tenant_id=$1 AND user_id=$2",
      [w.tenant, a.id],
    ),
    /PLAN_SEAT_LIMIT/,
  );
});

test("a new publication does not widen an existing grant, and explicit downgrade preserves existing seats", async () => {
  const v = await plan(3),
    w = await workspace(v),
    a = await login(),
    b = await login();
  await accept(a, await invite(w, a));
  await accept(b, await invite(w, b));
  await plan(20, 5000, v.plan_id);
  assert.equal((await usage(w)).seats.limit, 3);
  await grant({ kind: "tenant", id: w.tenant }, await plan(1), {
    overlap_policy: "replace",
  });
  const r = await usage(w);
  assert.equal(r.seats.used, 3);
  assert.equal(r.seats.over_limit, true);
  assert.equal((await call(a, "GET", w.base + "/projects")).status, 200);
  const c = await login();
  assert.equal(
    (await accept(c, await invite(w, c))).data.error.code,
    "PLAN_SEAT_LIMIT",
  );
});

test("concurrent upload reservations count across users and exact-key retries do not double reserve storage", async () => {
  const w = await workspace(await plan(2, 8)),
    k = randomUUID(),
    content = "12345678";
  const results = await Promise.all([
    upload(w, content, {}, k),
    upload(w, content, {}, k),
  ]);
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results),
  );
  assert.equal(results[0].data.upload_id, results[1].data.upload_id);
  assert.equal((await usage(w)).storage.reserved_bytes, "8");
  assert.equal((await upload(w, "x")).data.error.code, "PLAN_STORAGE_LIMIT");
});

test("a full storage reservation converts atomically to one version without double charging and completion can be replayed", async () => {
  const w = await workspace(await plan(2, 8)),
    content = "12345678",
    u = await upload(w, content);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const r = await finish(w, u.data.upload_id, content);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await usage(w)).storage.used_bytes, "8");
  assert.equal((await usage(w)).storage.reserved_bytes, "0");
  const replay = await call(
    w.u,
    "POST",
    `${w.base}/projects/${w.project}/uploads/${u.data.upload_id}/complete`,
    { size_bytes: 8, sha256: hash(content) },
  );
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.equal(replay.data.id, r.data.id);
  assert.equal((await usage(w)).storage.total_bytes, "8");
});

test("cancellation and clock expiry release reservations without a worker; an expired commitment cannot be revived", async () => {
  const w = await workspace(await plan(2, 8)),
    u = await upload(w, "12345678");
  assert.equal(
    (
      await call(
        w.u,
        "DELETE",
        `${w.base}/projects/${w.project}/uploads/${u.data.upload_id}`,
      )
    ).status,
    200,
  );
  assert.equal((await usage(w)).storage.reserved_bytes, "0");
  const again = await upload(w, "12345678");
  assert.equal(again.status, 201, JSON.stringify(again.data));
  await s.db.control.query(
    "UPDATE upload_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [again.data.upload_id],
  );
  assert.equal((await usage(w)).storage.reserved_bytes, "0");
  await assert.rejects(
    s.db.control.query(
      "UPDATE upload_sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [again.data.upload_id],
    ),
    /RESOURCE_IDENTITY_IMMUTABLE/,
  );
  assert.equal((await upload(w, "12345678")).status, 201);
});

test("all retained versions and independent copies are charged; rejected growth performs no object write", async () => {
  const w = await workspace(await plan(2, 8)),
    a = await bytes(w, "1234");
  await bytes(w, "5678", { asset: a.id, expectedVersion: 1 });
  assert.equal((await usage(w)).storage.used_bytes, "8");
  const oldFiles = (await readdir(s.db.config.DATA_DIR + "/objects")).length;
  await assert.rejects(bytes(w, "x"), /PLAN_STORAGE_LIMIT/);
  assert.equal(
    (await readdir(s.db.config.DATA_DIR + "/objects")).length,
    oldFiles,
  );
  const v = (
    await s.db.control.query(
      "SELECT * FROM asset_versions WHERE asset_id=$1 LIMIT 1",
      [a.id],
    )
  ).rows[0];
  await assert.rejects(
    s.db.tx(
      (tx) =>
        copyAssetVersion(tx, s.storage, {
          tenant: w.tenant,
          project: w.project,
          user: w.u.id,
          name: "copy.txt",
          mime: v.mime_type,
          storageKey: v.storage_key,
          size: Number(v.bytes),
          sha256: v.sha256,
        }),
      w.tenant,
    ),
    /PLAN_STORAGE_LIMIT/,
  );
  assert.equal((await usage(w)).storage.used_bytes, "8");
});

test("a quota downgrade preserves bytes and existing reservations can finish without additional capacity", async () => {
  const w = await workspace(await plan(2, 8)),
    u = await upload(w, "12345678");
  await grant({ kind: "tenant", id: w.tenant }, await plan(2, 4), {
    overlap_policy: "replace",
  });
  assert.equal((await usage(w)).storage.over_limit, true);
  const r = await finish(w, u.data.upload_id, "12345678");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await usage(w)).storage.used_bytes, "8");
  assert.equal((await upload(w, "x")).data.error.code, "PLAN_STORAGE_LIMIT");
});

test("independent asset transactions race for the same remaining bytes and the losing transaction leaves no version", async () => {
  const w = await workspace(await plan(2, 5));
  const r = await Promise.allSettled([bytes(w, "12345"), bytes(w, "abcde")]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const failed = r.find(
    (x) => x.status === "rejected",
  ) as PromiseRejectedResult;
  assert.match(failed.reason.message, /PLAN_STORAGE_LIMIT/);
  assert.equal((await usage(w)).storage.used_bytes, "5");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM assets WHERE tenant_id=$1",
        [w.tenant],
      )
    ).rows[0].n,
    1,
  );
});

test("an aggregate includes other members' private versions without exposing private rows or filenames", async () => {
  const w = await workspace(await plan(2, 8)),
    u = await login();
  await accept(u, await invite(w, u));
  const conversation = await call(
    u,
    "POST",
    `${w.base}/projects/${w.project}/conversations`,
    { name: "Private quota content" },
  );
  assert.ok(
    [200, 201].includes(conversation.status),
    JSON.stringify(conversation.data),
  );
  const c = conversation.data;
  await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: w.tenant,
        project: w.project,
        user: u.id,
        name: "private-secret.txt",
        mime: "text/plain",
        bytes: Buffer.from("12345678"),
        conversation: c.id,
      }),
    w.tenant,
    false,
    u.id,
  );
  const visible = await s.db.tx(
    (tx) =>
      tx.query("SELECT * FROM asset_versions WHERE tenant_id=$1", [w.tenant]),
    w.tenant,
    false,
    w.u.id,
  );
  assert.equal(visible.rowCount, 0);
  const r = await usage(w);
  assert.equal(r.storage.used_bytes, "8");
  assert.ok(!JSON.stringify(r).includes("private-secret"));
  assert.equal((await upload(w, "x")).data.error.code, "PLAN_STORAGE_LIMIT");
});

test("quarantine and logical deletion retain charged bytes until successful physical cleanup", async () => {
  const w = await workspace(await plan(2, 4)),
    a = await bytes(w, "1234");
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [a.id],
  );
  assert.equal((await usage(w)).storage.used_bytes, "4");
  await s.db.control.query("UPDATE assets SET state='deleted' WHERE id=$1", [
    a.id,
  ]);
  assert.equal((await usage(w)).storage.used_bytes, "4");
  const original = s.storage.remove.bind(s.storage);
  s.storage.remove = async () => {
    throw Object.assign(new Error("Fixture storage is busy"), {
      code: "EBUSY",
    });
  };
  try {
    await new ErasureService(s.db, s.storage).advance(2);
  } finally {
    s.storage.remove = original;
  }
  assert.equal((await usage(w)).storage.used_bytes, "4");
  assert.equal((await upload(w, "x")).data.error.code, "PLAN_STORAGE_LIMIT");
  await s.db.control.query(
    "UPDATE deletion_jobs SET next_attempt_at=now() WHERE target_id=$1",
    [a.id],
  );
  await new ErasureService(s.db, s.storage).advance(2);
  assert.equal((await usage(w)).storage.used_bytes, "0");
  assert.equal((await upload(w, "1234")).status, 201);
});

test("direct version INSERTs cannot bypass capacity or forge an uncommitted or mismatched upload conversion", async () => {
  const w = await workspace(await plan(2, 4)),
    u = await upload(w, "1234");
  const a = (
    await s.db.control.query(
      "INSERT INTO assets(tenant_id,project_id,name,kind,created_by) VALUES($1,$2,'Forged asset','file',$3) RETURNING id",
      [w.tenant, w.project, w.u.id],
    )
  ).rows[0];
  const query =
    "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256,upload_session_id) VALUES($1,$2,1,$3,'text/plain',4,$4,$5)";
  await assert.rejects(
    s.db.control.query(query, [
      w.tenant,
      a.id,
      "objects/" + randomUUID(),
      hash("1234"),
      null,
    ]),
    /PLAN_STORAGE_LIMIT/,
  );
  await assert.rejects(
    s.db.control.query(query, [
      w.tenant,
      a.id,
      "objects/" + randomUUID(),
      hash("xxxx"),
      u.data.upload_id,
    ]),
    /UPLOAD_RESERVATION_INVALID/,
  );
  await assert.rejects(
    s.db.control.query(query, [
      w.tenant,
      a.id,
      "objects/" + randomUUID(),
      hash("1234"),
      u.data.upload_id,
    ]),
    /UPLOAD_RESERVATION_INVALID/,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE upload_sessions SET state='completed' WHERE id=$1",
      [u.data.upload_id],
    ),
    /UPLOAD_RESERVATION_INVALID/,
  );
  await assert.rejects(
    s.db.control.query("UPDATE upload_sessions SET size_bytes=1 WHERE id=$1", [
      u.data.upload_id,
    ]),
    /RESOURCE_IDENTITY_IMMUTABLE/,
  );
  assert.equal((await usage(w)).storage.reserved_bytes, "4");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE asset_id=$1",
        [a.id],
      )
    ).rows[0].n,
    0,
  );
});

test("new versions uploaded by another authorized project member consume that uploader's reservation", async () => {
  const w = await workspace(await plan(2, 8)),
    a = await bytes(w, "1234"),
    u = await login();
  await accept(u, await invite(w, u));
  const memberWorkspace = { ...w, u };
  const r = await upload(memberWorkspace, "5678", {
    asset_id: a.id,
    expected_version: 1,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const completed = await finish(memberWorkspace, r.data.upload_id, "5678");
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(completed.data.current_version, 2);
  assert.equal((await usage(w)).storage.total_bytes, "8");
});

test("tenant quota reads reject foreign users, require both whole-tenant admin permissions, and respect overlapping project denies", async () => {
  const w = await workspace(await plan()),
    other = await login();
  assert.equal(
    (await call(other, "GET", w.base + "/resource-usage")).status,
    404,
  );
  assert.equal(
    (
      await call(w.u, "GET", w.base + "/resource-usage", undefined, {
        "x-tenant-id": randomUUID(),
      })
    ).data.error.code,
    "TENANT_MISMATCH",
  );
  const readOnly = await administrator(
    ["admin.tenants.read"],
    "tenant",
    w.tenant,
  );
  const project = await administrator(
    ["admin.tenants.read", "admin.entitlements.read"],
    "project",
    w.project,
  );
  const limited = await administrator(
    ["admin.tenants.read", "admin.entitlements.read"],
    "tenant",
    w.tenant,
  );
  const url = `/v1/admin/tenants/${w.tenant}/resource-usage`;
  assert.equal((await call(readOnly, "GET", url)).status, 403);
  assert.equal((await call(project, "GET", url)).status, 403);
  assert.equal((await call(limited, "GET", url)).status, 200);
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) SELECT $1,role_key,'project',$2,'deny' FROM admin_bindings WHERE principal_id=$1 LIMIT 1",
    [limited.id, w.project],
  );
  assert.equal((await call(limited, "GET", url)).status, 403);
  const full = await call(operator, "GET", url);
  assert.equal(full.status, 200, JSON.stringify(full.data));
  assert.deepEqual(full.data.seats, (await usage(w)).seats);
});

test("audit failure rolls back a new reservation and its replay; the same request can subsequently reserve once", async () => {
  const w = await workspace(await plan(2, 4)),
    k = randomUUID();
  // DDL is limited to this test's isolated database and removed in finally.
  const owner = new (await import("pg")).default.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION fail_resource_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='upload.create' THEN RAISE EXCEPTION 'Fixture audit unavailable'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER fixture_resource_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_resource_audit()",
    );
    assert.equal((await upload(w, "1234", {}, k)).status, 500);
    assert.equal((await usage(w)).storage.total_bytes, "0");
    await owner.query("DROP TRIGGER fixture_resource_audit ON audit_log");
    assert.equal((await upload(w, "1234", {}, k)).status, 201);
    assert.equal((await usage(w)).storage.reserved_bytes, "4");
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS fixture_resource_audit ON audit_log",
    );
    await owner.query("DROP FUNCTION fail_resource_audit()");
    await owner.end();
  }
});

test("separate users cannot reserve the same last bytes concurrently", async () => {
  const w = await workspace(await plan(2, 8)),
    u = await login();
  await accept(u, await invite(w, u));
  const result = await Promise.all([
    upload(w, "12345678"),
    upload({ ...w, u }, "abcdefgh"),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    result.find((r) => r.status === 409)!.data.error.code,
    "PLAN_STORAGE_LIMIT",
  );
  assert.equal((await usage(w)).storage.reserved_bytes, "8");
});

test("a clock boundary is evaluated at resource admission even in a transaction opened before expiry", async () => {
  const v = await plan(1, 4),
    w = await workspace();
  const g = await grant({ kind: "tenant", id: w.tenant }, v, {
    ends_at: new Date(Date.now() + 1800).toISOString(),
  });
  await s.db.tx(
    async (tx) => {
      const first = await resourceSnapshot(tx, w.tenant);
      assert.equal(first.seats.limit, 1);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, Date.parse(g.ends_at) - Date.now() + 100),
        ),
      );
      const after = await resourceSnapshot(tx, w.tenant);
      assert.equal(after.legacy_compatibility_limits, true);
      assert.ok(!after.plan_version_ids.includes(v.id));
    },
    w.tenant,
    true,
  );
});

test("resource reads select only the current mode's tenant grants while retaining the same actual usage", async () => {
  const w = await workspace(await plan(2, 4));
  await bytes(w, "1234");
  const configured = await usage(w);
  assert.equal(configured.storage.limit_bytes, "4");
  const simulated = await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.data_mode','simulated',true)");
      return resourceSnapshot(tx, w.tenant);
    },
    w.tenant,
    true,
  );
  assert.equal(simulated.data_mode, "simulated");
  assert.equal(simulated.legacy_compatibility_limits, true);
  assert.equal(simulated.storage.used_bytes, "4");
  assert.notDeepEqual(simulated.plan_version_ids, configured.plan_version_ids);
  assert.equal((await usage(w)).storage.limit_bytes, "4");
});

test("deleting a private conversation invalidates completed and pending uploads, releases only its reservation, and cannot reopen either transfer", async () => {
  const w = await workspace(await plan(2, 8));
  const c = await call(
    w.u,
    "POST",
    `${w.base}/projects/${w.project}/conversations`,
    { name: "Private attachment quota cleanup" },
  );
  assert.ok([200, 201].includes(c.status), JSON.stringify(c.data));
  const first = await upload(w, "1234", { conversation_id: c.data.id });
  assert.equal(first.status, 201);
  assert.equal((await finish(w, first.data.upload_id, "1234")).status, 200);
  const pending = await upload(w, "5678", { conversation_id: c.data.id });
  assert.equal(pending.status, 201);
  assert.equal((await usage(w)).storage.total_bytes, "8");
  await assert.rejects(
    s.db.control.query(
      "UPDATE upload_sessions SET state='cancelled' WHERE id=$1",
      [first.data.upload_id],
    ),
    /RESOURCE_IDENTITY_IMMUTABLE/,
  );
  const deletion = await call(
    w.u,
    "POST",
    "/v1/deletions",
    {
      target_type: "conversation",
      target_id: c.data.id,
      reason: "Erase private quota attachments",
    },
    { "x-tenant-id": w.tenant },
  );
  assert.equal(deletion.status, 202, JSON.stringify(deletion.data));
  const r = await usage(w);
  assert.equal(r.storage.reserved_bytes, "0");
  assert.equal(r.storage.used_bytes, "4");
  for (const id of [first.data.upload_id, pending.data.upload_id]) {
    const row = (
      await s.db.control.query(
        "SELECT state,filename,result FROM upload_sessions WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.deepEqual(row, {
      state: "cancelled",
      filename: "[deleted]",
      result: null,
    });
    await assert.rejects(
      s.db.control.query(
        "UPDATE upload_sessions SET state='pending' WHERE id=$1",
        [id],
      ),
      /RESOURCE_IDENTITY_IMMUTABLE/,
    );
  }
  for (let n = 0; n < 3; n++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'",
      [w.tenant],
    );
    await new ErasureService(s.db, s.storage).advance(40);
  }
  assert.equal((await usage(w)).storage.used_bytes, "0");
});
