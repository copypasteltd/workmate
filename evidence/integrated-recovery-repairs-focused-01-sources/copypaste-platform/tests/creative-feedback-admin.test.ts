import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { seal } from "../src/lib.js";

test("scoped Admin feedback metadata, independent body permission and quarantine fence the managed report with audit", async () => {
  const isolated = await isolatedTestEnvironment();
  const s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
  type Client = { id: string; cookie: string; csrf: string; admin: boolean };
  async function call(c: Client | undefined, method: string, url: string, body?: unknown) {
    const r = await s.app.inject({ method: method as any, url, headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    }, payload: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.statusCode, body: r.json(), raw: r };
  }
  async function ok(c: Client | undefined, method: string, url: string, body?: unknown) {
    const r = await call(c, method, url, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  async function login(email: string, secret?: OTPAuth.Secret): Promise<Client> {
    const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
    const ch = await ok(undefined, "POST", prefix + "/challenge", { email });
    const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`, "utf8"));
    const r = await call(undefined, "POST", prefix + "/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0],
      ...(secret ? { totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cookie = r.raw.cookies.find(v => v.name === (secret ? "cp_admin_session" : "cp_session"))!;
    return { id: r.body.user?.id ?? r.body.admin?.id, cookie: cookie.name + "=" + cookie.value, csrf: r.body.csrf_token, admin: !!secret };
  }
  try {
    const owner = await login(`feedback-owner-${randomUUID()}@example.invalid`);
    async function fixture() {
      const w = await ok(owner, "POST", "/v1/tenants", { name: "Scoped creative feedback", project_name: "Ad evidence" });
      const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`;
      const asset = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant, project, user: owner.id, name: "reviewed creative.png", mime: "image/png", bytes: Buffer.from("synthetic creative") }), tenant, true);
      const dataset = await ok(owner, "POST", base + "/analytics/import", { name: "Ad facts", source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong", account_id: "fixture-account", entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases",
        csv: "date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Harbour,ad-1,1000,20,12,2,40,HKD" });
      const root = base + "/creative-feedback";
      const mapping = await ok(owner, "POST", root + "/mappings", { name: "Reviewed identity", asset_version_id: asset.version.id, dataset_id: dataset.id, channel: "meta", campaign: "Harbour", ad_id: "ad-1", creative_id: "creative-1", date_from: "2026-10-20", date_to: "2026-10-20", match_source: "manual", match_note: "Explicit synthetic single-creative identity", allocation: "single_creative_entire_ad" });
      await ok(owner, "POST", root + `/mappings/${mapping.id}/confirm`, { expected_version: mapping.version, expected_sha256: mapping.sha256, confirm_single_creative_allocation: true, reason: "Checked the exact source and version" });
      const report = await ok(owner, "POST", root + "/reports", { name: "Scoped feedback", mapping_ids: [mapping.id], date_from: "2026-10-20", date_to: "2026-10-20" });
      return { tenant, project, root, mapping, report };
    }
    const f = await fixture(), other = await fixture();
    const email = `feedback-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
    const principal = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped feedback reviewer',$2) RETURNING id", [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0].id;
    async function grant(permissions: string[]) {
      const role = "feedback_" + randomUUID();
      await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Feedback test scope',$2)", [role, JSON.stringify(permissions)]);
      await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal, role, f.project]);
    }
    await grant(["admin.content.read"]);
    const admin = await login(email, secret);
    const list = await ok(admin, "GET", "/v1/admin/content?page_size=100");
    assert.ok(list.items.some((v: any) => v.id === f.mapping.id && v.kind === "creative_mappings"), "Scoped metadata lists the mapping");
    assert.ok(list.items.some((v: any) => v.id === f.report.id && v.kind === "creative_feedback_reports"), "Scoped metadata lists the report");
    assert.equal(list.items.some((v: any) => v.id === other.mapping.id || v.id === other.report.id), false, "Another enterprise's content is excluded");
    assert.equal(JSON.stringify(list).includes("single_creative_entire_ad"), false, "Metadata access does not expose the frozen body");
    assert.equal((await call(admin, "GET", `/v1/admin/content/${f.mapping.id}/body`)).status, 403);
    assert.equal((await call(admin, "POST", `/v1/admin/content/${f.mapping.id}/action`, { action: "quarantine", version: 1, reason: "Review required" })).status, 403);
    await grant(["admin.content.body.read", "admin.content.quarantine"]);
    const body = await ok(admin, "GET", `/v1/admin/content/${f.mapping.id}/body`);
    assert.equal(JSON.parse(body.text).input.ad_id, "ad-1", "Independent current body permission permits the exact mapping body");
    assert.equal((await call(admin, "GET", `/v1/admin/content/${other.mapping.id}/body`)).status, 403, "Body permission remains project scoped");
    await ok(admin, "POST", `/v1/admin/content/${f.mapping.id}/action`, { action: "quarantine", version: 1, reason: "Identity requires a new customer review" });
    assert.equal((await ok(owner, "GET", f.root + "/reports")).items.length, 0);
    assert.equal((await s.db.control.query("SELECT task_asset_version_sources_available($1) AS ok", [f.report.asset_version_id])).rows[0].ok, false);
    const audit = (await s.db.control.query("SELECT action FROM audit_log WHERE principal_id=$1 AND target=$2 AND outcome='succeeded'", [principal, f.mapping.id])).rows;
    assert.ok(["admin.content.body.read", "admin.content.quarantine"].every(action => audit.some(v => v.action === action)), "Both privileged reads and quarantine are audited");
    assert.equal((await ok(owner, "GET", other.root + "/reports")).items.length, 1, "The other enterprise's report stays available");
  } finally { await s.app.close(); await isolated.cleanup(); }
});
