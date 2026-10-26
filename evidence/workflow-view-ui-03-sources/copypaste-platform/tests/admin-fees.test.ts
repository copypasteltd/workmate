import { after, before, test } from "node:test";
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

test("independent cash evidence supports unknown, actual partial payout and confirmed remaining failure without claiming full payment", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    owner = await user(),
    f = await cashRefundFixture(a, reviewer, owner);
  const evidence = await refundEvidence(owner, f.account);
  assert.equal(
    (
      await observeRefund(
        a,
        f.refund.id,
        refundOutcomeBody(
          1,
          "paid",
          "20",
          evidence,
          "controlled-cash-" + randomUUID(),
        ),
      )
    ).status,
    403,
  );
  const unknown = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(1, "unknown"),
  );
  assert.equal(unknown.status, 202, JSON.stringify(unknown.data));
  assert.equal((await current(f.account.id)).reserved_micros, "60");
  const reference = "controlled-cash-" + randomUUID(),
    body = refundOutcomeBody(2, "paid", "20", evidence, reference),
    key = randomUUID();
  const paid = await observeRefund(reviewer, f.refund.id, body, key);
  assert.equal(paid.status, 202, JSON.stringify(paid.data));
  schema("AdminOperation", paid.data);
  assert.equal((await current(f.account.id)).balance_micros, "81");
  assert.equal((await current(f.account.id)).reserved_micros, "40");
  const replayed = await observeRefund(reviewer, f.refund.id, body, key);
  assert.equal(replayed.status, 202);
  assert.equal(replayed.data.id, paid.data.id);
  const duplicate = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(3, "paid", "1", evidence, reference),
  );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "REFUND_REFERENCE_DUPLICATE");
  const failed = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(
      3,
      "not_paid",
      "0",
      evidence,
      "controlled-bank-declined-" + randomUUID(),
    ),
  );
  assert.equal(failed.status, 202, JSON.stringify(failed.data));
  assert.equal((await current(f.account.id)).balance_micros, "81");
  assert.equal((await current(f.account.id)).reserved_micros, "0");
  const actual = (
    await call(a, "GET", `/v1/admin/billing/refunds/${f.refund.id}`)
  ).data;
  assert.equal(actual.refund.state, "partially_paid_closed");
  assert.equal(actual.refund.confirmed_paid.amount_micros, "20");
  assert.equal(actual.events.length, 3);
  const original = (
    await call(a, "GET", `/v1/admin/operations/${f.operation.id}`)
  ).data;
  assert.equal(original.state, "partially_succeeded");
  schema("AdminOperation", original);
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(4, "paid", "1", evidence, "late-" + randomUUID()),
      )
    ).status,
    409,
  );
  const second = await submit(
    a,
    f.account.id,
    await refundBody(f.account.id, f.entry.id, "81", "payment_method"),
  );
  assert.equal(second.status, 202, JSON.stringify(second.data));
  assert.equal((await current(f.account.id)).reserved_micros, "81");
});

test("cash discrepancies preserve an immutable observation and the original hold until independent reconciliation", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    owner = await user(),
    f = await cashRefundFixture(a, reviewer, owner),
    evidence = await refundEvidence(owner, f.account);
  const mismatch = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(1, "paid", "61", evidence, "discrepant-" + randomUUID()),
  );
  assert.equal(mismatch.status, 202, JSON.stringify(mismatch.data));
  assert.equal((await current(f.account.id)).balance_micros, "101");
  assert.equal((await current(f.account.id)).reserved_micros, "60");
  const detail = (
    await call(a, "GET", `/v1/admin/billing/refunds/${f.refund.id}`)
  ).data;
  assert.equal(detail.refund.state, "reconciling_mismatch");
  assert.equal(detail.events[0].observed_amount_micros, "61");
  const payments = (await call(a, "GET", "/v1/admin/billing/payments")).data
    .items;
  const payment = payments.find((p: any) => p.id === f.payment);
  schema("AdminPaymentRecord", payment);
  assert.equal(payment.state, "reconciling");
  assert.equal(payment.version, 5);
  const future = {
    ...refundOutcomeBody(2, "paid", "60", evidence, "future-" + randomUUID()),
    occurred_at: new Date(Date.now() + 86400000).toISOString(),
  };
  assert.equal(
    (await observeRefund(reviewer, f.refund.id, future)).data.error.code,
    "REFUND_DATE_INVALID",
  );
  const completed = await observeRefund(
    reviewer,
    f.refund.id,
    refundOutcomeBody(2, "paid", "60", evidence, "reconciled-" + randomUUID()),
  );
  assert.equal(completed.status, 202, JSON.stringify(completed.data));
  assert.equal((await current(f.account.id)).balance_micros, "41");
  assert.equal((await current(f.account.id)).reserved_micros, "0");
});

