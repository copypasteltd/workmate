import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, historyCall, type HistoryClient } from "./admin-history-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { defaults } from "../src/plans.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { deliveryFilename } from "../src/delivery-package.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, address = 0;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "controlled-fixture", AI_MODEL: "controlled-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function fixture() {
  const owner = await historyLogin(s), w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Explicit synthetic ZIP customer", project_name: "Delivery closure" });
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`; owner.tenant = tenant;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic delivery test only',$2)", [tenant, defaults.business]);
  const agent = await historyOk(s, owner, "POST", base + "/agents", { name: "Delivery test assistant", role_key: "assistant" });
  return { owner, tenant, project, base, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
class FixtureRuntime extends CodexRuntimeAdapter {
  constructor(private files = 2, private source?: string, private fail = false, private text = "Explicit simulated delivery result") { super(s.db.config); }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    if (this.source) await ctx.tools.find(t => t.name === "asset_text_read")!.run({ asset_id: this.source }, "delivery-source-read");
    for (let i = 0; i < this.files; i++) await ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "same-name.md", content: "Actual fixture bytes " + i, mime_type: "text/markdown" }, "delivery-file-" + i);
    if (this.fail) throw new Error("Explicit simulated model failure after partial file delivery");
    return { text: this.text, inputTokens: 10, outputTokens: 20, accepted: true, usageKnown: true, status: "completed", thread: "synthetic-zip-fixture", turn: "1" };
  }
}
async function completed(f: Fixture, options: { private?: boolean; files?: number; source?: string; fail?: boolean; text?: string } = {}) {
  const task = await historyOk(s, f.owner, "POST", f.base + "/tasks", { title: "Synthetic delivery fixture", prompt: "Produce clearly simulated task outputs", role_key: "assistant",
    ...(options.private ? { agent_id: f.agent.id } : {}), budget_micros: 1000000 });
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime(options.files, options.source, options.fail, options.text)).run(f.tenant, task.id);
  const q = await historyOk(s, f.owner, "GET", f.base + "/tasks/" + task.id + "/quality");
  assert.equal(q.technical_status, options.fail ? "failed" : "succeeded"); return q;
}
function url(f: Fixture, q: any) { return f.base + "/tasks/" + q.task_id + "/delivery-package?" + new URLSearchParams({ expected_version: String(q.task_version), expected_delivery_hash: q.delivery_hash }); }
async function download(f: Fixture, q: any, client: HistoryClient | null = f.owner, override?: string) {
  return s.app.inject({ method: "GET", url: override ?? url(f, q), remoteAddress: `127.1.${Math.floor(++address / 250)}.${address % 250 + 1}`,
    headers: { origin: s.db.config.WEB_ORIGIN, ...(client ? { cookie: client.cookie, "x-tenant-id": f.tenant } : {}) } });
}
const decode = (raw: Buffer) => { const entries = unzipSync(raw); return { entries, manifest: JSON.parse(Buffer.from(entries["manifest.json"]).toString("utf8")) }; };
const counts = async (f: Fixture) => (await s.db.control.query(`SELECT
  (SELECT count(*) FROM tasks WHERE tenant_id=$1)::text AS tasks,
  (SELECT count(*) FROM ledger WHERE tenant_id=$1)::text AS charges,
  (SELECT count(*) FROM reservations WHERE tenant_id=$1)::text AS holds,
  (SELECT count(*) FROM current_ai_provider_requests WHERE tenant_id=$1)::text AS requests`, [f.tenant])).rows[0];

test("complete ZIP independently extracts every exact task file, result, manifest and bilingual recovery guide without new model charges", async () => {
  const f = await fixture(), q = await completed(f), before = await counts(f), r = await download(f, q);
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.headers["content-type"], "application/zip");
  assert.equal(r.headers["cache-control"], "no-store"); assert.equal(r.headers["x-content-sha256"], hash(r.rawPayload));
  assert.equal(Number(r.headers["content-length"]), r.rawPayload.length);
  const { entries, manifest } = decode(r.rawPayload);
  assert.equal(manifest.task_version, q.task_version); assert.equal(manifest.delivery_hash, q.delivery_hash);
  assert.deepEqual(manifest.delivery_snapshot, q.delivery); assert.equal(manifest.files.length, 3);
  assert.equal(new Set(manifest.files.map((file: any) => file.path.toLowerCase())).size, 3, "Duplicate human filenames cannot overwrite one another");
  for (const file of manifest.files) {
    assert.equal(hash(Buffer.from(entries[file.path])), file.sha256); assert.equal(entries[file.path].length, file.bytes);
    assert.ok(!("storage_key" in file)); assert.ok(!("content" in file));
    if (file.asset_id) { const original = await s.app.inject({ method: "GET", url: f.base + "/assets/" + file.asset_id + "/download?version=" + file.version, headers: { cookie: f.owner.cookie, origin: s.db.config.WEB_ORIGIN } });
      assert.equal(original.statusCode, 200); assert.deepEqual(Buffer.from(entries[file.path]), original.rawPayload); }
  }
  const guide = Buffer.from(entries["README.md"]).toString(); assert.match(guide, /繼續編輯/); assert.match(guide, /Continue editing/);
  for (const line of Buffer.from(entries["SHA256SUMS"]).toString().trim().split("\n")) { const [digest, name] = line.split("  "); assert.equal(hash(Buffer.from(entries[name])), digest); }
  assert.deepEqual(await counts(f), before);
  const audit = (await s.db.control.query("SELECT count(*) AS n FROM audit_log WHERE target=$1 AND action='task.delivery_package.download'", [q.task_id])).rows[0]; assert.equal(Number(audit.n), 1);
});
test("an identical fixed-version export reproduces archive bytes", async () => {
  const f = await fixture(), q = await completed(f, { files: 1 });
  const first = await download(f, q), second = await download(f, q); assert.equal(first.statusCode, 200, first.body); assert.equal(second.statusCode, 200, second.body); assert.deepEqual(first.rawPayload, second.rawPayload);
});
test("authentication, cross-company access and another member's private outputs are fenced", async () => {
  const f = await fixture(), other = await fixture(), q = await completed(f, { private: true });
  assert.equal((await download(f, q, null)).statusCode, 401); assert.equal((await download(f, q, other.owner)).statusCode, 404);
  const member = await historyLogin(s); await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, member.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, member.id]);
  assert.equal((await download(f, q, member)).statusCode, 404); assert.equal((await download(f, q)).statusCode, 200);
});
test("a project viewer can download shared delivery and cannot approve it; removal takes effect immediately", async () => {
  const f = await fixture(), q = await completed(f), viewer = await historyLogin(s); viewer.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'viewer','active')", [f.tenant, viewer.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, viewer.id]);
  assert.equal((await download(f, q, viewer)).statusCode, 200);
  const denied = await historyCall(s, viewer, "POST", f.base + "/tasks/" + q.task_id + "/reviews", { expected_version: q.task_version, expected_delivery_hash: q.delivery_hash, decision: "accepted" }); assert.equal(denied.status, 403);
  await s.db.control.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.project, viewer.id]); assert.equal((await download(f, q, viewer)).statusCode, 404);
});
test("a stale task review version and a replaced asset head cannot silently change the selected export", async () => {
  const f = await fixture(), q = await completed(f);
  await historyOk(s, f.owner, "POST", f.base + "/tasks/" + q.task_id + "/reviews", { expected_version: q.task_version, expected_delivery_hash: q.delivery_hash, decision: "accepted" });
  assert.equal((await download(f, q)).statusCode, 409);
  const now = await historyOk(s, f.owner, "GET", f.base + "/tasks/" + q.task_id + "/quality"), file = now.delivery.artifacts[0];
  await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, asset: file.id, expectedVersion: file.version,
    name: "updated.md", mime: "text/markdown", bytes: Buffer.from("New real fixture version"), metadata: { task_id: q.task_id } }), f.tenant, false, f.owner.id);
  assert.equal((await download(f, now)).statusCode, 409);
  const fresh = await historyOk(s, f.owner, "GET", f.base + "/tasks/" + q.task_id + "/quality"), r = await download(f, fresh); assert.equal(r.statusCode, 200, r.body);
  assert.ok(decode(r.rawPayload).manifest.files.some((x: any) => x.asset_id === file.id && x.version === 2));
});
test("text-only delivery exports correctly and an empty delivery has no fabricated files", async () => {
  const f = await fixture(), text = await completed(f, { files: 0 }), r = await download(f, text); assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(decode(r.rawPayload).manifest.files.map((x: any) => x.path), ["result.md"]);
  const empty = await completed(f, { files: 0, text: "" }); assert.equal((await download(f, empty)).statusCode, 409);
});
test("failure after a real file delivery exports explicitly partial outputs", async () => {
  const f = await fixture(), q = await completed(f, { files: 1, fail: true }), r = await download(f, q); assert.equal(r.statusCode, 200, r.body);
  const { manifest, entries } = decode(r.rawPayload); assert.equal(manifest.complete_task, false); assert.equal(manifest.technical_status, "failed");
  assert.equal(manifest.files.length, 1); assert.match(Buffer.from(entries["README.md"]).toString(), /partial outputs/);
});
test("withdrawn source material blocks export of its derived task results", async () => {
  const f = await fixture(), source = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, name: "source.txt", mime: "text/plain", bytes: Buffer.from("Explicit private fixture evidence") }), f.tenant, false, f.owner.id);
  const q = await completed(f, { source: source.id }); await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [source.id]);
  const r = await download(f, q); assert.ok([404, 409].includes(r.statusCode), r.body); assert.ok(!r.headers["content-disposition"]);
});
test("project access revocation during archive construction is rechecked before any ZIP response", async () => {
  const f = await fixture(), q = await completed(f), original = s.storage.stream.bind(s.storage); let revoked = false;
  s.storage.stream = async key => { if (!revoked) { revoked = true; await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1", [f.project]); } return original(key); };
  try { const r = await download(f, q); assert.equal(r.statusCode, 404, r.body); assert.ok(!r.headers["content-disposition"]); } finally { s.storage.stream = original; }
});
test("corrupt stored bytes fail the entire archive, create no success audit and remove owned temporary files", async () => {
  const f = await fixture(), q = await completed(f), version = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [q.delivery.artifacts[0].version_id])).rows[0];
  await writeFile(path.resolve(s.db.config.DATA_DIR, version.storage_key), Buffer.from("Corrupted fixture bytes"));
  const r = await download(f, q); assert.equal(r.statusCode, 500, r.body); assert.ok(!r.headers["content-disposition"]);
  assert.equal(Number((await s.db.control.query("SELECT count(*) AS n FROM audit_log WHERE target=$1 AND action='task.delivery_package.download'", [q.task_id])).rows[0].n), 0);
  assert.deepEqual((await readdir(s.db.config.DATA_DIR)).filter(n => n.startsWith("delivery-package-")), []);
});
test("portable filenames never traverse paths, collide with Windows devices or carry control characters", () => {
  for (const value of ["../../secret.txt", "..\\..\\secret.txt", "CON.txt", "nul", "LPT1.pdf", "report\r\nname.svg", "\u202ehidden.exe", "...", "a:" + "字".repeat(300)]) {
    const name = deliveryFilename(value); assert.ok(name.length > 0); assert.ok(!/[<>:"/\\|?*\x00-\x1f\u202a-\u202e\u2066-\u2069]/.test(name)); assert.ok(!/^[. ]|[. ]$/.test(name)); assert.ok(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name));
  }
});
