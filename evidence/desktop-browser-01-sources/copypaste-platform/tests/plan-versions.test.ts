import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-plan-schemas.json" with { type: "json" };
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
  if (raw.statusCode === 202 && url.startsWith("/v1/admin/plans"))
    check("AdminOperation", data);
  if (
    (raw.statusCode === 200 && url === "/v1/admin/plans") ||
    (raw.statusCode === 200 && url.startsWith("/v1/admin/plans?"))
  )
    check("AdminPlanVersionList", data);
  if (raw.statusCode === 200 && /\/publication-previews$/.test(url))
    check("AdminPreview", data);
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
const body = (family: string = randomUUID()) => ({
  plan_id: family,
  name: "Campaign team",
  allowances: {
    feature_ids: ["text", "analytics"],
    allowed_role_ids: ["assistant"],
    seat_limit: 8,
    task_concurrency: 4,
    storage_bytes: 1234567,
    included_credit: { currency: "HKD", amount_micros: "0" },
    credit_policy: "no_automatic_credit",
  },
  reason: "Controlled plan review",
});
async function draft(a: Client, b = body(), k = randomUUID()) {
  const r = await call(a, "POST", "/v1/admin/plans/drafts", b, {
    "idempotency-key": k,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  const v = await call(a, "GET", "/v1/admin/plans/" + r.data.result_ids[0]);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  check("AdminPlanVersion", v.data);
  return { v: v.data, op: r.data, b };
}
async function preview(
  a: Client,
  v: any,
  reason = "Controlled publication review",
) {
  const b = { expected_version: v.version, reason },
    r = await call(
      a,
      "POST",
      `/v1/admin/plans/${v.id}/publication-previews`,
      b,
    );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { b, p: r.data };
}
async function submit(
  a: Client,
  v: any,
  p: Awaited<ReturnType<typeof preview>>,
  k = randomUUID(),
) {
  return call(a, "POST", `/v1/admin/plans/${v.id}/publications`, p.b, {
    "idempotency-key": k,
    "x-admin-preview-id": p.p.preview_id,
  });
}
async function approve(
  reviewer: Client,
  op: any,
  decision: "approve" | "reject" = "approve",
) {
  const request = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${op.id}/approval`,
  );
  assert.equal(request.status, 200, JSON.stringify(request.data));
  return call(
    reviewer,
    "POST",
    `/v1/admin/approvals/${request.data.id}/decisions`,
    {
      expected_version: request.data.version,
      payload_hash: request.data.payload_hash,
      decision,
      reason: "Independent controlled review",
    },
  );
}
async function publish(a: Client, reviewer: Client, v: any) {
  const r = await submit(a, v, await preview(a, v));
  assert.equal(r.status, 202, JSON.stringify(r.data));
  if (r.data.state === "pending_approval") {
    const d = await approve(reviewer, r.data);
    assert.equal(d.status, 202, JSON.stringify(d.data));
    assert.equal(d.data.state, "succeeded");
  }
  return r.data;
}
async function policy(requires: boolean) {
  await s.db.tx(
    async (tx) => {
      await tx.query(
        "UPDATE catalog_entries SET state='retired' WHERE kind='policy' AND key='admin-control' AND state='published'",
      );
      const n = (
        await tx.query(
          "SELECT coalesce(max(version),0)+1 AS n FROM catalog_entries WHERE kind='policy' AND key='admin-control'",
        )
      ).rows[0].n;
      await tx.query(
        "INSERT INTO catalog_entries(kind,key,version,state,body) VALUES('policy','admin-control',$1,'published',$2)",
        [
          n,
          {
            approval_threshold_micros: 1e10,
            max_vip_hours: 8784,
            plan_publication_requires_approval: requires,
            plan_approval_window_minutes: 5,
          },
        ],
      );
    },
    undefined,
    true,
  );
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
  if (s) await s.app.close();
  if (isolated) await isolated.cleanup();
});

test("plan contract fixture preserves the exact original schemas and source digest", async () => {
  const raw = await readFile("../../docs/contracts/openapi.json"),
    original = JSON.parse(raw.toString());
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    contract.normative_source_sha256,
  );
  for (const [name, schema] of Object.entries(contract.schemas))
    assert.deepEqual(schema, original.components.schemas[name]);
});
test("only a current independent Admin with whole global plan permission and recent MFA can read or write", async () => {
  const user = await login(randomUUID() + "@example.invalid");
  assert.equal((await call(undefined, "GET", "/v1/admin/plans")).status, 401);
  assert.equal((await call(user, "GET", "/v1/admin/plans")).status, 401);
  const scoped = await administrator({
    permissions: ["admin.plans.read", "admin.plans.draft"],
    scope: "tenant",
    id: randomUUID(),
  });
  assert.equal((await call(scoped, "GET", "/v1/admin/plans")).status, 403);
  assert.equal(
    (await call(scoped, "POST", "/v1/admin/plans/drafts", body())).status,
    403,
  );
  const a = await administrator();
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal(
    (await call(a, "GET", "/v1/admin/plans")).data.error.code,
    "MFA_REQUIRED",
  );
});
test("draft uses the original strict command, positive version, exact credit string and durable operation", async () => {
  const a = await administrator(),
    b = body();
  b.allowances.included_credit.amount_micros = "9007199254740993";
  b.allowances.credit_policy = "separate_idempotent_grant";
  const d = await draft(a, b);
  assert.equal(d.v.version, 1);
  assert.equal(d.v.state, "draft");
  assert.deepEqual(d.v.allowances, b.allowances);
  const op = await call(a, "GET", "/v1/admin/operations/" + d.op.id);
  assert.equal(op.status, 200);
  check("AdminOperation", op.data);
  for (const bad of [
    { ...b, engine: "dsh" },
    {
      ...b,
      allowances: {
        ...b.allowances,
        included_credit: { currency: "HKD", amount_micros: 1 },
      },
    },
    { ...b, allowances: { ...b.allowances, task_concurrency: 0 } },
  ])
    assert.equal(
      (await call(a, "POST", "/v1/admin/plans/drafts", bad)).status,
      400,
    );
  assert.equal(
    (
      await call(a, "POST", "/v1/admin/plans/drafts", {
        ...b,
        allowances: { ...b.allowances, feature_ids: ["external_ai"] },
      })
    ).data.error.code,
    "PLAN_FEATURE_UNKNOWN",
  );
  assert.equal(
    (
      await call(a, "POST", "/v1/admin/catalog", {
        kind: "plan",
        key: "bypass",
        body: {},
      })
    ).data.error.code,
    "CANONICAL_PLAN_REQUIRED",
  );
});
test("concurrent drafts and durable retries have one intent per key and monotonically allocated family versions", async () => {
  const a = await administrator(),
    b = body(),
    k = randomUUID();
  const r = await Promise.all([
    call(a, "POST", "/v1/admin/plans/drafts", b, { "idempotency-key": k }),
    call(a, "POST", "/v1/admin/plans/drafts", b, { "idempotency-key": k }),
  ]);
  assert.deepEqual(
    r.map((x) => x.status),
    [202, 202],
  );
  assert.equal(r[0].data.id, r[1].data.id);
  const more = await Promise.all([
    draft(a, { ...b, name: "Version two" }),
    draft(a, { ...b, name: "Version three" }),
  ]);
  assert.deepEqual(more.map((x) => x.v.version).sort(), [2, 3]);
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/admin/plans/drafts",
        { ...b, name: "Changed replay" },
        { "idempotency-key": k },
      )
    ).data.error.code,
    "IDEMPOTENCY_CONFLICT",
  );
});
test("signed plan pagination binds session and filters and rejects legacy or unknown query parameters", async () => {
  const a = await administrator(),
    first = await call(a, "GET", "/v1/admin/plans?limit=1");
  assert.equal(first.status, 200);
  assert.ok(first.data.next_cursor);
  const next = await call(
    a,
    "GET",
    "/v1/admin/plans?limit=1&cursor=" +
      encodeURIComponent(first.data.next_cursor),
  );
  assert.equal(next.status, 200);
  assert.notEqual(first.data.items[0].id, next.data.items[0].id);
  assert.equal(
    (
      await call(
        a,
        "GET",
        "/v1/admin/plans?limit=2&cursor=" +
          encodeURIComponent(first.data.next_cursor),
      )
    ).data.error.code,
    "CURSOR_INVALID",
  );
  const other = await administrator();
  assert.equal(
    (
      await call(
        other,
        "GET",
        "/v1/admin/plans?limit=1&cursor=" +
          encodeURIComponent(first.data.next_cursor),
      )
    ).data.error.code,
    "CURSOR_INVALID",
  );
  for (const q of ["page=1", "limit=0", "q=x", "limit=101"])
    assert.equal((await call(a, "GET", "/v1/admin/plans?" + q)).status, 400);
});
test("preview has no business or wallet effect; a publication is a separate immutable fact reviewed by another Admin", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    d = await draft(a);
  const before = (
    await s.db.control.query(
      "SELECT count(*)::int AS facts FROM commercial_plan_publications",
    )
  ).rows[0];
  const wallets = (
    await s.db.control.query(
      "SELECT coalesce(sum(balance_micros),0)::text AS n FROM wallets",
    )
  ).rows[0];
  const p = await preview(a, d.v);
  assert.equal(p.p.decision, "independent_approval");
  assert.equal(p.p.creates_business_effect, false);
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS facts FROM commercial_plan_publications",
      )
    ).rows[0],
    before,
  );
  const r = await submit(a, d.v, p);
  assert.equal(r.status, 202);
  assert.equal(r.data.state, "pending_approval");
  assert.equal(
    (await approve(a, r.data)).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const reqs = await call(reviewer, "GET", "/v1/admin/approvals");
  assert.ok(reqs.data.items.some((x: any) => x.operation_id === r.data.id));
  const done = await approve(reviewer, r.data);
  assert.equal(done.status, 202, JSON.stringify(done.data));
  assert.equal(done.data.state, "succeeded");
  assert.equal(
    (await call(a, "GET", "/v1/admin/plans/" + d.v.id)).data.state,
    "published",
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT coalesce(sum(balance_micros),0)::text AS n FROM wallets",
      )
    ).rows[0],
    wallets,
  );
  const f = (
    await s.db.control.query(
      "SELECT * FROM commercial_plan_publications WHERE operation_id=$1",
      [r.data.id],
    )
  ).rows[0];
  assert.equal(f.actor_id, a.id);
  assert.equal(f.plan_version_id, d.v.id);
});
test("direct publication still requires a current frozen preview and replay does not publish or credit twice", async () => {
  await policy(false);
  try {
    const a = await administrator(),
      d = await draft(a),
      p = await preview(a, d.v),
      k = randomUUID();
    assert.equal(p.p.decision, "recent_mfa");
    assert.equal(
      (await call(a, "POST", `/v1/admin/plans/${d.v.id}/publications`, p.b))
        .status,
      400,
    );
    const one = await submit(a, d.v, p, k);
    assert.equal(one.status, 202, JSON.stringify(one.data));
    assert.equal(one.data.state, "succeeded");
    const two = await submit(a, d.v, p, k);
    assert.deepEqual(two.data, one.data);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM commercial_plan_publications WHERE plan_version_id=$1",
          [d.v.id],
        )
      ).rows[0].n,
      1,
    );
    await s.db.control.query(
      "DELETE FROM admin_bindings WHERE principal_id=$1",
      [a.id],
    );
    assert.equal((await submit(a, d.v, p, k)).status, 403);
  } finally {
    await policy(true);
  }
});
test("new publication retires the old display version without changing a bound old grant or its task policy", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    u = await login(randomUUID() + "@example.invalid");
  const w = await call(u, "POST", "/v1/tenants", {
    name: "Pinned grant workspace",
    project_name: "Campaign",
  });
  assert.equal(w.status, 200);
  const original = (
    await s.db.control.query(
      "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'business',now()-interval '1 hour',now()+interval '1 day','Old current evaluation') RETURNING *",
      [u.id],
    )
  ).rows[0];
  const old = await s.db.tx(
    (tx) => effectivePlan(tx, w.data.tenant.id, u.id),
    w.data.tenant.id,
    false,
    u.id,
  );
  const b = body(legacyPlanIds.business);
  b.name = "Business revised";
  b.allowances.task_concurrency = 2;
  const d = await draft(a, b);
  await publish(a, reviewer, d.v);
  const current = await s.db.tx(
    (tx) => effectivePlan(tx, w.data.tenant.id, u.id),
    w.data.tenant.id,
    false,
    u.id,
  );
  assert.deepEqual(current, old);
  assert.equal(current.body.max_active_tasks, 8);
  assert.equal(
    (await call(a, "GET", "/v1/admin/plans/" + old.plan_version_id)).data.state,
    "retired",
  );
  assert.deepEqual(
    (
      await s.db.control.query("SELECT * FROM entitlements WHERE id=$1", [
        original.id,
      ])
    ).rows[0],
    original,
  );
  const next = await login(randomUUID() + "@example.invalid");
  await s.db.control.query(
    "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'business',now()-interval '1 hour',now()+interval '1 day','New current evaluation')",
    [next.id],
  );
  const newer = await s.db.tx(
    (tx) => effectivePlan(tx, w.data.tenant.id, next.id),
    w.data.tenant.id,
    false,
    next.id,
  );
  assert.equal(newer.plan_version_id, d.v.id);
  assert.equal(newer.body.max_active_tasks, 2);
});
test("immutable definitions, grant bodies, fallback bindings, publication facts and preview intent reject direct rewriting", async () => {
  const a = await administrator(),
    d = await draft(a),
    p = await preview(a, d.v);
  for (const statement of [
    [
      "UPDATE commercial_plan_versions SET name=$2 WHERE id=$1",
      [d.v.id, "Forged name"],
    ],
    ["DELETE FROM commercial_plan_versions WHERE id=$1", [d.v.id]],
    ["UPDATE admin_previews SET payload='{}' WHERE id=$1", [p.p.preview_id]],
    ["UPDATE admin_operations SET payload='{}' WHERE id=$1", [d.op.id]],
  ] as const)
    await assert.rejects(s.db.control.query(statement[0], [...statement[1]]), {
      code: "42501",
    });
  const grant = (await s.db.control.query("SELECT * FROM entitlements LIMIT 1"))
    .rows[0];
  await assert.rejects(
    s.db.control.query("UPDATE entitlements SET plan_body=$2 WHERE id=$1", [
      grant.id,
      { ...defaults.starter, name: "Changed after issue" },
    ]),
    { code: "42501" },
  );
  await assert.rejects(
    s.db.control.query(
      "DELETE FROM legacy_entitlement_plan_bindings WHERE entitlement_id=$1",
      [grant.id],
    ),
    { code: "42501" },
  );
  await assert.rejects(
    s.db.control.query(
      "INSERT INTO catalog_entries(kind,key,version,body) VALUES('plan','forged',1,'{}')",
    ),
    { code: "42501" },
  );
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM commercial_plan_versions WHERE id=$1",
        [d.v.id],
      )
    ).rows[0].n,
    0,
  );
});
test("approval rechecks requester and reviewer current permissions, MFA, policy and exact head rather than trusting the menu", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    d = await draft(a),
    r = await submit(a, d.v, await preview(a, d.v));
  assert.equal(r.status, 202);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  const denied = await approve(reviewer, r.data);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, "MFA_REQUIRED");
  assert.equal(
    (await call(reviewer, "GET", "/v1/admin/plans/" + d.v.id)).data.state,
    "draft",
  );
  const denyRole = "deny-" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [denyRole, JSON.stringify(["admin.plans.read"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [reviewer.id, denyRole, randomUUID()],
  );
  assert.equal((await call(reviewer, "GET", "/v1/admin/plans")).status, 403);
  assert.ok(
    !(await call(reviewer, "GET", "/v1/admin/approvals")).data.items.some(
      (x: any) => x.operation_id === r.data.id,
    ),
  );
});
test("changed head and policy invalidate previously frozen publication previews and cannot retire a newer version", async () => {
  await policy(false);
  try {
    const a = await administrator(),
      one = await draft(a),
      two = await draft(a, { ...one.b, name: "Newer immutable draft" });
    const p1 = await preview(a, one.v),
      p2 = await preview(a, two.v);
    assert.equal((await submit(a, two.v, p2)).data.state, "succeeded");
    const stale = await submit(a, one.v, p1);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, "PLAN_VERSION_ORDER");
    const third = await draft(a, { ...one.b, name: "Third draft" }),
      p3 = await preview(a, third.v);
    await policy(true);
    assert.equal(
      (await submit(a, third.v, p3)).data.error.code,
      "POLICY_CHANGED",
    );
  } finally {
    await policy(true);
  }
});
test("startup seeding is idempotent and never rebinds old grants to a new catalog head", async () => {
  const before = (
    await s.db.control.query(
      "SELECT * FROM legacy_entitlement_plan_bindings ORDER BY entitlement_id",
    )
  ).rows;
  const heads = (
    await s.db.control.query("SELECT * FROM commercial_plans ORDER BY id")
  ).rows;
  await seedCommercialPlans(s.db, s.catalog);
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT * FROM legacy_entitlement_plan_bindings ORDER BY entitlement_id",
      )
    ).rows,
    before,
  );
  assert.deepEqual(
    (await s.db.control.query("SELECT * FROM commercial_plans ORDER BY id"))
      .rows,
    heads,
  );
});

test("the confirmation comparison is the exact actor/session-bound frozen preview, not a refreshed family head", async () => {
  const a = await administrator(),
    other = await administrator(),
    d = await draft(a),
    p = await preview(a, d.v),
    endpoint = `/v1/admin/plans/publication-previews/${p.p.preview_id}`;
  const facts = await call(a, "GET", endpoint);
  assert.equal(facts.status, 200, JSON.stringify(facts.data));
  assert.equal(facts.data.preview_id, p.p.preview_id);
  assert.equal(facts.data.payload_hash, p.p.payload_hash);
  assert.deepEqual(facts.data.before.proposed, d.v);
  assert.equal(facts.data.before.previous, null);
  assert.equal((await call(other, "GET", endpoint)).status, 404);
  assert.equal((await call(undefined, "GET", endpoint)).status, 401);
  const submitted = await submit(a, d.v, p);
  assert.equal(submitted.status, 202);
  assert.equal((await call(a, "GET", endpoint)).status, 409);
});

test("concurrent publication from the same head commits only one frozen intent; the other must be previewed again", async () => {
  await policy(false);
  try {
    const a = await administrator(),
      first = await draft(a),
      second = await draft(a, first.b),
      p1 = await preview(a, first.v),
      p2 = await preview(a, second.v);
    const r = await Promise.all([
      submit(a, first.v, p1),
      submit(a, second.v, p2),
    ]);
    assert.deepEqual(r.map((x) => x.status).sort(), [202, 409]);
    assert.ok(
      ["TARGET_CHANGED", "PLAN_VERSION_ORDER"].includes(
        r.find((x) => x.status === 409)!.data.error.code,
      ),
    );
    const facts = (
      await s.db.control.query(
        "SELECT * FROM commercial_plan_publications WHERE plan_id=$1",
        [first.v.plan_id],
      )
    ).rows;
    assert.equal(facts.length, 1);
    const winning = r.find((x) => x.status === 202)!;
    assert.equal(winning.data.result_ids[0], facts[0].plan_version_id);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT published_version_id FROM commercial_plans WHERE id=$1",
          [first.v.plan_id],
        )
      ).rows[0].published_version_id,
      facts[0].plan_version_id,
    );
  } finally {
    await policy(true);
  }
});

test("audit failure rolls back a draft and an independent publication together with operation, approval decision and head", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  const intent = body(),
    key = randomUUID();
  try {
    await owner.query(
      "CREATE FUNCTION controlled_plan_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('admin.plans.draft','admin.plans.publish') AND NEW.outcome='succeeded' THEN RAISE EXCEPTION 'controlled plan audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER controlled_plan_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION controlled_plan_audit_failure()",
    );
    const failed = await call(a, "POST", "/v1/admin/plans/drafts", intent, {
      "idempotency-key": key,
    });
    assert.equal(failed.status, 500);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM commercial_plans WHERE id=$1",
          [intent.plan_id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM admin_operations WHERE principal_id=$1 AND action='plans.draft'",
          [a.id],
        )
      ).rows[0].n,
      0,
    );
    await owner.query("DROP TRIGGER controlled_plan_audit ON audit_log");
    const d = await draft(a, intent, key),
      r = await submit(a, d.v, await preview(a, d.v));
    assert.equal(r.status, 202);
    const request = (
      await call(reviewer, "GET", `/v1/admin/operations/${r.data.id}/approval`)
    ).data;
    await owner.query(
      "CREATE TRIGGER controlled_plan_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION controlled_plan_audit_failure()",
    );
    const rejectedByAudit = await approve(reviewer, r.data);
    assert.equal(
      rejectedByAudit.status,
      500,
      JSON.stringify(rejectedByAudit.data),
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_operations WHERE id=$1",
          [r.data.id],
        )
      ).rows[0].state,
      "pending_approval",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_approval_requests WHERE id=$1",
          [request.id],
        )
      ).rows[0].state,
      "pending",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
          [request.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM commercial_plan_publications WHERE plan_id=$1",
          [d.v.plan_id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT published_version_id FROM commercial_plans WHERE id=$1",
          [d.v.plan_id],
        )
      ).rows[0].published_version_id,
      null,
    );
    await owner.query("DROP TRIGGER controlled_plan_audit ON audit_log");
    assert.equal((await approve(reviewer, r.data)).data.state, "succeeded");
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS controlled_plan_audit ON audit_log",
    );
    await owner.query(
      "DROP FUNCTION IF EXISTS controlled_plan_audit_failure()",
    );
    await owner.end();
  }
});

test("a populated 055 upgrade preserves exact legacy rows, labels missing snapshots as evaluated now and never invents an original version", async () => {
  const prior = await isolatedTestEnvironment({ throughVersion: 55 }),
    owner = new pg.Client({ connectionString: prior.env.OWNER_DATABASE_URL });
  let upgraded: Awaited<ReturnType<typeof buildApp>> | undefined;
  await owner.connect();
  try {
    const user = (
        await owner.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
          randomUUID() + "@example.invalid",
        ])
      ).rows[0].id,
      actual = { ...defaults.business, name: "Recorded business definition" },
      custom = { ...actual, name: "Recorded grant-specific definition" };
    await owner.query(
      "INSERT INTO catalog_entries(kind,key,version,state,body,created_at) VALUES('plan','business',4,'published',$1,now()-interval '60 days')",
      [actual],
    );
    const invalid = (
      await owner.query(
        "INSERT INTO catalog_entries(kind,key,version,state,body) VALUES('plan','pro',7,'published','{}') RETURNING id",
      )
    ).rows[0].id;
    for (const [plan, snapshot, version] of [
      ["business", {}, 1],
      ["business", actual, 4],
      ["business", custom, 3],
      ["pro", {}, 1],
    ] as const)
      await owner.query(
        "INSERT INTO entitlements(user_id,plan,plan_body,plan_version,starts_at,ends_at,created_at,reason) VALUES($1,$2,$3,$4,now()-interval '30 days',now()+interval '30 days',now()-interval '30 days','Recorded old grant')",
        [user, plan, snapshot, version],
      );
    const rowsBefore = (
        await owner.query("SELECT * FROM entitlements ORDER BY id")
      ).rows,
      catalogBefore = (
        await owner.query(
          "SELECT * FROM catalog_entries WHERE kind='plan' ORDER BY id",
        )
      ).rows;
    await runMigrations(owner, "populated 055 commercial upgrade");
    upgraded = await buildApp(
      loadConfig({
        ...prior.env,
        NODE_ENV: "test",
        DEV_MAILBOX: "true",
        WORKER_ENABLED: "false",
        DEMO_MODE: "false",
      }),
      { worker: false },
    );
    assert.deepEqual(
      (await owner.query("SELECT * FROM entitlements ORDER BY id")).rows,
      rowsBefore,
    );
    assert.deepEqual(
      (
        await owner.query(
          "SELECT * FROM catalog_entries WHERE kind='plan' ORDER BY id",
        )
      ).rows,
      catalogBefore,
    );
    const bindings = (
      await owner.query(
        "SELECT e.plan_body,e.plan_version AS original_integer,b.*,v.version AS evaluated_version FROM entitlements e LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id LEFT JOIN commercial_plan_versions v ON v.id=b.catalog_version_id WHERE e.plan='business' ORDER BY e.id",
      )
    ).rows;
    assert.equal(bindings.length, 3);
    for (const b of bindings) {
      assert.equal(b.evaluated_version, 4);
      if (!Object.keys(b.plan_body).length) {
        assert.equal(b.original_integer, 1);
        assert.equal(b.provenance, "evaluated_fallback_at_binding");
        assert.deepEqual(b.runtime_body, actual);
        assert.equal(b.plan_version_id, b.catalog_version_id);
      } else {
        assert.equal(b.provenance, "recorded_grant_snapshot");
        assert.deepEqual(b.runtime_body, b.plan_body);
        assert.equal(
          b.plan_version_id,
          b.plan_body.name === actual.name ? b.catalog_version_id : null,
        );
      }
    }
    const issue = (
      await owner.query(
        "SELECT * FROM commercial_plan_migration_issues WHERE source_catalog_entry_id=$1",
        [invalid],
      )
    ).rows[0];
    assert.equal(issue.reason_code, "LEGACY_PLAN_DEFINITION_INVALID");
    assert.equal(
      (
        await owner.query(
          "SELECT published_version_id FROM commercial_plans WHERE legacy_key='pro'",
        )
      ).rows[0].published_version_id,
      null,
    );
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM legacy_entitlement_plan_bindings b JOIN entitlements e ON e.id=b.entitlement_id WHERE e.plan='pro'",
        )
      ).rows[0].n,
      0,
    );
    const facts = (
      await owner.query(
        "SELECT * FROM commercial_plan_publications WHERE plan_id=$1",
        [legacyPlanIds.business],
      )
    ).rows;
    assert.equal(facts.length, 1);
    assert.equal(facts[0].provenance, "evaluated_at_upgrade");
    assert.equal(facts[0].actor_id, null);
    assert.equal(facts[0].operation_id, null);
    await seedCommercialPlans(upgraded.db, upgraded.catalog);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM commercial_plan_publications WHERE plan_id=$1",
          [legacyPlanIds.business],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    if (upgraded) await upgraded.app.close();
    await owner.end();
    await prior.cleanup();
  }
});
