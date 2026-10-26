import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-vip-schemas.json" with { type: "json" };
import { dispatchEntitlementNotifications } from "../src/user-entitlements.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical } from "../src/lib.js";
import { effectivePlan, defaults } from "../src/plans.js";
import { seedCommercialPlans, legacyPlanIds } from "../src/commercial-plans.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin: boolean };
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function check(name: string, value: unknown) {
  const validator = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(validator(value), JSON.stringify(validator.errors));
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
      origin: url.startsWith("/v1/admin")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = raw.json();
  if (raw.statusCode === 202) check("AdminOperation", data);
  if (raw.statusCode === 200 && url === "/v1/admin/entitlement-previews")
    check("AdminPreview", data);
  if (raw.statusCode === 200 && url.startsWith("/v1/effective-entitlements"))
    check("EffectiveEntitlements", data);
  if (raw.statusCode === 200 && url.startsWith("/v1/plans"))
    check("PlanList", data);
  return { status: raw.statusCode, data, raw };
}
async function login(email: string, secret?: OTPAuth.Secret): Promise<Client> {
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
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function administrator(
  options: {
    permissions?: string[];
    scope?: "global" | "tenant" | "project";
    id?: string;
  } = {},
) {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Plan operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = "super_admin";
  if (options.permissions) {
    role = "plan-" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(options.permissions)],
    );
  }
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, options.scope ?? "global", options.id ?? null],
  );
  return { ...(await login(email, secret)), id: p.id };
}

