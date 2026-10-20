import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-fee-schemas.json" with { type: "json" };
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
  return s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5)",
    [a.id, role, kind, target, effect],
  );
}

async function personal(u: Client, dataMode = "configured_services") {
  return (
    await s.db.control.query(
      "SELECT * FROM wallets WHERE user_id=$1 AND data_mode=$2",
      [u.id, dataMode],
    )
  ).rows[0];
}
async function enterprise(tenant: string) {
  return (
    await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
      tenant,
    ])
  ).rows[0];
}
const payment = (
  account: string,
  amount: string,
  kind: "top_up" | "gift" = "top_up",
) =>
  s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: account,
          action: kind,
          amount_micros: amount,
          reason: "Controlled fixture; no payment received",
          ...(kind === "gift"
            ? { expires_at: new Date(Date.now() + 86400000).toISOString() }
            : { reference: "fixture-" + randomUUID() }),
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
async function manualTask(u: Client, w: any, payer: string, budget = 60) {
  return s.db.tx(
    async (tx) => {
      const row = (
        await tx.query(
          "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,billing_account_id) VALUES($1,$2,$3,'Controlled task','Not executed','assistant','fixture',$4,$5,$6) RETURNING *",
          [w.tenant.id, w.project.id, u.id, budget, randomUUID(), payer],
        )
      ).rows[0];
      await reserve(tx, w.tenant.id, row.id, budget);
      return row;
    },
    w.tenant.id,
    false,
    u.id,
  );
}
const base = "/v1/admin/billing/accounts";

const money = (n: string) => ({ currency: "HKD", amount_micros: n });
async function current(id: string) {
  return (await s.db.control.query("SELECT * FROM wallets WHERE id=$1", [id]))
    .rows[0];
}
async function gift(id: string, amount = "100") {
  return {
    expected_version: (await current(id)).version,
    reason: "Controlled promotional credit",
    action: "gift",
    amount: money(amount),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}
const suffix = (b: any) =>
  b.action === "credit_limit" ? "credit-limit" : b.action;
async function preview(a: Client, id: string, body: any) {
  schema("AdminFeePreview", body);
  return call(a, "POST", `${base}/${id}/previews`, body);
}
async function submit(
  a: Client,
  id: string,
  body: any,
  options: { key?: string; preview?: string; noPreview?: boolean } = {},
) {
  let pv = options.preview;
  if (!pv && !options.noPreview) {
    const p = await preview(a, id, body);
    assert.equal(p.status, 200, JSON.stringify(p.data));
    schema("AdminPreview", p.data);
    pv = p.data.preview_id;
  }
  const r = await call(a, "POST", `${base}/${id}/${suffix(body)}`, body, {
    key: options.key,
    headers: pv ? { "x-admin-preview-id": pv } : {},
  });
  if (r.status === 202) schema("AdminOperation", r.data);
  return r;
}
async function decide(
  a: Client,
  op: any,
  decision = "approve",
  changes: any = {},
  key?: string,
) {
  const request = (
    await s.db.control.query(
      "SELECT id,version FROM admin_approval_requests WHERE operation_id=$1",
      [op.id],
    )
  ).rows[0];
  const body = {
    expected_version: op.version,
    reason: "Controlled independent financial review",
    decision,
    payload_hash: op.payload_hash,
    ...changes,
  };
  schema("AdminApprovalDecision", body);
  const r = await call(
    a,
    "POST",
    `/v1/admin/approvals/${request?.id ?? op.id}/decisions`,
    body,
    { key },
  );
  if (r.status === 202) schema("AdminOperation", r.data);
  return r;
}

test("fee schema snapshot is byte-derived from the unchanged original OpenAPI", async () => {
  const original = await readFile("../../docs/contracts/openapi.json", "utf8");
  assert.equal(hash(original), contract.source_sha256);
  const schemas = JSON.parse(original).components.schemas;
  for (const [name, body] of Object.entries(contract.schemas))
    assert.deepEqual(body, schemas[name], name);
});

test("financial preview has no ledger, expiry or account effects and freezes the real policy", async () => {
  const u = await user(),
    a = await admin(undefined, "super_admin"),
    w = await personal(u);
  await s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: w.id,
          action: "gift",
          amount_micros: "500",
          reason: "Controlled already expired funding",
          expires_at: new Date(Date.now() - 86400000).toISOString(),
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
  const before = await current(w.id),
    lots = (
      await s.db.control.query(
        "SELECT * FROM funding_lots WHERE billing_account_id=$1",
        [w.id],
      )
    ).rows;
  const count = async () =>
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM billing_journal WHERE billing_account_id=$1",
        [w.id],
      )
    ).rows[0].n;
  const n = await count(),
    body = await gift(w.id),
    r = await preview(a, w.id, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  schema("AdminPreview", r.data);
  assert.equal(r.data.creates_business_effect, false);
  assert.deepEqual(await current(w.id), before);
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT * FROM funding_lots WHERE billing_account_id=$1",
        [w.id],
      )
    ).rows,
    lots,
  );
  assert.equal(await count(), n);
  const policy = (
    await s.db.control.query(
      "SELECT * FROM admin_operation_policy_versions WHERE id=$1",
      [r.data.policy_version_id],
    )
  ).rows[0];
  assert.equal(policy.payload_hash, hash(canonical(policy.body)));
  assert.equal(policy.body.source, null);
  assert.equal(
    r.data.payload_hash,
    hash(canonical({ billing_account_id: w.id, command: body })),
  );
  assert.equal(
    (await call(a, "POST", `${base}/${w.id}/gift`, body)).data.error.code,
    "PREVIEW_REQUIRED",
  );
});