test("concurrent actual cash outcomes debit once; full external repayment derives the original payment refunded state", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    owner = await user(),
    f = await cashRefundFixture(a, reviewer, owner, "101", "101"),
    evidence = await refundEvidence(owner, f.account);
  const body = refundOutcomeBody(
    1,
    "paid",
    "101",
    evidence,
    "once-" + randomUUID(),
  );
  const responses = await Promise.all([
    observeRefund(reviewer, f.refund.id, body),
    observeRefund(reviewer, f.refund.id, {
      ...body,
      external_reference: "other-" + randomUUID(),
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await current(f.account.id)).balance_micros, "0");
  assert.equal((await current(f.account.id)).reserved_micros, "0");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE billing_account_id=$1 AND kind='refund'",
        [f.account.id],
      )
    ).rows[0].n,
    1,
  );
  const payment = (
    await call(a, "GET", `/v1/admin/billing/payments/${f.payment}`)
  ).data;
  assert.equal(payment.payment.state, "refunded");
  assert.equal(payment.refunded_amount.amount_micros, "101");
  assert.equal(
    (
      await preview(
        a,
        f.account.id,
        await refundBody(f.account.id, f.entry.id, "1", "payment_method"),
      )
    ).data.error.code,
    "REFUND_FUNDS_UNAVAILABLE",
  );
});

test("refund facts reject cross-account evidence, account permissions and legacy ledger bypasses, and retain source expiry", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    owner = await user(),
    other = await user(),
    f = await cashRefundFixture(a, reviewer, owner),
    foreign = await refundEvidence(other, await personal(other));
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(1, "paid", "60", foreign, "foreign-" + randomUUID()),
      )
    ).data.error.code,
    "PAYMENT_EVIDENCE_INVALID",
  );
  const scoped = await admin(undefined, "user_operator");
  assert.equal(
    (await call(scoped, "GET", `/v1/admin/billing/refunds/${f.refund.id}`))
      .status,
    403,
  );
  const fake = () =>
    s.db.tx(
      (tx) =>
        tx.query(
          "INSERT INTO ledger(tenant_id,billing_account_id,kind,amount_micros,reference,source_id,idempotency_key,reason) VALUES(NULL,$1,'refund',-1,'unverified',$2,$3,'Controlled invalid bypass')",
          [f.account.id, f.entry.raw_entry_id, randomUUID()],
        ),
      undefined,
      true,
    );
  await assert.rejects(fake, /independently verified refund evidence/);
  await assert.rejects(
    s.db.control.query(
      "UPDATE billing_refunds SET amount_micros=amount_micros-1 WHERE id=$1",
      [f.refund.id],
    ),
    /permission denied/,
  );
  const ownerConnection = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await ownerConnection.connect();
  try {
    await assert.rejects(
      ownerConnection.query(
        "UPDATE billing_refunds SET amount_micros=amount_micros-1 WHERE id=$1",
        [f.refund.id],
      ),
      /immutable/,
    );
  } finally {
    await ownerConnection.end();
  }
  const giftLot = await payment(f.account.id, "1", "gift");
  await assert.rejects(
    s.db.control.query(
      "UPDATE funding_lots SET expires_at=expires_at+interval '1 day' WHERE ledger_id=$1",
      [giftLot.id],
    ),
    /immutable/,
  );
});

