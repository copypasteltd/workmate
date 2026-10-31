import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import { s, startFixture, stopFixture, fixture, ok, call, tool, decision, listRuns, FixtureRuntime } from "./workflow-handoff-fixture-145-v1.js";
import { desktopImageFixture } from "./desktop-image-fixture.js";
import { Worker } from "../src/worker.js";
import { advanceCloudWorkflows } from "../src/cloud-workflows.js";
import { saveAsset } from "../src/storage.js";
import type { RuntimeContext } from "../src/runtime.js";

const originalImage = desktopImageFixture(), editRequests: { task: string; body: Buffer }[] = [];
const provider = createServer(async (req, res) => {
  if (req.url !== "/v1/images/edits") { res.writeHead(502).end(); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  editRequests.push({ task: String(req.headers["x-copypaste-task-id"]), body: Buffer.concat(chunks) });
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ b64_json: originalImage.toString("base64") }] }));
});
before(async () => {
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  await startFixture({ AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1",
    AI_API_KEY: "explicit-synthetic-workflow-image-fixture", AI_IMAGE_MODEL: "workflow-fixed-image-fixture", AI_IMAGE_VERIFIED: "true", AI_IMAGE_HKD_MICROS_PER_IMAGE: "200" });
});
after(async () => {
  try { await stopFixture(); }
  finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
});

const definition = (role: string) => ({ input_schema: { fields: [{ key: "source", type: "file", required: true }] },
  output_schema: { fields: [{ key: "report", type: "text", step_index: 0, required: true }] },
  steps: [{ kind: "codex", role_key: role, prompt: "Use the exact customer-approved named file and produce its business deliverable.", budget_micros: 1_000_000 }] });
async function prepare(f: any, d: any, inputs: any) {
  const current = await ok(f.owner, "GET", f.base + "/conversations/" + f.conversation.id);
  const accepted = await ok(f.owner, "POST", f.base + `/conversations/${f.conversation.id}/messages`, {
    body: "Prepare the explicitly selected fixed-file workflow.", expected_version: current.version,
    intent: "delegate", mode: "execute", budget_micros: 1_000_000, client_message_id: randomUUID(),
  });
  let run: any;
  const runtime = new FixtureRuntime(async ctx => {
    const saved: any = await tool(ctx, "workflow_save").run({ name: "Fixed file access review", definition: d }, randomUUID());
    const published: any = await tool(ctx, "workflow_publish").run({ workflow_id: saved.workflow.id, expected_version: saved.workflow.version }, randomUUID());
    run = (await tool(ctx, "workflow_run").run({ workflow_id: saved.workflow.id, version: saved.workflow.version,
      definition_hash: published.definition_hash, inputs }, randomUUID()) as any).run;
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, accepted.task.id);
  if (runtime.failure) throw runtime.failure;
  await ok(f.owner, "POST", f.base + `/cloud-workflows/runs/${run.id}/decision`, decision(run, { input_hash: run.input_hash }));
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  return (await listRuns(f)).runs.find((r: any) => r.id === run.id);
}
async function execute(f: any, run: any, action: (ctx: RuntimeContext) => Promise<void>) {
  const runtime = new FixtureRuntime(action);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, run.active_task);
  if (runtime.failure) throw runtime.failure;
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + run.active_task);
  assert.equal(task.status, "succeeded", task.error_code);
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
}
async function privateFile(f: any, name: string, mime: string, bytes: Buffer) {
  const other = await ok(f.owner, "POST", f.base + "/conversations", { name: "Explicit separate private source", agent_id: f.agent.id });
  return s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id,
    privateOwner: f.owner.id, name, mime, bytes, metadata: { conversation_id: other.id } }), f.tenant, false, f.owner.id);
}