test("personal and enterprise gifts retain actual administrator, policy and journal identity; replay never double-credits", async () => {
  const u = await user(),
    tenant = await workspace(u),
    a = await admin(undefined, "super_admin");
  for (const w of [await personal(u), await enterprise(tenant.tenant.id)]) {
    const body = await gift(w.id),
      pv = await preview(a, w.id, body),
      key = randomUUID();
    const r = await submit(a, w.id, body, { key, preview: pv.data.preview_id });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.equal(r.data.state, "succeeded");
    const j = (
      await s.db.control.query(
        "SELECT j.*,o.policy_version_id FROM billing_journal j JOIN billing_operations o ON o.id=j.operation_id WHERE j.operation_id=$1",
        [r.data.id],
      )
    ).rows;
    assert.equal(j.length, 1);
    assert.equal(j[0].actor_id, a.id);
    assert.equal(j[0].policy_version_id, r.data.policy_version_id);
    assert.equal(j[0].kind, "gift");
    assert.equal(j[0].bucket, "promotional");
    assert.equal(j[0].amount_micros, "100");
    assert.deepEqual(r.data.result_ids, [j[0].id]);
    const again = await submit(a, w.id, body, { key, noPreview: true });
    assert.deepEqual(again.data, r.data);
    assert.equal((await current(w.id)).balance_micros, "100");
    const reused = await submit(a, w.id, body, { preview: pv.data.preview_id });
    assert.equal(reused.status, 409);
    assert.equal(
      (
        await submit(
          a,
          w.id,
          { ...body, reason: "Changed request behind the same key" },
          { key, noPreview: true },
        )
      ).data.error.code,
      "IDEMPOTENCY_CONFLICT",
    );
  }
  assert.equal(
    (await current((await personal(u, "simulated")).id)).balance_micros,
    "0",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM entitlements WHERE tenant_id=$1",
        [tenant.tenant.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await preview(
        a,
        (await personal(u, "simulated")).id,
        await gift((await personal(u, "simulated")).id),
      )
    ).status,
    404,
  );
});

