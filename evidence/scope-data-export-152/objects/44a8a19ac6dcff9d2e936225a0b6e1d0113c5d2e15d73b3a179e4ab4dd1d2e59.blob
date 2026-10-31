import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { scopeExportCatalog } from "../src/scope-export-catalog.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, historyFixture, historyAdmin, type HistoryClient } from "./admin-history-fixture.js";

let s: Awaited<ReturnType<typeof buildApp>>, isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, address = 0;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function fixture() {
  const owner = await historyLogin(s), w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Synthetic Harbour export studio", project_name: "Complete customer work" });
  const tenant = w.tenant.id, project = w.project.id; owner.tenant = tenant;
  return { owner, tenant, project, base: `/v1/tenants/${tenant}/projects/${project}`, workspace: `/v1/tenants/${tenant}` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function raw(client: HistoryClient | null, url: string, tenant = client?.tenant) {
  const n = ++address;
  return s.app.inject({ method: "GET", url, remoteAddress: `127.2.${Math.floor(n / 250)}.${n % 250 + 1}`,
    headers: { origin: url.startsWith("/v1/admin/") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(client ? { cookie: client.cookie } : {}), ...(tenant ? { "x-tenant-id": tenant } : {}) } });
}
async function preview(client: HistoryClient, base: string) { const r = await raw(client, base + "/export-preview"); assert.equal(r.statusCode, 200, r.body); return r.json(); }
async function archive(client: HistoryClient, base: string, expected?: string) {
  const snapshot = expected ?? (await preview(client, base)).snapshot;
  return raw(client, base + "/export-package?" + new URLSearchParams({ expected_snapshot: snapshot, acknowledge: "true" }));
}
function decode(r: Awaited<ReturnType<typeof raw>>) {
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.headers["x-content-sha256"], hash(r.rawPayload));
  assert.equal(Number(r.headers["content-length"]), r.rawPayload.length);
  const files = unzipSync(r.rawPayload), text = (name: string) => Buffer.from(files[name]).toString("utf8");
  const manifest = JSON.parse(text("manifest.json"));
  for (const line of text("SHA256SUMS").trim().split("\n")) { const [digest, name] = line.split("  "); assert.equal(hash(Buffer.from(files[name])), digest, name); }
  return { files, manifest, rows: (name: string) => text("data/" + name + ".ndjson").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) };
}
async function asset(f: Fixture, name = "原始資料.txt", actor = f.owner, privateFile = false, existing?: { id: string }) {
  const bytes = Buffer.from("Original retained bytes · " + randomUUID());
  const row = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: actor.id, name,
    mime: "text/plain", bytes, ...(privateFile ? { privateOwner: actor.id } : {}), ...(existing ? { asset: existing.id, expectedVersion: 1 } : {}),
    metadata: { customer_note: "Keep customer business data", access_token: "system-secret-must-not-export" } }), f.tenant, false, actor.id);
  return { ...row, bytes };
}
async function member(f: Fixture) {
  const c = await historyLogin(s); c.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')", [f.tenant, c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, c.id]); return c;
}
const csv = "date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Harbour,ad-1,1000,20,12,2,40,HKD";
const metrics = { name: "Original ad CSV", source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong", account_id: "synthetic-account", entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases", csv };

