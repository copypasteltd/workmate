import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-directory-schemas.json" with { type: "json" };
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { randomUUID } from "node:crypto";
import { billingAccount, fund } from "../src/billing.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyCall, historyOk, historyLogin, type System, type HistoryClient } from "./admin-history-fixture.js";
import { overviewAdmin, overviewBind, overviewTask } from "./admin-overview-fixture-160-v2.js";
import { directoryFixture, directoryPermissions } from "./admin-directory-filters-fixture-168-v1.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: System, f: Awaited<ReturnType<typeof directoryFixture>>, admin: Awaited<ReturnType<typeof overviewAdmin>>;
const query = (q: Record<string, string> = {}) => "/v1/admin/users?" + new URLSearchParams(q);
const list = (q: Record<string, string> = {}, c: HistoryClient | null = admin.client) => historyOk(s, c, "GET", query(q));
const ids = (data: any) => data.items.map((v: any) => v.id);
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false }); f = await directoryFixture(s); admin = await overviewAdmin(s, directoryPermissions); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });

test("legacy strict contract is preserved; operational fields distinguish origin and unknown activity with half-open dates", async () => {
  const ajv = new Ajv2020({ allErrors: true }); createRequire(import.meta.url)("ajv-formats")(ajv);
  const defs = JSON.parse(JSON.stringify(contract.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
  const validate = ajv.compile({ $defs: defs, $ref: "#/$defs/AdminUserList" }); const legacy = await list(); assert.ok(validate(legacy), JSON.stringify(validate.errors));
  const response = await historyCall(s, admin.client, "GET", query({ view: "operations", user_id: f.second.owner.id }));
  assert.equal(response.raw.headers["cache-control"], "no-store"); assert.equal(response.data.items[0].last_active_at, null); assert.equal(response.data.items[0].registration_source, null);
  assert.deepEqual(ids(await list({ registered_from: f.at(-10), registered_to: f.at(-9), activity: "known", active_from: f.at(-3), active_to: f.at(-2), registration_source: "email_otp" })), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ activity: "unknown", registration_source: "unknown" })), [f.second.owner.id]);
});

test("VIP plan, effective state and expiry belong to one actual grant; canonical grants and current denies are enforced", async () => {
  assert.deepEqual(ids(await list({ user_id: f.first.owner.id, vip_plan: "pro", vip_status: "effective", vip_expiry_from: f.at(5), vip_expiry_to: f.at(6) })), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ user_id: f.first.owner.id, vip_plan: "pro", vip_expiry_from: f.at(0), vip_expiry_to: f.at(2) })), []);
  for (const vip_status of ["scheduled", "expired", "suspended", "revoked"]) assert.deepEqual(ids(await list({ user_id: f.second.owner.id, vip_plan: "pro", vip_status })), [f.second.owner.id]);
  assert.deepEqual(ids(await list({ user_id: f.second.owner.id, vip_status: "suspended", vip_expiry_to: f.at(-2) })), []);
  assert.deepEqual(ids(await list({ user_id: f.second.owner.id, vip_status: "expired", vip_expiry_to: f.at(-2) })), [f.second.owner.id]);
  assert.deepEqual(ids(await list({ user_id: f.outside.owner.id, vip_plan: "pro", vip_status: "effective" })), [f.outside.owner.id]);
  const denied = await overviewAdmin(s, directoryPermissions); await overviewBind(s, denied.id, ["admin.entitlements.read"], "tenant", f.first.tenant, "deny");
  assert.deepEqual(ids(await list({ user_id: f.first.owner.id, vip_plan: "pro" }, denied.client)), []);
});

test("confirmed charge ranges are exact, inclusive and ledger-period scoped; holds and unknown fees are excluded", async () => {
  const q = { user_id: f.first.owner.id, charge_min_micros: "875000", charge_max_micros: "875000" };
  const rows = await list(q); assert.deepEqual(ids(rows), [f.first.owner.id]); assert.equal(rows.items[0].confirmed_customer_charges.amount_micros, "875000");
  assert.deepEqual(ids(await list({ ...q, charge_min_micros: "875001", charge_max_micros: "900719925474099312345678901234" })), []);
  const time = (await s.db.control.query("SELECT created_at FROM ledger WHERE task_id=$1 AND kind='charge'", [f.firstTask])).rows[0].created_at.toISOString();
  assert.deepEqual(ids(await list({ ...q, period_from: time })), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ ...q, period_to: time })), []);
  const scoped = await overviewAdmin(s, ["admin.users.read"]); await overviewBind(s, scoped.id, ["admin.usage.read"], "tenant", f.first.tenant);
  assert.deepEqual(ids(await list({ user_id: f.outside.owner.id, charge_max_micros: "0" }, scoped.client)), []);
});