test("debits bind an original funding bucket and cannot consume another source, expired credit or held funds", async () => {
  const u = await user(),
    tenant = await workspace(u),
    a = await admin(undefined, "super_admin"),
    w = await personal(u);
  const funded = await submit(a, w.id, await gift(w.id, "500"));
  const debit = async (id = funded.data.result_ids[0], n = "100") => ({
    action: "debit",
    expected_version: (await current(w.id)).version,
    reason: "Reverse original promotional funding",
    amount: money(n),
    original_entry_id: id,
  });
  const r = await submit(a, w.id, await debit());
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const j = (
    await s.db.control.query(
      "SELECT * FROM billing_journal WHERE operation_id=$1",
      [r.data.id],
    )
  ).rows[0];
  assert.equal(j.source_entry_id, funded.data.result_ids[0]);
  assert.equal(j.bucket, "promotional");
  assert.equal(j.direction, "debit");
  const other = await personal(await user()),
    otherFunding = await submit(a, other.id, await gift(other.id));
  assert.equal(
    (await preview(a, w.id, await debit(otherFunding.data.result_ids[0]))).data
      .error.code,
    "INVALID_SOURCE",
  );
  const task = await manualTask(u, tenant, w.id, 350);
  assert.equal(
    (await preview(a, w.id, await debit())).data.error.code,
    "FUNDS_UNAVAILABLE",
  );
  await s.db.tx(
    (tx) => settle(tx, tenant.tenant.id, task.id, 350, u.id),
    tenant.tenant.id,
    false,
    u.id,
  );
  assert.equal(
    (await preview(a, w.id, await debit())).data.error.code,
    "FUNDS_UNAVAILABLE",
  );
  const last = await submit(
    a,
    w.id,
    await debit(funded.data.result_ids[0], "50"),
  );
  assert.equal(last.status, 202);
  assert.equal((await current(w.id)).balance_micros, "0");
});

test("daily limits use exact amounts and replay; delegated caps cannot be widened", async () => {
  const u = await user(),
    w = await personal(u),
    a = await admin(undefined, "finance_admin");
  await s.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [a.id, { max_amount_micros: 100, max_daily_amount_micros: 150 }],
  );
  const body = await gift(w.id),
    key = randomUUID();
  assert.equal((await submit(a, w.id, body, { key })).status, 202);
  assert.equal(
    (await submit(a, w.id, body, { key, noPreview: true })).status,
    202,
  );
  const simulated = await personal(u, "simulated");
  await s.db.tx(
    async (tx) => {
      const op = (
        await tx.query(
          "INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) SELECT $1,'billing.gift',payload_hash,'{}',$2,'succeeded',policy_version_id,$3 FROM admin_operations WHERE principal_id=$1 ORDER BY created_at LIMIT 1 RETURNING id",
          [a.id, randomUUID(), [simulated.id]],
        )
      ).rows[0];
      await fund(
        tx,
        {
          billing_account_id: simulated.id,
          action: "gift",
          amount_micros: "1000",
          reason:
            "Synthetic simulated funding must not consume configured-service limits",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
        `admin:${op.id}`,
      );
    },
    undefined,
    true,
  );
  assert.equal(
    (await preview(a, w.id, await gift(w.id, "51"))).data.error.code,
    "DAILY_AMOUNT_LIMIT",
  );
  assert.equal(
    (await preview(a, w.id, await gift(w.id, "101"))).data.error.code,
    "ADMIN_FORBIDDEN",
  );
  assert.equal((await submit(a, w.id, await gift(w.id, "50"))).status, 202);
  assert.equal(
    (await preview(a, w.id, await gift(w.id, "1"))).data.error.code,
    "DAILY_AMOUNT_LIMIT",
  );
  const d = await admin(undefined, "security_admin");
  await bind(d, ["admin.access.bindings.write", "admin.billing.gift"]);
  await s.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [d.id, { max_daily_amount_micros: 150 }],
  );
  const target = await admin(undefined, "finance_admin");
  const delegatedRole = "fee_daily_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [delegatedRole, JSON.stringify(["admin.billing.gift"])],
  );
  const delegated = await call(d, "POST", "/v1/admin/access/bindings", {
    reason: "Controlled delegated daily limit",
    principal_id: target.id,
    role_key: delegatedRole,
    scope_kind: "global",
    effect: "allow",
    limits: { max_daily_amount_micros: 151 },
  });
  assert.equal(delegated.status, 403, JSON.stringify(delegated.data));
  assert.equal(delegated.data.error.code, "DELEGATION_LIMIT");
  assert.equal(
    (
      await call(d, "POST", "/v1/admin/access/bindings", {
        principal_id: target.id,
        role_key: delegatedRole,
        scope_kind: "global",
        effect: "allow",
        limits: { max_daily_amount_micros: 150 },
        reason: "Bounded delegated daily limit",
      })
    ).status,
    200,
  );
});

