import {
  createApprovalRequest,
  expireAdminApprovals,
} from "../src/admin-approval-storage.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-approval-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import {
  billingAccount,
  fund,
  reserve,
  settle,
  setBillingAccountLimit,
} from "../src/billing.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function schema(name: string, value: unknown) {
  const check = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(check(value), JSON.stringify(check.errors));
}
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
  return signIn(`admin-directory-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-directory-${randomUUID()}@example.invalid`,
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
async function workspace(o: Client) {
  const r = await call(o, "POST", "/v1/tenants", {
    name: "Admin membership authority",
    project_name: "Campaign",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    ...r.data,
    base: `/v1/admin/tenants/${r.data.tenant.id}/memberships`,
  };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
      DEMO_MODE: "false",
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

async function bind(
  a: Client,
  permissions: string[],
  kind = "global",
  target: string | null = null,
  effect = "allow",
) {
  const role = "directory_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(permissions)],
  );
  return s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5)",
    [a.id, role, kind, target, effect],
  );
}

async function request(op: string) {
  const r = (
    await s.db.control.query(
      "SELECT * FROM admin_approval_requests WHERE operation_id=$1",
      [op],
    )
  ).rows[0];
  assert.ok(r);
  return r;
}
async function pending(a: Client, w: any, recipient: Client) {
  const r = await call(a, "POST", w.base, {
    expected_version: 1,
    reason: "Independent controlled membership review",
    user_id: recipient.id,
    state: "active",
    role: "admin",
    project_ids: [w.project.id],
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "pending_approval");
  return r.data;
}
async function decide(a: Client, op: any, overrides: any = {}, key?: string) {
  const r = await request(op.id);
  return call(
    a,
    "POST",
    `/v1/admin/approvals/${r.id}/decisions`,
    {
      expected_version: r.version,
      payload_hash: r.payload_hash,
      decision: "approve",
      reason: "Independently checked frozen request",
      ...overrides,
    },
    { key },
  );
}
async function fixture() {
  const owner = await user(),
    w = await workspace(owner),
    a = await admin(w.tenant.id, "super_admin"),
    reviewer = await admin(w.tenant.id, "super_admin"),
    recipient = await user();
  return {
    owner,
    w,
    a,
    reviewer,
    recipient,
    op: await pending(a, w, recipient),
  };
}
test("shared approval fixture retains the four exact original schemas and source bytes", async () => {
  const source = await readFile(
    new URL("../../../docs/contracts/openapi.json", import.meta.url),
    "utf8",
  );
  assert.equal(contract.source_sha256, hash(source));
  const spec = JSON.parse(source);
  for (const [name, value] of Object.entries(contract.schemas))
    assert.deepEqual(value, spec.components.schemas[name]);
  assert.equal(Object.keys(contract.schemas).length, 4);
});
test("canonical queue returns actual request identities and no operation-shaped extra fields", async () => {
  const f = await fixture(),
    r = await request(f.op.id),
    list = await call(f.a, "GET", "/v1/admin/approvals?limit=100");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  schema("AdminApprovalList", list.data);
  assert.notEqual(r.id, f.op.id);
  assert.ok(
    list.data.items.some(
      (v: any) => v.id === r.id && v.operation_id === f.op.id,
    ),
  );
  const lookup = await call(
    f.a,
    "GET",
    `/v1/admin/operations/${f.op.id}/approval`,
  );
  schema("AdminApproval", lookup.data);
  assert.equal(lookup.data.id, r.id);
  const wrong = await call(
    f.reviewer,
    "POST",
    `/v1/admin/approvals/${f.op.id}/decisions`,
    {
      expected_version: 1,
      payload_hash: r.payload_hash,
      decision: "approve",
      reason: "Operation identity is not an approval request",
    },
  );
  assert.equal(wrong.status, 404);
  assert.equal(
    (
      await call(
        f.reviewer,
        "POST",
        `/v1/admin/operations/${f.op.id}/decision`,
        {
          decision: "approve",
          reason: "Legacy body cannot fill unseen version",
        },
      )
    ).data.error.code,
    "CANONICAL_APPROVAL_REQUIRED",
  );
});
test("queue scopes, whole-workspace project denies and frozen review reads intersect current authority", async () => {
  const f = await fixture(),
    outside = await workspace(await user()),
    outsider = await admin(outside.tenant.id, "super_admin"),
    r = await request(f.op.id);
  assert.equal(
    (await call(outsider, "GET", `/v1/admin/operations/${f.op.id}/approval`))
      .status,
    403,
  );
  const page = await call(outsider, "GET", "/v1/admin/approvals");
  schema("AdminApprovalList", page.data);
  assert.ok(!page.data.items.some((v: any) => v.id === r.id));
  await bind(
    f.reviewer,
    ["admin.approvals.read"],
    "project",
    f.w.project.id,
    "deny",
  );
  assert.equal(
    (await call(f.reviewer, "GET", `/v1/admin/approvals/${r.id}/review`))
      .status,
    403,
  );
  assert.ok(
    !(await call(f.reviewer, "GET", "/v1/admin/approvals")).data.items.some(
      (v: any) => v.id === r.id,
    ),
  );
});
test("signed microsecond cursor binds scope, original session, limit and directory identity", async () => {
  const f = await fixture();
  await pending(f.a, f.w, await user());
  await pending(f.a, f.w, await user());
  const page = await call(f.a, "GET", "/v1/admin/approvals?limit=1");
  assert.equal(page.status, 200);
  schema("AdminApprovalList", page.data);
  assert.ok(page.data.next_cursor);
  const url =
      "/v1/admin/approvals?limit=1&cursor=" +
      encodeURIComponent(page.data.next_cursor),
    next = await call(f.a, "GET", url);
  schema("AdminApprovalList", next.data);
  assert.notEqual(page.data.items[0].id, next.data.items[0].id);
  assert.equal(
    (await call(f.reviewer, "GET", url)).data.error.code,
    "CURSOR_INVALID",
  );
  assert.equal(
    (await call(f.a, "GET", url.replace("limit=1", "limit=2"))).data.error.code,
    "CURSOR_INVALID",
  );
  await bind(f.a, ["admin.approvals.read"], "tenant", f.w.tenant.id);
  assert.equal((await call(f.a, "GET", url)).data.error.code, "CURSOR_INVALID");
  for (const suffix of [
    "?page=1",
    "?limit=0",
    "?limit=101",
    "?cursor=x",
    "?search=anything",
  ])
    assert.ok(
      (await call(f.a, "GET", "/v1/admin/approvals" + suffix)).status >= 400,
    );
});
test("all decisions require the reviewed request version and hash and a distinct authorized business operator", async () => {
  const f = await fixture();
  assert.equal(
    (await decide(f.a, f.op)).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  assert.equal(
    (await decide(f.reviewer, f.op, { expected_version: 2 })).status,
    409,
  );
  assert.equal(
    (await decide(f.reviewer, f.op, { payload_hash: "0".repeat(64) })).status,
    409,
  );
  const reader = await admin(f.w.tenant.id, "super_admin");
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    reader.id,
  ]);
  await bind(reader, ["admin.approvals.decide"], "tenant", f.w.tenant.id);
  assert.equal((await decide(reader, f.op)).status, 403);
  const strict = await request(f.op.id);
  assert.equal(
    (
      await call(
        f.reviewer,
        "POST",
        `/v1/admin/approvals/${strict.id}/decisions`,
        { decision: "approve", reason: "Missing frozen request identity" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
        [strict.id],
      )
    ).rows[0].n,
    0,
  );
});
test("idempotent canonical decisions apply membership once and preserve immutable decision evidence", async () => {
  const f = await fixture(),
    r = await request(f.op.id),
    key = randomUUID();
  const result = await decide(f.reviewer, f.op, {}, key);
  assert.equal(result.status, 202, JSON.stringify(result.data));
  schema("AdminOperation", result.data);
  const repeat = await call(
    f.reviewer,
    "POST",
    `/v1/admin/approvals/${r.id}/decisions`,
    {
      expected_version: 1,
      payload_hash: r.payload_hash,
      decision: "approve",
      reason: "Independently checked frozen request",
    },
    { key },
  );
  assert.equal(repeat.status, 202);
  assert.deepEqual(repeat.data, result.data);
  assert.equal((await request(f.op.id)).state, "approved");
  const ds = await s.db.control.query(
    "SELECT * FROM admin_approval_decisions WHERE approval_id=$1",
    [r.id],
  );
  assert.equal(ds.rowCount, 1);
  assert.equal(ds.rows[0].reviewer_id, f.reviewer.id);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [f.w.tenant.id, f.recipient.id],
      )
    ).rows[0].role,
    "admin",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_approval_decisions SET reason='Changed record' WHERE approval_id=$1",
      [r.id],
    ),
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM admin_approval_requests WHERE id=$1", [
      r.id,
    ]),
  );
});
test("account closure uses its actual approval request, independent permission, and canonical current operation", async () => {
  const a = await admin(undefined, "super_admin"),
    b = await admin(undefined, "super_admin"),
    u = await user();
  const op = await call(a, "POST", `/v1/admin/users/${u.id}/status`, {
    expected_version: 1,
    reason: "Explicit user account closure fixture",
    state: "closed",
    inflight_policy: "stop_new",
  });
  assert.equal(op.status, 202, JSON.stringify(op.data));
  const r = await request(op.data.id);
  assert.notEqual(r.id, op.data.id);
  const current = await decide(b, op.data);
  assert.equal(current.status, 202, JSON.stringify(current.data));
  schema("AdminOperation", current.data);
  assert.ok(
    (
      await s.db.control.query(
        "SELECT admin_closed_at FROM users WHERE id=$1",
        [u.id],
      )
    ).rows[0].admin_closed_at,
  );
});
test("requestor session revocation remains binding even if the same administrator opens a fresh session", async () => {
  const f = await fixture();
  await s.db.control.query(
    "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
    [f.a.id],
  );
  // TOTP replay protection is real; wait for its next counter before re-login.
  await new Promise((resolve) =>
    setTimeout(resolve, 31000 - (Date.now() % 30000)),
  );
  await signIn(f.a.email, f.a.secret);
  assert.equal((await decide(f.reviewer, f.op)).status, 403);
  assert.equal((await request(f.op.id)).state, "pending");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
        [(await request(f.op.id)).id],
      )
    ).rows[0].n,
    0,
  );
});
test("worker persists actual expiry and system audit without inventing a human decision", async () => {
  const f = await fixture();
  const op = (
    await s.db.control.query(
      "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) SELECT principal_id,action,tenant_id,payload_hash,jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)),$2,'pending_approval',policy_version_id,target_ids FROM admin_operations WHERE id=$1 RETURNING *",
      [f.op.id, randomUUID()],
    )
  ).rows[0];
  const r = await s.db.tx(
    (tx) => createApprovalRequest(tx, op),
    undefined,
    true,
  );
  assert.equal(
    (await decide(f.reviewer, op)).data.error.code,
    "OPERATION_EXPIRED",
  );
  await expireAdminApprovals(s.db);
  assert.equal((await request(op.id)).state, "expired");
  assert.equal((await request(op.id)).version, 2);
  const current = await call(
    f.reviewer,
    "GET",
    `/v1/admin/operations/${op.id}`,
  );
  schema("AdminOperation", current.data);
  assert.equal(current.data.error_code, "OPERATION_EXPIRED");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
        [r.id],
      )
    ).rows[0].n,
    0,
  );
  const audit = (
    await s.db.control.query(
      "SELECT actor_kind,principal_id FROM audit_log WHERE action='admin.approval.expire' AND target=$1",
      [r.id],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_kind, "system");
  assert.equal(audit[0].principal_id, null);
  await expireAdminApprovals(s.db);
  assert.equal((await request(op.id)).version, 2);
});

