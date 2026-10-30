import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { seal } from "../src/lib.js";
import type { buildApp } from "../src/server.js";
export type System = Awaited<ReturnType<typeof buildApp>>;
export type HistoryClient = { id: string; cookie: string; csrf: string; email: string; tenant?: string };
export const historyPermissions = ["admin.content.read", "admin.content.body.read"];
export async function historyCall(s: System, client: HistoryClient | null, method: string, url: string, body?: any) {
  const raw = await s.app.inject({ method: method as any, url,
    headers: { origin: url.startsWith("/v1/admin/") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(client ? {cookie: client.cookie, "x-csrf-token": client.csrf} : {}),
      ...(client?.tenant ? {"x-tenant-id": client.tenant} : {}), "idempotency-key": randomUUID() },
    ...(body === undefined ? {} : { payload: body }) });
  return {status: raw.statusCode, data: raw.json(), raw};
}
export async function historyOk(s: System, client: HistoryClient | null, method: string, url: string, body?: any) {
  const r = await historyCall(s, client, method, url, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
export async function historyLogin(s: System, email = `history-${randomUUID()}@example.invalid`, secret?: OTPAuth.Secret) {
  const base = secret ? "/v1/admin/auth" : "/v1/auth";
  const challenge = await historyOk(s, null, "POST", base + "/challenge", {email});
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`, "utf8"));
  let totp: string | undefined;
  if (secret) {
    const previous = Number((await s.db.control.query("SELECT last_totp_step FROM admin_principals WHERE email=$1", [email])).rows[0].last_totp_step);
    const step = Math.max(Math.floor(Date.now() / 30000), previous + 1);
    totp = new OTPAuth.TOTP({secret, digits: 6, period: 30, algorithm: "SHA1"}).generate({timestamp: step * 30000});
  }
  const r = await historyCall(s, null, "POST", base + "/verify", {
    challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0], ...(secret ? {totp} : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(v => v.name === (secret ? "cp_admin_session" : "cp_session"))!;
  return {id: r.data.user?.id ?? r.data.admin?.id, cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token, email} as HistoryClient;
}
export async function historyAdmin(s: System, project: string, permissions = historyPermissions, authenticate = true) {
  const email = `history-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({size: 20});
  const id = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Content history operator',$2) RETURNING id",
    [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0].id;
  const role = "history_" + randomUUID();
  await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Explicit history fixture',$2)", [role, JSON.stringify(permissions)]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [id, role, project]);
  return {id, email, secret, role, client: authenticate ? await historyLogin(s, email, secret) : null};
}
export async function historyFixture(s: System, options: {versions?: number; notes?: number; authenticateAdmin?: boolean} = {}) {
  const owner = await historyLogin(s), workspace = await historyOk(s, owner, "POST", "/v1/tenants", {
    name: "Explicit synthetic history company", project_name: "Hong Kong content review" });
  owner.tenant = workspace.tenant.id;
  const tenant = workspace.tenant.id, project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const agent = await historyOk(s, owner, "POST", base + "/agents", {
    name: "Harbour saved specialist", role_key: "assistant", instructions: "Customer instructions version 1" });
  const memory = await historyOk(s, owner, "POST", base + "/memories", {
    name: "Harbour retained guidance", content: "Approved customer guidance version 1", scope: "project", expires_at: null });
  for (let n = 2; n <= (options.versions ?? 3); n++) {
    await historyOk(s, owner, "PATCH", base + "/agents/" + agent.id, {
      expected_version: n - 1, name: agent.name, role_key: "assistant", instructions: "Customer instructions version " + n });
    await historyOk(s, owner, "PATCH", base + "/memories/" + memory.id, {
      expected_version: n - 1, name: memory.name, content: "Approved customer guidance version " + n, scope: "project", expires_at: null });
  }
  const conversation = await historyOk(s, owner, "POST", base + "/conversations", {
    name: "Harbour customer conversation", agent_id: agent.id });
  for (let n = 1; n <= (options.notes ?? 3); n++)
    await historyOk(s, owner, "POST", base + `/conversations/${conversation.id}/messages`, {
      client_message_id: randomUUID(), expected_version: n, intent: "note",
      body: `Customer note ${String(n).padStart(3,"0")} · 香港營銷資料 · Explicit synthetic content` });
  const operator = await historyAdmin(s, project, historyPermissions, options.authenticateAdmin !== false);
  return {owner, tenant, project, base, agent, memory, conversation, operator};
}
export const historyUrl = (kind: string, id: string, query = "") => `/v1/admin/content/${kind}/${id}/history${query ? "?" + query : ""}`;