test("independent fee approval requires the exact version/hash, two actual authorized actors and both permissions", async () => {
  const u = await user(),
    w = await personal(u),
    a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    security = await admin(undefined, "security_admin");
  const body = await gift(w.id, "10000000000"),
    pending = await submit(a, w.id, body);
  assert.equal(pending.data.state, "pending_approval");
  assert.equal((await current(w.id)).balance_micros, "0");
  assert.equal(
    (await decide(a, pending.data)).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  assert.equal((await decide(security, pending.data)).status, 403);
  assert.equal(
    (await decide(reviewer, pending.data, "approve", { expected_version: 9 }))
      .data.error.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (
      await decide(reviewer, pending.data, "approve", {
        payload_hash: "0".repeat(64),
      })
    ).data.error.code,
    "VERSION_CONFLICT",
  );
  const review = await call(
    reviewer,
    "GET",
    `/v1/admin/billing/operations/${pending.data.id}/review`,
  );
  assert.deepEqual(review.data.command, body);
  assert.equal(review.data.billing_account_id, w.id);
  schema("AdminApproval", review.data.approval);
  assert.notEqual(review.data.approval.id, pending.data.id);
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_approval_requests SET expires_at=now()+interval '1 year' WHERE id=$1",
      [review.data.approval.id],
    ),
    /immutable/,
  );
  const key = randomUUID(),
    applied = await decide(reviewer, pending.data, "approve", {}, key);
  assert.equal(applied.status, 202, JSON.stringify(applied.data));
  assert.equal(applied.data.state, "succeeded");
  assert.deepEqual(
    (await decide(reviewer, pending.data, "approve", {}, key)).data,
    applied.data,
  );
  const op = (
    await s.db.control.query("SELECT * FROM admin_operations WHERE id=$1", [
      pending.data.id,
    ])
  ).rows[0];
  assert.equal(op.principal_id, a.id);
  assert.equal(op.approved_by, reviewer.id);
  const recorded = (
    await s.db.control.query(
      "SELECT * FROM admin_approval_decisions WHERE approval_id=$1",
      [review.data.approval.id],
    )
  ).rows[0];
  assert.equal(recorded.reviewer_id, reviewer.id);
  assert.equal(recorded.payload_hash, pending.data.payload_hash);
  assert.equal(recorded.expected_version, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state,version FROM admin_approval_requests WHERE id=$1",
        [review.data.approval.id],
      )
    ).rows[0].state,
    "approved",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT actor_id FROM billing_journal WHERE operation_id=$1",
        [op.id],
      )
    ).rows[0].actor_id,
    a.id,
  );
  assert.equal((await current(w.id)).balance_micros, "10000000000");
});

