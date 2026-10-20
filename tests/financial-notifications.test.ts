import { after, before, test } from "node:test";
import { dispatchFinancialNotifications } from "../src/financial-notifications.js";
import { runMigrations } from "../scripts/migration-runner.js";
import financialContract from "../contracts/financial-notification-schemas.json" with { type: "json" };
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import paymentContract from "../contracts/admin-payment-schemas.json" with { type: "json" };
import refundContract from "../contracts/admin-refund-schemas.json" with { type: "json" };
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
  JSON.stringify({
    ...contract.schemas,
    ...financialContract.schemas,
    ...paymentContract.schemas,
    ...refundContract.schemas,
  }).replaceAll("#/components/schemas/", "#/$defs/"),
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
  const data = raw.json();
  if (raw.statusCode === 200 && url.startsWith("/v1/financial-notifications"))
    schema(
      method === "PATCH" ? "FinancialReadReceipt" : "FinancialNotificationList",
      data,
    );
  if (raw.statusCode === 200 && url.startsWith("/v1/admin/billing/refunds"))
    schema(
      url.split("?")[0] === "/v1/admin/billing/refunds"
        ? "AdminRefundList"
        : "AdminRefundDetail",
      data,
    );
  if (raw.statusCode === 202 && url.startsWith("/v1/admin/billing/refunds"))
    schema("AdminOperation", data);
  return { status: raw.statusCode, data, raw };
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
async function consumed(
  u: Client,
  workspace: any,
  account: any,
  amount: number,
) {
  const task = await manualTask(u, workspace, account.id, amount);
  await s.db.tx(
    (tx) => settle(tx, workspace.tenant.id, task.id, amount, u.id),
    workspace.tenant.id,
    false,
    u.id,
  );
  return (
    await s.db.control.query(
      "SELECT * FROM billing_journal WHERE task_id=$1 AND kind='consume'",
      [task.id],
    )
  ).rows[0];
}
async function refundBody(
  account: string,
  entry: string,
  amount: string,
  destination = "paid_balance",
) {
  const body = {
    action: "refund",
    expected_version: (await current(account)).version,
    reason: "Controlled original-source refund",
    amount: money(amount),
    original_entry_id: entry,
    destination,
  };
  schema("AdminFeeRefund", body);
  return body;
}
async function cashRefundFixture(
  a: Client,
  reviewer: Client,
  owner: Client,
  original = "101",
  amount = "60",
) {
  const account = await personal(owner),
    r = await receipt(a, account, owner, original);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal((await confirmReceipt(reviewer, r)).status, 202);
  assert.equal(
    (await submit(a, account.id, await topup(account, r.payment, original)))
      .status,
    202,
  );
  const entry = (
    await s.db.control.query(
      "SELECT * FROM billing_journal WHERE payment_record_id=$1",
      [r.payment],
    )
  ).rows[0];
  const posted = await submit(
    a,
    account.id,
    await refundBody(account.id, entry.id, amount, "payment_method"),
  );
  assert.equal(posted.status, 202, JSON.stringify(posted.data));
  const refund = (
    await s.db.control.query(
      "SELECT * FROM billing_refunds WHERE operation_id=$1",
      [posted.data.id],
    )
  ).rows[0];
  return { account, payment: r.payment, entry, refund, operation: posted.data };
}
async function refundEvidence(owner: Client, account: any) {
  const ws = await workspace(owner),
    bytes = Buffer.from(
      "Controlled cash refund outcome; no money transferred " + randomUUID(),
    ),
    key = await s.storage.put(bytes, "text/plain");
  const asset = (
    await s.db.control.query(
      "INSERT INTO assets(tenant_id,project_id,name,kind,created_by,private_owner) VALUES($1,$2,'Controlled refund evidence','document',$3,$4) RETURNING id",
      [ws.tenant.id, ws.project.id, owner.id, account.user_id],
    )
  ).rows[0];
  return (
    await s.db.control.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,'text/plain',$4,$5) RETURNING id",
      [ws.tenant.id, asset.id, key, bytes.length, hash(bytes)],
    )
  ).rows[0].id;
}
const refundOutcomeBody = (
  version: number,
  outcome: string,
  amount: string | null = null,
  evidence: string | null = null,
  reference: string | null = null,
) => ({
  expected_version: version,
  reason: "Independent controlled cash outcome review",
  outcome,
  observed_amount: amount === null ? null : money(amount),
  evidence_asset_version_id: evidence,
  external_reference: reference,
  occurred_at: evidence ? new Date(Date.now() - 1000).toISOString() : null,
});
const observeRefund = (actor: Client, id: string, body: any, key?: string) =>
  call(actor, "POST", `/v1/admin/billing/refunds/${id}/outcomes`, body, {
    key,
  });
