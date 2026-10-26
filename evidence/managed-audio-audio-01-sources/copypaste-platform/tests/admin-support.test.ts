import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-support-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import { runMigrations } from "../scripts/migration-runner.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  cookie: string;
  csrf: string;
  admin: boolean;
  email: string;
  secret?: OTPAuth.Secret;
};
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const checks = new Map<string, ReturnType<typeof ajv.compile>>();
function schema(name: string, data: unknown) {
  if (!checks.has(name))
    checks.set(name, ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }));
  const check = checks.get(name)!;
  assert.ok(check(data), JSON.stringify(check.errors));
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = raw.json();
  if (raw.statusCode === 201) schema("SupportGrant", data);
  if (raw.statusCode === 202) schema("AdminOperation", data);
  if (
    raw.statusCode === 200 &&
    url.split("?")[0] === "/v1/admin/support/sessions"
  )
    schema("AdminSupportSessionList", data);
  return { status: raw.statusCode, data, raw };
}
async function login(email: string, secret?: OTPAuth.Secret): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [email],
  );
  const challenge = await call(undefined, "POST", prefix + "/challenge", {
    email,
  });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const verified = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: challenge.data.challenge_id,
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
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  const cookie = verified.raw.cookies.find(
    (r) => r.name === (secret ? "cp_admin_session" : "cp_session"),
  )!;
  return {
    id: verified.data.user?.id ?? verified.data.admin?.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: verified.data.csrf_token,
    email,
    secret,
    admin: !!secret,
  };
}
async function fixture(role = "support_agent") {
  const owner = await login(`support-${randomUUID()}@example.invalid`);
  const w = await call(owner, "POST", "/v1/tenants", {
    name: "Controlled customer",
    project_name: "Campaign",
  });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  const tenant = w.data.tenant.id,
    project = w.data.project.id,
    email = `support-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const actor = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Real support administrator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0].id;
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [actor, role, tenant],
  );
  const admin = { ...(await login(email, secret)), id: actor };
  return {
    owner,
    admin,
    tenant,
    project,
    input: {
      user_id: owner.id,
      tenant_id: tenant,
      project_ids: [project],
      mode: "read_only",
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      reason: "Investigate the reported task",
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function create(
  f: Fixture,
  extra: any = {},
  headers: Record<string, string> = {},
) {
  const r = await call(
    f.admin,
    "POST",
    "/v1/admin/support/sessions",
    { ...f.input, ...extra },
    headers,
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return { op: r.data, id: r.data.result_ids[0] };
}
const view = (f: Fixture, id: string) =>
  call(f.admin, "GET", `/v1/admin/support/sessions/${id}/view`, undefined, {
    "x-copypaste-support-session": id,
  });
async function grant(f: Fixture, ids = [f.project]) {
  const r = await call(
    f.owner,
    "POST",
    "/v1/support-grants",
    {
      reason: "Customer requested diagnostic assistance",
      project_ids: ids,
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    },
    { "x-tenant-id": f.tenant },
  );
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.id;
}
async function task(f: Fixture, privateTask = false) {
  const account = (
    await s.db.control.query(
      "SELECT id FROM wallets WHERE tenant_id=$1 AND data_mode='configured_services'",
      [f.tenant],
    )
  ).rows[0].id;
  return (
    await s.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,output,role_key,role_hash,budget_micros,idempotency_key,billing_account_id,private_owner) VALUES($1,$2,$3,'Controlled task','Shared controlled prompt','Controlled output','assistant','fixture',1,$4,$5,$6) RETURNING id",
      [
        f.tenant,
        f.project,
        f.owner.id,
        randomUUID(),
        account,
        privateTask ? f.owner.id : null,
      ],
    )
  ).rows[0].id;
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
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("canonical grant/session/list/operation use original strict schemas and preserve the real administrator", async () => {
  const f = await fixture(),
    g = await grant(f),
    t = await task(f),
    created = await create(f, { support_grant_id: g });
  const v = await view(f, created.id);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  schema("AdminSupportSession", v.data.session);
  assert.equal(v.data.actor.id, f.admin.id);
  assert.equal(v.data.target.id, f.owner.id);
  assert.equal(v.data.read_only, true);
  assert.deepEqual(
    v.data.projects.map((p: any) => p.id),
    [f.project],
  );
  assert.equal(v.data.tasks[0].id, t);
  assert.equal(v.data.tasks[0].body_available, false);
  assert.doesNotMatch(
    JSON.stringify(v.data),
    /Shared controlled prompt|Controlled output|token|cookie|credit|charged_micros/,
  );
  const list = await call(f.admin, "GET", "/v1/admin/support/sessions?limit=1");
  assert.equal(list.status, 200);
  assert.equal(list.data.items[0].id, created.id);
  assert.equal(
    (await call(f.admin, "GET", "/v1/admin/operations/" + created.op.id))
      .status,
    200,
  );
  const cookies = (
    await s.db.control.query("SELECT audience FROM sessions WHERE user_id=$1", [
      f.owner.id,
    ])
  ).rows;
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].audience, "user");
});
test("customer grant alone never grants body, VIP, billing or impersonation; explicit context refuses every other endpoint", async () => {
  const f = await fixture(),
    id = (await create(f, { support_grant_id: await grant(f) })).id;
  for (const [method, url, body] of [
    ["GET", "/v1/admin/me", undefined],
    ["GET", "/v1/session/context", undefined],
    ["POST", "/v1/admin/support/sessions", f.input],
    ["POST", "/v1/admin/billing/payments", {}],
    ["POST", "/v1/admin/entitlements", {}],
    ["GET", "/v1/auth/sessions", undefined],
  ] as const) {
    const r = await call(f.admin, method, url, body, {
      "x-copypaste-support-session": id,
    });
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.equal(r.data.error.code, "SUPPORT_READ_ONLY");
  }
  assert.equal(
    (await call(f.admin, "GET", `/v1/admin/support/sessions/${id}/view`))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/admin/support/sessions/${id}/view`,
        undefined,
        { "x-copypaste-support-session": id },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(f.admin, "POST", "/v1/admin/support", {
        tenant_id: f.tenant,
        reason: "Legacy no target",
      })
    ).status,
    410,
  );
});
test("body requires both a current explicit grant and independent body permission; private task bodies remain unavailable", async () => {
  const f = await fixture(),
    shared = await task(f),
    privateId = await task(f, true),
    id = (await create(f, { support_grant_id: await grant(f) })).id;
  const read = (taskId: string, sid = id) =>
    call(
      f.admin,
      "GET",
      `/v1/admin/support/sessions/${sid}/view/tasks/${taskId}`,
      undefined,
      { "x-copypaste-support-session": sid },
    );
  assert.equal((await read(shared)).status, 403);
  const role = "controlled_body_" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Independent body permission',$2)",
    [role, JSON.stringify(["admin.content.body.read"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [f.admin.id, role, f.project],
  );
  const r = await read(shared);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.prompt, "Shared controlled prompt");
  assert.equal((await read(privateId)).status, 403);
  const metadata = (await create(f)).id;
  assert.equal((await read(shared, metadata)).status, 403);
  const v = await view(f, id);
  const privateTask = v.data.tasks.find((t: any) => t.id === privateId);
  assert.equal(privateTask.title, null);
  assert.equal(privateTask.body_available, false);
});
test("revocation is immediate, one-way, audited, durable and idempotent without replaying active authorization", async () => {
  const f = await fixture(),
    g = await grant(f),
    id = (await create(f, { support_grant_id: g })).id,
    k = randomUUID();
  const revoke = () =>
    call(
      f.owner,
      "POST",
      `/v1/support-grants/${g}/revoke`,
      { reason: "Customer ended support" },
      { "x-tenant-id": f.tenant, "idempotency-key": k },
    );
  assert.equal((await revoke()).data.state, "revoked");
  assert.equal((await revoke()).data.state, "revoked");
  assert.equal((await view(f, id)).status, 410);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM audit_log WHERE action='support.grants.revoke' AND target=$1",
        [g],
      )
    ).rows[0].n,
    1,
  );
  const fresh = (await create(f)).id,
    input = { reason: "Administrator ended support" },
    key = randomUUID();
  const first = await call(
    f.admin,
    "POST",
    `/v1/admin/support/sessions/${fresh}/revocations`,
    input,
    { "idempotency-key": key },
  );
  const second = await call(
    f.admin,
    "POST",
    `/v1/admin/support/sessions/${fresh}/revocations`,
    input,
    { "idempotency-key": key },
  );
  assert.equal(first.status, 202, JSON.stringify(first.data));
  assert.equal(second.data.id, first.data.id);
  assert.equal((await view(f, fresh)).status, 410);
});
test("actual clock expiry ends a view without a worker, and an idempotent create cannot extend its deadline", async () => {
  const f = await fixture(),
    k = randomUUID(),
    input = { expires_at: new Date(Date.now() + 1300).toISOString() },
    created = await create(f, input, { "idempotency-key": k });
  assert.equal((await view(f, created.id)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1450));
  assert.equal((await view(f, created.id)).status, 410);
  const retry = await create(f, input, { "idempotency-key": k });
  assert.equal(retry.id, created.id);
  assert.equal((await view(f, created.id)).status, 410);
});
test("scope is explicit: empty selection never includes projects, foreign projects and target users are refused", async () => {
  const f = await fixture(),
    other = await fixture(),
    empty = (await create(f, { project_ids: [] })).id;
  await task(f);
  const v = await view(f, empty);
  assert.equal(v.status, 200);
  assert.deepEqual(v.data.projects, []);
  assert.deepEqual(v.data.tasks, []);
  for (const extra of [
    { user_id: other.owner.id },
    { project_ids: [other.project] },
    { project_ids: [f.project, f.project] },
    { mode: "write" },
    { expires_at: new Date(Date.now() + 61 * 60_000).toISOString() },
  ])
    assert.ok(
      (
        await call(f.admin, "POST", "/v1/admin/support/sessions", {
          ...f.input,
          ...extra,
        })
      ).status >= 400,
    );
  const g = await grant(f, []);
  assert.equal(
    (
      await call(f.admin, "POST", "/v1/admin/support/sessions", {
        ...f.input,
        support_grant_id: g,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        other.admin,
        "GET",
        `/v1/admin/support/sessions/${empty}/view`,
        undefined,
        { "x-copypaste-support-session": empty },
      )
    ).status,
    403,
  );
});
test("project-limited operators can use their exact intersection; an explicit deny wins and invalidates pagination", async () => {
  const f = await fixture();
  await s.db.control.query(
    "UPDATE admin_bindings SET scope_kind='project',scope_id=$2 WHERE principal_id=$1",
    [f.admin.id, f.project],
  );
  const id = (await create(f)).id;
  await create(f);
  const list = await call(f.admin, "GET", "/v1/admin/support/sessions?limit=1");
  assert.equal(list.status, 200);
  assert.ok(list.data.next_cursor);
  const next = await call(
    f.admin,
    "GET",
    "/v1/admin/support/sessions?limit=1&cursor=" +
      encodeURIComponent(list.data.next_cursor),
  );
  assert.equal(next.status, 200);
  assert.equal(next.data.items[0].id, id);
  assert.equal(
    (
      await call(f.admin, "POST", "/v1/admin/support/sessions", {
        ...f.input,
        project_ids: [],
      })
    ).status,
    403,
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,'support_agent','project',$2,'deny')",
    [f.admin.id, f.project],
  );
  assert.equal((await view(f, id)).status, 403);
  assert.equal(
    (
      await call(
        f.admin,
        "GET",
        "/v1/admin/support/sessions?limit=1&cursor=" +
          encodeURIComponent(list.data.next_cursor),
      )
    ).status,
    400,
  );
  assert.deepEqual(
    (await call(f.admin, "GET", "/v1/admin/support/sessions")).data.items,
    [],
  );
});
test("the originating administrator browser session and current target membership version are required", async () => {
  const f = await fixture(),
    id = (await create(f)).id;
  // Exercise a second real login without weakening the TOTP replay guard.
  await new Promise((resolve) =>
    setTimeout(resolve, 30000 - (Date.now() % 30000) + 100),
  );
  const other = {
    ...f,
    admin: { ...(await login(f.admin.email, f.admin.secret)), id: f.admin.id },
  };
  assert.equal((await view(other, id)).status, 404);
  await s.db.control.query(
    "UPDATE memberships SET version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.owner.id],
  );
  assert.equal((await view(f, id)).status, 404);
  assert.equal(
    (await call(f.admin, "GET", "/v1/admin/support/sessions")).data.items[0]
      .state,
    "revoked",
  );
});
test("current grant issuer, target authentication, project state and recent administrator MFA remain mandatory", async () => {
  const f = await fixture(),
    g = await grant(f),
    id = (await create(f, { support_grant_id: g })).id;
  await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1", [
    f.project,
  ]);
  assert.equal((await view(f, id)).status, 404);
  await s.db.control.query("UPDATE projects SET archived=false WHERE id=$1", [
    f.project,
  ]);
  assert.equal((await view(f, id)).status, 200);
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  assert.equal((await view(f, id)).status, 404);
  const other = await fixture(),
    second = (await create(other)).id;
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=clock_timestamp()-interval '11 minutes' WHERE admin_id=$1",
    [other.admin.id],
  );
  const stale = await view(other, second);
  assert.equal(stale.status, 403);
  assert.equal(stale.data.error.code, "MFA_REQUIRED");
});