test("approval fails closed after original session revocation, authority/target or policy changes; rejection remains possible", async () => {
  const reviewer = await admin(undefined, "super_admin");
  for (const change of ["session", "authority", "target", "policy"] as const) {
    const a = await admin(undefined, "super_admin"),
      w = await personal(await user()),
      pending = await submit(a, w.id, await gift(w.id, "10000000000"));
    assert.equal(pending.data.state, "pending_approval");
    if (change === "session")
      await s.db.control.query(
        "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
        [a.id],
      );
    if (change === "authority")
      await s.db.control.query(
        "DELETE FROM admin_bindings WHERE principal_id=$1",
        [a.id],
      );
    if (change === "target") await payment(w.id, "1", "gift");
    if (change === "policy") {
      await s.db.control.query(
        "UPDATE catalog_entries SET state='retired' WHERE kind='policy' AND key='admin-control' AND state='published'",
      );
      await s.db.control.query(
        "INSERT INTO catalog_entries(kind,key,version,state,body) VALUES('policy','admin-control',1,'published',$1)",
        [
          {
            approval_threshold_micros: "9999999999",
            fee_approval_window_minutes: 4,
          },
        ],
      );
    }
    const r = await decide(reviewer, pending.data);
    assert.ok([403, 409].includes(r.status), change + JSON.stringify(r.data));
    assert.equal(
      (await current(w.id)).balance_micros,
      change === "target" ? "1" : "0",
    );
    const rejected = await decide(reviewer, pending.data, "reject");
    assert.equal(rejected.status, 202, JSON.stringify(rejected.data));
    assert.equal(rejected.data.state, "cancelled");
  }
});

test("credit limits accept zero and exact integers beyond JS precision while preserving debt and holds", async () => {
  const u = await user(),
    w = await personal(u),
    a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin");
  const limit = async (n: string) => ({
    action: "credit_limit",
    expected_version: (await current(w.id)).version,
    reason: "Controlled credit limit change",
    new_limit: money(n),
  });
  const large = await submit(a, w.id, await limit("9007199254740993"));
  assert.equal(large.data.state, "pending_approval");
  assert.equal((await decide(reviewer, large.data)).status, 202);
  assert.equal((await current(w.id)).credit_limit_micros, "9007199254740993");
  assert.equal((await submit(a, w.id, await limit("0"))).status, 202);
  assert.equal((await current(w.id)).credit_limit_micros, "0");
  assert.equal(
    (
      await call(a, "POST", `${base}/${w.id}/previews`, {
        ...(await gift(w.id)),
        amount: money("0"),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(a, "POST", `${base}/${w.id}/previews`, {
        ...(await limit("0")),
        new_limit: money("9223372036854775808"),
      })
    ).status,
    400,
  );
  const tenant = await workspace(u);
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, w.id, "1000"),
    undefined,
    true,
  );
  const task = await manualTask(u, tenant, w.id, 700);
  assert.equal(
    (await preview(a, w.id, await limit("699"))).data.error.code,
    "CREDIT_RESERVED",
  );
  await s.db.tx(
    (tx) => settle(tx, tenant.tenant.id, task.id, 700, u.id),
    tenant.tenant.id,
    false,
    u.id,
  );
  assert.equal(
    (await preview(a, w.id, await limit("699"))).data.error.code,
    "CREDIT_RESERVED",
  );
});