test("a consumption refund restores original promotional/paid funds and cancels only its actual unpaid credit; replay and cumulative limits preserve the original charge", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, w.id, "100"),
    undefined,
    true,
  );
  await payment(w.id, "50", "gift");
  await payment(w.id, "101");
  const charge = await consumed(u, ws, w, 180),
    before = await current(w.id),
    b = await refundBody(w.id, charge.id, "180"),
    pv = await preview(a, w.id, b),
    key = randomUUID();
  assert.equal(before.balance_micros, "-29");
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.deepEqual(await current(w.id), before);
  schema("AdminFeeRefund", b);
  schema("AdminPreview", pv.data);
  const posted = await submit(a, w.id, b, { key, preview: pv.data.preview_id });
  assert.equal(posted.status, 202, JSON.stringify(posted.data));
  assert.equal(posted.data.state, "succeeded");
  const again = await call(a, "POST", `${base}/${w.id}/refund`, b, {
    key,
    headers: { "x-admin-preview-id": pv.data.preview_id },
  });
  assert.equal(again.status, 202);
  assert.equal(again.data.id, posted.data.id);
  assert.equal((await current(w.id)).balance_micros, "151");
  assert.equal((await current(w.id)).spent_micros, "180");
  const lots = (
    await s.db.control.query(
      "SELECT kind,sum(remaining_micros)::text AS amount FROM funding_lots WHERE billing_account_id=$1 GROUP BY kind ORDER BY kind",
      [w.id],
    )
  ).rows;
  assert.deepEqual(lots, [
    { kind: "gift", amount: "50" },
    { kind: "paid", amount: "101" },
  ]);
  assert.equal(
    (
      await s.db.control.query("SELECT amount_micros FROM ledger WHERE id=$1", [
        charge.raw_entry_id,
      ])
    ).rows[0].amount_micros,
    "-180",
  );
  const duplicate = await preview(
    a,
    w.id,
    await refundBody(w.id, charge.id, "1"),
  );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "REFUND_LIMIT_EXCEEDED");
});

test("refunded credit that was repaid with a gift and a payment returns those exact sources rather than converting gift funding to cash", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, w.id, "100"),
    undefined,
    true,
  );
  const charge = await consumed(u, ws, w, 60);
  await payment(w.id, "40", "gift");
  await payment(w.id, "15");
  assert.equal((await current(w.id)).balance_micros, "-5");
  const r = await submit(a, w.id, await refundBody(w.id, charge.id, "60"));
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal((await current(w.id)).balance_micros, "55");
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT kind,sum(remaining_micros)::text AS amount FROM funding_lots WHERE billing_account_id=$1 GROUP BY kind ORDER BY kind",
        [w.id],
      )
    ).rows,
    [
      { kind: "gift", amount: "40" },
      { kind: "paid", amount: "15" },
    ],
  );
  const debt = (
    await s.db.control.query(
      "SELECT (SELECT sum(remaining_micros) FROM funding_lots WHERE billing_account_id=w.id)-balance_micros AS debt FROM wallets w WHERE id=$1",
      [w.id],
    )
  ).rows[0].debt;
  assert.equal(debt, "0");
  const later = await consumed(u, ws, w, 80);
  await payment(w.id, "25");
  assert.equal((await current(w.id)).balance_micros, "0");
  const repaid = (
    await s.db.control.query(
      "SELECT DISTINCT s.charge_id FROM billing_credit_repayment_parts p JOIN billing_settlement_sources s ON s.id=p.credit_source_id JOIN ledger l ON l.id=p.funding_entry_id WHERE p.billing_account_id=$1 AND l.amount_micros=25",
      [w.id],
    )
  ).rows;
  assert.deepEqual(repaid, [{ charge_id: later.raw_entry_id }]);
});

test("expired promotional consumption refunds retain compensation and expiry facts without reviving spendable gift credit", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  const until = new Date(Date.now() + 2000).toISOString();
  await s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: w.id,
          action: "gift",
          amount_micros: "101",
          expires_at: until,
          reason: "Controlled gift expiry boundary",
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
  const charge = await consumed(u, ws, w, 100);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const b = await refundBody(w.id, charge.id, "100"),
    r = await submit(a, w.id, b);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal((await current(w.id)).balance_micros, "0");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT remaining_micros FROM funding_lots WHERE billing_account_id=$1",
        [w.id],
      )
    ).rows[0].remaining_micros,
    "0",
  );
  const facts = (
    await s.db.control.query(
      "SELECT kind,direction,bucket,amount_micros FROM billing_journal WHERE operation_id=$1 ORDER BY kind",
      [r.data.id],
    )
  ).rows;
  assert.deepEqual(facts, [
    {
      kind: "compensation",
      direction: "credit",
      bucket: "promotional",
      amount_micros: "100",
    },
    {
      kind: "gift_expiry",
      direction: "debit",
      bucket: "promotional",
      amount_micros: "100",
    },
  ]);
});