const base = "/v1/admin/billing/accounts";
async function receipt(
  a: Client,
  w: any,
  u: Client,
  amount = "101",
  options: any = {},
) {
  const ws = await workspace(u),
    bytes = Buffer.from(
      "Controlled bank receipt; not a real payment " + randomUUID(),
    );
  const key = await s.storage.put(bytes, "text/plain");
  const asset = (
    await s.db.control.query(
      "INSERT INTO assets(tenant_id,project_id,name,kind,created_by,private_owner) VALUES($1,$2,'Controlled receipt','document',$3,$4) RETURNING id",
      [ws.tenant.id, ws.project.id, u.id, w.user_id ?? null],
    )
  ).rows[0];
  const version = (
    await s.db.control.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,'text/plain',$4,$5) RETURNING id",
      [ws.tenant.id, asset.id, key, bytes.length, hash(bytes)],
    )
  ).rows[0];
  const body = {
    billing_account_id: w.id,
    external_reference: "bank-" + randomUUID(),
    amount: money(amount),
    received_at: new Date(Date.now() - 1000).toISOString(),
    evidence_asset_version_id: version.id,
    reason: "Controlled evidence; no actual money received",
    ...options,
  };
  const r = await call(a, "POST", "/v1/admin/billing/payments", body);
  return {
    ...r,
    body,
    asset: asset.id,
    version: version.id,
    payment: r.data.result_ids?.[0],
  };
}
async function confirmReceipt(a: Client, r: any, options: any = {}) {
  return call(
    a,
    "POST",
    `/v1/admin/billing/payments/${r.payment}/confirmations`,
    {
      expected_version: 1,
      verified_reference: r.body.external_reference,
      reason: "Independently checked controlled receipt",
      ...options,
    },
  );
}
async function topup(w: any, payment_record_id: string, amount = "101") {
  return {
    action: "top_up",
    expected_version: (await current(w.id)).version,
    amount: money(amount),
    payment_record_id,
    reason: "Post a verified controlled payment",
  };
}

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
  b.action === "credit_limit"
    ? "credit-limit"
    : b.action === "top_up"
      ? "top-up"
      : b.action;
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

async function notices(c: Client, tenant: string, query = "category=all") {
  const r = await call(
    c,
    "GET",
    "/v1/financial-notifications?" + query,
    undefined,
    { headers: { "x-tenant-id": tenant } },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function marks(
  c: Client,
  tenant: string,
  id: string,
  read = true,
  k = randomUUID(),
) {
  return call(
    c,
    "PATCH",
    "/v1/financial-notifications/" + id,
    { read },
    { key: k, headers: { "x-tenant-id": tenant } },
  );
}
async function ownerSQL<T>(run: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await c.connect();
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

test("canonical gifts commit one durable financial intent, preserve exact money and never notify a preview or an idempotent replay twice", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u),
    a = await admin(undefined, "super_admin"),
    body = await gift(account.id, "12500001"),
    k = randomUUID();
  const pv = await preview(a, account.id, body);
  assert.equal(pv.status, 200);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM financial_outbox WHERE billing_account_id=$1",
        [account.id],
      )
    ).rows[0].n,
    0,
  );
  const result = await submit(a, account.id, body, {
    preview: pv.data.preview_id,
    key: k,
  });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  assert.equal(result.data.state, "succeeded");
  const duplicate = await submit(a, account.id, body, {
    preview: pv.data.preview_id,
    key: k,
  });
  assert.equal(duplicate.data.id, result.data.id);
  assert.equal((await notices(u, w.tenant.id)).items.length, 0);
  await Promise.all([
    dispatchFinancialNotifications(s.db),
    dispatchFinancialNotifications(s.db),
  ]);
  const inbox = await notices(u, w.tenant.id),
    notice = inbox.items[0];
  assert.equal(inbox.items.length, 1);
  assert.equal(notice.event_type, "billing.gift");
  assert.deepEqual(notice.amount, money("12500001"));
  assert.equal(notice.operation_id, result.data.id);
  assert.equal(notice.subject.id, u.id);
  assert.equal(notice.direction, "credit");
  assert.equal(notice.bucket, "promotional");
  const source = (
    await s.db.control.query("SELECT * FROM billing_journal WHERE id=$1", [
      notice.source_id,
    ])
  ).rows[0];
  assert.equal(source.amount_micros, "12500001");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM financial_outbox WHERE billing_account_id=$1",
        [account.id],
      )
    ).rows[0].n,
    1,
  );
  await dispatchFinancialNotifications(s.db);
  assert.equal((await notices(u, w.tenant.id)).items.length, 1);
});