test("support context denials retain the administrator in the audit and grant lists use tenant-bound cursors", async () => {
  const f = await fixture(),
    g = await grant(f);
  await grant(f);
  const id = (await create(f)).id;
  const denied = await call(
    f.admin,
    "POST",
    "/v1/admin/support/sessions",
    f.input,
    { "x-copypaste-support-session": id },
  );
  assert.equal(denied.status, 403);
  assert.ok(
    (
      await s.db.control.query(
        "SELECT 1 FROM audit_log WHERE principal_id=$1 AND outcome='denied' AND detail->>'code'='SUPPORT_READ_ONLY'",
        [f.admin.id],
      )
    ).rowCount,
  );
  const list = await call(
    f.owner,
    "GET",
    "/v1/support-grants?limit=1",
    undefined,
    { "x-tenant-id": f.tenant },
  );
  assert.equal(list.status, 200);
  assert.ok(list.data.next_cursor);
  const next = await call(
    f.owner,
    "GET",
    "/v1/support-grants?limit=1&cursor=" +
      encodeURIComponent(list.data.next_cursor),
    undefined,
    { "x-tenant-id": f.tenant },
  );
  assert.equal(next.status, 200);
  assert.equal(next.data.items[0].id, g);
  const invalid = await call(
    f.owner,
    "GET",
    "/v1/support-grants?limit=2&cursor=" +
      encodeURIComponent(list.data.next_cursor),
    undefined,
    { "x-tenant-id": f.tenant },
  );
  assert.equal(invalid.status, 400);
});