test("financial intent is immutable at the database boundary and legacy paths cannot bypass canonical controls", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    tenant = await workspace(u),
    w = await personal(u),
    body = await gift(w.id, "10000000000");
  const pv = await preview(a, w.id, body),
    r = await submit(a, w.id, body, { preview: pv.data.preview_id });
  for (const [table, id] of [
    ["admin_operations", r.data.id],
    ["admin_previews", pv.data.preview_id],
  ]) {
    await assert.rejects(
      s.db.control.query(
        `UPDATE ${table} SET payload=payload||'{"changed":true}' WHERE id=$1`,
        [id],
      ),
      /immutable/,
    );
    await assert.rejects(
      s.db.control.query(`UPDATE ${table} SET id=$2 WHERE id=$1`, [
        id,
        randomUUID(),
      ]),
      /immutable/,
    );
    await assert.rejects(
      s.db.control.query(`DELETE FROM ${table} WHERE id=$1`, [id]),
      /immutable/,
    );
  }
  const legacy = {
    action: "billing.gift",
    tenant_id: tenant.tenant.id,
    amount_micros: 50,
    expires_at: body.expires_at,
    reason: body.reason,
  };
  assert.equal(
    (await call(a, "POST", "/v1/admin/operations/preview", legacy)).data.error
      .code,
    "CANONICAL_FINANCE_REQUIRED",
  );
  assert.equal(
    (
      await call(
        reviewer,
        "POST",
        `/v1/admin/operations/${r.data.id}/decision`,
        {
          decision: "approve",
          reason: "Old endpoint cannot bypass frozen hash",
        },
      )
    ).data.error.code,
    "CANONICAL_APPROVAL_REQUIRED",
  );
  assert.equal((await decide(reviewer, r.data, "reject")).status, 202);
});

test("scope denies cover personal/enterprise financial writes and operation reads; MFA is live", async () => {
  const u = await user(),
    t = await workspace(u),
    w = await personal(u),
    a = await admin(undefined, "super_admin"),
    r = await submit(a, w.id, await gift(w.id));
  await bind(
    a,
    ["admin.billing.gift", "admin.jobs.read"],
    "project",
    t.project.id,
    "deny",
  );
  assert.equal((await preview(a, w.id, await gift(w.id))).status, 403);
  assert.equal(
    (
      await preview(
        a,
        (await enterprise(t.tenant.id)).id,
        await gift((await enterprise(t.tenant.id)).id),
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(a, "GET", `/v1/admin/operations/${r.data.id}`)).status,
    403,
  );
  const jobs = await call(a, "GET", "/v1/admin/jobs");
  assert.equal(jobs.status, 200, JSON.stringify(jobs.data));
  assert.ok(!jobs.data.items.some((v: any) => v.id === r.data.id));
  const limited = await admin(t.tenant.id, "finance_admin");
  assert.equal((await preview(limited, w.id, await gift(w.id))).status, 403);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [limited.id],
  );
  const enterpriseAccount = await enterprise(t.tenant.id);
  assert.equal(
    (
      await preview(
        limited,
        enterpriseAccount.id,
        await gift(enterpriseAccount.id),
      )
    ).data.error.code,
    "MFA_REQUIRED",
  );
});

test("concurrent task reservation and financial write serialize without a foreign-key lock upgrade deadlock", async () => {
  const u = await user(),
    tenant = await workspace(u),
    w = await personal(u),
    a = await admin(undefined, "super_admin");
  await payment(w.id, "1000", "gift");
  const body = await gift(w.id),
    pv = await preview(a, w.id, body);
  const results = await Promise.all([
    manualTask(u, tenant, w.id, 100),
    submit(a, w.id, body, { preview: pv.data.preview_id }),
  ]);
  assert.ok(
    [202, 409].includes(results[1].status),
    JSON.stringify(results[1].data),
  );
  assert.equal((await current(w.id)).reserved_micros, "100");
  assert.equal(
    (await current(w.id)).balance_micros,
    results[1].status === 202 ? "1100" : "1000",
  );
});