test("a cash refund reserves only unspent independently verified original payment funds and remains in reconciliation", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u);
  const receiptRow = await receipt(a, w, u, "101");
  assert.equal(receiptRow.status, 202);
  assert.equal((await confirmReceipt(reviewer, receiptRow)).status, 202);
  assert.equal(
    (await submit(a, w.id, await topup(w, receiptRow.payment))).status,
    202,
  );
  const entry = (
    await s.db.control.query(
      "SELECT * FROM billing_journal WHERE payment_record_id=$1",
      [receiptRow.payment],
    )
  ).rows[0];
  const b = await refundBody(w.id, entry.id, "60", "payment_method"),
    r = await submit(a, w.id, b);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "reconciling");
  assert.equal((await current(w.id)).balance_micros, "101");
  assert.equal((await current(w.id)).reserved_micros, "60");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE billing_account_id=$1 AND kind='refund'",
        [w.id],
      )
    ).rows[0].n,
    0,
  );
  const tooMuch = await preview(
    a,
    w.id,
    await refundBody(w.id, entry.id, "42", "payment_method"),
  );
  assert.equal(tooMuch.status, 409);
  assert.equal(tooMuch.data.error.code, "REFUND_FUNDS_UNAVAILABLE");
  const wrongMode = await preview(
    a,
    w.id,
    await refundBody(w.id, entry.id, "1"),
  );
  assert.equal(wrongMode.status, 409);
  assert.equal(wrongMode.data.error.code, "CONSUMPTION_REQUIRED");
});

test("high-value consumption refunds require a frozen independent approval and retain every original bucket", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  await payment(w.id, "10000000000", "gift");
  const entry = await consumed(u, ws, w, 10000000000),
    b = await refundBody(w.id, entry.id, "10000000000"),
    pending = await submit(a, w.id, b);
  assert.equal(pending.data.state, "pending_approval");
  assert.equal((await current(w.id)).balance_micros, "0");
  assert.equal(
    (await decide(a, pending.data)).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const result = await decide(reviewer, pending.data);
  assert.equal(result.status, 202, JSON.stringify(result.data));
  assert.equal(result.data.state, "succeeded");
  assert.equal((await current(w.id)).balance_micros, "10000000000");
  const parts = (
    await s.db.control.query(
      "SELECT j.bucket,j.amount_micros,j.actor_id FROM billing_refunds r JOIN billing_refund_source_parts p ON p.refund_id=r.id JOIN billing_journal j ON j.id=p.journal_id WHERE r.operation_id=$1",
      [pending.data.id],
    )
  ).rows;
  assert.deepEqual(parts, [
    { bucket: "promotional", amount_micros: "10000000000", actor_id: a.id },
  ]);
});

test("refund scopes include the actual enterprise and personal subject; current deny and recent MFA are checked before replay", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await enterprise(ws.tenant.id),
    finance = await admin(ws.tenant.id, "finance_admin");
  await payment(w.id, "101", "gift");
  const entry = await consumed(u, ws, w, 80),
    body = await refundBody(w.id, entry.id, "80");
  const applied = await submit(finance, w.id, body);
  assert.equal(applied.status, 202, JSON.stringify(applied.data));
  const record = (
    await s.db.control.query(
      "SELECT * FROM billing_refunds WHERE operation_id=$1",
      [applied.data.id],
    )
  ).rows[0];
  const directory = await call(
    finance,
    "GET",
    "/v1/admin/billing/refunds?limit=1",
  );
  assert.equal(directory.status, 200, JSON.stringify(directory.data));
  assert.ok(
    directory.data.items.every((r: any) => r.billing_account_id === w.id),
  );
  assert.equal(
    (await call(finance, "GET", `/v1/admin/billing/refunds/${record.id}`))
      .status,
    200,
  );
  const f = await cashRefundFixture(a, reviewer, u);
  assert.equal(
    (await observeRefund(finance, f.refund.id, refundOutcomeBody(1, "unknown")))
      .status,
    403,
  );
  const key = randomUUID(),
    observation = refundOutcomeBody(1, "unknown");
  assert.equal(
    (await observeRefund(reviewer, f.refund.id, observation, key)).status,
    202,
  );
  await bind(reviewer, ["admin.billing.refund"], "global", null, "deny");
  assert.equal(
    (await observeRefund(reviewer, f.refund.id, observation, key)).status,
    403,
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [finance.id],
  );
  assert.equal(
    (await preview(finance, w.id, await refundBody(w.id, entry.id, "1"))).data
      .error.code,
    "MFA_REQUIRED",
  );
});

