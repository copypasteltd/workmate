import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { settle } from "../src/billing.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import { advanceAdminDataJobs } from "../src/admin-data-jobs.js";
import { dataCsvCell, dataCommand } from "../src/admin-data-model.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(options.key === null
        ? {}
        : { "idempotency-key": options.key ?? randomUUID() }),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function signIn(
  address: string,
  secret?: OTPAuth.Secret,
): Promise<Client> {
  if (secret) {
    const prior = (
      await s.db.control.query(
        "SELECT last_totp_step FROM admin_principals WHERE email=$1",
        [address],
      )
    ).rows[0];
    if (Number(prior?.last_totp_step) >= Math.floor(Date.now() / 30000))
      await new Promise((resolve) =>
        setTimeout(resolve, 30100 - (Date.now() % 30000)),
      );
  }
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [address],
  );
  const ch = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
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
  const cookie =
    r.raw.cookies.find(
      (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
    ) ?? r.raw.cookies[0];
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    email: address,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function user() {
  return signIn(`admin-data-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-data-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Membership operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, tenant ? "tenant" : "global", tenant ?? null],
  );
  return { ...(await signIn(email, secret)), id: p.id, secret };
}
const root = "/v1/admin/data-jobs";
let operator: Awaited<ReturnType<typeof admin>>, other: Client;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
  operator = await admin(undefined, "super_admin");
  other = await admin(undefined, "super_admin");
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function ok(
  c: Client,
  method: string,
  url: string,
  body?: unknown,
  options?: any,
) {
  const r = await call(c, method, url, body, options);
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data));
  return r.data;
}
async function synthetic(name = "Data target") {
  return (
    await s.db.control.query(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING *",
      [randomUUID() + "@example.invalid", name],
    )
  ).rows[0];
}
async function prepare(c: Client, command: unknown) {
  return ok(c, "POST", root + "/previews", command);
}
async function confirm(c: Client, p: any, options?: any) {
  return ok(
    c,
    "POST",
    root,
    { preview_id: p.id, definition_hash: p.definition_hash },
    options,
  );
}
async function batch(ids: string[], c: Client = operator) {
  return confirm(
    c,
    await prepare(c, {
      kind: "users.status",
      ids,
      state: "frozen",
      reason: "Reviewed customer account change",
    }),
  );
}
async function detail(id: string, c: Client = operator) {
  return ok(c, "GET", root + "/" + id);
}
async function exportJob(
  source = "users",
  filters: unknown = {},
  c: Client = operator,
) {
  return confirm(
    c,
    await prepare(c, {
      kind: "export",
      source,
      filters,
      reason: "Authorized customer data export",
    }),
  );
}
async function bind(
  a: Client,
  permissions: string[],
  effect = "allow",
  kind = "global",
  target: string | null = null,
) {
  const role = "data_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(permissions)],
  );
  return (
    await s.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [a.id, role, kind, target, effect],
    )
  ).rows[0].id;
}
async function download(c: Client, id: string, query = "") {
  return s.app.inject({
    method: "GET",
    url: root + "/" + id + "/download" + query,
    headers: { cookie: c.cookie, origin: s.db.config.ADMIN_ORIGIN },
  });
}

test("strict commands and spreadsheet formula neutralization including leading controls", () => {
  for (const value of [
    '=HYPERLINK("https://example.invalid")',
    " \t@SUM(1)",
    "\u0000+1",
    "\rheader",
    "\nheader",
    "-2",
    "\u2003=1",
  ])
    assert.ok(dataCsvCell(value).startsWith("\"'"), JSON.stringify(value));
  assert.equal(dataCsvCell('normal,"value"'), '"normal,""value"""');
  assert.equal(
    dataCommand.safeParse({
      kind: "export",
      source: "audit",
      filters: { project_id: randomUUID() },
      reason: "Audit export",
    }).success,
    false,
  );
  assert.equal(
    dataCommand.safeParse({
      kind: "users.status",
      ids: [randomUUID()],
      state: "closed",
      reason: "Close users",
    }).success,
    false,
  );
  assert.equal(
    dataCommand.safeParse({
      kind: "export",
      source: "users",
      filters: {
        created_from: "2026-10-26T00:00:00Z",
        created_to: "2026-10-25T00:00:00Z",
      },
      reason: "Export users",
    }).success,
    false,
  );
});
test("confirmation queues without mutation; idempotent replay and simultaneous confirmation create one job", async () => {
  const u = await user(),
    pre = await prepare(operator, {
      kind: "users.status",
      ids: [u.id],
      state: "frozen",
      reason: "Support confirmed account freeze",
    }),
    key = randomUUID();
  const jobs = await Promise.all([
    confirm(operator, pre, { key }),
    confirm(operator, pre, { key }),
  ]);
  assert.equal(jobs[0].id, jobs[1].id);
  assert.equal(jobs[0].state, "queued");
  assert.equal(
    (await s.db.control.query("SELECT status FROM users WHERE id=$1", [u.id]))
      .rows[0].status,
    "active",
  );
  assert.equal(
    (
      await call(operator, "POST", root, {
        preview_id: pre.id,
        definition_hash: pre.definition_hash,
      })
    ).status,
    409,
  );
  await Promise.all([advanceAdminDataJobs(s.db), advanceAdminDataJobs(s.db)]);
  const out = await detail(jobs[0].id);
  assert.equal(out.state, "succeeded");
  assert.equal(out.items[0].attempts, 1);
  const row = (
    await s.db.control.query(
      "SELECT version,auth_version,status FROM users WHERE id=$1",
      [u.id],
    )
  ).rows[0];
  assert.deepEqual(row, { version: 2, auth_version: 2, status: "suspended" });
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
  assert.equal((await call(other, "GET", root + "/" + out.id)).status, 404);
  const replay = await confirm(operator, pre, { key });
  assert.equal(replay.id, out.id);
  assert.equal(replay.state, "succeeded");
});
test("a stale or different-session preview cannot queue an account change", async () => {
  const u = await synthetic(),
    pre = await prepare(operator, {
      kind: "users.status",
      ids: [u.id],
      state: "frozen",
      reason: "Reviewed account freeze",
    });
  await s.db.control.query("UPDATE users SET version=version+1 WHERE id=$1", [
    u.id,
  ]);
  const r = await call(operator, "POST", root, {
    preview_id: pre.id,
    definition_hash: pre.definition_hash,
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "PREVIEW_STALE");
  const newSession = await signIn(operator.email, operator.secret),
    pre2 = await prepare(operator, {
      kind: "users.status",
      ids: [u.id],
      state: "frozen",
      reason: "Reviewed account freeze",
    });
  assert.equal(
    (
      await call(newSession, "POST", root, {
        preview_id: pre2.id,
        definition_hash: pre2.definition_hash,
      })
    ).status,
    409,
  );
});
test("partial success is durable; reviewed child retry excludes successes and cannot fork", async () => {
  const u = await synthetic(),
    v = await synthetic(),
    j = await batch([u.id, v.id]);
  await s.db.control.query("UPDATE users SET version=version+1 WHERE id=$1", [
    v.id,
  ]);
  await advanceAdminDataJobs(s.db);
  const d = await detail(j.id);
  assert.equal(d.state, "partially_succeeded");
  assert.equal(d.counts.succeeded, 1);
  assert.equal(d.counts.failed, 1);
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_items SET state='pending' WHERE job_id=$1 AND state='failed'",
      [j.id],
    ),
    { code: "23514" },
  );
  assert.equal(
    d.items.find((i: any) => i.target_id === v.id).error_code,
    "TARGET_CHANGED",
  );
  const control = {
    expected_revision: d.revision,
    reason: "Review the corrected failed target only",
  };
  const pre = await ok(
      operator,
      "POST",
      root + "/" + j.id + "/retry-previews",
      control,
    ),
    pre2 = await ok(
      operator,
      "POST",
      root + "/" + j.id + "/retry-previews",
      control,
    );
  assert.deepEqual(
    pre.manifest.targets.map((t: any) => t.id),
    [v.id],
  );
  const child = await confirm(operator, pre);
  assert.equal(child.retry_of, j.id);
  assert.equal(
    (
      await call(operator, "POST", root, {
        preview_id: pre2.id,
        definition_hash: pre2.definition_hash,
      })
    ).status,
    409,
  );
  await advanceAdminDataJobs(s.db);
  assert.equal((await detail(child.id)).state, "succeeded");
  assert.equal(
    (await s.db.control.query("SELECT version FROM users WHERE id=$1", [u.id]))
      .rows[0].version,
    2,
  );
  assert.equal((await detail(j.id)).state, "partially_succeeded");
});
test("cancel preserves committed items and stops remaining work, with optimistic revision control", async () => {
  const ids = (await Promise.all([synthetic(), synthetic(), synthetic()])).map(
      (u) => u.id,
    ),
    j = await batch(ids);
  await advanceAdminDataJobs(s.db, 1);
  const d = await detail(j.id);
  assert.equal(
    (
      await call(operator, "POST", root + "/" + j.id + "/cancel", {
        expected_revision: 1,
        reason: "Cancel the remaining targets",
      })
    ).status,
    409,
  );
  await ok(operator, "POST", root + "/" + j.id + "/cancel", {
    expected_revision: d.revision,
    reason: "Cancel the remaining targets",
  });
  await advanceAdminDataJobs(s.db);
  const out = await detail(j.id);
  assert.equal(out.state, "cancelled");
  assert.deepEqual(out.counts, {
    pending: 0,
    succeeded: 1,
    failed: 0,
    cancelled: 2,
  });
  const rows = (
    await s.db.control.query(
      "SELECT version FROM users WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  assert.deepEqual(rows.map((r) => r.version).sort(), [1, 1, 2]);
});
test("concurrent workers commit every account mutation once", async () => {
  const ids = (
      await Promise.all(Array.from({ length: 35 }, () => synthetic()))
    ).map((u) => u.id),
    j = await batch(ids);
  await Promise.all([advanceAdminDataJobs(s.db), advanceAdminDataJobs(s.db)]);
  const d = await detail(j.id);
  assert.equal(d.state, "succeeded");
  assert.equal(d.counts.succeeded, 35);
  const rows = (
    await s.db.control.query(
      "SELECT version,auth_version FROM users WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  assert.ok(rows.every((r) => r.version === 2 && r.auth_version === 2));
});
test("transient database failure rolls back mutation and is retried without repeating success", async () => {
  const u = await synthetic(),
    j = await batch([u.id]);
  const ddl = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await ddl.connect();
  await ddl.query(
    `CREATE FUNCTION data_job_fail_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${u.id}'::uuid AND NEW.status='suspended' THEN RAISE EXCEPTION 'controlled serialization fault' USING ERRCODE='40001'; END IF;RETURN NEW;END $$;CREATE TRIGGER data_job_fail_once BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION data_job_fail_once()`,
  );
  try {
    await advanceAdminDataJobs(s.db, 1);
    const d = await detail(j.id);
    assert.equal(d.state, "running");
    assert.equal(d.items[0].state, "pending");
    assert.equal(d.items[0].attempts, 1);
    assert.equal(
      (
        await s.db.control.query("SELECT version FROM users WHERE id=$1", [
          u.id,
        ])
      ).rows[0].version,
      1,
    );
  } finally {
    await ddl.query(
      "DROP TRIGGER data_job_fail_once ON users;DROP FUNCTION data_job_fail_once()",
    );
    await ddl.end();
  }
  await s.db.control.query(
    "UPDATE admin_data_items SET next_attempt_at=clock_timestamp() WHERE job_id=$1",
    [j.id],
  );
  await advanceAdminDataJobs(s.db);
  const out = await detail(j.id);
  assert.equal(out.state, "succeeded");
  assert.equal(out.items[0].attempts, 2);
});
test("expired MFA pauses a worker; the same owner must explicitly authorize a fresh session", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await synthetic(),
    j = await batch([u.id], a);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  await advanceAdminDataJobs(s.db);
  const row = (
    await s.db.control.query(
      "SELECT state,error_code,revision FROM admin_data_jobs WHERE id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(row.state, "needs_authorization");
  assert.equal(row.error_code, "MFA_REQUIRED");
  const renewed = await signIn(a.email, a.secret);
  await ok(renewed, "POST", root + "/" + j.id + "/reauthorize", {
    expected_revision: row.revision,
    reason: "Fresh owner MFA confirmation",
  });
  await advanceAdminDataJobs(s.db);
  assert.equal((await detail(j.id, renewed)).state, "succeeded");
});
test("a changed binding pauses execution and cannot revive an old snapshot through reauthorization", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await synthetic(),
    j = await batch([u.id], a);
  await bind(a, ["admin.users.status.write"], "deny");
  await advanceAdminDataJobs(s.db);
  const row = (
    await s.db.control.query(
      "SELECT state,revision FROM admin_data_jobs WHERE id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(row.state, "needs_authorization");
  assert.equal(
    (
      await call(a, "POST", root + "/" + j.id + "/reauthorize", {
        expected_revision: row.revision,
        reason: "Try to restore old authority",
      })
    ).status,
    403,
  );
  await ok(a, "POST", root + "/" + j.id + "/cancel", {
    expected_revision: row.revision,
    reason: "Cancel after delegated access changed",
  });
  assert.equal(
    (await s.db.control.query("SELECT version FROM users WHERE id=$1", [u.id]))
      .rows[0].version,
    1,
  );
});
test("frozen CSV selection contains 501 records, excludes later arrivals, and has an exact manifest", async () => {
  const prefix = "snapshot-" + randomUUID();
  await s.db.control.query(
    "INSERT INTO users(email,name) SELECT gen_random_uuid()::text||'@example.invalid',$1||n::text FROM generate_series(1,501)n",
    [prefix],
  );
  const j = await exportJob("users", { q: prefix });
  await synthetic(prefix + "later");
  for (let n = 0; n < 17; n++) await advanceAdminDataJobs(s.db);
  assert.equal((await detail(j.id)).state, "succeeded");
  const file = await download(operator, j.id);
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.body.trim().split("\r\n").length, 502);
  assert.ok(!file.body.includes(prefix + "later"));
  assert.match(file.headers["cache-control"] as string, /no-store/);
  const manifest = await download(operator, j.id, "?format=manifest");
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.json().manifest.targets.length, 501);
  assert.equal(manifest.json().counts.succeeded, 501);
});
test("contact field redaction is applied before encrypted snapshot storage", async () => {
  const a = await admin(undefined, "user_operator");
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    a.id,
  ]);
  await bind(a, [
    "admin.jobs.create",
    "admin.jobs.read",
    "admin.users.read",
    "admin.exports.create",
    "admin.exports.download",
  ]);
  const u = await synthetic(),
    pre = await prepare(a, {
      kind: "export",
      source: "users",
      filters: { user_id: u.id },
      reason: "Redacted directory export",
    });
  assert.equal(pre.sample[0].contact, undefined);
  assert.match(pre.sample[0].masked_contact, /\*\*\*/);
  const persisted = (
    await s.db.control.query("SELECT * FROM admin_data_previews WHERE id=$1", [
      pre.id,
    ])
  ).rows[0];
  assert.ok(!JSON.stringify(persisted).includes(u.email));
  const j = await confirm(a, pre);
  await advanceAdminDataJobs(s.db);
  const file = await download(a, j.id);
  assert.equal(file.statusCode, 200);
  assert.ok(!file.body.includes(u.email));
  assert.match(file.body, /masked_contact/);
});
test("partial exports require explicit acceptance; later record changes block a download", async () => {
  const prefix = "partial-" + randomUUID(),
    u = await synthetic(prefix + "first"),
    v = await synthetic(prefix + "second"),
    j = await exportJob("users", { q: prefix });
  await s.db.control.query(
    "UPDATE users SET name='changed',version=version+1 WHERE id=$1",
    [v.id],
  );
  await advanceAdminDataJobs(s.db);
  assert.equal((await detail(j.id)).state, "partially_succeeded");
  assert.equal((await download(operator, j.id)).statusCode, 409);
  const partial = await download(operator, j.id, "?accept_partial=true");
  assert.equal(partial.statusCode, 200);
  assert.ok(partial.body.includes(u.id));
  assert.ok(!partial.body.includes(v.id));
  await s.db.control.query(
    "UPDATE users SET name='new name',version=version+1 WHERE id=$1",
    [u.id],
  );
  const denied = await download(operator, j.id, "?accept_partial=true");
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.json().error.code, "EXPORT_CHANGED");
});
test("download rechecks current authority, ownership, and explicit export denies", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await synthetic(),
    j = await exportJob("users", { user_id: u.id }, a);
  await advanceAdminDataJobs(s.db);
  assert.equal((await download(other, j.id)).statusCode, 404);
  await bind(a, ["admin.exports.download"], "deny");
  assert.equal((await download(a, j.id)).statusCode, 403);
});
test("project denies constrain account export selection even under global read grants", async () => {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Scoped export",
      project_name: "Private project",
    }),
    a = await admin(undefined, "super_admin");
  await bind(a, ["admin.exports.create"], "deny", "project", w.project.id);
  const r = await call(a, "POST", root + "/previews", {
    kind: "export",
    source: "users",
    filters: { user_id: owner.id },
    reason: "Check scoped export restriction",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "NO_TARGETS");
});
test("unsupported filters, empty selection, excessive selection and absent idempotency fail explicitly", async () => {
  const u = await synthetic();
  assert.equal(
    (
      await call(operator, "POST", root + "/previews", {
        kind: "export",
        source: "billing",
        filters: { state: "active" },
        reason: "Unsupported state filter",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(operator, "POST", root + "/previews", {
        kind: "export",
        source: "users",
        filters: { q: randomUUID() },
        reason: "No matching records",
      })
    ).data.error.code,
    "NO_TARGETS",
  );
  assert.equal(
    (
      await call(operator, "POST", root + "/previews", {
        kind: "users.status",
        ids: [u.id, u.id],
        state: "frozen",
        reason: "Duplicate selection",
      })
    ).status,
    400,
  );
  const pre = await prepare(operator, {
    kind: "users.status",
    ids: [u.id],
    state: "frozen",
    reason: "Reviewed status change",
  });
  assert.equal(
    (
      await call(
        operator,
        "POST",
        root,
        { preview_id: pre.id, definition_hash: pre.definition_hash },
        { key: null },
      )
    ).data.error.code,
    "IDEMPOTENCY_REQUIRED",
  );
});
test("SQL guards preserve frozen definitions, events, successful items and private control-plane tables", async () => {
  const u = await synthetic(),
    j = await batch([u.id]);
  await advanceAdminDataJobs(s.db);
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_jobs SET command='{}'::jsonb,revision=revision+1 WHERE id=$1",
      [j.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_items SET state='pending' WHERE job_id=$1",
      [j.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_items SET payload_ciphertext=NULL WHERE job_id=$1",
      [j.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_events SET detail='{}' WHERE job_id=$1",
      [j.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(s.db.app.query("SELECT * FROM admin_data_items"), {
    code: "42501",
  });
  await assert.rejects(s.db.queue.query("SELECT * FROM admin_data_previews"), {
    code: "42501",
  });
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_data_items SET attempts=0 WHERE job_id=$1",
      [j.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      `INSERT INTO admin_data_jobs(preview_id,principal_id,command,definition_hash,access_hash,policy_version_id,auth_version,session_id,state,total,manifest,idempotency_key,request_hash)
    SELECT preview_id,$2,command,definition_hash,access_hash,policy_version_id,auth_version,session_id,'queued',total,manifest,$3,request_hash FROM admin_data_jobs WHERE id=$1`,
      [j.id, other.id, randomUUID()],
    ),
    { code: "23514" },
  );
});

test("usage, billing and audit exports freeze whitelisted individual records with real scope checks", async () => {
  const u = await user(),
    w = await ok(u, "POST", "/v1/tenants", {
      name: "Data source studio",
      project_name: "Reporting",
    });
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [w.tenant.id],
  );
  const task = await ok(
    u,
    "POST",
    `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`,
    {
      title: "Private title excluded from export",
      prompt: "Private prompt excluded from export",
      role_key: "assistant",
      budget_micros: 1000000,
    },
  );
  await s.db.tx(
    (tx) => settle(tx, w.tenant.id, task.id, 12345, u.id),
    undefined,
    true,
  );
  for (const source of ["usage", "billing", "audit"] as const) {
    const filters =
      source === "audit"
        ? { q: "admin.data-jobs.create" }
        : { tenant_id: w.tenant.id };
    const j = await exportJob(source, filters);
    await advanceAdminDataJobs(s.db);
    const d = await detail(j.id);
    assert.equal(d.state, "succeeded", JSON.stringify(d));
    const file = await download(operator, j.id);
    assert.equal(file.statusCode, 200, file.body);
    assert.ok(!file.body.includes("Private prompt"));
    assert.ok(!file.body.includes("Private title"));
    if (source === "usage") assert.match(file.body, /12345/);
    if (source === "billing") assert.ok(!d.manifest.columns.includes("reason"));
    if (source === "audit") assert.ok(!d.manifest.columns.includes("detail"));
  }
});
test("expiry erases encrypted material while retaining immutable selection and audit facts", async () => {
  const u = await synthetic(),
    j = await batch([u.id]);
  await advanceAdminDataJobs(s.db);
  const expired = (
    await s.db.control.query(
      `INSERT INTO admin_data_previews(principal_id,session_id,auth_version,access_hash,command,definition_hash,manifest,payload_ciphertext,payload_hash,created_at,expires_at)
    SELECT principal_id,session_id,auth_version,access_hash,command,definition_hash,manifest,payload_ciphertext,payload_hash,clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '1 minute' FROM admin_data_previews WHERE id=$1 RETURNING id`,
      [
        j.id
          ? (
              await s.db.control.query(
                "SELECT preview_id FROM admin_data_jobs WHERE id=$1",
                [j.id],
              )
            ).rows[0].preview_id
          : null,
      ],
    )
  ).rows[0];
  const clone = (
    await s.db.control.query(
      `INSERT INTO admin_data_jobs(preview_id,principal_id,command,definition_hash,access_hash,policy_version_id,auth_version,session_id,state,total,manifest,idempotency_key,request_hash,created_at,expires_at)
    SELECT $2,principal_id,command,definition_hash,access_hash,policy_version_id,auth_version,session_id,'succeeded',total,manifest,$3,request_hash,clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '1 minute' FROM admin_data_jobs WHERE id=$1 RETURNING id`,
      [j.id, expired.id, randomUUID()],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_data_items SELECT $2,ordinal,target_id,target_version,fingerprint,payload_ciphertext,payload_hash,state,attempts,retryable,error_code,next_attempt_at,completed_at FROM admin_data_items WHERE job_id=$1",
    [j.id, clone.id],
  );
  await advanceAdminDataJobs(s.db);
  const out = (
    await s.db.control.query(
      "SELECT j.state,i.payload_ciphertext,i.fingerprint FROM admin_data_jobs j JOIN admin_data_items i ON i.job_id=j.id WHERE j.id=$1",
      [clone.id],
    )
  ).rows[0];
  assert.equal(out.state, "expired");
  assert.equal(out.payload_ciphertext, null);
  assert.match(out.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT payload_ciphertext FROM admin_data_previews WHERE id=$1",
        [expired.id],
      )
    ).rows[0].payload_ciphertext,
    null,
  );
  assert.equal((await download(operator, clone.id)).statusCode, 410);
});