test("a failing approval audit rolls back membership, operation, request, decision and receipt; the same key can then safely retry", async () => {
  const f = await fixture(),
    r = await request(f.op.id),
    key = randomUUID();
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION controlled_shared_approval_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.approval.approve' THEN RAISE EXCEPTION 'Controlled approval audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER controlled_shared_approval_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION controlled_shared_approval_audit_failure()",
    );
    assert.equal((await decide(f.reviewer, f.op, {}, key)).status, 500);
    assert.equal((await request(f.op.id)).version, 1);
    assert.equal((await request(f.op.id)).state, "pending");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_operations WHERE id=$1",
          [f.op.id],
        )
      ).rows[0].state,
      "pending_approval",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND user_id=$2",
          [f.w.tenant.id, f.recipient.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
          [r.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
          [f.reviewer.id, `admin.approval.decision:${r.id}`, key],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS controlled_shared_approval_audit ON audit_log",
    );
    await owner.query(
      "DROP FUNCTION IF EXISTS controlled_shared_approval_audit_failure()",
    );
    await owner.end();
  }
  const retry = await decide(f.reviewer, f.op, {}, key);
  assert.equal(retry.status, 202, JSON.stringify(retry.data));
  assert.equal(retry.data.state, "succeeded");
  assert.equal((await request(f.op.id)).state, "approved");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [f.w.tenant.id, f.recipient.id],
      )
    ).rows[0].role,
    "admin",
  );
});