test("refund request and actual payout audit failures roll back facts, holds and idempotency together", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    f = await cashRefundFixture(a, reviewer, u),
    evidence = await refundEvidence(u, f.account),
    ownerConnection = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await ownerConnection.connect();
  try {
    const body = await refundBody(
        f.account.id,
        f.entry.id,
        "10",
        "payment_method",
      ),
      pv = await preview(a, f.account.id, body),
      key = randomUUID(),
      before = await current(f.account.id);
    await ownerConnection.query(
      "CREATE FUNCTION reject_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('admin.billing.refund','admin.billing.refund.outcome') THEN RAISE EXCEPTION 'controlled refund audit failure'; END IF; RETURN NEW; END $$",
    );
    await ownerConnection.query(
      "CREATE TRIGGER refund_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_refund_audit()",
    );
    assert.equal(
      (
        await submit(a, f.account.id, body, {
          key,
          preview: pv.data.preview_id,
        })
      ).status,
      500,
    );
    assert.deepEqual(await current(f.account.id), before);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM billing_refunds WHERE billing_account_id=$1",
          [f.account.id],
        )
      ).rows[0].n,
      1,
    );
    const observed = refundOutcomeBody(
        1,
        "paid",
        "60",
        evidence,
        "audit-" + randomUUID(),
      ),
      outcomeKey = randomUUID();
    assert.equal(
      (await observeRefund(reviewer, f.refund.id, observed, outcomeKey)).status,
      500,
    );
    assert.deepEqual(await current(f.account.id), before);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM billing_refund_events WHERE refund_id=$1",
          [f.refund.id],
        )
      ).rows[0].n,
      0,
    );
    await ownerConnection.query("DROP TRIGGER refund_audit_fault ON audit_log");
    assert.equal(
      (await observeRefund(reviewer, f.refund.id, observed, outcomeKey)).status,
      202,
    );
    assert.equal((await current(f.account.id)).balance_micros, "41");
    // The other pending preview was not consumed, but the actual payout changed its source snapshot.
    assert.equal(
      (
        await submit(a, f.account.id, body, {
          key,
          preview: pv.data.preview_id,
        })
      ).status,
      409,
    );
  } finally {
    await ownerConnection.query(
      "DROP TRIGGER IF EXISTS refund_audit_fault ON audit_log",
    );
    await ownerConnection.query(
      "DROP FUNCTION IF EXISTS reject_refund_audit()",
    );
    await ownerConnection.end();
  }
});

test("concurrent compensation cannot exceed the original consumption or return the same funding twice", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  await payment(w.id, "101", "gift");
  const entry = await consumed(u, ws, w, 101),
    b = await refundBody(w.id, entry.id, "80"),
    p1 = await preview(a, w.id, b),
    p2 = await preview(a, w.id, b);
  const results = await Promise.all([
    submit(a, w.id, b, { preview: p1.data.preview_id }),
    submit(a, w.id, b, { preview: p2.data.preview_id }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await current(w.id)).balance_micros, "80");
  assert.equal(
    (await preview(a, w.id, await refundBody(w.id, entry.id, "22"))).data.error
      .code,
    "REFUND_LIMIT_EXCEEDED",
  );
  assert.equal(
    (await submit(a, w.id, await refundBody(w.id, entry.id, "21"))).status,
    202,
  );
  assert.equal((await current(w.id)).balance_micros, "101");
});