test("a high-value gift remains silent while pending and rejected, while independent approval emits only the real committed gift", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u),
    a = await admin(undefined, "super_admin"),
    other = await admin(undefined, "super_admin");
  const pending = await submit(
    a,
    account.id,
    await gift(account.id, "10000000001"),
  );
  assert.equal(pending.status, 202, JSON.stringify(pending.data));
  assert.equal(pending.data.state, "pending_approval");
  await dispatchFinancialNotifications(s.db);
  assert.equal((await notices(u, w.tenant.id)).items.length, 0);
  assert.equal((await decide(other, pending.data, "reject")).status, 202);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM financial_outbox WHERE billing_account_id=$1",
        [account.id],
      )
    ).rows[0].n,
    0,
  );
  const next = await submit(
    a,
    account.id,
    await gift(account.id, "10000000001"),
  );
  assert.equal((await decide(other, next.data)).status, 202);
  await dispatchFinancialNotifications(s.db);
  const inbox = await notices(u, w.tenant.id);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].operation_id, next.data.id);
});

test("payment recording and confirmation remain neutral; posting, refund commitments, unknown outcomes and partial payouts retain their distinct source facts", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await workspace(u),
    f = await cashRefundFixture(a, reviewer, u),
    evidence = await refundEvidence(u, f.account);
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(1, "unknown"),
      )
    ).status,
    202,
  );
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(
          2,
          "paid",
          "20",
          evidence,
          "notice-payout-" + randomUUID(),
        ),
      )
    ).status,
    202,
  );
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(
          3,
          "not_paid",
          "0",
          evidence,
          "notice-declined-" + randomUUID(),
        ),
      )
    ).status,
    202,
  );
  await dispatchFinancialNotifications(s.db);
  const list = (await notices(u, w.tenant.id)).items;
  for (const kind of [
    "payment.recorded",
    "payment.confirmed",
    "billing.top_up",
    "refund.requested",
    "refund.unknown",
    "refund.paid",
    "refund.not_paid",
    "billing.refund",
    "billing.reserve",
    "billing.release",
  ])
    assert.ok(
      list.some((n: any) => n.event_type === kind),
      kind,
    );
  const unknown = list.find((n: any) => n.event_type === "refund.unknown");
  assert.equal(unknown.amount, null);
  assert.deepEqual(unknown.requested_amount, money("60"));
  for (const kind of [
    "payment.recorded",
    "payment.confirmed",
    "refund.requested",
    "refund.unknown",
    "refund.paid",
    "refund.not_paid",
  ])
    assert.equal(
      list.find((n: any) => n.event_type === kind).direction,
      "neutral",
    );
  assert.deepEqual(
    list.find((n: any) => n.event_type === "refund.paid").amount,
    money("20"),
  );
  assert.equal((await current(f.account.id)).balance_micros, "81");
  assert.equal((await current(f.account.id)).reserved_micros, "0");
  const serialized = JSON.stringify(list);
  for (const forbidden of [
    "evidence_sha256",
    "evidence_asset_version_id",
    "external_reference",
    "verified_by",
    "reason",
    "Controlled cash refund",
  ])
    assert.ok(!serialized.includes(forbidden), forbidden);
});