let operator: Client, reviewer: Client;
const root = "/v1/admin/entitlement-grants";
const future = (ms: number) => new Date(Date.now() + ms).toISOString();
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
  const transaction = s.db.tx.bind(s.db);
  s.db.tx = (async (...args: any[]) => {
    try {
      return await (transaction as any)(...args);
    } catch (e: any) {
      if (e.severity)
        console.error("isolated VIP database diagnostic", e.message, e.where);
      throw e;
    }
  }) as typeof s.db.tx;
  operator = await administrator();
  reviewer = await administrator();
});
after(async () => {
  if (s) await s.app.close();
  if (isolated) await isolated.cleanup();
});
async function workspace() {
  const u = await login(randomUUID() + "@example.invalid");
  const w = await call(u, "POST", "/v1/tenants", {
    name: "VIP lifecycle workspace",
    project_name: "Campaign",
  });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  return {
    u,
    tenant: w.data.tenant.id as string,
    project: w.data.project.id as string,
  };
}
async function approve(op: any, a = reviewer, decision = "approve") {
  const r = await call(a, "GET", `/v1/admin/operations/${op.id}/approval`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return call(a, "POST", `/v1/admin/approvals/${r.data.id}/decisions`, {
    expected_version: r.data.version,
    payload_hash: r.data.payload_hash,
    decision,
    reason: "Independent VIP review",
  });
}
async function plan(
  features = ["analytics"],
  tasks = 2,
  family = randomUUID(),
) {
  const d = await call(operator, "POST", "/v1/admin/plans/drafts", {
    plan_id: family,
    name: "Controlled VIP plan",
    allowances: {
      feature_ids: features,
      allowed_role_ids: ["assistant"],
      seat_limit: 3,
      task_concurrency: tasks,
      storage_bytes: 123456,
      included_credit: { currency: "HKD", amount_micros: "0" },
      credit_policy: "no_automatic_credit",
    },
    reason: "Define a fixed test plan",
  });
  assert.equal(d.status, 202, JSON.stringify(d.data));
  const v = (
    await call(operator, "GET", "/v1/admin/plans/" + d.data.result_ids[0])
  ).data;
  const b = {
    expected_version: v.version,
    reason: "Publish exact VIP test definition",
  };
  const p = await call(
    operator,
    "POST",
    `/v1/admin/plans/${v.id}/publication-previews`,
    b,
  );
  const o = await call(
    operator,
    "POST",
    `/v1/admin/plans/${v.id}/publications`,
    b,
    { "x-admin-preview-id": p.data.preview_id },
  );
  assert.equal(o.status, 202, JSON.stringify(o.data));
  if (o.data.state === "pending_approval")
    assert.equal((await approve(o.data)).data.state, "succeeded");
  return v;
}
async function command(
  subject: { kind: "user" | "tenant"; id: string },
  v: any,
  extra: Record<string, any> = {},
) {
  const r = await call(
    operator,
    "GET",
    `${root}/subjects/${subject.kind}/${subject.id}`,
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    subject,
    plan_version_id: v.id,
    starts_at: future(-1000),
    ends_at: future(3600000),
    overlap_policy: "reject",
    source: "manual",
    auto_renew: false,
    expected_subject_version: r.data.version,
    reason: "Controlled VIP lifecycle",
    ...extra,
  };
}
async function preview(
  b: any,
  a = operator,
  path = "/v1/admin/entitlement-previews",
) {
  const p = await call(a, "POST", path, b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  check("AdminPreview", p.data);
  return p.data;
}
async function submit(
  b: any,
  p: any,
  a = operator,
  path = root,
  k = randomUUID(),
) {
  return call(a, "POST", path, b, {
    "x-admin-preview-id": p.preview_id,
    "idempotency-key": k,
  });
}
async function grant(b: any) {
  let o = await submit(b, await preview(b));
  assert.equal(o.status, 202, JSON.stringify(o.data));
  if (o.data.state === "pending_approval") o = await approve(o.data);
  assert.equal(o.data.state, "succeeded", JSON.stringify(o.data));
  const g = await call(operator, "GET", root + "/" + o.data.result_ids[0]);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  check("AdminVipGrant", g.data);
  return { op: o.data, g: g.data };
}
async function change(g: any, suffix: string, extra: Record<string, any> = {}) {
  const b = {
      expected_version: g.version,
      reason: "Controlled VIP change",
      ...extra,
    },
    path = `${root}/${g.id}/${suffix}`;
  const o = await submit(
    b,
    await preview(b, operator, path + "/previews"),
    operator,
    path,
  );
  assert.equal(o.status, 202, JSON.stringify(o.data));
  return {
    op: o.data,
    g: (await call(operator, "GET", root + "/" + g.id)).data,
  };
}

test("VIP contract fixture is byte-source-bound to the unchanged original OpenAPI", async () => {
  const raw = await readFile("../../docs/contracts/openapi.json"),
    original = JSON.parse(raw.toString());
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    contract.normative_source_sha256,
  );
  for (const [name, schema] of Object.entries(contract.schemas))
    assert.deepEqual(schema, original.components.schemas[name]);
});
test("current Admin MFA, exact scopes, original strict requests and the closed legacy write path", async () => {
  const { u, tenant, project } = await workspace(),
    v = await plan(),
    b = await command({ kind: "user", id: u.id }, v);
  assert.equal((await call(undefined, "GET", root)).status, 401);
  assert.equal((await call(u, "GET", root)).status, 401);
  const scoped = await administrator({
    permissions: ["admin.entitlements.read", "admin.entitlements.grant"],
    scope: "tenant",
    id: tenant,
  });
  assert.equal(
    (await call(scoped, "POST", "/v1/admin/entitlement-previews", b)).status,
    403,
  );
  const denied = await administrator();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES('vip-deny','VIP explicit deny','[\"admin.entitlements.grant\",\"admin.entitlements.read\"]')",
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,'vip-deny','project',$2,'deny')",
    [denied.id, project],
  );
  assert.equal(
    (await call(denied, "POST", "/v1/admin/entitlement-previews", b)).status,
    403,
  );
  assert.equal(
    (
      await call(operator, "POST", "/v1/admin/entitlement-previews", {
        ...b,
        auto_renew: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(operator, "POST", "/v1/admin/entitlement-previews", {
        ...b,
        undocumented: true,
      })
    ).status,
    400,
  );
  const old = await call(operator, "POST", "/v1/admin/operations/preview", {
    action: "entitlements.grant",
    user_id: u.id,
    plan: "pro",
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    reason: b.reason,
  });
  assert.equal(old.status, 409, JSON.stringify(old.data));
  assert.equal(old.data.error.code, "CANONICAL_VIP_REQUIRED");
  const expired = await administrator();
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [expired.id],
  );
  assert.equal(
    (await call(expired, "POST", "/v1/admin/entitlement-previews", b)).status,
    403,
  );
});
test("preview has no entitlement or money effect; commit is durable, atomic and idempotent", async () => {
  const { u, tenant } = await workspace(),
    v = await plan(),
    b = await command({ kind: "user", id: u.id }, v);
  const counts = async () =>
    (
      await s.db.control.query(
        "SELECT (SELECT count(*)::int FROM vip_grants) AS grants,(SELECT count(*)::int FROM entitlement_subjects) AS subjects,(SELECT count(*)::int FROM ledger) AS ledger",
      )
    ).rows[0];
  const before = await counts(),
    p = await preview(b);
  assert.deepEqual(await counts(), before);
  assert.equal(
    (
      await call(
        operator,
        "GET",
        "/v1/admin/entitlement-previews/" + p.preview_id,
      )
    ).data.command.plan_version_id,
    v.id,
  );
  const k = randomUUID(),
    results = await Promise.all([
      submit(b, p, operator, root, k),
      submit(b, p, operator, root, k),
    ]);
  assert.equal(results[0].status, 202, JSON.stringify(results[0].data));
  assert.deepEqual(results[0].data, results[1].data);
  const after = await counts();
  assert.equal(after.grants, before.grants + 1);
  assert.equal(after.subjects, before.subjects + 1);
  assert.equal(after.ledger, before.ledger);
  const g = (
    await call(operator, "GET", root + "/" + results[0].data.result_ids[0])
  ).data;
  check("AdminVipGrant", g);
  const h = await call(operator, "GET", root + "/" + g.id + "/history");
  assert.equal(h.data.items.length, 1);
  assert.equal(h.data.items[0].before_value, null);
  assert.equal(h.data.items[0].actor_id, operator.id);
  assert.equal(
    (
      await submit(
        { ...b, reason: "Changed command reason" },
        p,
        operator,
        root,
        k,
      )
    ).status,
    409,
  );
  assert.equal((await submit(b, p)).status, 409);
  const effective = await call(
    u,
    "GET",
    "/v1/effective-entitlements",
    undefined,
    { "x-tenant-id": tenant },
  );
  assert.deepEqual(effective.data.feature_ids, ["analytics"]);
  assert.deepEqual(effective.data.plan_version_ids, [v.id]);
  const list = await call(
    operator,
    "GET",
    `${root}?subject_id=${u.id}&limit=1`,
  );
  check("AdminVipGrantList", list.data);
  assert.equal(list.data.items[0].id, g.id);
  const hidden = await administrator({
    permissions: ["admin.entitlements.read", "admin.jobs.read"],
    scope: "tenant",
    id: tenant,
  });
  for (const endpoint of [root, "/v1/admin/entitlements", "/v1/admin/jobs"]) {
    const denied = await call(hidden, "GET", endpoint);
    assert.equal(denied.status, 200, JSON.stringify(denied.data));
    assert.ok(
      !denied.data.items.some(
        (item: any) => item.id === g.id || item.id === results[0].data.id,
      ),
    );
  }
  assert.equal((await call(hidden, "GET", root + "/" + g.id)).status, 403);
  const plans = await call(u, "GET", "/v1/plans?limit=1", undefined, {
    "x-tenant-id": tenant,
  });
  assert.equal(plans.status, 200);
  assert.ok(plans.data.next_cursor);
});
test("personal and enterprise features merge, quotas take max, resources remain independent", async () => {
  const { u, tenant } = await workspace(),
    personal = await plan(["analytics"], 2),
    enterprise = await plan(["text"], 5);
  await grant(await command({ kind: "user", id: u.id }, personal));
  await grant(await command({ kind: "tenant", id: tenant }, enterprise));
  const e = await call(u, "GET", "/v1/effective-entitlements", undefined, {
    "x-tenant-id": tenant,
  });
  assert.deepEqual(e.data.feature_ids, ["analytics", "text"]);
  assert.equal(e.data.plan_version_ids.length, 2);
  const runtime = await s.db.tx(
    (tx) => effectivePlan(tx, tenant, u.id),
    tenant,
    false,
    u.id,
  );
  assert.equal(runtime.body.max_active_tasks, 5);
  assert.ok(!runtime.body.capabilities.includes("image"));
  const enterpriseOnly = await call(
    u,
    "GET",
    "/v1/effective-entitlements?subject_kind=tenant",
    undefined,
    { "x-tenant-id": tenant },
  );
  assert.deepEqual(enterpriseOnly.data.feature_ids, ["text"]);
  const outsider = await login(randomUUID() + "@example.invalid");
  assert.equal(
    (
      await call(outsider, "GET", "/v1/effective-entitlements", undefined, {
        "x-tenant-id": tenant,
      })
    ).status,
    404,
  );
});
test("extension, suspension, resumption and revocation retain origin with consecutive immutable revisions", async () => {
  const { u, tenant } = await workspace(),
    v = await plan(),
    original = await grant(await command({ kind: "user", id: u.id }, v));
  const extended = await change(original.g, "extensions", {
    ends_at: future(7200000),
  });
  const suspended = await change(extended.g, "suspensions");
  assert.equal(suspended.g.state, "suspended");
  const fallback = await call(
    u,
    "GET",
    "/v1/effective-entitlements",
    undefined,
    { "x-tenant-id": tenant },
  );
  assert.ok(fallback.data.feature_ids.includes("image"));
  const resumed = await change(suspended.g, "resumptions");
  assert.equal(resumed.g.state, "active");
  const revoked = await change(resumed.g, "revocations");
  assert.equal(revoked.g.state, "revoked");
  assert.equal(revoked.g.actor_id, original.g.actor_id);
  assert.equal(revoked.g.operation_id, original.g.operation_id);
  assert.equal(revoked.g.version, 5);
  const h = (
    await call(operator, "GET", root + "/" + original.g.id + "/history")
  ).data;
  assert.deepEqual(
    h.items.map((e: any) => e.action),
    ["grant", "extend", "suspend", "resume", "revoke"],
  );
  for (let i = 1; i < h.items.length; i++)
    assert.deepEqual(h.items[i].before_value, h.items[i - 1].after_value);
  await assert.rejects(
    s.db.control.query(
      "UPDATE vip_grants SET ends_at=ends_at+interval '1 day' WHERE id=$1",
      [original.g.id],
    ),
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM vip_grant_events WHERE grant_id=$1", [
      original.g.id,
    ]),
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_operations SET policy_version_id=gen_random_uuid() WHERE id=$1",
      [original.op.id],
    ),
  );
  assert.equal(
    (
      await call(
        operator,
        "POST",
        `${root}/${original.g.id}/resumptions/previews`,
        { expected_version: 5, reason: "Cannot restore a revoked grant" },
      )
    ).status,
    409,
  );
});
test("same-plan renewal requires the exact UUID and source; new publication cannot rebind a grant", async () => {
  const { u } = await workspace(),
    v = await plan(),
    original = await grant(await command({ kind: "user", id: u.id }, v));
  const b = await command({ kind: "user", id: u.id }, v, {
    overlap_policy: "extend_same_plan",
    ends_at: future(7200000),
  });
  const renewed = await grant(b);
  assert.equal(renewed.g.id, original.g.id);
  assert.equal(renewed.g.operation_id, original.g.operation_id);
  assert.equal(renewed.g.version, 2);
  const replacement = await plan(["text"], 3, v.plan_id);
  const wrong = await command({ kind: "user", id: u.id }, replacement, {
    overlap_policy: "extend_same_plan",
    ends_at: future(10800000),
  });
  assert.equal(
    (await call(operator, "POST", "/v1/admin/entitlement-previews", wrong))
      .status,
    409,
  );
  assert.equal(
    (await call(operator, "GET", root + "/" + original.g.id)).data
      .plan_version_id,
    v.id,
  );
  const retiredRenewal = await grant(
    await command({ kind: "user", id: u.id }, v, {
      overlap_policy: "extend_same_plan",
      ends_at: future(10800000),
    }),
  );
  assert.equal(retiredRenewal.g.plan_version_id, v.id);
  assert.equal(retiredRenewal.g.id, original.g.id);
  assert.equal(
    (
      await call(operator, "POST", "/v1/admin/entitlement-previews", {
        ...b,
        source: "trial",
        expected_subject_version: 4,
      })
    ).status,
    409,
  );
});
test("replacement needs independent review and stays scheduled until its real boundary; old grants never revive", async () => {
  const { u, tenant } = await workspace(),
    v = await plan(["analytics"]),
    next = await plan(["text"]);
  const old = await grant(await command({ kind: "user", id: u.id }, v));
  const b = await command({ kind: "user", id: u.id }, next, {
    overlap_policy: "replace",
    starts_at: future(5000),
    ends_at: future(7000),
  });
  const o = await submit(b, await preview(b));
  assert.equal(o.data.state, "pending_approval");
  assert.equal((await approve(o.data, operator)).status, 403);
  const decision = await approve(o.data);
  assert.equal(decision.status, 202, JSON.stringify(decision.data));
  const e = () =>
    call(u, "GET", "/v1/effective-entitlements", undefined, {
      "x-tenant-id": tenant,
    });
  assert.deepEqual((await e()).data.feature_ids, ["analytics"]);
  await new Promise((r) =>
    setTimeout(r, Math.max(0, Date.parse(b.starts_at) - Date.now() + 100)),
  );
  assert.deepEqual((await e()).data.feature_ids, ["text"]);
  await new Promise((r) =>
    setTimeout(r, Math.max(0, Date.parse(b.ends_at) - Date.now() + 100)),
  );
  assert.ok((await e()).data.feature_ids.includes("image"));
  assert.equal(
    (await call(operator, "GET", root + "/" + old.g.id)).data.state,
    "replaced",
  );
});
test("expiry is authoritative without workers; notification outbox is bounded, mode-scoped and idempotent", async () => {
  const { u, tenant } = await workspace(),
    v = await plan();
  await grant(
    await command({ kind: "user", id: u.id }, v, { ends_at: future(1100) }),
  );
  await new Promise((r) => setTimeout(r, 1200));
  const e = await call(u, "GET", "/v1/effective-entitlements", undefined, {
    "x-tenant-id": tenant,
  });
  assert.ok(e.data.feature_ids.includes("image"));
  await dispatchEntitlementNotifications(s.db);
  const n = async () =>
    call(u, "GET", "/v1/entitlement-notifications", undefined, {
      "x-tenant-id": tenant,
    });
  const first = await n();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.items.length, 2);
  await dispatchEntitlementNotifications(s.db);
  assert.deepEqual((await n()).data.items, first.data.items);
  const id = first.data.items[0].id;
  assert.equal(
    (
      await call(
        u,
        "PATCH",
        "/v1/entitlement-notifications/" + id,
        { read: true },
        { "x-tenant-id": tenant },
      )
    ).data.read,
    true,
  );
  const outsider = await workspace();
  assert.equal(
    (
      await call(
        outsider.u,
        "PATCH",
        "/v1/entitlement-notifications/" + id,
        { read: true },
        { "x-tenant-id": outsider.tenant },
      )
    ).status,
    404,
  );
});
test("concurrent subject versions cannot overwrite each other and stale previews create no partial grants", async () => {
  const { u } = await workspace(),
    v = await plan(),
    b = await command({ kind: "user", id: u.id }, v);
  const p1 = await preview(b),
    p2 = await preview(b),
    rows = await Promise.all([submit(b, p1), submit(b, p2)]);
  assert.deepEqual(rows.map((r) => r.status).sort(), [202, 409]);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE s.user_id=$1",
        [u.id],
      )
    ).rows[0].n,
    1,
  );
});
test("approval rechecks original session and current permissions; cancelled requests have no grant effect", async () => {
  const { u } = await workspace(),
    v = await plan(),
    a = await administrator();
  const b = await command({ kind: "user", id: u.id }, v, {
    ends_at: future(40 * 86400000),
  });
  const o = await submit(b, await preview(b, a), a);
  assert.equal(o.data.state, "pending_approval");
  await s.db.control.query(
    "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
    [a.id],
  );
  const d = await approve(o.data);
  assert.equal(d.status, 403, JSON.stringify(d.data));
  const rejected = await approve(o.data, reviewer, "reject");
  assert.equal(rejected.data.state, "cancelled");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE s.user_id=$1",
        [u.id],
      )
    ).rows[0].n,
    0,
  );
});
test("legacy replacement preserves unknown historical facts and cannot cut another billing mode", async () => {
  const { u, tenant } = await workspace(),
    v = await plan(["analytics"]);
  const legacy = (
    await s.db.control.query(
      "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'business',now()-interval '1 day',now()+interval '2 days','Original history with unknown actor') RETURNING *",
      [u.id],
    )
  ).rows[0];
  const b = await command({ kind: "user", id: u.id }, v, {
    overlap_policy: "replace",
  });
  await grant(b);
  assert.deepEqual(
    (
      await s.db.control.query("SELECT * FROM entitlements WHERE id=$1", [
        legacy.id,
      ])
    ).rows[0],
    legacy,
  );
  const configured = await s.db.tx(
    (tx) => effectivePlan(tx, tenant, u.id),
    tenant,
    false,
    u.id,
  );
  assert.deepEqual(configured.body.capabilities, ["analytics"]);
  const simulated = await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.data_mode','simulated',true)");
      return effectivePlan(tx, tenant, u.id);
    },
    tenant,
    false,
    u.id,
  );
  assert.equal(simulated.plan, "business");
  assert.ok(simulated.body.capabilities.includes("image"));
  const historical = await call(
    operator,
    "GET",
    `${root}/legacy?subject_id=${u.id}&limit=1`,
  );
  assert.equal(historical.status, 200, JSON.stringify(historical.data));
  assert.equal(historical.data.items[0].original_actor_id, null);
  assert.equal(historical.data.items[0].original_operation_id, null);
});
test("audit failure rolls back subject revision, grant, operation, revision and outbox; original preview can retry", async () => {
  const { u } = await workspace(),
    v = await plan(),
    b = await command({ kind: "user", id: u.id }, v),
    p = await preview(b);
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  const k = randomUUID();
  try {
    await owner.query(
      "CREATE FUNCTION vip_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.entitlements.grant' AND NEW.outcome='succeeded' THEN RAISE EXCEPTION 'controlled VIP audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER vip_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION vip_audit_fault()",
    );
    assert.equal((await submit(b, p, operator, root, k)).status, 500);
    const row = (
      await s.db.control.query(
        "SELECT (SELECT count(*)::int FROM entitlement_subjects WHERE user_id=$1) AS subjects,(SELECT consumed_at FROM admin_previews WHERE id=$2) AS consumed",
        [u.id, p.preview_id],
      )
    ).rows[0];
    assert.equal(row.subjects, 0);
    assert.equal(row.consumed, null);
    await owner.query("DROP TRIGGER vip_audit_fault ON audit_log");
    const retry = await submit(b, p, operator, root, k);
    assert.equal(retry.status, 202, JSON.stringify(retry.data));
    assert.equal(retry.data.state, "succeeded");
  } finally {
    await owner.query("DROP TRIGGER IF EXISTS vip_audit_fault ON audit_log");
    await owner.query("DROP FUNCTION IF EXISTS vip_audit_fault()");
    await owner.end();
  }
});
test("current head, frozen command, duration limits and revoked permissions are rechecked", async () => {
  const { u } = await workspace(),
    v = await plan(),
    b = await command({ kind: "user", id: u.id }, v),
    p = await preview(b);
  await plan(["text"], 3, v.plan_id);
  assert.equal((await submit(b, p)).status, 409);
  const current = await plan(),
    fresh = await command({ kind: "user", id: u.id }, current),
    previewed = await preview(fresh);
  assert.equal(
    (await submit({ ...fresh, source: "trial" }, previewed)).status,
    409,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_previews SET expires_at=expires_at+interval '1 day' WHERE id=$1",
      [previewed.preview_id],
    ),
  );
  const a = await administrator({
    permissions: ["admin.entitlements.grant", "admin.entitlements.read"],
  });
  await s.db.control.query(
    "UPDATE admin_bindings SET limits='{\"max_duration_hours\":2}' WHERE principal_id=$1",
    [a.id],
  );
  const longer = { ...fresh, ends_at: future(10800000) };
  assert.equal(
    (await call(a, "POST", "/v1/admin/entitlement-previews", longer)).status,
    403,
  );
  const prepared = await preview(fresh, a),
    k = randomUUID(),
    o = await submit(fresh, prepared, a, root, k);
  assert.equal(o.status, 202, JSON.stringify(o.data));
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    a.id,
  ]);
  assert.equal((await submit(fresh, prepared, a, root, k)).status, 403);
});
test("verified payment must match subject and mode, is linked once and never posts money by granting VIP", async () => {
  const { u, tenant, project } = await workspace(),
    v = await plan();
  const account = (
    await s.db.control.query(
      "SELECT * FROM wallets WHERE user_id=$1 AND data_mode='configured_services'",
      [u.id],
    )
  ).rows[0];
  const bytes = Buffer.from(
    "Controlled VIP payment evidence; no actual money received " + randomUUID(),
  );
  const key = await s.storage.put(bytes, "text/plain");
  const asset = (
    await s.db.control.query(
      "INSERT INTO assets(tenant_id,project_id,name,kind,created_by,private_owner) VALUES($1,$2,'VIP payment fixture','document',$3,$3) RETURNING id",
      [tenant, project, u.id],
    )
  ).rows[0];
  const version = (
    await s.db.control.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,'text/plain',$4,$5) RETURNING id",
      [
        tenant,
        asset.id,
        key,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    )
  ).rows[0];
  const paymentBody = {
    billing_account_id: account.id,
    external_reference: "vip-" + randomUUID(),
    amount: { currency: "HKD", amount_micros: "1000000" },
    received_at: future(-1000),
    evidence_asset_version_id: version.id,
    reason: "Controlled VIP payment fixture",
  };
  const recorded = await call(
    operator,
    "POST",
    "/v1/admin/billing/payments",
    paymentBody,
  );
  assert.equal(recorded.status, 202, JSON.stringify(recorded.data));
  const id = recorded.data.result_ids[0],
    b = await command({ kind: "user", id: u.id }, v, {
      source: "paid",
      payment_record_id: id,
    });
  assert.equal(
    (await call(operator, "POST", "/v1/admin/entitlement-previews", b)).status,
    409,
  );
  const confirmed = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${id}/confirmations`,
    {
      expected_version: 1,
      verified_reference: paymentBody.external_reference,
      reason: "Independent payment fixture verification",
    },
  );
  assert.equal(confirmed.status, 202, JSON.stringify(confirmed.data));
  const other = await workspace(),
    wrong = await command({ kind: "user", id: other.u.id }, v, {
      source: "paid",
      payment_record_id: id,
    });
  assert.equal(
    (await call(operator, "POST", "/v1/admin/entitlement-previews", wrong))
      .status,
    409,
  );
  const before = (
    await s.db.control.query(
      "SELECT balance_micros,version FROM wallets WHERE id=$1",
      [account.id],
    )
  ).rows[0];
  const prepared = await preview(b),
    submitted = await submit(b, prepared);
  assert.equal(submitted.status, 202, JSON.stringify(submitted.data));
  assert.equal(submitted.data.state, "pending_approval");
  const nonFinance = await administrator({
    permissions: [
      "admin.entitlements.read",
      "admin.entitlements.grant",
      "admin.approvals.read",
      "admin.approvals.decide",
      "admin.jobs.read",
    ],
  });
  for (const endpoint of [
    `/v1/admin/operations/${submitted.data.id}`,
    `/v1/admin/operations/${submitted.data.id}/approval`,
  ])
    assert.equal((await call(nonFinance, "GET", endpoint)).status, 403);
  const request = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${submitted.data.id}/approval`,
  );
  assert.equal(request.status, 200);
  assert.equal(
    (
      await call(
        nonFinance,
        "POST",
        `/v1/admin/approvals/${request.data.id}/decisions`,
        {
          expected_version: request.data.version,
          payload_hash: request.data.payload_hash,
          decision: "approve",
          reason:
            "An entitlement reviewer cannot access a payment without finance permission",
        },
      )
    ).status,
    403,
  );
  const approved = await approve(submitted.data);
  assert.equal(approved.status, 202, JSON.stringify(approved.data));
  assert.equal(approved.data.state, "succeeded");
  const original = {
    g: (await call(operator, "GET", root + "/" + approved.data.result_ids[0]))
      .data,
  };
  assert.equal(original.g.source, "paid");
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT balance_micros,version FROM wallets WHERE id=$1",
        [account.id],
      )
    ).rows[0],
    before,
  );
  const duplicate = await command({ kind: "user", id: u.id }, v, {
    source: "paid",
    payment_record_id: id,
    starts_at: b.ends_at,
    ends_at: future(7200000),
  });
  assert.equal(
    (await call(operator, "POST", "/v1/admin/entitlement-previews", duplicate))
      .data.error.code,
    "PAYMENT_ALREADY_LINKED",
  );
});