test("every explicitly exported column exists in the real migrated schema and customer queries retain SELECT access", async () => {
  const schema = (await s.db.control.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
  const missing: string[] = [];
  for (const d of scopeExportCatalog) {
    for (const col of d.columns.split(" ").filter(Boolean)) if (!schema.some(c => c.table_name === d.table && c.column_name === col)) missing.push(d.table + "." + col);
    if (!(await s.db.control.query("SELECT has_table_privilege('cp_app',$1,'SELECT') AS ok", [d.table])).rows[0].ok) missing.push(d.table + ":missing customer SELECT");
  }
  assert.deepEqual(missing, []);
});

test("complete ZIP contains original CSV, every retained file version and full conversation/memory history with independent checksums and no new fees", async () => {
  const h = await historyFixture(s, { versions: 3, notes: 4 }), f: Fixture = { ...h, workspace: `/v1/tenants/${h.tenant}` };
  const v1 = await asset(f), v2 = await asset(f, v1.name, f.owner, false, v1);
  const dataset = await historyOk(s, f.owner, "POST", f.base + "/analytics/import", metrics);
  const before = (await s.db.control.query("SELECT (SELECT count(*) FROM ledger WHERE tenant_id=$1) ledger,(SELECT count(*) FROM current_ai_provider_requests WHERE tenant_id=$1) requests", [f.tenant])).rows;
  const p = await preview(f.owner, f.base), z = decode(await archive(f.owner, f.base, p.snapshot));
  assert.equal(z.manifest.snapshot, p.snapshot); assert.equal(z.rows("conversation_messages").length, 4);
  assert.equal(z.rows("memory_versions").filter((r: any) => r.memory_id === h.memory.id).length, 3);
  assert.equal(z.rows("agent_versions").filter((r: any) => r.agent_id === h.agent.id).length, 3);
  assert.equal(z.rows("analytics_datasets").find((r: any) => r.id === dataset.id).raw_csv, csv);
  for (const v of [v1, v2]) { const entry = z.manifest.files.find((r: any) => r.version_id === v.version.id); assert.ok(entry); assert.deepEqual(Buffer.from(z.files[entry.path]), v.bytes); }
  assert.doesNotMatch(JSON.stringify(z.manifest), /storage_key|system-secret/);
  const exportedVersion = z.rows("asset_versions").find((r: any) => r.id === v1.version.id); assert.equal(exportedVersion.metadata.customer_note, "Keep customer business data"); assert.equal(exportedVersion.metadata.access_token, undefined);
  assert.deepEqual((await s.db.control.query("SELECT (SELECT count(*) FROM ledger WHERE tenant_id=$1) ledger,(SELECT count(*) FROM current_ai_provider_requests WHERE tenant_id=$1) requests", [f.tenant])).rows, before);
});

test("current project viewers can export readable project content while workspace exports, cross-company access and suspended memberships are denied", async () => {
  const f = await fixture(), c = await member(f), other = await fixture();
  await s.db.control.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2", [f.project, c.id]);
  assert.equal((await raw(null, f.base + "/export-preview")).statusCode, 401);
  assert.equal((await raw(other.owner, f.base + "/export-preview", f.tenant)).statusCode, 404);
  assert.equal((await raw(f.owner, f.base + "/export-preview", other.tenant)).statusCode, 400);
  assert.equal((await raw(c, f.workspace + "/export-preview")).statusCode, 403);
  assert.equal((await raw(c, f.base + "/export-preview")).statusCode, 200);
  await s.db.control.query("UPDATE memberships SET admin_suspended=true WHERE tenant_id=$1 AND user_id=$2", [f.tenant, c.id]);
  assert.equal((await raw(c, f.base + "/export-preview")).statusCode, 404);
});

test("owners do not inherit another member's private content and administrators export shared content only", async () => {
  const f = await fixture(), c = await member(f), shared = await asset(f), own = await asset(f, "Owner private.txt", f.owner, true), theirs = await asset(f, "Member private.txt", c, true);
  const conversation = await historyOk(s, c, "POST", f.base + "/conversations", { name: "Other member private discussion" });
  const owner = decode(await archive(f.owner, f.base));
  assert.ok(owner.manifest.files.some((r: any) => r.asset_id === own.id)); assert.ok(!owner.manifest.files.some((r: any) => r.asset_id === theirs.id));
  assert.ok(!owner.rows("conversations").some((r: any) => r.id === conversation.id));
  const a = await historyAdmin(s, f.project, ["admin.exports.create", "admin.content.body.read"]), admin = decode(await archive(a.client!, `/v1/admin/scopes/projects/${f.project}`));
  assert.equal(admin.manifest.audience, "admin_shared_content"); assert.equal(admin.manifest.versions, 1); assert.equal(admin.manifest.files.find((r: any) => r.asset_id)?.asset_id, shared.id);
  assert.equal(admin.rows("conversations").length, 0);
});

test("workspace memories appear once beyond ordinary UI pagination; project exports explicitly exclude global and personal scope", async () => {
  const f = await fixture();
  for (const scope of ["tenant", "personal"]) await historyOk(s, f.owner, "POST", f.base + "/memories", { scope, name: scope + " guidance", content: "Complete " + scope + " memory", expires_at: null });
  await s.db.tx(async tx => {
    await tx.query(`WITH inserted AS (INSERT INTO memories(tenant_id,project_id,scope,name,created_by)
      SELECT $1,$2,'project','Complete guidance '||n,$3 FROM generate_series(1,205) n RETURNING id,tenant_id)
      INSERT INTO memory_versions(tenant_id,memory_id,version,content,created_by) SELECT tenant_id,id,1,'Beyond the UI page',$3 FROM inserted`, [f.tenant, f.project, f.owner.id]);
  }, f.tenant, false, f.owner.id);
  assert.equal(decode(await archive(f.owner, f.base)).rows("memories").length, 205);
  const all = decode(await archive(f.owner, f.workspace)); assert.equal(all.rows("memories").length, 207); assert.equal(all.rows("memory_versions").length, 207);
});

test("changed previews, archived projects, removed project access and pending workspace erasure never download stale content", async () => {
  const f = await fixture(), c = await member(f), p = await preview(f.owner, f.base); await asset(f);
  assert.equal((await archive(f.owner, f.base, p.snapshot)).statusCode, 409);
  const m = await preview(c, f.base); await s.db.control.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.project, c.id]);
  assert.equal((await archive(c, f.base, m.snapshot)).statusCode, 404);
  await historyOk(s, f.owner, "PATCH", f.base, { archived: true, expected_archived: false });
  assert.equal((await raw(f.owner, f.base + "/export-preview")).statusCode, 409);
  const workspace = await preview(f.owner, f.workspace); assert.equal(workspace.projects.length, 0); assert.equal(workspace.archived_projects[0].id, f.project);
  await historyOk(s, f.owner, "POST", f.workspace + "/erasure", { confirmation: "Synthetic Harbour export studio", reason_code: "workspace_closure", acknowledge_irreversible: true, acknowledge_retention: true });
  assert.equal((await archive(f.owner, f.workspace, workspace.snapshot)).statusCode, 404);
});