test("mismatched external evidence remains an observation without turning its amount into a successful payment", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await workspace(u),
    f = await cashRefundFixture(a, reviewer, u),
    evidence = await refundEvidence(u, f.account);
  const observed = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(
      1,
      "paid",
      "61",
      evidence,
      "notice-mismatch-" + randomUUID(),
    ),
  );
  assert.equal(observed.status, 202, JSON.stringify(observed.data));
  await dispatchFinancialNotifications(s.db);
  const notice = (await notices(u, w.tenant.id)).items.find(
    (n: any) => n.event_type === "refund.mismatch",
  );
  assert.deepEqual(notice.amount, money("61"));
  assert.equal(notice.direction, "neutral");
  assert.deepEqual(notice.requested_amount, money("60"));
  assert.equal((await current(f.account.id)).balance_micros, "101");
  assert.equal((await current(f.account.id)).reserved_micros, "60");
});

test("real reservations, settlement, original-source compensation, gift expiry and zero credit limits all retain truthful journal semantics", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u),
    a = await admin(undefined, "super_admin");
  await payment(account.id, "200", "gift");
  const entry = await consumed(u, w, account, 40);
  const cancelled = await manualTask(u, w, account.id, 10);
  await s.db.tx(
    (tx) => settle(tx, w.tenant.id, cancelled.id, 0, u.id),
    w.tenant.id,
    false,
    u.id,
  );
  assert.equal(
    (await submit(a, account.id, await refundBody(account.id, entry.id, "20")))
      .status,
    202,
  );
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, account.id, "0"),
    undefined,
    true,
  );
  await s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: account.id,
          action: "gift",
          amount_micros: "3",
          reason: "Controlled already expired financial source",
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
  await s.db.tx((tx) => billingAccount(tx, account.id), undefined, true);
  await dispatchFinancialNotifications(s.db);
  const list = (await notices(u, w.tenant.id)).items;
  for (const kind of [
    "billing.reserve",
    "billing.consume",
    "billing.release",
    "billing.compensation",
    "billing.gift_expiry",
    "billing.credit_limit",
  ])
    assert.ok(
      list.some((n: any) => n.event_type === kind),
      kind,
    );
  const zero = list.find((n: any) => n.event_type === "billing.credit_limit");
  assert.deepEqual(zero.amount, money("0"));
  assert.equal(zero.direction, "neutral");
  const updates = (await notices(u, w.tenant.id, "category=account_updates"))
    .items;
  assert.ok(
    updates.every(
      (n: any) =>
        !["billing.reserve", "billing.consume", "billing.release"].includes(
          n.event_type,
        ),
    ),
  );
  assert.ok(updates.some((n: any) => n.event_type === "billing.gift_expiry"));
});

test("ordinary members see only their own funds; current workspace owners and admins receive enterprise events and demotion blocks old reads and receipt replay", async () => {
  const u = await user(),
    member = await user(),
    manager = await user(),
    w = await workspace(u),
    account = await enterprise(w.tenant.id),
    mine = await personal(member);
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'admin')",
    [w.tenant.id, member.id, manager.id],
  );
  await payment(account.id, "61", "gift");
  await payment(mine.id, "17", "gift");
  await dispatchFinancialNotifications(s.db);
  const owner = (await notices(u, w.tenant.id)).items[0],
    ownerAdmin = (await notices(manager, w.tenant.id)).items[0],
    ordinary = (await notices(member, w.tenant.id)).items;
  assert.equal(owner.billing_account_id, account.id);
  assert.equal(ownerAdmin.billing_account_id, account.id);
  assert.equal(ordinary.length, 1);
  assert.equal(ordinary[0].billing_account_id, mine.id);
  assert.equal((await marks(member, w.tenant.id, owner.id)).status, 404);
  const k = randomUUID();
  assert.equal(
    (await marks(manager, w.tenant.id, ownerAdmin.id, true, k)).status,
    200,
  );
  await s.db.control.query(
    "UPDATE memberships SET role='member',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant.id, manager.id],
  );
  assert.equal((await notices(manager, w.tenant.id)).items.length, 0);
  assert.equal(
    (await marks(manager, w.tenant.id, ownerAdmin.id, true, k)).status,
    404,
  );
  const hidden = await call(
    member,
    "GET",
    "/v1/financial-notifications?account_id=" + account.id,
    undefined,
    { headers: { "x-tenant-id": w.tenant.id } },
  );
  assert.equal(hidden.status, 404);
});

