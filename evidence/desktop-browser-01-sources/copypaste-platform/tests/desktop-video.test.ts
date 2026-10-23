import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { advanceVideoProjects } from "../src/video-projects.js";
import { renderVideoProject } from "../src/video-render.js";
import { reuseCompletedTaskTool } from "../src/task-tool-reuse.js";
import { nativeVideoFixture, startNativeVideo, videoSourceFixture, videoDefinitionFixture, videoCall, videoOK, videoToolRequest, videoFinish, videoActor, type VideoFixture } from "./desktop-video-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, aiCalls = 0;
const provider = createServer((_req, res) => { aiCalls++; res.writeHead(502).end(); });
before(async () => {
  isolated = await isolatedTestEnvironment();
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-native-video-fixture", AI_MODEL: "synthetic-native-video-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
});
beforeEach(async () => {
  await s.db.control.query("UPDATE video_renders SET state='cancelled',revision=revision+1,finished_at=clock_timestamp() WHERE state IN('queued','rendering')");
});
after(async () => {
  try { assert.equal(aiCalls, 0, "Composition and status must not secretly call an AI provider"); await s?.app.close(); }
  finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); await isolated?.cleanup(); }
});
async function queued(f: VideoFixture, privateSource = true) {
  const r = await startNativeVideo(s, f), asset = await videoSourceFixture(s, f, privateSource ? r.task.task_id : undefined);
  const definition = videoDefinitionFixture({ asset_id: asset.id, version: asset.version.version });
  const body = videoToolRequest("video_project_queue", { name: "Private native campaign", definition });
  const result = (await videoOK(s, f.c, "POST", r.url + "/tools", body)).output;
  return { ...r, asset, definition, body, result };
}
const status = (f: VideoFixture, q: any) => videoOK(s, f.c, "GET", `${f.base}/video-projects/${q.result.project.id}/renders/${q.result.render.id}/status`);
const row = async (id: string) => (await s.db.control.query("SELECT * FROM video_renders WHERE id=$1", [id])).rows[0];

test("native video specialist exposes seven scoped tools and no cloud Agent or private-to-shared fallback", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  assert.deepEqual(q.started.company_tools.filter((tool: any) => tool.name.startsWith("video_project")).map((tool: any) => tool.name).sort(),
    ["video_projects", "video_project_read", "video_project_queue", "video_project_status", "video_project_edit", "video_project_render", "video_project_cancel"].sort());
  const p = (await s.db.control.query("SELECT * FROM creative_projects WHERE id=$1", [q.result.project.id])).rows[0];
  assert.equal(p.private_owner, f.c.id); assert.equal(p.origin_task_id, q.task.task_id);
  assert.equal((await row(q.result.render.id)).origin_task_id, q.task.task_id);
  assert.equal(q.result.delivery_state, "queued"); assert.equal(q.result.requires_render_completion, true);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1", [q.task.task_id])).rows[0].n, 0);
  const read = (await videoOK(s, f.c, "POST", q.url + "/tools", videoToolRequest("video_project_read", { video_id: p.id }))).output;
  assert.deepEqual(read.definition, q.definition); assert.equal(read.renders[0].id, q.result.render.id);
});

test("native private video really encodes and fully decodes six immutable private deliveries without AI media fees", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  const pending = await status(f, q); assert.equal(pending.delivery_state, "queued"); assert.deepEqual(pending.assets, []);
  assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "succeeded");
  const done = await status(f, q); assert.equal(done.delivery_state, "available"); assert.equal(done.assets.length, 6);
  assert.equal(done.render.probe.video_codec, "h264"); assert.equal(done.render.probe.duration_frames, 72); assert.equal(done.render.probe.fully_decoded, true);
  assert.equal(done.ai_cost_micros, "0"); assert.equal(done.cost_source, "local_composition_no_ai");
  assert.equal((await videoOK(s, f.c, "GET", `${f.base}/video-projects/${q.result.project.id}`)).renderer_profile.renderer, "copypaste-campaign-cuts-2");
  const owners = (await s.db.control.query("SELECT private_owner FROM assets WHERE id=ANY($1::uuid[])", [done.assets.map((asset: any) => asset.id)])).rows;
  assert.equal(owners.length, 6); assert.ok(owners.every((asset: any) => asset.private_owner === f.c.id));
  for (const asset of done.assets) assert.equal((await s.app.inject({ method: "GET", url: `${f.base}/assets/${asset.id}/download?version=${asset.version.version}`,
    headers: { Authorization: "Bearer " + f.c.access_token } })).statusCode, 200);
  const tool = (await videoOK(s, f.c, "POST", q.url + "/tools", videoToolRequest("video_project_status", { video_id: q.result.project.id, render_id: q.result.render.id }))).output;
  assert.deepEqual(tool.assets, done.assets);
});