test("a quarantined fixed workflow output is excluded and corrupt original bytes fail before a ZIP is sent", async () => {
  const f = await fixture(), file = await asset(f), definition = { steps: [{ kind: "approval", label: "Customer decision" }] };
  const workflow = (await s.db.control.query("INSERT INTO workflows(tenant_id,project_id,name,definition,created_by) VALUES($1,$2,'Retained workflow',$3,$4) RETURNING id", [f.tenant, f.project, JSON.stringify(definition), f.owner.id])).rows[0].id;
  const run = (await s.db.control.query("INSERT INTO workflow_runs(tenant_id,project_id,workflow_id,created_by,actor_auth_version,definition,results,state) VALUES($1,$2,$3,$4,1,$5,$6,'succeeded') RETURNING id", [f.tenant, f.project, workflow, f.owner.id, JSON.stringify(definition), JSON.stringify([{ kind: "analytics.summary", asset_version_id: file.version.id }])])).rows[0].id;
  assert.ok(decode(await archive(f.owner, f.base)).rows("workflow_runs").some((r: any) => r.id === run));
  await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [file.id]);
  assert.ok(!decode(await archive(f.owner, f.base)).rows("workflow_runs").some((r: any) => r.id === run));
  const damaged = await asset(f, "damaged.txt"), p = await preview(f.owner, f.base), key = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [damaged.version.id])).rows[0].storage_key;
  await writeFile(path.join(s.db.config.DATA_DIR, key), Buffer.alloc(damaged.bytes.length, 33));
  const response = await archive(f.owner, f.base, p.snapshot); assert.ok(response.statusCode >= 400); assert.match(String(response.headers["content-type"]), /json/);
  assert.ok(!(await readdir(s.db.config.DATA_DIR)).some(name => name.startsWith("scope-export-")));
});

test("administrator exports require independent body/export permissions, recent MFA and all project denies even for workspace selection", async () => {
  const f = await fixture(), a = await historyAdmin(s, f.project, ["admin.exports.create", "admin.content.body.read"]), base = `/v1/admin/scopes/projects/${f.project}`;
  const forbidden = await historyAdmin(s, f.project, ["admin.exports.create"]); assert.equal((await raw(forbidden.client!, base + "/export-preview")).statusCode, 403);
  await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1", [a.id]); assert.equal((await raw(a.client!, base + "/export-preview")).statusCode, 403);
  await s.db.control.query("UPDATE sessions SET mfa_at=now() WHERE admin_id=$1", [a.id]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)", [a.id, a.role, f.tenant]);
  assert.equal((await raw(a.client!, `/v1/admin/scopes/tenants/${f.tenant}/export-preview`)).statusCode, 200);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')", [a.id, a.role, f.project]);
  assert.equal((await raw(a.client!, `/v1/admin/scopes/tenants/${f.tenant}/export-preview`)).statusCode, 403);
});