test("personal, tenant, user and execution-mode boundaries cannot be crossed with a notification UUID or account filter", async () => {
  const u = await user(),
    other = await user(),
    w = await workspace(u),
    second = await workspace(other),
    mine = await personal(u),
    simulated = await personal(u, "simulated");
  await payment(mine.id, "10", "gift");
  await payment(simulated.id, "20", "gift");
  await dispatchFinancialNotifications(s.db);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM financial_outbox WHERE billing_account_id=$1 AND dispatched_at IS NULL",
        [simulated.id],
      )
    ).rows[0].n,
    1,
  );
  s.db.config.DEMO_MODE = true;
  try {
    await dispatchFinancialNotifications(s.db);
  } finally {
    s.db.config.DEMO_MODE = false;
  }
  const mineNotice = (await notices(u, w.tenant.id)).items[0];
  assert.equal(mineNotice.amount.amount_micros, "10");
  assert.equal((await notices(other, second.tenant.id)).items.length, 0);
  assert.equal(
    (await marks(other, second.tenant.id, mineNotice.id)).status,
    404,
  );
  for (const id of [mine.id, simulated.id, randomUUID()]) {
    const result = await call(
      other,
      "GET",
      "/v1/financial-notifications?account_id=" + id,
      undefined,
      { headers: { "x-tenant-id": second.tenant.id } },
    );
    assert.equal(result.status, 404);
  }
  const simulatedId = (
    await s.db.control.query(
      `SELECT n.id FROM financial_notifications n JOIN financial_outbox o ON o.id=n.outbox_id WHERE o.billing_account_id=$1`,
      [simulated.id],
    )
  ).rows[0].id;
  assert.equal((await marks(u, w.tenant.id, simulatedId)).status, 404);
});

test("signed keyset cursors preserve every row, bind filters and session authority, reject tampering and exclude normally later deliveries", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  for (let i = 0; i < 7; i++) await payment(account.id, String(i + 1), "gift");
  await dispatchFinancialNotifications(s.db);
  const first = await notices(u, w.tenant.id, "category=all&limit=2"),
    ids = first.items.map((n: any) => n.id);
  assert.ok(first.next_cursor && first.next_cursor.includes("."));
  await payment(account.id, "99", "gift");
  await dispatchFinancialNotifications(s.db);
  let cursor = first.next_cursor;
  while (cursor) {
    const page = await notices(
      u,
      w.tenant.id,
      "category=all&limit=2&cursor=" + encodeURIComponent(cursor),
    );
    ids.push(...page.items.map((n: any) => n.id));
    cursor = page.next_cursor;
  }
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids).size, 7);
  const query = (suffix: string) =>
    call(u, "GET", "/v1/financial-notifications?" + suffix, undefined, {
      headers: { "x-tenant-id": w.tenant.id },
    });
  const encoded = encodeURIComponent(first.next_cursor);
  assert.equal((await query("cursor=" + encoded)).status, 410);
  assert.equal(
    (await query("category=all&unread=true&cursor=" + encoded)).status,
    410,
  );
  assert.equal(
    (
      await query(
        "category=all&account_id=" + account.id + "&cursor=" + encoded,
      )
    ).status,
    410,
  );
  assert.equal(
    (await query("category=all&cursor=" + encoded.slice(0, -8) + "tampered"))
      .status,
    410,
  );
  await s.db.control.query(
    "UPDATE memberships SET version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant.id, u.id],
  );
  assert.equal((await query("category=all&cursor=" + encoded)).status, 410);
});

