import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-vip-schemas.json" with { type: "json" };
import combinedContract from "../contracts/admin-vip-credit-schemas.json" with { type: "json" };
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
  JSON.stringify({
    ...contract.schemas,
    ...combinedContract.schemas,
  }).replaceAll("#/components/schemas/", "#/$defs/"),
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
        console.error(
          "isolated combined-command database diagnostic",
          e.message,
          e.where,
        );
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
const combinations = "/v1/admin/vip-credit-combinations",
  combinedPreviews = "/v1/admin/vip-credit-previews";
async function combined(kind: "user" | "tenant" = "user", amount = "12500001") {
  const ws = await workspace(),
    subject = { kind, id: kind === "user" ? ws.u.id : ws.tenant };
  const wallet = (
    await s.db.control.query(
      `SELECT * FROM wallets WHERE ${kind === "user" ? "user_id" : "tenant_id"}=$1 AND data_mode='configured_services'`,
      [subject.id],
    )
  ).rows[0];
  return {
    ws,
    b: {
      billing_account_id: wallet.id,
      vip: await command(subject, await plan()),
      gift: {
        action: "gift",
        expected_version: wallet.version,
        reason: "Explicit welcome credit",
        amount: { currency: "HKD", amount_micros: amount },
        expires_at: future(86400000),
      },
    },
  };
}
async function preview(b: any, a = operator) {
  check("VipCreditCommand", b);
  const r = await call(a, "POST", combinedPreviews, b);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  check("AdminPreview", r.data);
  return r.data;
}
async function submit(b: any, p: any, a = operator, k = randomUUID()) {
  return call(a, "POST", combinations, b, {
    "x-admin-preview-id": p.preview_id,
    "idempotency-key": k,
  });
}
async function view(op: any, a = operator) {
  const r = await call(a, "GET", combinations + "/" + op.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  check("AdminOperation", r.data.operation);
  for (const c of r.data.children) check("AdminOperation", c.operation);
  return r.data;
}
async function balance(account: string) {
  return (
    await s.db.control.query(
      "SELECT balance_micros,version FROM wallets WHERE id=$1",
      [account],
    )
  ).rows[0];
}
async function assertEmpty(b: any) {
  assert.equal((await balance(b.billing_account_id)).balance_micros, "0");
  const r = (
    await s.db.control.query(
      "SELECT count(*)::int n FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE coalesce(s.tenant_id,s.user_id)=$1",
      [b.vip.subject.id],
    )
  ).rows[0];
  assert.equal(r.n, 0);
}
test("personal and workspace commands freeze two versions without business effects, then commit exact canonical children", async () => {
  for (const kind of ["user", "tenant"] as const) {
    const { b } = await combined(kind),
      p = await preview(b);
    assert.equal(p.expected_target_versions.length, 2);
    await assertEmpty(b);
    const r = await submit(b, p);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.equal(r.data.state, "succeeded");
    const d = await view(r.data);
    assert.equal(d.children.length, 2);
    assert.ok(d.children.every((c: any) => c.operation.state === "succeeded"));
    assert.equal(
      d.result.credit_reference,
      "admin:" + d.result.gift_operation_id,
    );
    assert.equal(
      (await balance(b.billing_account_id)).balance_micros,
      b.gift.amount.amount_micros,
    );
    const g = await call(operator, "GET", root + "/" + d.result.grant_id);
    assert.equal(g.status, 200);
    assert.equal(g.data.operation_id, d.result.vip_operation_id);
    assert.equal(g.data.actor_id, operator.id);
    const j = (
      await s.db.control.query(
        "SELECT * FROM billing_journal WHERE operation_id=$1",
        [d.result.gift_operation_id],
      )
    ).rows;
    assert.equal(j.length, 1);
    assert.equal(j[0].actor_id, operator.id);
    assert.equal(j[0].amount_micros, b.gift.amount.amount_micros);
  }
});
test("concurrent identical confirmation and later replay return the same parent and one gift reference", async () => {
  const { b } = await combined(),
    p = await preview(b),
    k = randomUUID();
  const results = await Promise.all([
    submit(b, p, operator, k),
    submit(b, p, operator, k),
  ]);
  assert.ok(
    results.every((r) => r.status === 202),
    JSON.stringify(results),
  );
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal((await submit(b, p, operator, k)).data.id, results[0].data.id);
  assert.equal((await view(results[0].data)).children.length, 2);
  assert.equal(
    (await balance(b.billing_account_id)).balance_micros,
    b.gift.amount.amount_micros,
  );
  const changed = structuredClone(b);
  changed.gift.amount.amount_micros = "2";
  assert.equal((await submit(changed, p, operator, k)).status, 409);
});
test("billing account must match the exact VIP subject, kind and current mode", async () => {
  const { b } = await combined(),
    other = await combined();
  for (const account of [
    other.b.billing_account_id,
    (
      await s.db.control.query(
        "SELECT id FROM wallets WHERE tenant_id=$1 AND data_mode='configured_services'",
        [(await workspace()).tenant],
      )
    ).rows[0].id,
  ]) {
    const wrong = { ...b, billing_account_id: account };
    assert.equal(
      (await call(operator, "POST", combinedPreviews, wrong)).status,
      404,
    );
  }
  const simulated = (
    await s.db.control.query(
      "SELECT id FROM wallets WHERE user_id=$1 AND data_mode='simulated'",
      [b.vip.subject.id],
    )
  ).rows[0];
  assert.equal(
    (
      await call(operator, "POST", combinedPreviews, {
        ...b,
        billing_account_id: simulated.id,
      })
    ).status,
    404,
  );
  await assertEmpty(b);
});
test("VIP-only, finance-only and project-scoped admins cannot create or read combined facts", async () => {
  const { b, ws } = await combined(),
    op = await submit(b, await preview(b));
  for (const options of [
    {
      permissions: [
        "admin.entitlements.read",
        "admin.entitlements.grant",
        "admin.jobs.read",
        "admin.approvals.read",
      ],
    },
    {
      permissions: [
        "admin.billing.read",
        "admin.billing.gift",
        "admin.jobs.read",
        "admin.approvals.read",
      ],
    },
    { scope: "project" as const, id: ws.project },
  ]) {
    const a = await administrator(options);
    assert.equal((await call(a, "POST", combinedPreviews, b)).status, 403);
    assert.equal(
      (await call(a, "GET", combinations + "/" + op.data.id)).status,
      403,
    );
    assert.equal(
      (await call(a, "GET", "/v1/admin/operations/" + op.data.id)).status,
      403,
    );
  }
});
test("either policy requests one independent approval; requester and partial reviewers cannot approve", async () => {
  for (const cause of ["amount", "interval"]) {
    const { b } = await combined(
      "tenant",
      cause === "amount" ? "10000000000" : "123",
    );
    if (cause === "interval") b.vip.ends_at = future(32 * 86400000);
    const p = await preview(b);
    assert.equal(p.decision, "independent_approval");
    const r = await submit(b, p);
    assert.equal(r.data.state, "pending_approval", JSON.stringify(r.data));
    await assertEmpty(b);
    assert.equal((await view(r.data)).children.length, 0);
    assert.equal((await approve(r.data, operator)).status, 403);
    const a = await administrator({
      permissions: [
        "admin.approvals.read",
        "admin.approvals.decide",
        "admin.entitlements.read",
        "admin.entitlements.grant",
        "admin.billing.read",
      ],
    });
    assert.equal((await approve(r.data, a)).status, 403);
    const approved = await approve(r.data);
    assert.equal(approved.status, 202, JSON.stringify(approved.data));
    assert.equal(approved.data.state, "succeeded");
    const d = await view(approved.data);
    assert.equal(d.children.length, 2);
    const rows = (
      await s.db.control.query(
        "SELECT principal_id,approved_by FROM admin_operations WHERE id=ANY($1::uuid[])",
        [d.children.map((c: any) => c.operation.id)],
      )
    ).rows;
    assert.ok(
      rows.every(
        (x: any) =>
          x.principal_id === operator.id && x.approved_by === reviewer.id,
      ),
    );
  }
});
test("shared approval lists do not leak combined requests to a reader of only one domain", async () => {
  const { b } = await combined("user", "10000000000"),
    pending = await submit(b, await preview(b));
  const approval = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${pending.data.id}/approval`,
  );
  for (const read of ["admin.entitlements.read", "admin.billing.read"]) {
    const a = await administrator({
      permissions: ["admin.approvals.read", read],
    });
    const list = await call(a, "GET", "/v1/admin/approvals?limit=100");
    assert.equal(list.status, 200);
    assert.ok(!list.data.items.some((x: any) => x.id === approval.data.id));
    assert.equal(
      (await call(a, "GET", `/v1/admin/approvals/${approval.data.id}/review`))
        .status,
      403,
    );
    assert.equal(
      (await call(a, "GET", `/v1/admin/operations/${pending.data.id}/approval`))
        .status,
      403,
    );
  }
});
test("version and payload changes after preview commit neither effect", async () => {
  for (const change of ["body", "wallet", "subject"]) {
    const { b } = await combined(),
      p = await preview(b);
    if (change === "body") b.gift.reason = "Changed confirmed intent";
    if (change === "wallet")
      await s.db.control.query(
        "UPDATE wallets SET version=version+1 WHERE id=$1",
        [b.billing_account_id],
      );
    if (change === "subject") b.vip.expected_subject_version++;
    assert.equal((await submit(b, p)).status, 409);
    await assertEmpty(b);
  }
});
test("original session, rights, billing facts and policy are rechecked on independent approval", async () => {
  for (const change of ["session", "authority", "wallet", "policy"]) {
    const a = await administrator(),
      { b } = await combined("user", "10000000000"),
      pending = await submit(b, await preview(b, a), a);
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
    if (change === "wallet")
      await s.db.control.query(
        "UPDATE wallets SET version=version+1 WHERE id=$1",
        [b.billing_account_id],
      );
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
    const r = await approve(pending.data);
    assert.ok(
      [401, 403, 409].includes(r.status),
      change + JSON.stringify(r.data),
    );
    await assertEmpty(b);
    const rejected = await approve(pending.data, reviewer, "reject");
    assert.equal(rejected.status, 202, JSON.stringify(rejected.data));
    assert.equal(rejected.data.state, "cancelled");
  }
});
test("per-command amount, VIP duration and daily gift caps also apply to combined children", async () => {
  const a = await administrator();
  await s.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [
      a.id,
      {
        max_amount_micros: 100,
        max_daily_amount_micros: 150,
        max_duration_hours: 2,
      },
    ],
  );
  const first = await combined("user", "100");
  const done = await submit(first.b, await preview(first.b, a), a);
  assert.equal(done.data.state, "succeeded", JSON.stringify(done.data));
  const second = await combined("user", "51");
  const daily = await call(a, "POST", combinedPreviews, second.b);
  assert.equal(daily.status, 403);
  assert.equal(daily.data.error.code, "DAILY_AMOUNT_LIMIT");
  second.b.gift.amount.amount_micros = "101";
  assert.equal((await call(a, "POST", combinedPreviews, second.b)).status, 403);
  second.b.gift.amount.amount_micros = "1";
  second.b.vip.ends_at = future(10800000);
  assert.equal((await call(a, "POST", combinedPreviews, second.b)).status, 403);
  await assertEmpty(second.b);
});
test("gift audit failure after VIP writes rolls back both projections, children, link and preview consumption", async () => {
  const { b } = await combined(),
    p = await preview(b),
    k = randomUUID(),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION vip_credit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.billing.gift' THEN RAISE EXCEPTION 'controlled second-child failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER vip_credit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION vip_credit_fault()",
    );
    assert.equal((await submit(b, p, operator, k)).status, 500);
    await assertEmpty(b);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT consumed_at FROM admin_previews WHERE id=$1",
          [p.preview_id],
        )
      ).rows[0].consumed_at,
      null,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int n FROM admin_operations WHERE payload->>'billing_account_id'=$1",
          [b.billing_account_id],
        )
      ).rows[0].n,
      0,
    );
    await owner.query("DROP TRIGGER vip_credit_fault ON audit_log");
    const retry = await submit(b, p, operator, k);
    assert.equal(retry.status, 202, JSON.stringify(retry.data));
    assert.equal(retry.data.state, "succeeded");
  } finally {
    await owner.query("DROP TRIGGER IF EXISTS vip_credit_fault ON audit_log");
    await owner.query("DROP FUNCTION IF EXISTS vip_credit_fault()");
    await owner.end();
  }
});
test("rejected combination has no child operations, credit or entitlements", async () => {
  const { b } = await combined("user", "10000000000"),
    r = await submit(b, await preview(b));
  const rejected = await approve(r.data, reviewer, "reject");
  assert.equal(rejected.data.state, "cancelled");
  await assertEmpty(b);
  assert.equal((await view(r.data)).children.length, 0);
});
test("database guards reject parent-only success, detached children, marker removal and mutable links", async () => {
  const { b } = await combined("user", "10000000000"),
    pending = await submit(b, await preview(b));
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_operations SET state='succeeded' WHERE id=$1",
      [pending.data.id],
    ),
    (e: any) => e.code === "23514",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_operations SET payload=payload-'vip_credit_command_version' WHERE id=$1",
      [pending.data.id],
    ),
  );
  const approved = await approve(pending.data);
  assert.equal(approved.status, 202, JSON.stringify(approved.data));
  const d = await view(approved.data);
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_vip_credit_combinations SET credit_journal_id=gen_random_uuid() WHERE parent_operation_id=$1",
      [pending.data.id],
    ),
  );
  await assert.rejects(
    s.db.control.query(
      "DELETE FROM admin_vip_credit_combinations WHERE parent_operation_id=$1",
      [pending.data.id],
    ),
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE admin_operations SET state='cancelled' WHERE id=$1",
      [d.result.gift_operation_id],
    ),
  );
  await assert.rejects(
    s.db.control.query("UPDATE admin_operations SET result='{}' WHERE id=$1", [
      pending.data.id,
    ]),
  );
  await assert.rejects(
    s.db.control.query(
      "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) SELECT principal_id,action,tenant_id,payload_hash,payload,gen_random_uuid()::text,'succeeded',policy_version_id,target_ids FROM admin_operations WHERE id=$1",
      [d.result.gift_operation_id],
    ),
    (e: any) => e.code === "23514",
  );
});
test("later VIP suspension preserves the explicit gift and its historical parent link", async () => {
  const { b } = await combined(),
    done = await submit(b, await preview(b)),
    d = await view(done.data);
  const reason = {
    expected_version: 1,
    reason: "Suspend access without altering explicit credit",
  };
  const p = await call(
    operator,
    "POST",
    `${root}/${d.result.grant_id}/suspensions/previews`,
    reason,
  );
  const suspended = await call(
    operator,
    "POST",
    `${root}/${d.result.grant_id}/suspensions`,
    reason,
    { "x-admin-preview-id": p.data.preview_id },
  );
  assert.equal(suspended.status, 202, JSON.stringify(suspended.data));
  assert.equal(
    (await balance(b.billing_account_id)).balance_micros,
    b.gift.amount.amount_micros,
  );
  assert.equal(
    (await view(done.data)).result.credit_reference,
    d.result.credit_reference,
  );
});
test("expired gift input and unknown fields fail before creating effects", async () => {
  const { b } = await combined();
  b.gift.expires_at = future(-1000);
  assert.equal((await call(operator, "POST", combinedPreviews, b)).status, 400);
  assert.equal(
    (
      await call(operator, "POST", combinedPreviews, {
        ...b,
        automatic_credit: true,
      })
    ).status,
    400,
  );
  await assertEmpty(b);
});

test("same-plan renewal keeps the original grant while each explicit gift has one new parent-bound reference", async () => {
  const { b } = await combined(),
    first = await submit(b, await preview(b)),
    original = await view(first.data);
  const next = structuredClone(b),
    w = await balance(b.billing_account_id);
  next.vip.expected_subject_version = 2;
  next.vip.overlap_policy = "extend_same_plan";
  next.vip.ends_at = future(7200000);
  next.gift.expected_version = w.version;
  const renewed = await submit(next, await preview(next));
  assert.equal(renewed.status, 202, JSON.stringify(renewed.data));
  const latest = await view(renewed.data);
  assert.equal(latest.result.grant_id, original.result.grant_id);
  assert.notEqual(
    latest.result.credit_reference,
    original.result.credit_reference,
  );
  assert.equal(
    (await balance(b.billing_account_id)).balance_micros,
    (BigInt(b.gift.amount.amount_micros) * 2n).toString(),
  );
});

test("overlapping explicit project denies and revoked gift access block replay and approval visibility", async () => {
  const { b, ws } = await combined("tenant", "10000000000"),
    a = await administrator(),
    p = await preview(b, a),
    pending = await submit(b, p, a),
    k = randomUUID();
  const deny = "combined-deny-" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [deny, JSON.stringify(["admin.billing.read", "admin.billing.gift"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [a.id, deny, ws.project],
  );
  assert.equal((await submit(b, p, a, k)).status, 403);
  assert.equal(
    (await call(a, "GET", combinedPreviews + "/" + p.preview_id)).status,
    403,
  );
  const request = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${pending.data.id}/approval`,
  );
  const list = await call(a, "GET", "/v1/admin/approvals?limit=100");
  assert.equal(list.status, 200);
  assert.ok(!list.data.items.some((x: any) => x.id === request.data.id));
  assert.equal((await approve(pending.data)).status, 403);
  await assertEmpty(b);
});