test("audit failure rolls back the complete fee change and leaves its preview available for a safe retry", async () => {
  const a = await admin(undefined, "super_admin"),
    w = await personal(await user()),
    b = await gift(w.id),
    pv = await preview(a, w.id, b),
    key = randomUUID();
  const before = await current(w.id);
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION controlled_fee_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.billing.gift' THEN RAISE EXCEPTION 'Controlled audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER controlled_fee_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION controlled_fee_audit_failure()",
    );
    const r = await submit(a, w.id, b, { key, preview: pv.data.preview_id });
    assert.equal(r.status, 500);
    assert.deepEqual(await current(w.id), before);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM billing_journal WHERE billing_account_id=$1",
          [w.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT consumed_at FROM admin_previews WHERE id=$1",
          [pv.data.preview_id],
        )
      ).rows[0].consumed_at,
      null,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM admin_operations WHERE payload->>'billing_account_id'=$1",
          [w.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    try {
      await owner.query(
        "DROP TRIGGER IF EXISTS controlled_fee_audit ON audit_log",
      );
      await owner.query(
        "DROP FUNCTION IF EXISTS controlled_fee_audit_failure()",
      );
    } finally {
      await owner.end();
    }
  }
  assert.equal(
    (await submit(a, w.id, b, { key, preview: pv.data.preview_id })).status,
    202,
  );
  assert.equal((await current(w.id)).balance_micros, "100");
});

test("expired frozen review requests cannot be approved or rewritten; their actual rejection is immutable", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    w = await personal(await user()),
    pending = await submit(a, w.id, await gift(w.id, "10000000000"));
  const expired = (
    await s.db.control.query(
      "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) SELECT principal_id,action,tenant_id,payload_hash,jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)),$2,'pending_approval',policy_version_id,target_ids FROM admin_operations WHERE id=$1 RETURNING *",
      [pending.data.id, randomUUID()],
    )
  ).rows[0];
  const request = (
    await s.db.control.query(
      "INSERT INTO admin_approval_requests(operation_id,requester_id,payload_hash,policy_version_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        expired.id,
        a.id,
        expired.payload_hash,
        expired.policy_version_id,
        expired.payload.expires_at,
      ],
    )
  ).rows[0];
  const review = await call(
    reviewer,
    "GET",
    `/v1/admin/billing/operations/${expired.id}/review`,
  );
  schema("AdminApproval", review.data.approval);
  assert.equal(review.data.approval.state, "pending");
  assert.ok(Date.parse(review.data.approval.expires_at) < Date.now());
  assert.equal(
    (await decide(reviewer, expired)).data.error.code,
    "OPERATION_EXPIRED",
  );
  assert.equal(
    (await decide(reviewer, expired, "reject")).data.state,
    "cancelled",
  );
  assert.equal((await current(w.id)).balance_micros, "0");
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE admin_approval_decisions SET reason='Altered history' WHERE approval_id=$1",
        [request.id],
      ),
      /immutable/,
    );
    await assert.rejects(
      owner.query("DELETE FROM admin_approval_decisions WHERE approval_id=$1", [
        request.id,
      ]),
      /immutable/,
    );
  } finally {
    await owner.end();
  }
});

test("new gifts cannot overflow the account and daily credit increases cannot be reset by reducing the limit", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    w = await personal(await user());
  const largest = await submit(
    a,
    w.id,
    await gift(w.id, "9223372036854775807"),
  );
  assert.equal(largest.data.state, "pending_approval");
  assert.equal((await decide(reviewer, largest.data)).status, 202);
  assert.equal(
    (await preview(a, w.id, await gift(w.id, "1"))).data.error.code,
    "AMOUNT_RANGE",
  );
  const bounded = await admin(undefined, "finance_admin"),
    small = await personal(await user());
  await s.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [bounded.id, { max_amount_micros: 1000, max_daily_amount_micros: 100 }],
  );
  const limit = async (n: string) => ({
    action: "credit_limit",
    expected_version: (await current(small.id)).version,
    reason: "Controlled daily credit increases",
    new_limit: money(n),
  });
  assert.equal(
    (await submit(bounded, small.id, await limit("100"))).status,
    202,
  );
  assert.equal(
    (await submit(bounded, small.id, await limit("50"))).status,
    202,
  );
  assert.equal(
    (await preview(bounded, small.id, await limit("51"))).data.error.code,
    "DAILY_AMOUNT_LIMIT",
  );
  assert.equal((await submit(bounded, small.id, await limit("0"))).status, 202);
});