test("mark-read uses strict CSRF and durable idempotency; another user's receipt or unauthorized account cannot be replayed", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  await payment(account.id, "8", "gift");
  await dispatchFinancialNotifications(s.db);
  const n = (await notices(u, w.tenant.id)).items[0],
    k = randomUUID();
  assert.equal((await marks(u, w.tenant.id, n.id, true, k)).status, 200);
  assert.equal((await marks(u, w.tenant.id, n.id, true, k)).data.read, true);
  assert.equal((await marks(u, w.tenant.id, n.id, false, k)).status, 409);
  assert.equal(
    (await notices(u, w.tenant.id, "category=all&unread=true")).items.length,
    0,
  );
  assert.equal((await marks(u, w.tenant.id, n.id, false)).data.read, false);
  const path = "/v1/financial-notifications/" + n.id;
  assert.equal(
    (
      await call(
        u,
        "PATCH",
        path,
        { read: true },
        { headers: { "x-tenant-id": w.tenant.id, "x-csrf-token": "" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        u,
        "PATCH",
        path,
        { read: "true" },
        { headers: { "x-tenant-id": w.tenant.id } },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        u,
        "PATCH",
        path,
        { read: true, recipient_id: u.id },
        { headers: { "x-tenant-id": w.tenant.id } },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        u,
        "PATCH",
        path,
        { read: true },
        { key: null, headers: { "x-tenant-id": w.tenant.id } },
      )
    ).status,
    400,
  );
});

test("administratively suspended memberships cannot use the control transaction to read personal or enterprise notifications", async () => {
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  await payment(account.id, "9", "gift");
  await dispatchFinancialNotifications(s.db);
  const id = (await notices(u, w.tenant.id)).items[0].id;
  await s.db.control.query(
    "UPDATE memberships SET admin_suspended=true,status='removed',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant.id, u.id],
  );
  assert.equal(
    (
      await call(u, "GET", "/v1/financial-notifications", undefined, {
        headers: { "x-tenant-id": w.tenant.id },
      })
    ).status,
    404,
  );
  assert.equal((await marks(u, w.tenant.id, id)).status, 404);
});

test("a financial intent insertion failure rolls back canonical gift, wallet, audit, operation and preview consumption together", async () => {
  const u = await user(),
    account = await personal(u),
    a = await admin(undefined, "super_admin"),
    body = await gift(account.id, "41"),
    pv = await preview(a, account.id, body),
    k = randomUUID(),
    before = await current(account.id);
  await ownerSQL(async (c) => {
    await c.query(
      `CREATE FUNCTION reject_financial_test_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.billing_account_id='${account.id}' THEN RAISE EXCEPTION 'controlled intent failure'; END IF; RETURN NEW; END $$`,
    );
    await c.query(
      "CREATE TRIGGER reject_financial_test_intent BEFORE INSERT ON financial_outbox FOR EACH ROW EXECUTE FUNCTION reject_financial_test_intent()",
    );
    try {
      const failed = await submit(a, account.id, body, {
        preview: pv.data.preview_id,
        key: k,
      });
      assert.equal(failed.status, 500);
      assert.deepEqual(await current(account.id), before);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int n FROM billing_journal WHERE billing_account_id=$1",
            [account.id],
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
            "SELECT count(*)::int n FROM admin_operations WHERE idempotency_key=$1",
            [k],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await c.query(
        "DROP TRIGGER reject_financial_test_intent ON financial_outbox",
      );
      await c.query("DROP FUNCTION reject_financial_test_intent()");
    }
  });
  assert.equal(
    (await submit(a, account.id, body, { preview: pv.data.preview_id, key: k }))
      .status,
    202,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM financial_outbox WHERE billing_account_id=$1",
        [account.id],
      )
    ).rows[0].n,
    1,
  );
});

