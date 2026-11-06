import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, type HistoryClient } from "./admin-history-fixture.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { saveAsset } from "../src/storage.js";
import { canonical, hash } from "../src/lib.js";
import { editableDesignSchema } from "../src/editable-design-model.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false }); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient | null, method: string, url: string, body?: unknown) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": randomUUID() },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: raw.statusCode, data: raw.json(), headers: raw.headers };
}
function ok(r: Awaited<ReturnType<typeof call>>) { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; }
async function fixture(kind: "vector" | "presentation" = "vector") {
  const user = await historyLogin(s), w = ok(await call(user, "POST", "/v1/tenants", { name: "Direct design", project_name: "Draft work" })); user.tenant = w.tenant.id;
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`, scene = { width: 1200, height: 800, background: "#faf7ef", layers: [
    { id: "block", kind: "rect", x: 40, y: 40, w: 300, h: 200, fill: "#a8472f", stroke: null, stroke_width: 0, radius: 12 },
    { id: "copy", kind: "text", x: 400, y: 40, w: 600, h: 200, text: "Private draft", font_size: 32, color: "#15171a", weight: 400 },
  ] }, input: any = { title: "Direct edit", locale: "en-HK", ...(kind === "vector" ? { purpose: "Review", scene } : { audience: "Team", decision: "Approve", slides: [{ id: "first", title: "First", notes: "", scene }] }) };
  const source = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: user.tenant!, project: w.project.id, user: user.id, name: kind + ".source.json", mime: "application/json",
    bytes: Buffer.from(JSON.stringify({ schema: editableDesignSchema, kind, input, input_sha256: hash(canonical(input)), data_mode: "simulated" })),
    metadata: { editable_design_schema: editableDesignSchema, design_kind: kind, data_mode: "simulated" } }), user.tenant!, false, user.id);
  const p = ok(await call(user, "POST", base + "/editable-projects", { name: "Design draft", source_version_id: source.version.id, sha256: source.version.sha256, confirm_project_sharing: true }));
  const detail = ok(await call(user, "GET", base + "/editable-projects/" + p.id));
  const body = { expected_version: 1, source_version: 1, input: structuredClone(detail.input), page: 1 };
  return { user, base, p, detail, body, source, tenant: w.tenant.id, project: w.project.id, path: base + "/editable-projects/" + p.id };
}
async function counts(tenant: string, user: string) { return (await s.db.control.query(`SELECT (SELECT count(*) FROM assets WHERE tenant_id=$1)::int AS assets,
  (SELECT count(*) FROM editable_project_versions WHERE tenant_id=$1)::int AS versions,(SELECT count(*) FROM ledger WHERE tenant_id=$1)::int AS ledger,
  (SELECT count(*) FROM current_ai_provider_requests WHERE tenant_id=$1)::int AS model_calls,(SELECT count(*) FROM request_replays WHERE actor_id=$2)::int AS replays`, [tenant, user])).rows[0]; }
for (const kind of ["vector", "presentation"] as const) test(`${kind}: unsaved preview renders exact new pixels without assets, saved versions, fees or provider calls`, async () => {
  const f = await fixture(kind), before = await counts(f.tenant, f.user.id), first = ok(await call(f.user, "POST", f.path + "/draft-preview", f.body));
  const scene = kind === "vector" ? f.body.input.scene : f.body.input.slides[0].scene; scene.layers[0].fill = "#2155ca";
  const r = await call(f.user, "POST", f.path + "/draft-preview", f.body), next = ok(r); assert.match(String(r.headers["cache-control"]), /no-store/);
  assert.notEqual(next.sha256, first.sha256); assert.notEqual(next.input_sha256, first.input_sha256);
  const bytes = Buffer.from(next.base64, "base64"), png = PNG.sync.read(bytes); assert.equal(hash(bytes), next.sha256); assert.equal(bytes.length, next.bytes); assert.equal(png.width, 960); assert.equal(png.height, 640);
  const offset = (80 * png.width + 80) * 4; assert.deepEqual([...png.data.subarray(offset, offset + 3)], [33, 85, 202]);
  assert.equal(next.saved, false); assert.equal(next.provider_calls, 0); assert.equal(next.current_version, 1); assert.equal(next.source_version, 1);
  assert.deepEqual(await counts(f.tenant, f.user.id), before); assert.deepEqual(ok(await call(f.user, "GET", f.path)), f.detail);
});
test("draft previews enforce head, original version, page, geometry and current project authority", async () => {
  const f = await fixture();
  for (const [patch, status] of [[{ expected_version: 2 }, 409], [{ source_version: 8 }, 404], [{ page: 2 }, 404], [{ page: 0 }, 400], [{ extra: true }, 400]] as const) assert.equal((await call(f.user, "POST", f.path + "/draft-preview", { ...f.body, ...patch })).status, status);
  const invalid = structuredClone(f.body); invalid.input.scene.layers[0].x = 1199; assert.equal((await call(f.user, "POST", f.path + "/draft-preview", invalid)).status, 400);
  const stranger = await historyLogin(s); stranger.tenant = f.tenant; assert.ok([403, 404].includes((await call(stranger, "POST", f.path + "/draft-preview", f.body)).status));
  assert.equal((await call(null, "POST", f.path + "/draft-preview", f.body)).status, 401);
  const saved = ok(await call(f.user, "PUT", f.path, { name: "Next saved version", expected_version: 1, input: f.detail.input })); assert.equal(saved.version, 2);
  assert.equal((await call(f.user, "POST", f.path + "/draft-preview", f.body)).status, 409);
  assert.equal((await call(f.user, "POST", f.path + "/draft-preview", { ...f.body, expected_version: 2 })).status, 200);
});
test("private/unavailable sources cannot be smuggled into draft previews", async () => {
  const f = await fixture(), png = new PNG({ width: 32, height: 32 }); png.data.fill(255);
  const asset = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.user.id, privateOwner: f.user.id,
    name: "Private.png", mime: "image/png", bytes: PNG.sync.write(png) }), f.tenant, false, f.user.id);
  const input = structuredClone(f.body.input); input.scene.layers.push({ kind: "image", id: "private", x: 40, y: 300, w: 200, h: 200, asset_version_id: asset.version.id, sha256: asset.version.sha256, alt: "Private source", fit: "contain" });
  assert.equal((await call(f.user, "POST", f.path + "/draft-preview", { ...f.body, input })).status, 404);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [f.source.id]);
  assert.equal((await call(f.user, "POST", f.path + "/draft-preview", f.body)).status, 404);
});