test("a lost second-child effect during approval leaves the parent pending and the decision unrecorded", async () => {
  const { b } = await combined("user", "10000000000"),
    pending = await submit(b, await preview(b)),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION combination_link_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled final link failure'; END $$",
    );
    await owner.query(
      "CREATE TRIGGER combination_link_fault BEFORE INSERT ON admin_vip_credit_combinations FOR EACH ROW EXECUTE FUNCTION combination_link_fault()",
    );
    const failed = await approve(pending.data);
    assert.equal(failed.status, 500);
    await assertEmpty(b);
    const d = await view(pending.data);
    assert.equal(d.operation.state, "pending_approval");
    assert.equal(d.children.length, 0);
    const decisions = (
      await s.db.control.query(
        "SELECT count(*)::int n FROM admin_approval_decisions d JOIN admin_approval_requests r ON r.id=d.approval_id WHERE r.operation_id=$1",
        [pending.data.id],
      )
    ).rows[0].n;
    assert.equal(decisions, 0);
    await owner.query(
      "DROP TRIGGER combination_link_fault ON admin_vip_credit_combinations",
    );
    const retried = await approve(pending.data);
    assert.equal(retried.status, 202, JSON.stringify(retried.data));
    assert.equal(retried.data.state, "succeeded");
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS combination_link_fault ON admin_vip_credit_combinations",
    );
    await owner.query("DROP FUNCTION IF EXISTS combination_link_fault()");
    await owner.end();
  }
});

