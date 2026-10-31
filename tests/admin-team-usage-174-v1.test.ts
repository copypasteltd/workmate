import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { parse } from "csv-parse/sync";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { canonical, hash, seal, unseal } from "../src/lib.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { overviewAdmin, overviewBind } from "./admin-overview-fixture-160-v2.js";
import { historyCall, historyOk, type System } from "./admin-history-fixture.js";
import { reportPermissions, refundConsumption } from "./admin-usage-report-fixture-169-v1.js";
import { teamUsageFixture } from "./admin-team-usage-fixture-174-v1.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: System, f: Awaited<ReturnType<typeof teamUsageFixture>>, admin: Awaited<ReturnType<typeof overviewAdmin>>;
const root = "/v1/admin/usage-reports";
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false }); f = await teamUsageFixture(s); admin = await overviewAdmin(s, reportPermissions); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function snapshot(extra: any = {}, client = admin.client) { const saved = await historyOk(s, client, "POST", root, { ...f.filters, ...extra }); return historyOk(s, client, "GET", root + "/" + saved.id); }
async function csv(r: any, selection = "", client = admin.client) { const raw = await s.app.inject({ method: "GET", url: root + "/" + r.id + "/export" + selection, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: client!.cookie } }); assert.equal(raw.statusCode, 200, raw.body); return parse(raw.body, { columns: true, bom: true }) as Record<string, string>[]; }

test("actual team/run and coordinator/member work identities sum ledger entries once, without whole-team budgets or private content", async () => {
  const r = await snapshot(); assert.equal(r.total, 5); assert.equal(r.summary.confirmed_micros, "630025");
  assert.equal(r.team_attribution_version, 1);
  const team = r.groups.team.find((g: any) => g.key === f.group); assert.equal(team.works, 4); assert.equal(team.confirmed_micros, "520016");
  assert.equal(r.groups.team.find((g: any) => g.key === "standalone").confirmed_micros, "110009");
  assert.deepEqual(r.groups.team_run.filter((g: any) => g.key !== "standalone").map((g: any) => g.confirmed_micros).sort(), ["200004", "320012"]);
  for (const t of f.tasks) { const w = r.items.find((w: any) => w.id === t.id); assert.equal(w.team_id, f.group); assert.equal(w.team_run_id, t.run); assert.equal(w.team_node_key, t.node); assert.equal(w.team_attribution, "team"); }
  assert.ok(!JSON.stringify(r).includes(f.privateName)); assert.ok(!JSON.stringify(r).includes(f.outside));
});
test("team/run filters are intersected before bounded capture and retain both period bases", async () => {
  assert.equal((await snapshot({ team_id: f.group })).total, 4);
  for (const time_basis of ["work_created_at", "ledger_posted_at"]) {
    const r = await snapshot({ team_id: f.group, team_run_id: f.runs[0], time_basis }); assert.equal(r.total, 2); assert.equal(r.summary.confirmed_micros, "200004"); assert.ok(r.items.every((w: any) => w.team_run_id === f.runs[0]));
  }
  assert.equal((await snapshot({ team_id: randomUUID(), team_run_id: f.runs[0] })).total, 0);
});
test("team-run drilldown, exact work detail and CSV share one financial selection and watermark", async () => {
  const r = await snapshot(), q = "?group_by=team_run&group_key=" + f.runs[0];
  const selected = await historyOk(s, admin.client, "GET", root + "/" + r.id + q), rows = await csv(r, q);
  assert.equal(selected.total, 2); assert.equal(rows.length, 2); assert.equal(selected.summary.confirmed_micros, "200004");
  for (const row of rows) { assert.equal(row.team_id, f.group); assert.equal(row.team_run_id, f.runs[0]); assert.equal(row.watermark, r.watermark); }
  const task = f.tasks.find(t => t.run === f.runs[0] && t.node === "draft")!;
  const d = await historyOk(s, admin.client, "GET", `${root}/${r.id}/works/task/${task.id}` + q); assert.equal(d.work.team_node_key, "draft"); assert.equal(d.watermark, r.watermark);
  assert.equal((await historyCall(s, admin.client, "GET", `${root}/${r.id}/works/task/${f.tasks.find(t => t.run === f.runs[1])!.id}` + q)).status, 404);
});
test("team selection never grants outside-project or export authority", async () => {
  const scoped = await overviewAdmin(s, []); await overviewBind(s, scoped.id, reportPermissions, "project", f.second.project);
  assert.equal((await snapshot({ user_id: undefined, team_id: f.group }, scoped.client)).total, 0);
  const noExport = await overviewAdmin(s, ["admin.usage.read", "admin.users.read"]), r = await snapshot({ team_id: f.group }, noExport.client);
  const response = await s.app.inject({ method: "GET", url: `${root}/${r.id}/export?group_by=team_run&group_key=${f.runs[0]}`, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: noExport.client!.cookie } }); assert.equal(response.statusCode, 403);
});
test("later real consumption refunds change fresh team reports while the previous snapshot stays immutable", async () => {
  const before = await snapshot({ team_run_id: f.runs[0] });
  await refundConsumption(s, { first: f.first, company: f.tasks.find(t => t.run === f.runs[0] && t.node === "draft")!.id } as any, "10001");
  const after = await snapshot({ team_run_id: f.runs[0] }); assert.equal(after.summary.net_micros, "190003"); assert.equal(after.summary.refunded_micros, "10001");
  const retained = await historyOk(s, admin.client, "GET", root + "/" + before.id); assert.equal(retained.summary.net_micros, "200004"); assert.equal(retained.watermark, before.watermark);
});
test("a legacy encrypted snapshot remains unrecorded, keeps its old CSV columns and never invents standalone lineage", async () => {
  const r = await snapshot(), row = (await s.db.control.query("SELECT * FROM admin_data_previews WHERE id=$1", [r.id])).rows[0];
  const report = JSON.parse(unseal(s.db.config.MASTER_KEY!, row.payload_ciphertext)); delete report.team_attribution_version;
  for (const w of report.works) for (const key of ["team_id", "team_run_id", "team_node_key", "team_attribution"]) delete w[key];
  const raw = canonical(report);
  const legacy = (await s.db.control.query(`INSERT INTO admin_data_previews(principal_id,session_id,auth_version,access_hash,command,definition_hash,manifest,payload_ciphertext,payload_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [row.principal_id,row.session_id,row.auth_version,row.access_hash,row.command,row.definition_hash,row.manifest,seal(s.db.config.MASTER_KEY!,raw),hash(raw)])).rows[0];
  const old = await historyOk(s, admin.client, "GET", root + "/" + legacy.id); assert.equal(old.team_attribution_version, null); assert.deepEqual(old.groups.team.map((g: any) => g.key), ["unrecorded"]); assert.equal(old.groups.team_run[0].works, 5);
  const rows = await csv(old); assert.ok(!Object.hasOwn(rows[0], "team_run_id"));
});
