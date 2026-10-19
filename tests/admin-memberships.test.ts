import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-membership-schemas.json" with { type: "json" };
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
  return signIn(`admin-members-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-members-${randomUUID()}@example.invalid`,
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

test("canonical 202 operation and current read response preserve strict source schemas and real immutable policy provenance", async () => {
  const original = JSON.parse(
    await readFile(
      new URL("../../../docs/contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [name, value] of Object.entries(contract.schemas))
    assert.deepEqual(value, original.components.schemas[name]);
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id);
  const b = change(r, { project_ids: [w.project.id] });
  schema("AdminMembershipChange", b);
  const p = await preview(a, w, b);
  assert.equal(p.before.id, null);
  assert.equal(p.approval, false);
  const k = "eightkey",
    created = await call(a, "POST", w.base, b, {
      key: k,
      headers: { "x-admin-preview-id": p.id },
    });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  schema("AdminOperation", created.data);
  assert.equal(created.data.state, "succeeded");
  assert.equal(created.data.actor_id, a.id);
  assert.deepEqual(created.data.target_ids, [w.tenant.id, r.id]);
  const m = await member(w.tenant.id, r.id);
  assert.deepEqual(created.data.result_ids, [m.id]);
  const pinned = (
    await s.db.control.query(
      "SELECT * FROM admin_operation_policy_versions WHERE id=$1",
      [created.data.policy_version_id],
    )
  ).rows[0];
  assert.equal(pinned.body.source, "built_in_default");
  assert.equal(hash(canonical(pinned.body)), pinned.payload_hash);
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_operation_policy_versions SET body='{}' WHERE id=$1",
      [pinned.id],
    ),
  );
  const again = await call(a, "POST", w.base, b, {
    key: k,
    headers: { "x-admin-preview-id": p.id },
  });
  assert.deepEqual(again.data, created.data);
  assert.equal((await member(w.tenant.id, r.id)).version, 2);
  assert.equal(
    (await call(a, "POST", w.base, { ...b, role: "viewer" }, { key: k })).data
      .error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  const read = await call(a, "GET", "/v1/admin/operations/" + created.data.id);
  assert.equal(read.status, 200, JSON.stringify(read.data));
  schema("AdminOperation", read.data);
  assert.deepEqual(read.data, created.data);
  const audit = (
    await s.db.control.query(
      "SELECT detail FROM audit_log WHERE target=$1 AND action='admin.tenants.members.write'",
      [created.data.id],
    )
  ).rows[0];
  assert.equal(audit.detail.reason, b.reason);
  assert.equal(audit.detail.before.id, null);
  assert.equal(audit.detail.after.id, m.id);
});

test("admin audience, CSRF, strict payload, origin, MFA and matching enterprise scope are enforced before mutations", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    other = await workspace(o),
    a = await admin(w.tenant.id),
    outsider = await admin(other.tenant.id),
    b = change(r);
  assert.equal((await call(o, "POST", w.base, b)).status, 401);
  for (const headers of [
    { "x-csrf-token": "wrong" },
    { origin: "https://untrusted.invalid" },
  ] as Record<string, string>[])
    assert.equal((await call(a, "POST", w.base, b, { headers })).status, 403);
  assert.equal((await call(a, "POST", w.base, b, { key: null })).status, 400);
  assert.equal(
    (await call(a, "POST", w.base, { ...b, arbitrary: true })).status,
    400,
  );
  assert.equal((await call(outsider, "POST", w.base, b)).status, 403);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal(
    (await call(a, "POST", w.base, b)).data.error.code,
    "MFA_REQUIRED",
  );
  assert.equal(await member(w.tenant.id, r.id), undefined);
});

test("project-only grants cannot change enterprise membership; overlapping explicit project denies override global grants", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(),
    b = change(r);
  await s.db.control.query(
    "UPDATE admin_bindings SET scope_kind='project',scope_id=$2 WHERE principal_id=$1",
    [a.id, w.project.id],
  );
  assert.equal((await call(a, "POST", w.base, b)).status, 403);
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'user_operator','global')",
    [a.id],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,'user_operator','project',$2,'deny')",
    [a.id, w.project.id],
  );
  assert.equal((await call(a, "POST", w.base, b)).status, 403);
  assert.equal(await member(w.tenant.id, r.id), undefined);
});

