import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-account-schemas.json" with { type: "json" };
import memberContract from "../contracts/membership-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { canonical, hash, seal, unseal } from "../src/lib.js";

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
  JSON.stringify({ ...memberContract.schemas, ...contract.schemas }).replaceAll(
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
  return signIn(`admin-accounts-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-accounts-${randomUUID()}@example.invalid`,
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
function change(u: Client, extra: any = {}) {
  return {
    user_id: u.id,
    expected_version: 1,
    role: "member",
    state: "active",
    project_ids: [],
    reason: "Customer support membership correction",
    ...extra,
  };
}
async function member(tenant: string, user: string) {
  return (
    await s.db.control.query(
      "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenant, user],
    )
  ).rows[0];
}
async function preview(a: Client, w: any, b: any) {
  const r = await call(a, "POST", w.base + "/preview", b);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
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

const userBase = (u: Client) => `/v1/admin/users/${u.id}`;
const current = async (u: Client) =>
  (await s.db.control.query("SELECT * FROM users WHERE id=$1", [u.id])).rows[0];
const statusChange = (
  state = "frozen",
  expected_version = 1,
  inflight_policy = "stop_new",
) => ({
  state,
  expected_version,
  inflight_policy,
  reason: "Customer requested account control",
});
const reasonOnly = { reason: "Customer requested session revocation" };

test("four original command schemas and strict 202 operations use actual immutable policy snapshots", async () => {
  const original = JSON.parse(
    await readFile(
      new URL("../../../docs/contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [name, value] of Object.entries(contract.schemas))
    assert.deepEqual(value, original.components.schemas[name]);
  const u = await user(),
    a = await admin(),
    base = userBase(u),
    command = {
      display_name: "Customer support name",
      labels: ["pilot", "marketing"],
      expected_version: 1,
      reason: "Confirmed profile correction",
    };
  schema("AdminUserProfileChange", command);
  const p = await call(a, "POST", base + "/profile/preview", command);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.before.version, 1);
  const r = await call(a, "POST", base + "/profile", command, {
    key: "profile-retry",
    headers: { "x-admin-preview-id": p.data.id },
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  schema("AdminOperation", r.data);
  assert.equal(r.data.state, "succeeded");
  assert.deepEqual(r.data.target_ids, [u.id]);
  assert.deepEqual(r.data.result_ids, [u.id]);
  assert.ok(
    (
      await s.db.control.query(
        "SELECT 1 FROM admin_operation_policy_versions WHERE id=$1",
        [r.data.policy_version_id],
      )
    ).rowCount,
  );
  assert.equal((await current(u)).name, command.display_name);
  assert.deepEqual((await current(u)).labels, command.labels);
  assert.equal((await current(u)).version, 2);
  assert.deepEqual(
    (
      await call(a, "POST", base + "/profile", command, {
        key: "profile-retry",
        headers: { "x-admin-preview-id": p.data.id },
      })
    ).data,
    r.data,
  );
  assert.equal((await current(u)).version, 2);
  assert.equal(
    (
      await call(
        a,
        "POST",
        base + "/profile",
        { ...command, display_name: "Different" },
        { key: "profile-retry" },
      )
    ).status,
    409,
  );
  assert.equal(
    (await call(a, "GET", `/v1/admin/operations/${r.data.id}`)).status,
    200,
  );
});

test("sensitive commands reject malformed bodies, missing keys and CSRF, stale MFA and revision conflicts; legacy PATCH is absent", async () => {
  const u = await user(),
    a = await admin(),
    base = userBase(u);
  for (const body of [
    { ...statusChange(), unexpected: true },
    { ...statusChange(), expected_version: 0 },
    { ...statusChange(), state: "suspended" },
    { ...statusChange(), reason: "x" },
  ])
    assert.equal((await call(a, "POST", base + "/status", body)).status, 400);
  assert.equal(
    (await call(a, "POST", base + "/status", statusChange(), { key: null }))
      .status,
    400,
  );
  assert.equal(
    (
      await call(a, "POST", base + "/status", statusChange(), {
        headers: { "x-csrf-token": "bad" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(a, "POST", base + "/status", statusChange("frozen", 99)))
      .status,
    409,
  );
  assert.equal(
    (
      await call(a, "PATCH", base, {
        status: "suspended",
        reason: "Bypass attempt",
      })
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal(
    (await call(a, "POST", base + "/status", statusChange())).data.error.code,
    "MFA_REQUIRED",
  );
  assert.equal((await current(u)).status, "active");
});

test("account scope is global with overlapping denies; tenant/project operators cannot freeze a user globally", async () => {
  const u = await user(),
    w = await workspace(u),
    scoped = await admin(w.tenant.id),
    a = await admin();
  assert.equal(
    (await call(scoped, "POST", userBase(u) + "/status", statusChange()))
      .status,
    403,
  );
  const role = "deny_account_" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Account deny',$2)",
    [
      role,
      JSON.stringify([
        "admin.users.status.write",
        "admin.tenants.status.write",
      ]),
    ],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [a.id, role, w.project.id],
  );
  assert.equal(
    (await call(a, "POST", userBase(u) + "/status", statusChange())).status,
    403,
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        `/v1/admin/tenants/${w.tenant.id}/status`,
        statusChange("suspended"),
      )
    ).status,
    403,
  );
  assert.equal((await current(u)).status, "active");
});

test("freezing invalidates all credentials and pending invitations; restore never resurrects old sessions", async () => {
  const u = await user(),
    other = await signIn(u.email),
    w = await workspace(u),
    recipient = await user(),
    a = await admin();
  const i = await call(u, "POST", `/v1/tenants/${w.tenant.id}/invites`, {
    email: recipient.email,
    role: "member",
    project_ids: [],
  });
  assert.equal(i.status, 201);
  const frozen = await call(a, "POST", userBase(u) + "/status", statusChange());
  assert.equal(frozen.status, 202, JSON.stringify(frozen.data));
  schema("AdminAccountStatusChange", statusChange());
  schema("AdminOperation", frozen.data);
  for (const c of [u, other])
    assert.equal((await call(c, "GET", "/v1/me")).status, 401);
  const inv = (
    await s.db.control.query("SELECT * FROM invites WHERE id=$1", [i.data.id])
  ).rows[0];
  assert.ok(inv.revoked_at);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM invitation_deliveries WHERE invite_id=$1 AND token_cipher IS NOT NULL",
        [i.data.id],
      )
    ).rows[0].n,
    0,
  );
  const row = await current(u);
  assert.equal(row.version, 2);
  assert.equal(row.auth_version, 2);
  assert.equal(
    (
      await call(
        a,
        "POST",
        userBase(u) + "/status",
        statusChange("active", row.version),
      )
    ).status,
    202,
  );
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
  const fresh = await signIn(u.email);
  assert.equal((await call(fresh, "GET", "/v1/me")).status, 200);
  assert.ok(
    (
      await s.db.control.query("SELECT revoked_at FROM invites WHERE id=$1", [
        i.data.id,
      ])
    ).rows[0].revoked_at,
  );
});

test("session revocation alone keeps active account and memberships, consumes native codes and is idempotent", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    path = userBase(u) + "/session-revocations";
  schema("AdminReason", reasonOnly);
  await s.db.control.query(
    "INSERT INTO native_auth_codes(digest,user_id,challenge,client_id,redirect_uri,expires_at,source_session_id,issued_auth_version) SELECT $1,$2,'test-pkce','extension','https://extension.invalid/callback',now()+interval '60 seconds',id,auth_version FROM sessions WHERE user_id=$2 AND revoked_at IS NULL LIMIT 1",
    [hash("pending-native-" + u.id), u.id],
  );
  const r = await call(a, "POST", path, reasonOnly, {
    key: "revoke-all-sessions",
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const row = await current(u);
  assert.ok(
    (
      await s.db.control.query(
        "SELECT consumed_at FROM native_auth_codes WHERE user_id=$1",
        [u.id],
      )
    ).rows[0].consumed_at,
  );
  assert.equal(row.status, "active");
  assert.equal(row.auth_version, 2);
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
  assert.deepEqual(
    (await call(a, "POST", path, reasonOnly, { key: "revoke-all-sessions" }))
      .data,
    r.data,
  );
  assert.equal((await current(u)).auth_version, 2);
  assert.equal((await member(w.tenant.id, u.id)).status, "active");
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal(
    (await call(a, "POST", path, reasonOnly, { key: "revoke-all-sessions" }))
      .status,
    403,
  );
});

test("workspace suspension preserves access to other workspaces and cannot be bypassed with legacy PATCH", async () => {
  const u = await user(),
    w = await workspace(u),
    other = await workspace(u),
    a = await admin(w.tenant.id),
    path = `/v1/admin/tenants/${w.tenant.id}/status`;
  const command = statusChange("suspended");
  schema("AdminTenantStatusChange", command);
  assert.equal((await call(a, "POST", path, command)).status, 202);
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/members`)).status,
    404,
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${other.tenant.id}/members`)).status,
    200,
  );
  assert.equal((await call(u, "GET", "/v1/me")).status, 200);
  assert.equal(
    (
      await call(a, "PATCH", `/v1/admin/tenants/${w.tenant.id}`, {
        status: "active",
        reason: "Bypass attempt",
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(a, "POST", path, statusChange("active", 2))).status,
    202,
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/members`)).status,
    200,
  );
});

test("closing and reopening require a different reviewer; exact original session, target revision and current policy are rechecked", async () => {
  const u = await user(),
    a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    path = userBase(u) + "/status";
  const r = await call(a, "POST", path, statusChange("closed"));
  assert.equal(r.status, 202);
  assert.equal(r.data.state, "pending_approval");
  assert.equal((await current(u)).status, "active");
  const decision = (c: Client, id: string) =>
    call(c, "POST", `/v1/admin/operations/${id}/decision`, {
      decision: "approve",
      reason: "Independent customer control review",
    });
  assert.equal((await decision(a, r.data.id)).status, 403);
  assert.equal(
    (
      await call(
        reviewer,
        "GET",
        `/v1/admin/operations/${r.data.id}/account-review`,
      )
    ).status,
    200,
  );
  const approved = await decision(reviewer, r.data.id);
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  schema("AdminOperation", approved.data);
  assert.ok((await current(u)).admin_closed_at);
  const reopen = await call(a, "POST", path, statusChange("active", 2));
  assert.equal(reopen.data.state, "pending_approval");
  await s.db.control.query(
    "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
    [a.id],
  );
  assert.equal((await decision(reviewer, reopen.data.id)).status, 403);
  assert.ok((await current(u)).admin_closed_at);
  const rejected = await call(
    reviewer,
    "POST",
    `/v1/admin/operations/${reopen.data.id}/decision`,
    { decision: "reject", reason: "Original operator session was revoked" },
  );
  assert.equal(rejected.data.state, "cancelled");
  const fresh = await admin(undefined, "super_admin"),
    another = await call(fresh, "POST", path, statusChange("active", 2));
  assert.equal((await decision(reviewer, another.data.id)).status, 200);
  assert.equal((await current(u)).admin_closed_at, null);
});

test("permanent closure requires owner transfer; concurrent profile CAS writes allow one winner", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  const closed = await call(
    a,
    "POST",
    userBase(u) + "/status",
    statusChange("closed"),
  );
  assert.equal(closed.status, 409);
  assert.equal(closed.data.error.code, "OWNER_TRANSFER_REQUIRED");
  const b = {
    expected_version: 1,
    reason: "Concurrent profile correction",
    display_name: "First",
  };
  const rs = await Promise.all([
    call(a, "POST", userBase(u) + "/profile", b),
    call(a, "POST", userBase(u) + "/profile", { ...b, display_name: "Second" }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await current(u)).version, 2);
  assert.ok(w.tenant.id);
});

test("legacy bulk freeze has immutable policy provenance and cannot reopen closed accounts or bypass rechecked scopes", async () => {
  const u = await user(),
    a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin");
  const b = {
    action: "users.status",
    ids: [u.id],
    status: "suspended",
    reason: "Bulk support freeze",
  };
  const p = await call(a, "POST", "/v1/admin/jobs/preview", b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const input = { preview_id: p.data.id, payload_hash: p.data.payload_hash };
  const r = await call(a, "POST", "/v1/admin/jobs", input, {
    key: "bulk-freeze-retry",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await current(u)).status, "suspended");
  assert.equal(
    (await call(a, "GET", `/v1/admin/operations/${r.data.id}`)).status,
    200,
  );
  assert.deepEqual(
    (
      await call(a, "POST", "/v1/admin/jobs", input, {
        key: "bulk-freeze-retry",
      })
    ).data,
    r.data,
  );
  assert.equal((await current(u)).auth_version, 2);
  const close = await call(
    a,
    "POST",
    userBase(u) + "/status",
    statusChange("closed", 2),
  );
  assert.equal(close.data.state, "pending_approval");
  assert.equal(
    (
      await call(
        reviewer,
        "POST",
        `/v1/admin/operations/${close.data.id}/decision`,
        { decision: "approve", reason: "Approved account closure" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(a, "POST", "/v1/admin/jobs/preview", {
        ...b,
        status: "active",
      })
    ).data.error.code,
    "ACCOUNT_CLOSED",
  );
});

test("stop-new preserves holds; cancellation releases only pristine work and retains accepted or uncertain work for reconciliation", async () => {
  const a = await admin();
  for (const variant of [
    "stop_new",
    "pristine",
    "accepted",
    "running",
    "user_cancel",
    "admin_cancel",
  ] as const) {
    const u = await user(),
      w = await workspace(u),
      base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`;
    await s.db.control.query(
      "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
      [w.tenant.id],
    );
    const created = await call(u, "POST", base, {
      title: "Cancellation cost boundary",
      prompt: "Write a campaign brief",
      role_key: "assistant",
      budget_micros: 1000000,
      mode: "execute",
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const task = created.data;
    if (["accepted", "user_cancel", "admin_cancel"].includes(variant)) {
      await s.db.control.query("UPDATE tasks SET attempt=1 WHERE id=$1", [
        task.id,
      ]);
      await s.db.control.query(
        "INSERT INTO tool_operations(tenant_id,task_id,call_id,action,state,input_hash,charge_micros) VALUES($1,$2,'accepted-cost','image.generate','succeeded','fixture-input',250000)",
        [w.tenant.id, task.id],
      );
    }
    if (variant === "running")
      await s.db.control.query(
        "UPDATE tasks SET status='running',attempt=1 WHERE id=$1",
        [task.id],
      );
    let r;
    if (variant === "user_cancel")
      r = await call(u, "POST", base + `/${task.id}/cancel`);
    else if (variant === "admin_cancel") {
      const control = await admin(w.tenant.id, "content_admin");
      r = await call(control, "POST", `/v1/admin/execution/${task.id}/action`, {
        action: "cancel",
        version: task.version,
        reason: "Cancel accepted task and preserve costs",
      });
    } else
      r = await call(
        a,
        "POST",
        userBase(u) + "/status",
        statusChange(
          "frozen",
          1,
          variant === "stop_new" ? "stop_new" : "request_cancel",
        ),
      );
    assert.ok(
      [200, 202].includes(r.status),
      variant + ": " + JSON.stringify(r.data),
    );
    const row = (
        await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [task.id])
      ).rows[0],
      hold = (
        await s.db.control.query(
          "SELECT * FROM reservations WHERE task_id=$1",
          [task.id],
        )
      ).rows[0],
      wallet = (
        await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
          w.tenant.id,
        ])
      ).rows[0];
    if (variant === "pristine") {
      assert.equal(row.status, "cancelled");
      assert.equal(hold.status, "released");
      assert.equal(Number(wallet.reserved_micros), 0);
    } else if (variant === "stop_new") {
      assert.equal(row.status, "queued");
      assert.equal(row.cancel_requested, false);
      assert.equal(hold.status, "reserved");
      assert.equal(Number(wallet.reserved_micros), 1000000);
    } else if (variant === "running") {
      assert.equal(row.status, "running");
      assert.equal(row.cancel_requested, true);
      assert.equal(hold.status, "reserved");
    } else {
      assert.equal(row.status, "reconciling");
      assert.equal(row.cancel_requested, true);
      assert.equal(hold.status, "reconciling");
      assert.equal(Number(wallet.reserved_micros), 1000000);
      assert.equal(Number(row.charged_micros), 0);
    }
  }
});

test("account review fails after target, policy, deadline or original permission changes without applying the command", async () => {
  const reviewer = await admin(undefined, "super_admin");
  for (const kind of ["target", "deadline", "policy", "authority"] as const) {
    const u = await user(),
      a = await admin(),
      pending = await call(
        a,
        "POST",
        userBase(u) + "/status",
        statusChange("closed"),
      );
    assert.equal(pending.data.state, "pending_approval");
    if (kind === "target")
      await s.db.control.query(
        "UPDATE users SET name='Changed during review' WHERE id=$1",
        [u.id],
      );
    if (kind === "deadline")
      await s.db.control.query(
        "UPDATE admin_operations SET payload=jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",
        [pending.data.id],
      );
    if (kind === "authority")
      await s.db.control.query(
        "DELETE FROM admin_bindings WHERE principal_id=$1",
        [a.id],
      );
    if (kind === "policy") {
      await s.db.control.query(
        "UPDATE catalog_entries SET state='retired' WHERE kind='policy' AND key='admin-control' AND state='published'",
      );
      await s.db.control.query(
        "INSERT INTO catalog_entries(kind,key,version,state,body) VALUES('policy','admin-control',1,'published',$1)",
        [
          {
            approval_threshold_micros: 10000000000,
            max_vip_hours: 8784,
            account_close_requires_approval: true,
          },
        ],
      );
    }
    const decided = await call(
      reviewer,
      "POST",
      `/v1/admin/operations/${pending.data.id}/decision`,
      { decision: "approve", reason: "Check changed authority boundary" },
    );
    assert.equal(
      decided.status,
      kind === "authority" ? 403 : 409,
      kind + ": " + JSON.stringify(decided.data),
    );
    assert.equal((await current(u)).status, "active");
  }
});

test("an authenticated workspace creation queued behind an account freeze rechecks account authority inside the transaction", async () => {
  const u = await user(),
    gate = await s.db.control.connect();
  const gatePid = (await gate.query("SELECT pg_backend_pid() AS id")).rows[0]
    .id;
  await gate.query("BEGIN");
  try {
    await gate.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `user-authority:${u.id}`,
    ]);
    const request = call(u, "POST", "/v1/tenants", {
      name: "Freeze race",
      project_name: "Must not create",
    });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting = !!(
        await s.db.control.query(
          "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND $1=ANY(pg_blocking_pids(pid)) LIMIT 1",
          [gatePid],
        )
      ).rowCount;
      if (waiting) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(waiting, "The real request reached the held user authority lock");
    await gate.query(
      "UPDATE users SET status='suspended',auth_version=auth_version+1 WHERE id=$1",
      [u.id],
    );
    await gate.query("COMMIT");
    const r = await request;
    assert.equal(r.status, 401, JSON.stringify(r.data));
    assert.equal(r.data.error.code, "AUTHORIZATION_CHANGED");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM memberships WHERE user_id=$1",
          [u.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await gate.query("ROLLBACK");
    gate.release();
  }
});