test("a task can spend only funds outside a cash commitment; settlement and independently verified payout preserve each hold", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    f = await cashRefundFixture(a, reviewer, u),
    ws = await workspace(u);
  const heldTask = await manualTask(u, ws, f.account.id, 41);
  assert.equal((await current(f.account.id)).reserved_micros, "101");
  await assert.rejects(
    manualTask(u, ws, f.account.id, 1),
    (e: any) => e.code === "INSUFFICIENT_CREDIT",
  );
  const evidence = await refundEvidence(u, f.account);
  assert.equal(
    (
      await observeRefund(
        reviewer,
        f.refund.id,
        refundOutcomeBody(
          1,
          "paid",
          "60",
          evidence,
          "task-hold-" + randomUUID(),
        ),
      )
    ).status,
    202,
  );
  assert.equal((await current(f.account.id)).balance_micros, "41");
  assert.equal((await current(f.account.id)).reserved_micros, "41");
  await s.db.tx(
    (tx) => settle(tx, ws.tenant.id, heldTask.id, 41, u.id),
    ws.tenant.id,
    false,
    u.id,
  );
  assert.equal((await current(f.account.id)).balance_micros, "0");
  assert.equal((await current(f.account.id)).reserved_micros, "0");
});

test("payment and account UUIDs are case-insensitive without changing the payment identity or amount", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u);
  const r = await receipt(a, w, u);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const confirmed = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${r.payment.toUpperCase()}/confirmations`,
    {
      expected_version: 1,
      reason: "Verify the same controlled payment identifier",
      verified_reference: r.body.external_reference,
    },
  );
  assert.equal(confirmed.status, 202, JSON.stringify(confirmed.data));
  const b = await topup(w, r.payment.toUpperCase()),
    pv = await preview(a, w.id.toUpperCase(), b);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  const posted = await submit(a, w.id.toUpperCase(), b, {
    preview: pv.data.preview_id,
  });
  assert.equal(posted.status, 202, JSON.stringify(posted.data));
  assert.equal((await current(w.id)).balance_micros, "101");
});

test("verified payments repay actual credit debt before creating spendable paid funds; old external receipts cannot be posted again", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    ws = await workspace(u),
    w = await personal(u);
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, w.id, "100"),
    undefined,
    true,
  );
  const task = await manualTask(u, ws, w.id, 60);
  await s.db.tx(
    (tx) => settle(tx, ws.tenant.id, task.id, 60, u.id),
    ws.tenant.id,
    false,
    u.id,
  );
  assert.equal((await current(w.id)).balance_micros, "-60");
  const r = await receipt(a, w, u, "101");
  assert.equal(r.status, 202);
  assert.equal((await confirmReceipt(reviewer, r)).status, 202);
  const posted = await submit(a, w.id, await topup(w, r.payment));
  assert.equal(posted.status, 202, JSON.stringify(posted.data));
  const amounts = (
    await s.db.control.query(
      "SELECT w.balance_micros,(SELECT sum(remaining_micros)::text FROM funding_lots WHERE billing_account_id=w.id) AS paid,(SELECT sum(amount_micros)::text FROM billing_credit_repayments WHERE billing_account_id=w.id) AS repaid FROM wallets w WHERE w.id=$1",
      [w.id],
    )
  ).rows[0];
  assert.deepEqual(amounts, { balance_micros: "41", paid: "41", repaid: "60" });
  const reference = "old-bank-receipt-" + randomUUID();
  await s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: w.id,
          action: "top_up",
          amount_micros: "100",
          reference,
          reason: "Original historical receipt fixture",
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
  const duplicate = await receipt(a, w, u, "100", {
    external_reference: reference,
  });
  assert.equal(duplicate.data.error.code, "PAYMENT_REFERENCE_HISTORICAL");
});

test("concurrent payment postings use one source exactly once and permission revocation prevents receipt replay", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u);
  const r = await receipt(a, w, u, "123456789");
  assert.equal(r.status, 202);
  const confirmBody = {
      expected_version: 1,
      reason: "Controlled independent receipt verification",
      verified_reference: r.body.external_reference,
    },
    confirmKey = randomUUID();
  const confirmation = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${r.payment}/confirmations`,
    confirmBody,
    { key: confirmKey },
  );
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.data));
  const b = await topup(w, r.payment, "123456789"),
    pv1 = await preview(a, w.id, b),
    pv2 = await preview(a, w.id, b);
  const writes = await Promise.all([
    submit(a, w.id, b, { preview: pv1.data.preview_id }),
    submit(a, w.id, b, { preview: pv2.data.preview_id }),
  ]);
  assert.deepEqual(writes.map((x) => x.status).sort(), [202, 409]);
  assert.equal((await current(w.id)).balance_micros, "123456789");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM payment_postings WHERE payment_record_id=$1",
        [r.payment],
      )
    ).rows[0].n,
    1,
  );
  await s.db.control.query(
    "UPDATE admin_bindings SET expires_at=now()-interval '1 second' WHERE principal_id=$1",
    [reviewer.id],
  );
  const replay = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${r.payment}/confirmations`,
    confirmBody,
    { key: confirmKey },
  );
  assert.equal(replay.status, 403, JSON.stringify(replay.data));
});

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

test("recording and independent receipt verification never change balances; exact confirmed payment posts once", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u);
  const r = await receipt(a, w, u, "9007199254740993");
  assert.equal(r.status, 202, JSON.stringify(r.data));
  schema("AdminOperation", r.data);
  assert.equal((await current(w.id)).balance_micros, "0");
  assert.equal(
    (await confirmReceipt(a, r)).data.error.code,
    "PAYMENT_SELF_VERIFICATION",
  );
  assert.equal(
    (await preview(a, w.id, await topup(w, r.payment, "9007199254740993"))).data
      .error.code,
    "PAYMENT_NOT_CONFIRMED",
  );
  assert.equal(
    (
      await confirmReceipt(reviewer, r, {
        verified_reference: "wrong-reference",
      })
    ).data.error.code,
    "PAYMENT_REFERENCE_MISMATCH",
  );
  const confirmed = await confirmReceipt(reviewer, r);
  assert.equal(confirmed.status, 202, JSON.stringify(confirmed.data));
  schema("AdminOperation", confirmed.data);
  assert.equal((await current(w.id)).balance_micros, "0");
  assert.equal(
    (await preview(a, w.id, await topup(w, r.payment, "1"))).data.error.code,
    "PAYMENT_AMOUNT_MISMATCH",
  );
  const b = await topup(w, r.payment, "9007199254740993"),
    pv = await preview(a, w.id, b);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  schema("AdminPreview", pv.data);
  const key = randomUUID(),
    submitted = await submit(a, w.id, b, { key, preview: pv.data.preview_id });
  assert.equal(submitted.status, 202, JSON.stringify(submitted.data));
  assert.equal(submitted.data.state, "pending_approval");
  const approved = await decide(reviewer, submitted.data);
  assert.equal(approved.status, 202, JSON.stringify(approved.data));
  assert.equal(approved.data.state, "succeeded");
  assert.equal((await current(w.id)).balance_micros, "9007199254740993");
  const j = (
    await s.db.control.query(
      "SELECT * FROM billing_journal WHERE operation_id=$1",
      [submitted.data.id],
    )
  ).rows;
  assert.equal(j.length, 1);
  assert.equal(j[0].payment_record_id, r.payment);
  assert.equal(j[0].actor_id, a.id);
  assert.equal(
    (await preview(a, w.id, await topup(w, r.payment, "9007199254740993"))).data
      .error.code,
    "PAYMENT_ALREADY_POSTED",
  );
  const list = await call(a, "GET", "/v1/admin/billing/payments?limit=1");
  schema("AdminPaymentRecordList", list.data);
  assert.equal(list.data.items[0].version, 3);
});

test("payment registration and confirmation have persistent idempotency, per-account scope and no legacy top-up bypass", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u),
    other = await personal(await user());
  const r = await receipt(a, w, u);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const duplicate = await call(a, "POST", "/v1/admin/billing/payments", r.body);
  assert.equal(duplicate.data.error.code, "PAYMENT_REFERENCE_DUPLICATE");
  const confirmedBody = {
      expected_version: 1,
      verified_reference: r.body.external_reference,
      reason: "Independent verification of test evidence",
    },
    idempotency = randomUUID();
  const c1 = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${r.payment}/confirmations`,
    confirmedBody,
    { key: idempotency },
  );
  const c2 = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${r.payment}/confirmations`,
    confirmedBody,
    { key: idempotency },
  );
  assert.equal(c1.status, 202, JSON.stringify(c1.data));
  assert.deepEqual(c1.data, c2.data);
  assert.equal(
    (await preview(a, other.id, await topup(other, r.payment))).data.error.code,
    "PAYMENT_ACCOUNT_MISMATCH",
  );
  const ws = await workspace(u),
    legacy = await call(a, "POST", "/v1/admin/operations/preview", {
      action: "billing.top_up",
      tenant_id: ws.tenant.id,
      amount_micros: 101,
      reference: "Unverified reference",
      reason: "Must not post money without a verified receipt",
    });
  assert.equal(legacy.data.error.code, "CANONICAL_FINANCE_REQUIRED");
  const denied = await admin(ws.tenant.id, "finance_admin");
  assert.equal(
    (await call(denied, "GET", `/v1/admin/billing/payments/${r.payment}`))
      .status,
    403,
  );
  const ordinary = await call(u, "GET", "/v1/admin/billing/payments");
  assert.equal(ordinary.status, 401);
  const direct = await submit(a, w.id, await topup(w, r.payment));
  assert.equal(direct.status, 202, JSON.stringify(direct.data));
  assert.equal(direct.data.state, "succeeded");
  assert.equal((await current(w.id)).balance_micros, "101");
  const read = await call(a, "GET", `/v1/admin/operations/${r.data.id}`);
  schema("AdminOperation", read.data);
});

test("quarantined, changed-subject and future payment evidence cannot become product credit", async () => {
  const a = await admin(undefined, "super_admin"),
    reviewer = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u);
  const future = await receipt(a, w, u, "101", {
    received_at: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(future.data.error.code, "PAYMENT_DATE_INVALID");
  const wrong = await receipt(a, await personal(await user()), u);
  // receipt() deliberately makes private evidence for the account's subject;
  // replacing that subject afterwards is a direct database attack fixture.
  assert.equal(wrong.status, 202, JSON.stringify(wrong.data));
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [
    wrong.asset,
    u.id,
  ]);
  assert.equal(
    (await confirmReceipt(reviewer, wrong)).data.error.code,
    "PAYMENT_EVIDENCE_INVALID",
  );
  const r = await receipt(a, w, u);
  assert.equal(r.status, 202);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [r.asset],
  );
  assert.equal(
    (await confirmReceipt(reviewer, r)).data.error.code,
    "PAYMENT_EVIDENCE_INVALID",
  );
  await s.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [
    r.asset,
  ]);
  assert.equal((await confirmReceipt(reviewer, r)).status, 202);
  const b = await topup(w, r.payment),
    pv = await preview(a, w.id, b);
  assert.equal(pv.status, 200);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [r.asset],
  );
  const result = await submit(a, w.id, b, { preview: pv.data.preview_id });
  assert.equal(result.data.error.code, "PAYMENT_EVIDENCE_INVALID");
  assert.equal((await current(w.id)).balance_micros, "0");
});

test("payment audit failure rolls back registration, and committed payment facts cannot be edited or deleted", async () => {
  const a = await admin(undefined, "super_admin"),
    u = await user(),
    w = await personal(u),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION reject_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.payment.record' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER payment_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_payment_audit()",
    );
    const r = await receipt(a, w, u);
    assert.equal(r.status, 500);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM payment_records WHERE external_reference=$1",
          [r.body.external_reference],
        )
      ).rows[0].n,
      0,
    );
    await owner.query("DROP TRIGGER payment_audit_fault ON audit_log");
    const good = await call(a, "POST", "/v1/admin/billing/payments", r.body);
    assert.equal(good.status, 202, JSON.stringify(good.data));
    await assert.rejects(
      owner.query(
        "UPDATE admin_operations SET payload=jsonb_set(payload,'{command,kind}','\"forged\"') WHERE id=$1",
        [good.data.id],
      ),
      /immutable/,
    );
    await assert.rejects(
      owner.query(
        "UPDATE payment_records SET external_reference='edited' WHERE id=$1",
        [good.data.result_ids[0]],
      ),
      /append-only/,
    );
    await assert.rejects(
      owner.query("DELETE FROM payment_records WHERE id=$1", [
        good.data.result_ids[0],
      ]),
      /append-only/,
    );
    assert.equal((await current(w.id)).balance_micros, "0");
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS payment_audit_fault ON audit_log",
    );
    await owner.query("DROP FUNCTION IF EXISTS reject_payment_audit()");
    await owner.end();
  }
});

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

test("fee schema snapshot is byte-derived from the unchanged original OpenAPI", async () => {
  const original = await readFile("../../docs/contracts/openapi.json", "utf8");
  assert.equal(hash(original), contract.source_sha256);
  const schemas = JSON.parse(original).components.schemas;
  assert.equal(hash(original), paymentContract.source_sha256);
  for (const [name, body] of Object.entries({
    ...contract.schemas,
    ...paymentContract.schemas,
  }))
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