test("a dispatcher failure retains the pending intent, creates no partial delivery, then retries once without changing money", async () => {
  await dispatchFinancialNotifications(s.db);
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  await payment(account.id, "31", "gift");
  const before = await current(account.id);
  await ownerSQL(async (c) => {
    await c.query(
      `CREATE FUNCTION reject_financial_test_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient_id='${u.id}' THEN RAISE EXCEPTION 'controlled delivery failure'; END IF; RETURN NEW; END $$`,
    );
    await c.query(
      "CREATE TRIGGER reject_financial_test_notice BEFORE INSERT ON financial_notifications FOR EACH ROW EXECUTE FUNCTION reject_financial_test_notice()",
    );
    try {
      await assert.rejects(
        dispatchFinancialNotifications(s.db),
        /controlled delivery failure/,
      );
      assert.equal((await notices(u, w.tenant.id)).items.length, 0);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT dispatched_at FROM financial_outbox WHERE billing_account_id=$1",
            [account.id],
          )
        ).rows[0].dispatched_at,
        null,
      );
    } finally {
      await c.query(
        "DROP TRIGGER reject_financial_test_notice ON financial_notifications",
      );
      await c.query("DROP FUNCTION reject_financial_test_notice()");
    }
  });
  await Promise.all([
    dispatchFinancialNotifications(s.db),
    dispatchFinancialNotifications(s.db),
  ]);
  assert.equal((await notices(u, w.tenant.id)).items.length, 1);
  assert.deepEqual(await current(account.id), before);
});

