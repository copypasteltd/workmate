import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { projectAccess } from "../src/access.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { hash } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(c: Client | undefined, method: string, url: string, body?: unknown, requestKey = randomUUID()) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({ method: method as any, url, headers: {
    origin: s.db.config.WEB_ORIGIN, ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
    "idempotency-key": requestKey, ...(tenant ? { "x-tenant-id": tenant } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: unknown, requestKey = randomUUID()) {
  const r = await call(c, method, url, body, requestKey);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", { email: `creative-feedback-${randomUUID()}@example.invalid` });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(c => c.name === "cp_session")!;
  return { id: r.data.user.id, cookie: cookie.name + "=" + cookie.value, csrf: r.data.csrf_token };
}
const actor = (c: Client) => ({ id: c.id, email: "fixture@example.invalid", name: "Fixture", audience: "user" as const, authVersion: 1, sessionId: "", sessionHash: "" });
async function fixture(importOverrides: Record<string, unknown> = {}) {
  const owner = await user(), w = await ok(owner, "POST", "/v1/tenants", { name: "Confirmed creative evidence", project_name: "Isolated ad feedback" });
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  const asset = await s.db.tx(async tx => {
    await projectAccess(tx, actor(owner), tenant, project, "write");
    return saveAsset(tx, s.storage, { tenant, project, user: owner.id, name: "Harbour summer creative.png", mime: "image/png", bytes:
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2uS8AAAAASUVORK5CYII=", "base64") });
  }, tenant);
  const csv = "date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Autumn,ad-1,1000,100,10.000001,2,40,HKD\n2026-10-21,meta,Autumn,ad-1,2000,50,20,,60,HKD\n2026-10-20,meta,Autumn,ad-2,500,25,5,1,10,HKD";
  const imported = await ok(owner, "POST", base + "/analytics/import", { name: "Ad-level source", csv, source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong",
    account_id: "account-1", entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases", ...importOverrides });
  const input = { name: "Autumn creative / ad-1", asset_version_id: asset.version.id, dataset_id: imported.id, channel: "meta", campaign: "Autumn",
    ad_id: "ad-1", creative_id: "creative-1", date_from: "2026-10-20", date_to: "2026-10-21", match_source: "name_candidate", match_note: "Same label needs an explicit identity check", allocation: "single_creative_entire_ad" };
  return { owner, tenant, project, base, root: base + "/creative-feedback", asset, imported, input, csv };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, b: any = f.input, k = randomUUID()) => ok(f.owner, "POST", f.root + "/mappings", b, k);
const decision = (m: any) => ({ expected_version: m.version, expected_sha256: m.sha256, reason: "Checked the exact ad and asset version", confirm_single_creative_allocation: true });
const confirm = (f: Fixture, m: any, k = randomUUID()) => ok(f.owner, "POST", f.root + `/mappings/${m.id}/confirm`, decision(m), k);
const reportInput = (m: any, ids = [m.id]) => ({ name: "Creative performance evidence", mapping_ids: ids, date_from: "2026-10-20", date_to: "2026-10-21" });
const withdraw = (f: Fixture, m: any) => ok(f.owner, "POST", f.root + `/mappings/${m.id}/withdraw`, { expected_version: m.version, expected_sha256: m.sha256, reason: "The creative identity was withdrawn after review" });

before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "true" }), { worker: false });
});
after(async () => { await s?.app.close(); await isolated?.cleanup(); });

test("candidate names never contribute; explicit confirmation freezes versions and exact independent evidence", async () => {
  const f = await fixture(), m = await create(f);
  assert.equal(m.state, "candidate");
  const before = await call(f.owner, "POST", f.root + "/reports", reportInput(m));
  assert.equal(before.status, 409); assert.equal(before.data.error.code, "CREATIVE_CONFIRMATION_REQUIRED");
  const verified = await confirm(f, m);
  const receipt = await ok(f.owner, "POST", f.root + "/reports", reportInput(m));
  const report = (await ok(f.owner, "GET", f.root + "/reports")).items[0];
  assert.equal(report.id, receipt.id); assert.equal(report.body.mapping_versions[0].version, verified.version);
  const g = report.body.groups[0];
  assert.equal(g.scope.asset_version_id, f.asset.version.id); assert.equal(g.scope.creative_id, "creative-1");
  assert.equal(g.scope.account_id, "account-1"); assert.equal(g.metrics.exact.spend, "30.00000100");
  assert.equal(g.metrics.exact.ctr, "0.05000000"); assert.equal(g.metrics.exact.conversions, null);
  assert.equal(g.metrics.null_reasons.conversions, "missing_conversions");
  assert.deepEqual(g.ad_ids, ["ad-1"]); assert.equal(report.body.input_rows, 2);
  const stored = (await s.db.control.query("SELECT * FROM asset_versions WHERE id=$1", [receipt.asset_version_id])).rows[0];
  const bytes = await s.storage.get(stored.storage_key);
  assert.equal(hash(bytes), stored.sha256); assert.deepEqual(JSON.parse(bytes.toString()), report.body);
  assert.equal(stored.metadata.creative_feedback_id, report.id);
  const refs = (await s.db.control.query("SELECT content_source_manifest($1,$2,'{}',ARRAY[$3::uuid]) AS refs", [f.tenant, f.project, receipt.asset_version_id])).rows[0].refs;
  assert.ok(refs.some((r: any) => r.kind === "analytics_datasets" && r.id === f.imported.id));
  assert.ok(refs.some((r: any) => r.kind === "assets" && r.id === f.asset.id));
  assert.equal((await ok(f.owner, "GET", f.root + "/mappings")).items[0].confirmed_by, f.owner.id);
});