test("same-project members cannot see native private video definitions, source rows, renders or any delivery", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f); await advanceVideoProjects(s.db, s.storage);
  const done = await status(f, q), other = await videoActor(s);
  assert.equal(done.assets.length, 6, "Privacy checks must exercise actual completed deliveries");
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
  const listed = await videoOK(s, other.c, "GET", f.base + "/video-projects"); assert.equal(listed.items.length, 0);
  for (const suffix of ["", `/renders/${q.result.render.id}/status`, `/renders/${q.result.render.id}/preview`])
    assert.equal((await videoCall(s, other.c, "GET", `${f.base}/video-projects/${q.result.project.id}${suffix}`)).status, 404);
  for (const asset of done.assets) assert.equal((await s.app.inject({ method: "GET", url: `${f.base}/assets/${asset.id}/download?version=1`, headers: { Authorization: "Bearer " + other.c.access_token } })).statusCode, 404);
  await s.db.tx(async tx => {
    for (const table of ["video_project_versions", "video_project_sources", "video_renders"])
      assert.equal((await tx.query(`SELECT 1 FROM ${table} WHERE video_id=$1`, [q.result.project.id])).rowCount, 0);
  }, f.tenant, false, other.c.id);
  await assert.rejects(s.db.control.query("UPDATE creative_projects SET private_owner=NULL,origin_task_id=NULL WHERE id=$1", [q.result.project.id]), /immutable/);
});

test("native video create and revision reuse exact calls; a busy render or stale version rolls back the entire edit", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  const repeated = (await videoOK(s, f.c, "POST", q.url + "/tools", q.body)).output;
  assert.deepEqual(repeated, q.result);
  assert.equal((await videoCall(s, f.c, "POST", q.url + "/tools", { ...q.body, arguments: { ...q.body.arguments as any, name: "Changed native call" } })).status, 409);
  const edit = videoToolRequest("video_project_edit", { video_id: q.result.project.id, expected_version: 1, name: "Private revision", definition: videoDefinitionFixture(undefined, "A revised launch") });
  const busy = await videoCall(s, f.c, "POST", q.url + "/tools", edit); assert.equal(busy.data.error.code, "VIDEO_ALREADY_RENDERING");
  assert.equal((await s.db.control.query("SELECT version FROM creative_projects WHERE id=$1", [q.result.project.id])).rows[0].version, 1);
  await advanceVideoProjects(s.db, s.storage); const original = await status(f, q), firstMp4 = original.assets.find((a: any) => a.version.mime_type === "video/mp4");
  const changed = (await videoOK(s, f.c, "POST", q.url + "/tools", edit)).output;
  assert.equal(changed.project.version, 2);
  assert.deepEqual((await videoOK(s, f.c, "POST", q.url + "/tools", edit)).output, changed);
  const stale = await videoCall(s, f.c, "POST", q.url + "/tools", { ...edit, call_id: "stale_" + randomUUID() }); assert.equal(stale.data.error.code, "VERSION_CONFLICT");
  await advanceVideoProjects(s.db, s.storage);
  const latest = await videoOK(s, f.c, "GET", `${f.base}/video-projects/${q.result.project.id}`);
  assert.deepEqual(latest.versions.map((v: any) => v.version), [2, 1]); assert.equal(latest.renders[0].version, 2);
  assert.equal((await status(f, q)).assets.find((a: any) => a.id === firstMp4.id).version.sha256, firstMp4.version.sha256);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM video_renders WHERE video_id=$1", [q.result.project.id])).rows[0].n, 2);
});

test("stopping a Desktop task cancels only its own pending video jobs and preserves an unrelated shared composition", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  const shared = await videoOK(s, f.web, "POST", f.base + "/video-projects", { name: "Explicit shared fixture", definition: videoDefinitionFixture() });
  const sharedRender = await videoOK(s, f.web, "POST", `${f.base}/video-projects/${shared.id}/renders`, { expected_version: 1 });
  await videoOK(s, f.c, "POST", q.url + "/cancel", {});
  assert.equal((await row(q.result.render.id)).state, "cancelled"); assert.equal((await row(q.result.render.id)).error_code, "DESKTOP_ORIGIN_STOPPED");
  assert.equal((await row(sharedRender.id)).state, "queued"); assert.equal((await row(sharedRender.id)).origin_task_id, null);
  assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "succeeded");
  assert.equal((await row(sharedRender.id)).state, "succeeded"); assert.equal((await status(f, q)).assets.length, 0);
});