test("concurrent duplicate commands create one canonical context, one operation and one audit", async () => {
  const f = await fixture(),
    k = randomUUID();
  const results = await Promise.all([
    create(f, {}, { "idempotency-key": k }),
    create(f, {}, { "idempotency-key": k }),
  ]);
  assert.equal(results[0].id, results[1].id);
  const counts = (
    await s.db.control.query(
      "SELECT (SELECT count(*) FROM support_session_contexts WHERE target_user_id=$1)::int contexts,(SELECT count(*) FROM admin_operations WHERE principal_id=$2 AND action='support.sessions.create')::int operations,(SELECT count(*) FROM audit_log WHERE principal_id=$2 AND action='admin.support.start')::int audits",
      [f.owner.id, f.admin.id],
    )
  ).rows[0];
  assert.deepEqual(counts, { contexts: 1, operations: 1, audits: 1 });
  assert.equal(
    (
      await call(
        f.admin,
        "POST",
        "/v1/admin/support/sessions",
        { ...f.input, reason: "Different command" },
        { "idempotency-key": k },
      )
    ).status,
    409,
  );
});
test("a failing audit rolls back the support command and no data is returned by a failed view audit", async () => {
  const f = await fixture(),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    const id = (await create(f)).id;
    await owner.query(
      `CREATE FUNCTION fail_support_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('admin.support.start','admin.support.view') THEN RAISE EXCEPTION 'controlled support audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_support_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_support_audit()`,
    );
    const failed = await call(
      f.admin,
      "POST",
      "/v1/admin/support/sessions",
      f.input,
    );
    assert.equal(failed.status, 500);
    assert.equal((await view(f, id)).status, 500);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int n FROM support_session_contexts WHERE target_user_id=$1",
          [f.owner.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS test_support_audit ON audit_log; DROP FUNCTION IF EXISTS fail_support_audit()",
    );
    await owner.end();
  }
});
test("application role cannot select support scope; database provenance and deadlines cannot be rewritten", async () => {
  const f = await fixture(),
    g = await grant(f),
    id = (await create(f, { support_grant_id: g })).id;
  await assert.rejects(
    s.db.app.query("SELECT * FROM support_grants"),
    (e: any) => e.code === "42501",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE support_sessions SET expires_at=expires_at+interval '1 hour' WHERE id=$1",
      [id],
    ),
    (e: any) => e.code === "23514",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE support_session_contexts SET project_ids='{}' WHERE id=$1",
      [id],
    ),
    (e: any) => e.code === "42501",
  );
  await s.db.control.query(
    "UPDATE support_grants SET revoked_at=clock_timestamp() WHERE id=$1",
    [g],
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE support_grants SET revoked_at=NULL WHERE id=$1",
      [g],
    ),
    (e: any) => e.code === "23514",
  );
});
test("populated 061 forward migration preserves every old row and leaves legacy support unscoped", async () => {
  const old = await isolatedTestEnvironment({ throughVersion: 61 }),
    c = new pg.Client({ connectionString: old.env.OWNER_DATABASE_URL });
  await c.connect();
  try {
    const u = (
      await c.query(
        "INSERT INTO users(email,name) VALUES($1,'Original customer') RETURNING id",
        [randomUUID() + "@example.invalid"],
      )
    ).rows[0].id;
    const t = (
      await c.query(
        "INSERT INTO tenants(name) VALUES('Original support workspace') RETURNING id",
      )
    ).rows[0].id;
    const a = (
      await c.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Original support administrator',$2) RETURNING id",
        [
          randomUUID() + "@example.invalid",
          seal(
            s.db.config.MASTER_KEY!,
            new OTPAuth.Secret({ size: 20 }).base32,
          ),
        ],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO support_sessions(principal_id,tenant_id,reason,expires_at,body_granted) VALUES($1,$2,'Historical legacy support',now()+interval '1 hour',true)",
      [a, t],
    );
    const tables = (
      await c.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    const snapshot = async () => {
      const result = [];
      for (const table of tables) {
        assert.match(table, /^[a-z_]+$/);
        result.push([
          table,
          (
            await c.query(
              `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')::text AS value FROM ${table} r`,
            )
          ).rows[0].value,
        ]);
      }
      return result;
    };
    const original = await snapshot(),
      checksums = (
        await c.query(
          "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
        )
      ).rows;
    assert.ok(u);
    await runMigrations(c, "actual populated support migration", {
      throughVersion: 62,
    });
    assert.deepEqual(await snapshot(), original);
    assert.deepEqual(
      (
        await c.query(
          "SELECT version,source_sha256 FROM schema_migrations WHERE version<=61 ORDER BY version",
        )
      ).rows,
      checksums,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM support_session_contexts"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM support_grants")).rows[0].n,
      0,
    );
    await runMigrations(c, "unchanged support migration replay", {
      throughVersion: 62,
    });
    assert.deepEqual(await snapshot(), original);
  } finally {
    await c.end();
    await old.cleanup();
  }
});