test("campaign totals, unknown definitions, absent exact ads and malformed dates cannot be allocated", async () => {
  for (const patch of [{ entity_level: "campaign" }, { attribution_definition: "not_provided" }, { conversion_definition: "not_provided" }]) {
    const f = await fixture(patch);
    const r = await call(f.owner, "POST", f.root + "/mappings", f.input);
    assert.equal(r.status, 422, JSON.stringify(r.data)); assert.equal(r.data.error.code, "CREATIVE_AD_SOURCE_REQUIRED");
  }
  const f = await fixture();
  const noAccount = await call(f.owner, "POST", f.base + "/analytics/import", { name: "Missing account", csv: f.csv, source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong",
    entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases" });
  assert.equal(noAccount.status, 400); assert.equal(noAccount.data.error.code, "IMPORT_DEFINITION_REQUIRED");
  assert.equal((await call(f.owner, "POST", f.root + "/mappings", { ...f.input, ad_id: "missing-ad" })).status, 422);
  assert.equal((await call(f.owner, "POST", f.root + "/mappings", { ...f.input, date_from: "2026-02-30" })).status, 400);
  assert.equal((await call(f.owner, "POST", f.root + "/mappings", { ...f.input, allocation: "proportional_guess" })).status, 400);
});

test("idempotency retries keep original receipts; changed content, stale digest and duplicate mapping IDs reject", async () => {
  const f = await fixture(), k = randomUUID(), m = await create(f, f.input, k);
  assert.deepEqual(await create(f, f.input, k), m);
  assert.equal((await call(f.owner, "POST", f.root + "/mappings", { ...f.input, creative_id: "different" }, k)).status, 409);
  const ck = randomUUID(), c = await confirm(f, m, ck);
  assert.deepEqual(await confirm(f, m, ck), c);
  assert.equal((await call(f.owner, "POST", f.root + `/mappings/${m.id}/confirm`, decision(m))).status, 409);
  const rk = randomUUID(), r = await ok(f.owner, "POST", f.root + "/reports", reportInput(m), rk);
  assert.deepEqual(await ok(f.owner, "POST", f.root + "/reports", reportInput(m), rk), r);
  assert.equal((await call(f.owner, "POST", f.root + "/reports", reportInput(m, [m.id, m.id]))).status, 400);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM creative_feedback_reports WHERE project_id=$1", [f.project])).rows[0].n, 1);
});

test("competing creative allocations cannot both confirm; withdraw and a new candidate preserve the first decision", async () => {
  const f = await fixture(), a = await create(f), b = await create(f, { ...f.input, creative_id: "creative-2" });
  const results = await Promise.all([call(f.owner, "POST", f.root + `/mappings/${a.id}/confirm`, decision(a)), call(f.owner, "POST", f.root + `/mappings/${b.id}/confirm`, decision(b))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const chosen = results[0].status === 200 ? results[0].data : results[1].data;
  const pending = results[0].status === 200 ? b : a;
  await withdraw(f, chosen);
  assert.equal((await confirm(f, pending)).state, "confirmed");
  const old = (await s.db.control.query("SELECT * FROM creative_mappings WHERE id=$1", [chosen.id])).rows[0];
  assert.equal(old.state, "withdrawn"); assert.ok(old.confirmed_at && old.withdrawn_at); assert.equal(old.confirmed_by, f.owner.id);
  assert.equal((await call(f.owner, "POST", f.root + `/mappings/${old.id}/confirm`, decision(old))).status, 409);
});

test("withdrawal fences raw downloads and nested lineage even if an administrator restores the report file", async () => {
  const f = await fixture(), m = await confirm(f, await create(f));
  const r = await ok(f.owner, "POST", f.root + "/reports", reportInput(m));
  const before = await s.db.control.query("SELECT content_source_manifest($1,$2,'{}',ARRAY[$3::uuid]) AS refs", [f.tenant, f.project, r.asset_version_id]);
  assert.ok(before.rows[0].refs.some((v: any) => v.kind === "creative_mappings" && v.id === m.id));
  await withdraw(f, m);
  assert.equal((await ok(f.owner, "GET", f.root + "/reports")).items.length, 0);
  await s.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [r.asset_id]);
  const after = await s.db.control.query("SELECT content_source_manifest($1,$2,'{}',ARRAY[$3::uuid]) AS refs,task_asset_version_sources_available($3) AS ok", [f.tenant, f.project, r.asset_version_id]);
  assert.equal(after.rows[0].refs, null); assert.equal(after.rows[0].ok, false);
  assert.equal((await ok(f.owner, "GET", f.root + "/reports")).items.length, 0);
  assert.equal((await call(f.owner, "GET", `${f.base}/assets/${r.asset_id}/download?version=1`)).status, 404);
});

test("current source visibility and frozen old media version survive replacement, quarantine and expiry", async () => {
  const f = await fixture(), m = await confirm(f, await create(f)), r = await ok(f.owner, "POST", f.root + "/reports", reportInput(m));
  await s.db.tx(async tx => {
    await projectAccess(tx, actor(f.owner), f.tenant, f.project, "write");
    await saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, name: "new creative.png", asset: f.asset.id,
      expectedVersion: 1, mime: "image/png", bytes: Buffer.from("replacement media") });
  }, f.tenant);
  const original = (await ok(f.owner, "GET", f.root + "/reports")).items[0];
  assert.equal(original.body.groups[0].scope.asset_version_id, f.asset.version.id);
  await s.db.control.query("UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1", [f.imported.id]);
  assert.equal((await ok(f.owner, "GET", f.root + "/reports")).items.length, 0);
  assert.equal((await ok(f.owner, "GET", f.root + "/mappings")).items.length, 0);
  await s.db.control.query("UPDATE analytics_datasets SET content_state='active',retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [f.imported.id]);
  assert.equal((await ok(f.owner, "GET", f.root + "/reports")).items.length, 0);
  assert.equal((await call(f.owner, "POST", f.root + "/reports", reportInput(m))).status, 404);
  assert.equal((await s.db.control.query("SELECT sha256 FROM creative_feedback_reports WHERE id=$1", [r.id])).rows[0].sha256, r.sha256);
});

test("cross-tenant, private creative, read-only and revoked project membership reject before returning source data", async () => {
  const f = await fixture(), other = await fixture(), m = await create(f);
  assert.equal((await call(other.owner, "GET", f.root + "/mappings")).status, 404);
  assert.equal((await call(f.owner, "POST", f.root + "/mappings", { ...f.input, asset_version_id: other.asset.version.id })).status, 404);
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [f.asset.id, f.owner.id]);
  assert.equal((await call(f.owner, "POST", f.root + `/mappings/${m.id}/confirm`, decision(m))).status, 404);
  await s.db.control.query("UPDATE assets SET private_owner=NULL WHERE id=$1", [f.asset.id]);
  const viewer = await user();
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'viewer','active')", [f.tenant, viewer.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, viewer.id]);
  assert.equal((await call(viewer, "GET", f.root + "/mappings")).status, 200);
  assert.equal((await call(viewer, "POST", f.root + `/mappings/${m.id}/confirm`, decision(m))).status, 403);
  await s.db.control.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.project, viewer.id]);
  assert.equal((await call(viewer, "GET", f.root + "/mappings")).status, 404);
});