test("project and version validation reject stale, archived, foreign and nonexistent targets; an absent grant requires version one and active state", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    other = await workspace(o),
    a = await admin(w.tenant.id);
  for (const [extra, status] of [
    [{ expected_version: 2 }, 409],
    [{ state: "removed" }, 409],
    [{ state: "suspended" }, 409],
    [{ project_ids: [other.project.id] }, 404],
    [{ user_id: randomUUID() }, 404],
  ] as const)
    assert.equal(
      (await call(a, "POST", w.base, change(r, extra))).status,
      status,
    );
  await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1", [
    w.project.id,
  ]);
  assert.equal(
    (await call(a, "POST", w.base, change(r, { project_ids: [w.project.id] })))
      .status,
    404,
  );
  assert.equal(await member(w.tenant.id, r.id), undefined);
});

test("two concurrent admin writes sharing one revision admit exactly one change", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id),
    b = change(r);
  assert.equal((await call(a, "POST", w.base, b)).status, 202);
  const rs = await Promise.all([
    call(a, "POST", w.base, { ...b, expected_version: 2, role: "viewer" }),
    call(a, "POST", w.base, { ...b, expected_version: 2, state: "suspended" }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await member(w.tenant.id, r.id)).version, 3);
});

test("suspension immediately denies old credentials, preserves explicit scopes and cannot be bypassed by owner edits, removal or a new invite", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id),
    b = change(r, { project_ids: [w.project.id] });
  assert.equal((await call(a, "POST", w.base, b)).status, 202);
  const revoked = await call(o, "POST", `/v1/tenants/${w.tenant.id}/invites`, {
    email: r.email,
    role: "member",
    project_ids: [w.project.id],
  });
  assert.equal(revoked.status, 201);
  const suspended = await call(a, "POST", w.base, {
    ...b,
    expected_version: 2,
    state: "suspended",
  });
  assert.equal(suspended.status, 202, JSON.stringify(suspended.data));
  const m = await member(w.tenant.id, r.id);
  assert.equal(m.status, "removed");
  assert.equal(m.admin_suspended, true);
  assert.equal(
    (await call(r, "GET", `/v1/tenants/${w.tenant.id}/projects`)).status,
    404,
  );
  assert.equal(
    (
      await s.db.control.query("SELECT revoked_at FROM invites WHERE id=$1", [
        revoked.data.id,
      ])
    ).rows[0].revoked_at !== null,
    true,
  );
  const listing = await call(o, "GET", `/v1/tenants/${w.tenant.id}/members`);
  schema("MemberList", listing.data);
  const dir = await call(
    o,
    "GET",
    `/v1/tenants/${w.tenant.id}/member-directory`,
  );
  assert.equal(
    dir.data.items.find((i: any) => i.user_id === r.id).management_state,
    "suspended",
  );
  const patch = await call(
    o,
    "PATCH",
    `/v1/tenants/${w.tenant.id}/members/${r.id}`,
    {
      role: "member",
      status: "active",
      version: m.version,
      project_ids: [w.project.id],
    },
  );
  assert.equal(patch.data.error.code, "ADMIN_MEMBERSHIP_SUSPENDED");
  const removal = await call(o, "DELETE", "/v1/members/" + m.id, undefined, {
    headers: { "x-tenant-id": w.tenant.id },
  });
  assert.equal(removal.data.error.code, "ADMIN_MEMBERSHIP_SUSPENDED");
  const invited = await call(o, "POST", `/v1/tenants/${w.tenant.id}/invites`, {
    email: r.email,
    role: "member",
    project_ids: [w.project.id],
  });
  const d = (
    await s.db.control.query(
      "SELECT token_cipher FROM invitation_deliveries WHERE invite_id=$1",
      [invited.data.id],
    )
  ).rows[0];
  const accepted = await call(r, "POST", "/v1/invites/accept", {
    token: unseal(s.db.config.MASTER_KEY!, d.token_cipher),
  });
  assert.equal(accepted.data.error.code, "ADMIN_MEMBERSHIP_SUSPENDED");
  const resumed = await call(a, "POST", w.base, {
    ...b,
    expected_version: m.version,
  });
  assert.equal(resumed.status, 202, JSON.stringify(resumed.data));
  assert.equal(
    (await call(r, "GET", `/v1/tenants/${w.tenant.id}/projects`)).status,
    200,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT project_id FROM project_members WHERE tenant_id=$1 AND user_id=$2",
        [w.tenant.id, r.id],
      )
    ).rows[0].project_id,
    w.project.id,
  );
});