test("current MFA and gift authority are checked before successful replay can reveal a combined result", async () => {
  const a = await administrator(),
    { b } = await combined(),
    p = await preview(b, a),
    k = randomUUID();
  const done = await submit(b, p, a, k);
  assert.equal(done.data.state, "succeeded");
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal((await submit(b, p, a, k)).status, 403);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now() WHERE admin_id=$1",
    [a.id],
  );
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    a.id,
  ]);
  assert.equal((await submit(b, p, a, k)).status, 403);
  assert.equal(
    (await balance(b.billing_account_id)).balance_micros,
    b.gift.amount.amount_micros,
  );
});

test("the supplement composes original schemas without changing the normative OpenAPI", async () => {
  const bytes = await readFile("../../docs/contracts/openapi.json"),
    original = JSON.parse(bytes.toString());
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    combinedContract.normative_source_sha256,
  );
  assert.equal(
    combinedContract.normative_source_sha256,
    contract.normative_source_sha256,
  );
  for (const [name, definition] of Object.entries(combinedContract.schemas))
    if (name !== "VipCreditCommand")
      assert.deepEqual(definition, original.components.schemas[name]);
  assert.deepEqual(
    await readFile("contracts/admin-vip-credit-schemas.json"),
    await readFile("../../docs/contracts/admin-vip-credit-schemas.json"),
  );
});
