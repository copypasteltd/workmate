import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { seal, hash } from "../src/lib.js";
import { fund, settle } from "../src/billing.js";
import { defaults } from "../src/plans.js";
import { historyCall, historyOk, historyLogin, type HistoryClient, type System } from "./admin-history-fixture.js";

export const overviewPermissions = ["admin.overview.read", "admin.users.read", "admin.usage.read", "admin.billing.read", "admin.execution.read"];
export async function overviewBind(s: System, actor: string, permissions: string[], kind = "global", scope: string | null = null, effect = "allow") {
  const role = "overview160_" + randomUUID();
  await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Explicit synthetic overview fixture',$2)", [role, JSON.stringify(permissions)]);
  const binding = (await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5) RETURNING id", [actor, role, kind, scope, effect])).rows[0];
  return binding.id as string;
}
export async function overviewAdmin(s: System, permissions = overviewPermissions, authenticate = true) {
  const email = "overview160-" + randomUUID() + "@example.invalid", secret = new OTPAuth.Secret({ size: 20 });
  const id = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic finance operator',$2) RETURNING id", [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0].id;
  await overviewBind(s, id, permissions);
  return { id, email, secret, client: authenticate ? await historyLogin(s, email, secret) : null };
}
export async function overviewWorkspace(s: System) {
  const owner = await historyLogin(s), w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Synthetic Hong Kong studio", project_name: "Campaign accounting" });
  owner.tenant = w.tenant.id;
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic overview test entitlement',$2)", [w.tenant.id, defaults.business]);
  const mode = s.db.config.DEMO_MODE ? "simulated" : "configured_services";
  const wallets = (await s.db.control.query("SELECT id,user_id FROM wallets WHERE tenant_id=$1 OR (user_id=$2 AND data_mode=$3)", [w.tenant.id, owner.id, mode])).rows;
  const tenantWallet = wallets.find(r => !r.user_id).id as string, personalWallet = wallets.find(r => r.user_id).id as string;
  for (const id of [tenantWallet, personalWallet]) await s.db.tx(tx => fund(tx, { billing_account_id: id, action: "gift", amount_micros: 20_000_000, expires_at: new Date(Date.now() + 86_400_000).toISOString(), reason: "Explicit synthetic overview credit; no real payment" }, randomUUID()), w.tenant.id, true, owner.id);
  return { owner, tenant: w.tenant.id as string, project: w.project.id as string, tenantWallet, personalWallet };
}
export type OverviewWorkspace = Awaited<ReturnType<typeof overviewWorkspace>>;
export async function overviewTask(s: System, f: OverviewWorkspace, wallet = f.tenantWallet) {
  const r = await s.app.inject({ method: "POST", url: `/v1/tenants/${f.tenant}/projects/${f.project}/tasks`, headers: { origin: s.db.config.WEB_ORIGIN, cookie: f.owner.cookie, "x-csrf-token": f.owner.csrf, "x-tenant-id": f.tenant, "x-billing-account-id": wallet, "idempotency-key": randomUUID() }, payload: { title: "Synthetic campaign accounting", prompt: "Explicit synthetic accounting fixture. No real model call.", role_key: "assistant", budget_micros: 1_000_000 } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
export async function overviewSettle(s: System, f: OverviewWorkspace, task: string, amount = 875_000, unknown = false) {
  await s.db.tx(tx => settle(tx, f.tenant, task, amount, f.owner.id, unknown), undefined, true);
}
export const overviewGet = (s: System, client: HistoryClient | null) => historyCall(s, client, "GET", "/v1/admin/overview");

/** Exercise the real enrolled-node/quote/hold/settlement controller using only
 * synthetic protocol messages. This never starts a computer, VM or container. */
export async function overviewCloudCharge(s: System, f: OverviewWorkspace) {
  const admin = await overviewAdmin(s, ["admin.cloud_runtime.infrastructure.write"]);
  const request = async (client: HistoryClient | null, method: string, url: string, body?: unknown, bearer?: string): Promise<any> => {
    const r = await s.app.inject({ method: method as any, url, headers: { origin: url.startsWith("/v1/admin") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN, ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}), ...(bearer ? { authorization: "Bearer " + bearer } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    assert.equal(r.statusCode, 200, method + " " + url + ": " + r.body);
    return r.json();
  };
  const plan = { key: "overview160-" + randomUUID().slice(0, 8), name: "Synthetic accounting resource", region: "Hong Kong", cpu_cores: 4, memory_mib: 8192, disk_mib: 32768, per_minute_micros: 2_000_000, max_minutes: 30, terminal: true, visual: true, reason: "Explicit synthetic control-plane accounting fixture" };
  await request(admin.client, "POST", "/v1/admin/cloud-computers/plans", { plan, enabled: true, expected_version: 0 });
  const machine = hash("overview160-machine-" + randomUUID());
  const node = await request(admin.client, "POST", "/v1/admin/cloud-computers/nodes", { name: "Synthetic node protocol", plan_key: plan.key, machine_fingerprint: machine, reason: plan.reason });
  const instance = randomUUID();
  const poll = (session: string | null = null, generation = 0) => request(null, "POST", `/v1/cloud-runtime-nodes/${node.id}/poll`, { machine_fingerprint: machine, instance_id: instance, agent_version: "1.0.0", physical_host: true, current_session_id: session, current_generation: generation }, node.enrollment_token);
  const ack = (command: any, outcome: string, cleanup = false, ms = 0) => request(null, "POST", `/v1/cloud-runtime-nodes/${node.id}/acknowledgements`, { instance_id: instance, command_id: command.id, session_id: command.session_id, generation: command.generation, outcome, cleanup_verified: cleanup, running_milliseconds: ms }, node.enrollment_token);
  await poll();
  const base = `/v1/tenants/${f.tenant}/projects/${f.project}/cloud-computers`;
  const quote = await request(f.owner, "POST", base + "/quotes", { plan_key: plan.key, minutes: 5, billing_account_id: f.tenantWallet, scope: { terminal: true, visual: true, selected_asset_versions: [], purpose: "Explicit synthetic accounting fixture, no physical execution" } });
  const session = await request(f.owner, "POST", base + "/sessions", { quote_id: quote.id, specification_hash: quote.specification_hash, maximum_cost_micros: quote.maximum_cost_micros, confirm_cost_and_scope: true });
  const start = (await poll()).commands[0];
  assert.equal(start.kind, "start");
  await ack(start, "ready");
  await request(f.owner, "POST", base + "/sessions/" + session.id + "/stop", {});
  const stop = (await poll(session.id, start.generation)).commands[0];
  assert.equal(stop.kind, "stop");
  await ack(stop, "stopped", true, 60_000);
  const charge = (await s.db.control.query("SELECT amount_micros,task_id FROM ledger WHERE cloud_runtime_session_id=$1", [session.id])).rows;
  assert.equal(charge.length, 1); assert.equal(charge[0].task_id, null); assert.equal(charge[0].amount_micros, "-2000000");
  return session.id as string;
}