test("database guards reject forged subjects, mutable delivery facts and low-privilege access independently of HTTP", async () => {
  const u = await user(),
    stranger = await user(),
    w = await workspace(u),
    account = await personal(u),
    other = await personal(stranger);
  await payment(account.id, "1", "gift");
  await dispatchFinancialNotifications(s.db);
  const outbox = (
      await s.db.control.query(
        "SELECT * FROM financial_outbox WHERE billing_account_id=$1",
        [account.id],
      )
    ).rows[0],
    id = (await notices(u, w.tenant.id)).items[0].id;
  await assert.rejects(s.db.app.query("SELECT * FROM financial_outbox"), {
    code: "42501",
  });
  await assert.rejects(
    s.db.app.query("SELECT * FROM financial_notifications"),
    { code: "42501" },
  );
  await ownerSQL(async (c) => {
    await assert.rejects(
      c.query(
        "INSERT INTO financial_outbox(billing_account_id,kind,journal_id) VALUES($1,'journal',$2)",
        [other.id, outbox.journal_id],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      c.query(
        "INSERT INTO financial_notifications(outbox_id,recipient_id) VALUES($1,$2)",
        [outbox.id, stranger.id],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      c.query(
        "UPDATE financial_notifications SET recipient_id=$2 WHERE id=$1",
        [id, stranger.id],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      c.query("DELETE FROM financial_notifications WHERE id=$1", [id]),
      { code: "23514" },
    );
    await assert.rejects(
      c.query("UPDATE financial_outbox SET dispatched_at=NULL WHERE id=$1", [
        outbox.id,
      ]),
      { code: "23514" },
    );
    await assert.rejects(
      c.query("UPDATE financial_outbox SET journal_id=$2 WHERE id=$1", [
        outbox.id,
        randomUUID(),
      ]),
      { code: "23514" },
    );
    await assert.rejects(
      c.query("DELETE FROM financial_outbox WHERE id=$1", [outbox.id]),
      { code: "23514" },
    );
  });
});

test("bounded concurrent delivery drains more than one page with one recipient row per source and preserves values beyond Number precision", async () => {
  await dispatchFinancialNotifications(s.db);
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  await payment(account.id, "9007199254740993", "gift");
  for (let i = 0; i < 104; i++) await payment(account.id, "1", "gift");
  const delivered = await Promise.all([
    dispatchFinancialNotifications(s.db),
    dispatchFinancialNotifications(s.db),
    dispatchFinancialNotifications(s.db),
  ]);
  assert.ok(delivered.every((n) => n <= 100));
  assert.equal(
    delivered.reduce((a, b) => a + b, 0),
    105,
  );
  const count = (
    await s.db.control.query(
      `SELECT count(*)::int n,count(DISTINCT n.outbox_id)::int sources FROM financial_notifications n
    JOIN financial_outbox o ON o.id=n.outbox_id WHERE o.billing_account_id=$1 AND n.recipient_id=$2`,
      [account.id, u.id],
    )
  ).rows[0];
  assert.deepEqual(count, { n: 105, sources: 105 });
  let cursor: string | null = null,
    big;
  do {
    const page = await notices(
      u,
      w.tenant.id,
      "category=all&limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    big ??= page.items.find(
      (n: any) => n.amount.amount_micros === "9007199254740993",
    );
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(big.amount, money("9007199254740993"));
});

test("an actual populated 060 upgrade preserves every original public row and does not fabricate old financial notifications", async () => {
  const old = await isolatedTestEnvironment({ throughVersion: 60 }),
    c = new pg.Client({ connectionString: old.env.OWNER_DATABASE_URL });
  await c.connect();
  try {
    const u = (
        await c.query(
          "INSERT INTO users(email,name) VALUES($1,'Original finance owner') RETURNING id",
          [randomUUID() + "@example.invalid"],
        )
      ).rows[0].id,
      account = (
        await c.query(
          "SELECT id FROM wallets WHERE user_id=$1 AND data_mode='configured_services'",
          [u],
        )
      ).rows[0].id;
    await c.query("UPDATE wallets SET credit_limit_micros=23 WHERE id=$1", [
      account,
    ]);
    const operation = (
      await c.query(
        "INSERT INTO billing_operations(billing_account_id,actor_id,action,provenance) VALUES($1,$2,'billing.credit_limit.write','current_event') RETURNING id",
        [account, u],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO billing_journal(billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason) VALUES($1,$2,$3,'credit_limit','neutral','credit_limit',23,'Original controlled limit')",
      [account, operation, u],
    );
    const tables = (
        await c.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename),
      before = new Map<string, string>();
    for (const table of tables)
      before.set(
        table,
        (
          await c.query(
            `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')::text AS v FROM ${table} r`,
          )
        ).rows[0].v,
      );
    const checksums = (
      await c.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    await runMigrations(c, "populated financial delivery upgrade");
    for (const table of tables)
      assert.equal(
        (
          await c.query(
            `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')::text AS v FROM ${table} r`,
          )
        ).rows[0].v,
        before.get(table),
        table,
      );
    assert.deepEqual(
      (
        await c.query(
          "SELECT version,source_sha256 FROM schema_migrations WHERE version<=60 ORDER BY version",
        )
      ).rows,
      checksums,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM financial_outbox")).rows[0].n,
      0,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM financial_notifications"))
        .rows[0].n,
      0,
    );
    await c.query(
      "INSERT INTO billing_journal(billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason) VALUES($1,$2,$3,'credit_limit','neutral','credit_limit',23,'New controlled limit')",
      [account, operation, u],
    );
    await runMigrations(c, "financial delivery upgrade replay");
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM financial_outbox")).rows[0].n,
      1,
    );
  } finally {
    await c.end();
    await old.cleanup();
  }
});

test("strict supplementary schema retains original Money bytes and rejects unknown amounts, extra sensitive fields and malformed commands", async () => {
  const original = await readFile("../../docs/contracts/openapi.json"),
    specification = JSON.parse(original.toString());
  assert.equal(hash(original), financialContract.normative_source_sha256);
  assert.deepEqual(
    financialContract.schemas.Money,
    specification.components.schemas.Money,
  );
  assert.deepEqual(
    await readFile("contracts/financial-notification-schemas.json"),
    await readFile("../../docs/contracts/financial-notification-schemas.json"),
  );
  const u = await user(),
    w = await workspace(u),
    account = await personal(u);
  await payment(account.id, "1", "gift");
  await dispatchFinancialNotifications(s.db);
  const notice = (await notices(u, w.tenant.id)).items[0];
  const validate = ajv.compile({
    $defs: defs,
    $ref: "#/$defs/FinancialNotification",
  });
  assert.equal(
    validate({ ...notice, bank_reference: "private reference" }),
    false,
  );
  assert.equal(
    validate({ ...notice, amount: { currency: "HKD", amount_micros: 1 } }),
    false,
  );
  assert.equal(
    validate({ ...notice, event_type: "refund.success_without_evidence" }),
    false,
  );
  assert.equal(
    (
      await call(u, "GET", "/v1/financial-notifications?limit=101", undefined, {
        headers: { "x-tenant-id": w.tenant.id },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        u,
        "GET",
        "/v1/financial-notifications?include_evidence=true",
        undefined,
        { headers: { "x-tenant-id": w.tenant.id } },
      )
    ).status,
    400,
  );
});