test("a first workflow step can inspect its named private CSV from another conversation, without gaining access to unrelated private files", async () => {
  const f = await fixture(), source = await privateFile(f, "selected.csv", "text/csv", Buffer.from("campaign,clicks\nHK,12\n")),
    unrelated = await privateFile(f, "not-selected.csv", "text/csv", Buffer.from("campaign,clicks\nSecret,99\n"));
  const run = await prepare(f, definition("marketing-analyst"), { source: source.version.id });
  await execute(f, run, async ctx => {
    const manifest: any = await tool(ctx, "workflow_inputs").run({}, randomUUID());
    assert.equal(manifest.items.length, 0); assert.equal(manifest.named_files[0].asset_version_id, source.version.id);
    const inspected: any = await tool(ctx, "analysis_file_inspect").run({ asset_version_id: source.version.id }, randomUUID());
    assert.deepEqual(inspected.headers, ["campaign", "clicks"]); assert.equal(inspected.input_row_count, 1);
    await assert.rejects(tool(ctx, "analysis_file_inspect").run({ asset_version_id: unrelated.version.id }, randomUUID()),
      (error: any) => error.code === "NOT_FOUND");
  });
});

test("Image2 edits the exact approved old private image bytes and rejects a supplied replacement version or digest before dispatch", async () => {
  const f = await fixture(), source = await privateFile(f, "selected.png", "image/png", originalImage),
    unrelated = await privateFile(f, "not-selected.png", "image/png", originalImage);
  const replacement = PNG.sync.read(originalImage); replacement.data[0] = 11;
  const latestBytes = PNG.sync.write(replacement);
  const latest = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id,
    asset: source.id, expectedVersion: 1, name: "selected.png", mime: "image/png", bytes: latestBytes }), f.tenant, false, f.owner.id);
  const run = await prepare(f, definition("designer"), { source: source.version.id });
  await execute(f, run, async ctx => {
    const manifest: any = await tool(ctx, "workflow_inputs").run({}, randomUUID());
    assert.equal(manifest.named_files[0].asset_version_id, source.version.id);
    const edit = tool(ctx, "image2_edit"), args = { asset_id: source.id, prompt: "Edit this exact customer-approved original campaign image.", filename: "reviewed.png" };
    await assert.rejects(edit.run({ ...args, asset_version_id: latest.version.id }, randomUUID()), (error: any) => error.code === "WORKFLOW_IMAGE_INPUT_CHANGED");
    await assert.rejects(edit.run({ ...args, sha256: "0".repeat(64) }, randomUUID()), (error: any) => error.code === "ASSET_SOURCE_INTEGRITY");
    await assert.rejects(edit.run({ ...args, asset_id: unrelated.id }, randomUUID()), (error: any) => error.code === "NOT_FOUND");
    await edit.run(args, randomUUID());
  });
  const requests = editRequests.filter(r => r.task === run.active_task);
  assert.equal(requests.length, 1); assert.ok(requests[0].body.includes(originalImage)); assert.equal(requests[0].body.includes(latestBytes), false);
  const reads = (await s.db.control.query("SELECT asset_version_id FROM task_source_reads WHERE task_id=$1 AND kind='asset_version'", [run.active_task])).rows;
  assert.ok(reads.some((row: any) => row.asset_version_id === source.version.id));
  assert.equal(reads.some((row: any) => row.asset_version_id === latest.version.id), false);
});

test("a completed cloud run stops exposing its cached named text when an actual output version expires", async () => {
  const f = await fixture(), source = await privateFile(f, "brief.txt", "text/plain", Buffer.from("Customer-approved campaign brief")),
    run = await prepare(f, definition("assistant"), { source: source.version.id });
  await execute(f, run, async ctx => { await tool(ctx, "workflow_inputs").run({}, randomUUID()); });
  const before = (await listRuns(f)).runs.find((row: any) => row.id === run.id);
  assert.equal(before.state, "succeeded"); assert.equal(typeof before.named_outputs.report, "string");
  const output = before.results.find((r: any) => r.kind === "codex").output_file;
  await s.db.control.query("UPDATE assets SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [output.asset_id]);
  assert.equal((await listRuns(f)).runs.some((row: any) => row.id === run.id), false);
  assert.equal((await call(f.owner, "GET", f.base + "/cloud-workflows?run_id=" + run.id)).status, 404);
});