test("account availability agrees with billing expiry, reservations and credit without directory writes or pooling", async () => {
  // Expiry is immutable: drain only free original credit through the billing
  // domain, then create genuinely expiring grants and reserve part of one.
  for (const account of [f.first.personalWallet, f.first.tenantWallet]) {
    const lots = (await s.db.control.query("SELECT ledger_id,(remaining_micros-reserved_micros)::text AS free FROM funding_lots WHERE billing_account_id=$1 AND remaining_micros>reserved_micros", [account])).rows;
    for (const lot of lots) await s.db.tx(tx => fund(tx, { billing_account_id: account, action: "debit", source_id: lot.ledger_id, amount_micros: lot.free, reason: "Synthetic free-credit debit before expiry fixture" }, randomUUID()), undefined, true);
  }
  const expires = Date.now() + 1800;
  for (const [account, amount] of [[f.first.personalWallet, 1000000], [f.first.tenantWallet, 2000000]] as const)
    await s.db.tx(tx => fund(tx, { billing_account_id: account, action: "gift", amount_micros: amount, expires_at: new Date(expires).toISOString(), reason: "Synthetic short-lived credit" }, randomUUID()), undefined, true);
  await overviewTask(s, f.first);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, expires - Date.now() + 50)));
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=250000 WHERE id=$1", [f.first.tenantWallet]);
  const snapshot = async () => (await s.db.control.query("SELECT row_to_json(w) AS wallet,(SELECT count(*)::int FROM ledger l WHERE l.billing_account_id=w.id) AS entries FROM wallets w WHERE w.id=ANY($1::uuid[]) ORDER BY w.id", [[f.first.personalWallet, f.first.tenantWallet]])).rows;
  const before = await snapshot(); const q = { user_id: f.first.owner.id, balance_state: "insufficient", balance_required_micros: "1", billing_subject: "personal" };
  assert.deepEqual(ids(await list(q)), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ ...q, billing_subject: "tenant" })), []);
  assert.deepEqual(ids(await list({ ...q, billing_subject: "tenant", balance_state: "sufficient", balance_required_micros: "250000" })), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ ...q, billing_subject: "tenant", balance_state: "sufficient", balance_required_micros: "250001" })), []);
  assert.deepEqual(await snapshot(), before);
  const rollback = new Error("rollback expiry comparison");
  await assert.rejects(s.db.tx(async tx => { const w = await billingAccount(tx, f.first.tenantWallet); assert.equal(BigInt(w.balance_micros) + BigInt(w.credit_limit_micros) - BigInt(w.reserved_micros), 250000n); throw rollback; }, undefined, true), e => e === rollback);
  assert.deepEqual(await snapshot(), before);
  await s.db.control.query("UPDATE wallets SET balance_micros=balance_micros+1 WHERE id=$1", [f.first.personalWallet]);
  assert.deepEqual(ids(await list(q)), []); // inconsistent account remains unknown
  await s.db.control.query("UPDATE wallets SET balance_micros=balance_micros-1 WHERE id=$1", [f.first.personalWallet]);
});

test("role use distinguishes submitted and started tasks; reconciliation is creator- and scope-specific", async () => {
  assert.deepEqual(ids(await list({ user_id: f.outside.owner.id, role_key: "assistant", role_usage: "created" })), [f.outside.owner.id]);
  assert.deepEqual(ids(await list({ user_id: f.outside.owner.id, role_key: "assistant", role_usage: "started" })), []);
  assert.deepEqual(ids(await list({ role_key: "assistant", role_usage: "started", cost_exception: "pending_reconciliation" })), [f.first.owner.id]);
  assert.deepEqual(ids(await list({ user_id: f.first.owner.id, cost_exception: "none" })), []);
  const denied = await overviewAdmin(s, directoryPermissions); await overviewBind(s, denied.id, ["admin.usage.read"], "project", f.first.project, "deny");
  assert.deepEqual(ids(await list({ user_id: f.first.owner.id, cost_exception: "pending_reconciliation" }, denied.client)), []);
});