test("privileged changes persist pending without effect and require a distinct scoped approver with live MFA", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id, "super_admin"),
    reviewer = await admin(w.tenant.id, "super_admin"),
    b = change(r, { role: "owner", project_ids: [w.project.id] });
  const p = await preview(a, w, b);
  assert.equal(p.approval, true);
  const pending = await call(a, "POST", w.base, b, {
    key: randomUUID(),
    headers: { "x-admin-preview-id": p.id },
  });
  assert.equal(pending.status, 202);
  schema("AdminOperation", pending.data);
  assert.equal(pending.data.state, "pending_approval");
  assert.equal(await member(w.tenant.id, r.id), undefined);
  const path = `/v1/admin/operations/${pending.data.id}/decision`;
  assert.equal(
    (
      await call(a, "POST", path, {
        decision: "approve",
        reason: "Self review is prohibited",
      })
    ).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const approved = await call(reviewer, "POST", path, {
    decision: "approve",
    reason: "Reviewed customer ownership request",
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  schema("AdminOperation", approved.data);
  assert.equal(approved.data.state, "succeeded");
  assert.equal((await member(w.tenant.id, r.id)).role, "owner");
  const repeat = await call(reviewer, "POST", path, {
    decision: "approve",
    reason: "Retry approved request",
  });
  assert.equal(repeat.data.error.code, "NOT_PENDING");
});

test("approval cannot outlive original authority, policy, target snapshot or approval deadline", async () => {
  const o = await user(),
    w = await workspace(o),
    reviewer = await admin(w.tenant.id, "super_admin");
  for (const kind of ["revoke", "deadline", "target", "policy"] as const) {
    const a = await admin(w.tenant.id),
      r = await user(),
      b = change(r, { role: "admin" });
    const pending = await call(a, "POST", w.base, b);
    assert.equal(pending.data.state, "pending_approval");
    if (kind === "revoke")
      await s.db.control.query(
        "DELETE FROM admin_bindings WHERE principal_id=$1",
        [a.id],
      );
    if (kind === "deadline")
      await s.db.control.query(
        "UPDATE admin_operations SET payload=jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",
        [pending.data.id],
      );
    if (kind === "target")
      assert.equal(
        (await call(reviewer, "POST", w.base, change(r, { role: "viewer" })))
          .status,
        202,
      );
    if (kind === "policy")
      await s.db.control.query(
        "INSERT INTO catalog_entries(kind,key,version,state,body) VALUES('policy','admin-control',1,'published',$1)",
        [
          {
            approval_threshold_micros: 10000000000,
            max_vip_hours: 8784,
            membership_privileged_requires_approval: true,
          },
        ],
      );
    const decided = await call(
      reviewer,
      "POST",
      `/v1/admin/operations/${pending.data.id}/decision`,
      { decision: "approve", reason: "Review after a relevant change" },
    );
    assert.equal(
      decided.status,
      kind === "revoke" ? 403 : 409,
      `${kind}: ${JSON.stringify(decided.data)}`,
    );
    assert.equal((await member(w.tenant.id, r.id))?.role === "admin", false);
    assert.equal(
      (
        await call(
          reviewer,
          "POST",
          `/v1/admin/operations/${pending.data.id}/decision`,
          { decision: "reject", reason: "Stale request cancelled safely" },
        )
      ).data.state,
      "cancelled",
    );
  }
});

test("preview detects a first grant created after inspection; last owner remains protected across admin and owner mutation paths", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id, "super_admin"),
    b = change(r);
  const p = await preview(a, w, b);
  const invitation = await call(
    o,
    "POST",
    `/v1/tenants/${w.tenant.id}/invites`,
    { email: r.email, role: "viewer", project_ids: [] },
  );
  assert.equal(invitation.status, 201);
  const delivery = (
    await s.db.control.query(
      "SELECT token_cipher FROM invitation_deliveries WHERE invite_id=$1",
      [invitation.data.id],
    )
  ).rows[0];
  assert.equal(
    (
      await call(r, "POST", "/v1/invites/accept", {
        token: unseal(s.db.config.MASTER_KEY!, delivery.token_cipher),
      })
    ).status,
    201,
  );
  const stale = await call(a, "POST", w.base, b, {
    headers: { "x-admin-preview-id": p.id },
  });
  assert.equal(stale.data.error.code, "PREVIEW_CHANGED");
  assert.equal(
    (
      await call(
        a,
        "POST",
        w.base,
        change(o, { state: "suspended", role: "owner" }),
      )
    ).data.error.code,
    "LAST_OWNER",
  );
  assert.equal(
    (await call(a, "POST", w.base, change(o, { role: "member" }))).data.error
      .code,
    "LAST_OWNER",
  );
});