test("row-level security and immutable content reject direct unscoped reads and forbidden history rewrites", async () => {
  const f = await fixture(), m = await confirm(f, await create(f)), r = await ok(f.owner, "POST", f.root + "/reports", reportInput(m));
  assert.equal((await s.db.app.query("SELECT id FROM creative_mappings")).rowCount, 0);
  await assert.rejects(s.db.app.query("UPDATE creative_mappings SET state='withdrawn' WHERE id=$1", [m.id]), { code: "42501" });
  await assert.rejects(s.db.control.query("UPDATE creative_mappings SET body='{}' WHERE id=$1", [m.id]), { code: "23514" });
  await assert.rejects(s.db.control.query("UPDATE creative_feedback_reports SET body='{}' WHERE id=$1", [r.id]), { code: "23514" });
  await assert.rejects(s.db.control.query("DELETE FROM creative_feedback_mappings WHERE report_id=$1", [r.id]), { code: "42501" });
  const tables = (await s.db.control.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)", [["creative_mappings", "creative_feedback_reports", "creative_feedback_mappings"]])).rows;
  assert.equal(tables.length, 3); assert.ok(tables.every(t => t.relrowsecurity && t.relforcerowsecurity));
});

test("098 upgrade retains the source function OID, prepared reader and existing rows", async () => {
  const old = await isolatedTestEnvironment({ throughVersion: 98 });
  const client = new pg.Client({ connectionString: old.env.OWNER_DATABASE_URL });
  await client.connect();
  try {
    const oid = (await client.query("SELECT 'content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure::oid AS id")).rows[0].id;
    await client.query("PREPARE retained_source_reader(uuid,uuid) AS SELECT content_source_manifest($1,$2,'{}','{}') AS refs");
    const t = randomUUID(), p = randomUUID();
    assert.deepEqual((await client.query(`EXECUTE retained_source_reader('${t}','${p}')`)).rows[0].refs, []);
    const before = (await client.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    await runMigrations(client, "098 to confirmed creative feedback");
    assert.equal((await client.query("SELECT 'content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure::oid AS id")).rows[0].id, oid);
    assert.deepEqual((await client.query(`EXECUTE retained_source_reader('${t}','${p}')`)).rows[0].refs, []);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, before + 1);
  } finally { await client.end(); await old.cleanup(); }
});
