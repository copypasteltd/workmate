const money = (amount_micros:string) => ({currency:"HKD",amount_micros});
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


test("highest administrator executes high-value gift directly with a single audited journal",async()=>{
 const u=await user(),w=await personal(u),a=await admin(undefined,"super_admin"),b=await gift(w.id,"10000000000"),key=randomUUID();
 const pv=await preview(a,w.id,b);assert.equal(pv.status,200,JSON.stringify(pv.data));assert.notEqual(pv.data.decision,"independent_approval");
 const r=await submit(a,w.id,b,{preview:pv.data.preview_id,key});assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
 assert.equal((await current(w.id)).balance_micros,"10000000000");
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM admin_approval_requests WHERE operation_id=$1",[r.data.id])).rows[0].n,0);
 assert.equal((await submit(a,w.id,b,{preview:pv.data.preview_id,key})).data.id,r.data.id);
 assert.equal((await current(w.id)).balance_micros,"10000000000");
});
test("same-permission ordinary fee operator still needs another authorized reviewer",async()=>{
 const u=await user(),w=await personal(u),a=await admin(),highest=await admin(undefined,"super_admin"),perms=(await s.db.control.query("SELECT permissions FROM admin_roles WHERE key='super_admin'")).rows[0].permissions;
 await bind(a,perms);const r=await submit(a,w.id,await gift(w.id,"10000000000"));assert.equal(r.data.state,"pending_approval",JSON.stringify(r.data));
 assert.equal((await current(w.id)).balance_micros,"0");assert.equal((await decide(a,r.data)).status,403);
 const done=await decide(highest,r.data);assert.equal(done.status,202,JSON.stringify(done.data));assert.equal(done.data.state,"succeeded");
 assert.equal((await current(w.id)).balance_micros,"10000000000");
});
test("highest administrator can verify its own actual receipt facts without bypassing evidence checks",async()=>{
 const u=await user(),w=await personal(u),a=await admin(undefined,"super_admin"),r=await receipt(a,w,u);assert.equal(r.status,202,JSON.stringify(r.data));
 const bad=await confirmReceipt(a,r,{verified_reference:"incorrect-original-reference"});assert.equal(bad.status,409,JSON.stringify(bad.data));
 const verified=await confirmReceipt(a,r);assert.equal(verified.status,202,JSON.stringify(verified.data));assert.equal(verified.data.state,"succeeded");
 const fact=(await s.db.control.query("SELECT * FROM payment_confirmations WHERE payment_record_id=$1",[r.payment])).rows[0];
 assert.equal(fact.verified_by,a.id);assert.equal(fact.execution_mode,"super_admin_direct");assert.equal((await current(w.id)).balance_micros,"0");
});
test("ordinary receipt author cannot verify its own payment even with every business permission",async()=>{
 const u=await user(),w=await personal(u),a=await admin(),perms=(await s.db.control.query("SELECT permissions FROM admin_roles WHERE key='super_admin'")).rows[0].permissions;
 await bind(a,perms);const r=await receipt(a,w,u);assert.equal(r.status,202,JSON.stringify(r.data));assert.equal((await confirmReceipt(a,r)).status,403);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM payment_confirmations WHERE payment_record_id=$1",[r.payment])).rows[0].n,0);
});