test("successful replay cannot restore a later suspension and revoked administrators cannot read or recover it", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id),
    b = change(r),
    k = randomUUID();
  const first = await call(a, "POST", w.base, b, { key: k });
  assert.equal(first.status, 202);
  const suspension = await call(a, "POST", w.base, {
    ...b,
    expected_version: 2,
    state: "suspended",
  });
  assert.equal(suspension.status, 202);
  assert.equal(
    (await call(a, "POST", w.base, b, { key: k })).data.id,
    first.data.id,
  );
  assert.equal((await member(w.tenant.id, r.id)).admin_suspended, true);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    a.id,
  ]);
  assert.equal((await call(a, "POST", w.base, b, { key: k })).status, 403);
  assert.equal(
    (await call(a, "GET", "/v1/admin/operations/" + first.data.id)).status,
    403,
  );
});

test("scoped review reveals frozen business changes without actor session metadata; historical policies are never fabricated", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    other = await workspace(o),
    a = await admin(w.tenant.id),
    reviewer = await admin(w.tenant.id, "super_admin"),
    outsider = await admin(other.tenant.id, "super_admin"),
    b = change(r, { role: "admin" });
  const pending = await call(a, "POST", w.base, b);
  const path = `/v1/admin/operations/${pending.data.id}/membership-review`;
  assert.equal((await call(outsider, "GET", path)).status, 403);
  const read = await call(reviewer, "GET", path);
  assert.equal(read.status, 200, JSON.stringify(read.data));
  assert.deepEqual(read.data.command, b);
  schema("AdminOperation", read.data.operation);
  assert.equal(JSON.stringify(read.data).includes("actor_session_id"), false);
  assert.equal(JSON.stringify(read.data).includes("actor_auth_version"), false);
  const options = await call(
    a,
    "GET",
    `/v1/admin/tenants/${w.tenant.id}/membership-options?user_id=${r.id}`,
  );
  assert.equal(options.status, 200);
  assert.equal(options.data.membership, null);
  assert.equal(options.data.projects[0].archived, false);
  assert.equal(await member(w.tenant.id, r.id), undefined);
  const legacy = (
    await s.db.control.query(
      "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state) VALUES($1,'billing.gift',$2,$3,'{}',$4,'succeeded') RETURNING id",
      [a.id, w.tenant.id, hash("historical"), randomUUID()],
    )
  ).rows[0];
  const historic = await call(a, "GET", `/v1/admin/operations/${legacy.id}`);
  assert.equal(historic.data.error.code, "OPERATION_POLICY_UNRECORDED");
});

test("admin approval and a simultaneous owner removal share the same last-owner protection", async () => {
  const o = await user(),
    second = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id, "super_admin"),
    reviewer = await admin(w.tenant.id, "super_admin");
  const grant = await call(
    a,
    "POST",
    w.base,
    change(second, { role: "owner" }),
  );
  assert.equal(
    (
      await call(
        reviewer,
        "POST",
        `/v1/admin/operations/${grant.data.id}/decision`,
        { decision: "approve", reason: "Independent second owner approval" },
      )
    ).status,
    200,
  );
  const hold = await call(
    a,
    "POST",
    w.base,
    change(o, { role: "owner", state: "suspended" }),
  );
  assert.equal(hold.data.state, "pending_approval");
  const secondMember = await member(w.tenant.id, second.id);
  const results = await Promise.all([
    call(reviewer, "POST", `/v1/admin/operations/${hold.data.id}/decision`, {
      decision: "approve",
      reason: "Independent suspension review",
    }),
    call(o, "DELETE", `/v1/members/${secondMember.id}`, undefined, {
      headers: { "x-tenant-id": w.tenant.id },
    }),
  ]);
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(results.map((r) => r.data)),
  );
  const n = (
    await s.db.control.query(
      "SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND role='owner' AND status='active'",
      [w.tenant.id],
    )
  ).rows[0].n;
  assert.equal(n, 1);
});

test("concurrent first grants cannot reuse the virtual absence revision to overwrite access", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    a = await admin(w.tenant.id),
    b = change(r);
  const results = await Promise.all([
    call(a, "POST", w.base, b),
    call(a, "POST", w.base, { ...b, role: "viewer" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await member(w.tenant.id, r.id)).version, 2);
  assert.equal(
    results.find((r) => r.status === 409)!.data.error.code,
    "VERSION_CONFLICT",
  );
});