test("concurrent different-key decisions apply once and a later retry must still pass current MFA and business authority", async () => {
  const f = await fixture(),
    r = await request(f.op.id),
    firstKey = randomUUID(),
    secondKey = randomUUID();
  const results = await Promise.all([
    decide(f.reviewer, f.op, {}, firstKey),
    decide(f.reviewer, f.op, {}, secondKey),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [202, 409]);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
        [r.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [f.w.tenant.id, f.recipient.id],
      )
    ).rows[0].n,
    1,
  );
  const winner = results[0].status === 202 ? firstKey : secondKey;
  await bind(
    f.reviewer,
    ["admin.tenants.members.write"],
    "project",
    f.w.project.id,
    "deny",
  );
  const denied = await decide(
    f.reviewer,
    f.op,
    { expected_version: 1 },
    winner,
  );
  assert.equal(denied.status, 403);
  await s.db.control.query(
    "DELETE FROM admin_bindings WHERE principal_id=$1 AND effect='deny'",
    [f.reviewer.id],
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '30 minutes' WHERE admin_id=$1",
    [f.reviewer.id],
  );
  const stale = await decide(f.reviewer, f.op, { expected_version: 1 }, winner);
  assert.equal(stale.status, 403);
  assert.equal(stale.data.error.code, "MFA_REQUIRED");
});