test("malformed and unsupported combinations fail closed; field permissions, identity and recent MFA remain mandatory", async () => {
  const invalid: Record<string, string>[] = [{ active_from: f.at(-1), active_to: f.at(-2) }, { activity: "unknown", active_from: f.at(-1) }, { charge_min_micros: "9", charge_max_micros: "8" }, { charge_min_micros: "1.2" }, { charge_max_micros: "01" }, { charge_min_micros: "1e6" }, { balance_required_micros: "1" }, { balance_state: "insufficient", balance_required_micros: "0" }, { role_usage: "started" }, { vip_plan: "' OR 1=1--", unrelated: "true" }];
  for (const q of invalid) assert.equal((await historyCall(s, admin.client, "GET", query(q))).status, 400);
  const limited = await overviewAdmin(s, ["admin.users.read"]);
  const restricted: Record<string, string>[] = [{ charge_min_micros: "0" }, { role_key: "assistant" }, { cost_exception: "none" }, { vip_plan: "pro" }, { balance_state: "insufficient" }];
  for (const q of restricted) assert.equal((await historyCall(s, limited.client, "GET", query(q))).status, 403);
  assert.equal((await historyCall(s, f.first.owner, "GET", query())).status, 401);
  await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1", [limited.id]);
  assert.equal((await historyCall(s, limited.client, "GET", query())).data.error.code, "MFA_REQUIRED");
});

test("signed keyset pagination binds new filters and current grants; repeated pages never duplicate users", async () => {
  const q = { view: "operations", activity: "known", limit: "1" }, first = await list(q); assert.ok(first.next_cursor);
  const second = await list({ ...q, cursor: first.next_cursor }); assert.equal(second.next_cursor, null); assert.notEqual(first.items[0].id, second.items[0].id);
  assert.deepEqual(new Set([...ids(first), ...ids(second)]), new Set([f.first.owner.id, f.outside.owner.id]));
  assert.equal((await historyCall(s, admin.client, "GET", query({ ...q, activity: "unknown", cursor: first.next_cursor }))).status, 400);
  const revoked = await overviewAdmin(s, directoryPermissions); const page = await list(q, revoked.client);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [revoked.id]);
  assert.equal((await historyCall(s, revoked.client, "GET", query({ ...q, cursor: page.next_cursor }))).status, 403);
});

test("successful account access is throttled without identity revisions; rejected access and Admin reads do not count or invent origin", async () => {
  const read = async () => (await s.db.control.query("SELECT version,auth_version,last_active_at,registration_source FROM users WHERE id=$1", [f.second.owner.id])).rows[0];
  const initial = await read(); assert.equal(initial.last_active_at, null); await list({ user_id: f.second.owner.id, view: "operations" }); assert.deepEqual(await read(), initial);
  const bad = await s.app.inject({ method: "POST", url: "/v1/tenants", headers: { origin: s.db.config.WEB_ORIGIN, cookie: f.second.owner.cookie, "x-csrf-token": "invalid" }, payload: { name: "Rejected", project_name: "Rejected" } });
  assert.equal(bad.statusCode, 403); assert.deepEqual(await read(), initial);
  await historyOk(s, f.second.owner, "GET", "/v1/me"); const active = await read(); assert.ok(active.last_active_at); assert.equal(active.version, initial.version); assert.equal(active.auth_version, initial.auth_version); assert.equal(active.registration_source, null);
  await historyOk(s, f.second.owner, "GET", "/v1/me"); assert.deepEqual(await read(), active);
  await s.db.control.query("UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1", [f.second.owner.email]);
  const login = await historyLogin(s, f.second.owner.email); assert.equal((await read()).registration_source, null);
  await s.db.control.query("UPDATE users SET last_active_at=NULL WHERE id=$1", [login.id]);
  await s.db.control.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [login.id]);
  assert.equal((await historyCall(s, login, "GET", "/v1/me")).status, 401); assert.equal((await read()).last_active_at, null);
  const fresh = await historyLogin(s); const row = (await s.db.control.query("SELECT registration_source,last_active_at FROM users WHERE id=$1", [fresh.id])).rows[0]; assert.equal(row.registration_source, "email_otp"); assert.ok(row.last_active_at);
});