test("a cancelled native origin cannot publish six deliveries even when the real encoder already finished", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  let encoded!: () => void, publish!: () => void;
  const encodedGate = new Promise<void>(resolve => { encoded = resolve; }), publishGate = new Promise<void>(resolve => { publish = resolve; });
  const work = advanceVideoProjects(s.db, s.storage, async (...args) => {
    const result = await renderVideoProject(...args); encoded(); await publishGate; return result;
  });
  try { await Promise.race([encodedGate, work.then(result => { throw new Error("Encoder did not reach the publication gate: " + JSON.stringify(result)); })]); await videoOK(s, f.c, "POST", q.url + "/cancel", {}); }
  finally { publish(); }
  const result = await work;
  assert.ok(result?.stale || result?.state === "stale"); assert.equal((await row(q.result.render.id)).state, "cancelled");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'render_id'=$1", [q.result.render.id])).rows[0].n, 0);
});

test("revoked native login families fail queued video admission before encoding", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  await s.db.control.query("UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=(SELECT native_family_id FROM desktop_executions WHERE task_id=$1)", [q.task.task_id]);
  let encoded = 0;
  await advanceVideoProjects(s.db, s.storage, async (...args) => { encoded++; return renderVideoProject(...args); });
  assert.equal(encoded, 0); const stopped = await row(q.result.render.id);
  assert.equal(stopped.state, "failed"); assert.equal(stopped.error_code, "DESKTOP_VIDEO_ORIGIN_UNAVAILABLE");
});

test("expired native owners leave no queued starvation and the next shared video can progress", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  const shared = await videoOK(s, f.web, "POST", f.base + "/video-projects", { name: "Independent next composition", definition: videoDefinitionFixture() });
  const next = await videoOK(s, f.web, "POST", `${f.base}/video-projects/${shared.id}/renders`, { expected_version: 1 });
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [q.task.task_id]);
  await advanceVideoProjects(s.db, s.storage); assert.ok(["failed", "cancelled"].includes((await row(q.result.render.id)).state));
  if ((await row(next.id)).state === "queued") await advanceVideoProjects(s.db, s.storage);
  assert.equal((await row(next.id)).state, "succeeded");
});

test("expired native video sources withdraw every output and never automatically regenerate the video", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f); await advanceVideoProjects(s.db, s.storage);
  assert.equal((await status(f, q)).assets.length, 6);
  await s.db.control.query("UPDATE assets SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [q.asset.id]);
  const result = await status(f, q); assert.equal(result.delivery_state, "unavailable"); assert.deepEqual(result.assets, []);
  assert.equal((await row(q.result.render.id)).state, "succeeded");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM video_renders WHERE video_id=$1", [q.result.project.id])).rows[0].n, 1);
});

test("normally completed native turns may leave clearly queued zero-AI composition with private recoverable outputs", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f);
  await videoOK(s, f.c, "POST", q.url + "/finish", videoFinish);
  assert.equal((await row(q.result.render.id)).state, "queued");
  assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "succeeded");
  assert.equal((await status(f, q)).assets.length, 6);
  const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [q.task.task_id])).rows[0];
  assert.equal(task.status, "succeeded"); assert.equal(task.charged_micros, "0");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1 AND status='reserved'", [task.id])).rows[0].n, 0);
});

test("completed video receipts revalidate actual project/render records on a later attempt without creating another composition", async () => {
  const f = await nativeVideoFixture(s), q = await queued(f); await advanceVideoProjects(s.db, s.storage);
  let recreated = 0;
  const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [q.task.task_id])).rows[0];
  const reused = await s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
    return reuseCompletedTaskTool(tx, { ...task, attempt: 2 }, task.fencing_token, "video_project_queue", "later_" + randomUUID(), q.body.arguments,
      async () => { recreated++; throw new Error("Never replay a completed video effect"); });
  }, f.tenant, false, f.c.id);
  assert.equal(recreated, 0); assert.deepEqual(reused, q.result);
  await s.db.control.query("UPDATE creative_projects SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [q.result.project.id]);
  await assert.rejects(s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
    return reuseCompletedTaskTool(tx, { ...task, attempt: 2 }, task.fencing_token, "video_project_queue", "later_" + randomUUID(), q.body.arguments,
      async () => { recreated++; return {}; });
  }, f.tenant, false, f.c.id), /previously queued video project/);
  assert.equal(recreated, 0);
});
