import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-directory-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import { settle } from "../src/billing.js";

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
  return { ...(await signIn(email, secret)), id: p.id };
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
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5)",
    [a.id, role, kind, target, effect],
  );
}
async function synthetic(name: string) {
  return (
    await s.db.control.query(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING *",
      [randomUUID() + "@example.invalid", name],
    )
  ).rows[0];
}
async function join(
  user: string,
  tenant: string,
  role = "member",
  project?: string,
) {
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
    [tenant, user, role],
  );
  if (project)
    await s.db.control.query(
      "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
      [tenant, project, user],
    );
}
test("strict original directory schemas, deduplicated users, persisted billing IDs and actual login timestamp", async () => {
  const u = await user(),
    w = await workspace(u),
    w2 = await workspace(u),
    a = await admin(undefined, "super_admin");
  const list = await call(a, "GET", "/v1/admin/users?user_id=" + u.id);
  assert.equal(list.status, 200, JSON.stringify(list.data));
  schema("AdminUserList", list.data);
  assert.equal(list.data.items.length, 1);
  assert.deepEqual(
    [...list.data.items[0].tenant_ids].sort(),
    [w.tenant.id, w2.tenant.id].sort(),
  );
  assert.equal(list.data.items[0].contact, u.email);
  assert.ok(Date.parse(list.data.items[0].last_login_at));
  assert.equal(
    list.data.items[0].confirmed_customer_charges.amount_micros,
    "0",
  );
  const detail = await call(a, "GET", "/v1/admin/users/" + u.id);
  schema("AdminUserDetail", detail.data);
  assert.equal(detail.data.memberships.length, 2);
  assert.equal(detail.data.usage, undefined);
  const rows = (
    await s.db.control.query(
      "SELECT id FROM wallets WHERE tenant_id=ANY($1::uuid[])",
      [[w.tenant.id, w2.tenant.id]],
    )
  ).rows
    .map((r) => r.id)
    .sort();
  assert.deepEqual(detail.data.billing_account_ids.sort(), rows);
  assert.ok(!rows.includes(w.tenant.id));
  const tenants = await call(
    a,
    "GET",
    "/v1/admin/tenants?q=" + encodeURIComponent(w.tenant.name),
  );
  assert.equal(tenants.status, 200, JSON.stringify(tenants.data));
  schema("AdminTenantList", tenants.data);
  assert.equal(
    tenants.data.items.find((r: any) => r.id === w.tenant.id)
      .billing_account_id,
    (
      await s.db.control.query("SELECT id FROM wallets WHERE tenant_id=$1", [
        w.tenant.id,
      ])
    ).rows[0].id,
  );
});
test("scope projection intersects user, contact, billing and project permissions; denies constrain global grants", async () => {
  const u = await user(),
    w = await workspace(u),
    other = await workspace(u),
    a = await admin(w.tenant.id),
    outsider = await synthetic("Hidden customer");
  await join(outsider.id, other.tenant.id);
  let d = await call(a, "GET", "/v1/admin/users/" + u.id);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  schema("AdminUserDetail", d.data);
  assert.deepEqual(d.data.user.tenant_ids, [w.tenant.id]);
  assert.deepEqual(d.data.memberships[0].project_ids, [w.project.id]);
  assert.deepEqual(d.data.billing_account_ids, []);
  assert.equal(
    (await call(a, "GET", "/v1/admin/users/" + outsider.id)).status,
    404,
  );
  await bind(a, ["admin.users.contact.read"], "tenant", w.tenant.id, "deny");
  await bind(a, ["admin.users.contact.read"], "tenant", other.tenant.id);
  d = await call(a, "GET", "/v1/admin/users/" + u.id);
  assert.equal(d.data.user.contact, undefined);
  assert.equal(
    (await call(a, "GET", "/v1/admin/users?q=" + encodeURIComponent(u.email)))
      .data.items.length,
    0,
  );
  const g = await admin(undefined, "super_admin");
  await bind(
    g,
    ["admin.users.read", "admin.tenants.read"],
    "tenant",
    other.tenant.id,
    "deny",
  );
  d = await call(g, "GET", "/v1/admin/users/" + u.id);
  assert.deepEqual(d.data.user.tenant_ids, [w.tenant.id]);
  assert.equal(
    (await call(g, "GET", "/v1/admin/users/" + outsider.id)).status,
    404,
  );
  assert.ok(
    !(await call(g, "GET", "/v1/admin/tenants")).data.items.some(
      (r: any) => r.id === other.tenant.id,
    ),
  );
});
test("project-only directory access exposes only assigned users and permitted project IDs", async () => {
  const owner = await user(),
    w = await workspace(owner),
    a = await admin(w.tenant.id),
    yes = await synthetic("Visible project member"),
    no = await synthetic("Other project member");
  await join(yes.id, w.tenant.id, "viewer", w.project.id);
  await join(no.id, w.tenant.id);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    a.id,
  ]);
  await bind(
    a,
    ["admin.users.read", "admin.tenants.read", "admin.usage.read"],
    "project",
    w.project.id,
  );
  const list = await call(
    a,
    "GET",
    "/v1/admin/users?project_id=" + w.project.id,
  );
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.items.some((r: any) => r.id === yes.id));
  assert.ok(!list.data.items.some((r: any) => r.id === no.id));
  const d = await call(a, "GET", "/v1/admin/users/" + yes.id);
  schema("AdminUserDetail", d.data);
  assert.deepEqual(d.data.memberships[0].project_ids, [w.project.id]);
  assert.equal(d.data.user.contact, undefined);
  assert.equal((await call(a, "GET", "/v1/admin/users/" + no.id)).status, 404);
  await bind(a, ["admin.users.read"], "project", w.project.id, "deny");
  assert.equal((await call(a, "GET", "/v1/admin/users/" + yes.id)).status, 404);
});
test("keyset cursors keep timestamp ties, exclude later registrations and bind filters, sessions, current permissions", async () => {
  const a = await admin(),
    tag = "Cursor " + randomUUID();
  const users = await Promise.all([
    synthetic(tag),
    synthetic(tag),
    synthetic(tag),
    synthetic(tag),
  ]);
  await s.db.control.query(
    "UPDATE users SET created_at='2026-01-01T00:00:00.123456Z' WHERE id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  const path = "/v1/admin/users?q=" + encodeURIComponent(tag) + "&limit=2",
    first = await call(a, "GET", path);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  schema("AdminUserList", first.data);
  assert.ok(first.data.next_cursor);
  await synthetic(tag);
  const next = await call(
    a,
    "GET",
    path + "&cursor=" + encodeURIComponent(first.data.next_cursor),
  );
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.deepEqual(
    [...first.data.items, ...next.data.items].map((r) => r.id).sort(),
    users.map((u) => u.id).sort(),
  );
  assert.equal(next.data.next_cursor, null);
  for (const bad of [
    path + "x&cursor=" + encodeURIComponent(first.data.next_cursor),
    path + "&cursor=" + encodeURIComponent(first.data.next_cursor + "x"),
  ])
    assert.equal((await call(a, "GET", bad)).status, 400);
  const b = await admin();
  assert.equal(
    (
      await call(
        b,
        "GET",
        path + "&cursor=" + encodeURIComponent(first.data.next_cursor),
      )
    ).status,
    400,
  );
  await bind(a, ["admin.users.contact.read"], "global", null, "deny");
  assert.equal(
    (
      await call(
        a,
        "GET",
        path + "&cursor=" + encodeURIComponent(first.data.next_cursor),
      )
    ).status,
    400,
  );
});
test("tenant keyset uses persisted account identities and cannot cross scopes or malformed inputs", async () => {
  const u = await user(),
    a = await admin(),
    tag = "Tenant cursor " + randomUUID(),
    ids = [];
  for (let i = 0; i < 3; i++) {
    const w = await workspace(u);
    ids.push(w.tenant.id);
    await s.db.control.query(
      "UPDATE tenants SET name=$2,created_at='2026-01-01T00:00:00.999999Z' WHERE id=$1",
      [w.tenant.id, tag],
    );
  }
  const path = "/v1/admin/tenants?q=" + encodeURIComponent(tag) + "&limit=1";
  let cursor: string | null = null;
  const found: string[] = [];
  do {
    const r = await call(
      a,
      "GET",
      path + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    schema("AdminTenantList", r.data);
    found.push(...r.data.items.map((r: any) => r.id));
    cursor = r.data.next_cursor;
  } while (cursor);
  assert.deepEqual(found.sort(), ids.sort());
  for (const query of [
    "limit=0",
    "limit=101",
    "q=",
    "cursor=bad",
    "page=1",
    "tenant_id=" + ids[0],
  ])
    assert.equal(
      (await call(a, "GET", "/v1/admin/tenants?" + query)).status,
      400,
    );
});
test("confirmed usage comes from charge ledger by actor, project and settlement period, excluding holds and reconciliation", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    tasks: string[] = [];
  await s.db.control.query(
    "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'business',now()-interval '1 hour',now()+interval '1 day','Concurrent reservation fixture')",
    [u.id],
  );
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [w.tenant.id],
  );
  for (let i = 0; i < 3; i++) {
    const r = await call(
      u,
      "POST",
      `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`,
      {
        title: "Directory charge",
        prompt: "Write a campaign brief",
        role_key: "assistant",
        budget_micros: 1000000,
      },
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    tasks.push(r.data.id);
  }
  await s.db.tx(
    async (tx) => {
      await settle(tx, w.tenant.id, tasks[0], 123456, u.id);
      await settle(tx, w.tenant.id, tasks[1], 777777, u.id, true);
    },
    undefined,
    true,
  );
  const chargeAt = (
    await s.db.control.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM ledger WHERE task_id=$1 AND kind='charge'`,
      [tasks[0]],
    )
  ).rows[0].at;
  const chargeAfter = new Date(Date.parse(chargeAt) + 1000).toISOString();
  const base =
    "/v1/admin/users?user_id=" + u.id + "&project_id=" + w.project.id;
  const r = await call(a, "GET", base);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.items[0].confirmed_customer_charges, {
    currency: "HKD",
    amount_micros: "123456",
  });
  const empty = await call(
    a,
    "GET",
    base +
      "&period_from=" +
      encodeURIComponent(chargeAt) +
      "&period_to=" +
      encodeURIComponent(chargeAfter),
  );
  assert.equal(
    empty.data.items[0].confirmed_customer_charges.amount_micros,
    "123456",
  );
  assert.equal(
    (await call(a, "GET", base + "&period_to=" + encodeURIComponent(chargeAt)))
      .data.items[0].confirmed_customer_charges.amount_micros,
    "0",
  );
  await bind(a, ["admin.usage.read"], "project", w.project.id, "deny");
  assert.equal(
    (await call(a, "GET", base)).data.items[0].confirmed_customer_charges,
    undefined,
  );
  const context = await call(
    a,
    "GET",
    "/v1/admin/users/" + u.id + "/management-context",
  );
  assert.equal(context.status, 200, JSON.stringify(context.data));
  assert.equal(
    context.data.memberships[0].confirmed_customer_charges,
    undefined,
  );
});
test("VIP filters use effective current grants, hide forbidden fields, do not grant personal rights through project access", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  await s.db.control.query(
    "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'pro',now()-interval '1 hour',now()+interval '1 day','Directory fixture')",
    [u.id],
  );
  const base = "/v1/admin/users?user_id=" + u.id;
  assert.equal((await call(a, "GET", base + "&vip=true")).data.items.length, 1);
  assert.equal(
    (await call(a, "GET", base + "&vip=false")).data.items.length,
    0,
  );
  assert.deepEqual(
    (await call(a, "GET", "/v1/admin/users/" + u.id)).data
      .effective_entitlements,
    ["pro"],
  );
  await s.db.control.query(
    "UPDATE entitlements SET ends_at=now()-interval '1 minute',starts_at=now()-interval '1 day' WHERE user_id=$1",
    [u.id],
  );
  assert.equal(
    (await call(a, "GET", base + "&vip=false")).data.items.length,
    1,
  );
  await bind(a, ["admin.entitlements.read"], "global", null, "deny");
  assert.equal((await call(a, "GET", base + "&vip=false")).status, 403);
  assert.equal(
    (await call(a, "GET", base)).data.items[0].vip_summary,
    undefined,
  );
  const scoped = await admin(w.tenant.id),
    d = await call(scoped, "GET", "/v1/admin/users/" + u.id);
  assert.deepEqual(d.data.effective_entitlements, []);
  assert.equal(
    (
      await call(
        scoped,
        "GET",
        "/v1/admin/users/" + u.id + "/management-context",
      )
    ).data.personal_entitlements,
    null,
  );
});
test("query validation is strict; stale MFA and revoked live authorization cannot read either directory", async () => {
  const a = await admin(),
    u = await user();
  for (const query of [
    "vip=0",
    "vip=yes",
    "state=suspended",
    "user_id=bad",
    "period_from=bad",
    "period_from=2026-02-02T00:00:00Z&period_to=2026-02-01T00:00:00Z",
    "page_size=50",
  ])
    assert.equal(
      (await call(a, "GET", "/v1/admin/users?" + query)).status,
      400,
      query,
    );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  for (const url of [
    "/v1/admin/users",
    "/v1/admin/tenants",
    "/v1/admin/users/" + u.id,
    "/v1/admin/users/" + u.id + "/management-context",
  ])
    assert.equal((await call(a, "GET", url)).data.error.code, "MFA_REQUIRED");
  const b = await admin();
  await s.db.control.query(
    "UPDATE admin_principals SET auth_version=auth_version+1 WHERE id=$1",
    [b.id],
  );
  assert.equal((await call(b, "GET", "/v1/admin/users")).status, 401);
  assert.equal((await call(u, "GET", "/v1/admin/users")).status, 401);
});

test("account state filters distinguish frozen and closed, and search treats wildcard text literally", async () => {
  const a = await admin(),
    tag = "Literal_%_" + randomUUID(),
    active = await synthetic(tag),
    frozen = await synthetic(tag),
    closed = await synthetic(tag);
  await s.db.control.query("UPDATE users SET status='suspended' WHERE id=$1", [
    frozen.id,
  ]);
  await s.db.control.query(
    "UPDATE users SET status='suspended',admin_closed_at=now() WHERE id=$1",
    [closed.id],
  );
  for (const [state, u] of [
    ["active", active],
    ["frozen", frozen],
    ["closed", closed],
  ] as const) {
    const r = await call(
      a,
      "GET",
      "/v1/admin/users?q=" + encodeURIComponent(tag) + "&state=" + state,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    schema("AdminUserList", r.data);
    assert.deepEqual(
      r.data.items.map((v: any) => v.id),
      [u.id],
    );
    assert.equal(r.data.items[0].last_login_at, null);
  }
  await synthetic(tag.replace("_%_", "abc"));
  const r = await call(
    a,
    "GET",
    "/v1/admin/users?q=" + encodeURIComponent(tag),
  );
  assert.equal(r.data.items.length, 3);
});
test("personal and tenant VIP sources stay distinct; overlapping field denies block both reveal and filter oracles", async () => {
  const u = await user(),
    w = await workspace(u),
    scoped = await admin(w.tenant.id),
    global = await admin();
  await s.db.control.query(
    "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'pro',now()-interval '1 hour',now()+interval '1 day','Personal fixture')",
    [u.id],
  );
  await s.db.control.query(
    "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason) VALUES($1,'business',now()-interval '1 hour',now()+interval '1 day','Tenant fixture')",
    [w.tenant.id],
  );
  const path = "/v1/admin/users/" + u.id,
    list = "/v1/admin/users?user_id=" + u.id;
  let r = await call(scoped, "GET", path);
  assert.deepEqual(r.data.effective_entitlements, ["business"]);
  assert.equal(r.data.user.vip_summary, "business");
  await s.db.control.query(
    "UPDATE memberships SET admin_suspended=true,status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant.id, u.id],
  );
  r = await call(scoped, "GET", path);
  assert.deepEqual(r.data.effective_entitlements, []);
  assert.equal(r.data.memberships[0].state, "suspended");
  await bind(
    global,
    ["admin.entitlements.read", "admin.users.contact.read"],
    "project",
    w.project.id,
    "deny",
  );
  r = await call(global, "GET", path);
  assert.equal(r.data.user.contact, undefined);
  assert.equal(r.data.user.vip_summary, undefined);
  assert.deepEqual(r.data.effective_entitlements, []);
  for (const vip of ["true", "false"])
    assert.equal(
      (await call(global, "GET", list + "&vip=" + vip)).data.items.length,
      0,
    );
  assert.equal(
    (
      await call(
        global,
        "GET",
        "/v1/admin/users?q=" + encodeURIComponent(u.email),
      )
    ).data.items.length,
    0,
  );
  assert.equal(
    (await call(global, "GET", path + "/management-context")).data
      .personal_entitlements,
    null,
  );
});

test("user exports consume canonical cursor pages, retain field redaction and refuse silent truncation", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  await bind(a, ["admin.users.contact.read"], "global", null, "deny");
  const created = await call(a, "POST", "/v1/admin/exports", {
    source: "users",
    tenant_id: w.tenant.id,
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const csv = await s.app.inject({
    method: "GET",
    url: `/v1/admin/exports/${created.data.id}/download`,
    headers: { cookie: a.cookie },
  });
  assert.equal(csv.statusCode, 200, csv.body);
  assert.match(csv.headers["content-type"] as string, /text\/csv/);
  assert.ok(csv.body.includes("display_name"));
  assert.ok(csv.body.includes("masked_contact"));
  assert.ok(!csv.body.includes(u.email));
  await s.db.control.query(
    "INSERT INTO users(email,name) SELECT gen_random_uuid()::text||'@example.invalid','Owned export bound fixture' FROM generate_series(1,501)",
  );
  const big = await call(a, "POST", "/v1/admin/exports", { source: "users" });
  assert.equal(big.status, 200, JSON.stringify(big.data));
  const download = await call(
    a,
    "GET",
    `/v1/admin/exports/${big.data.id}/download`,
  );
  assert.equal(download.status, 409, JSON.stringify(download.data));
  assert.equal(download.data.error.code, "EXPORT_TOO_LARGE");
  await bind(a, ["admin.exports.download"], "global", null, "deny");
  assert.equal(
    (await call(a, "GET", `/v1/admin/exports/${created.data.id}/download`))
      .status,
    403,
  );
});
