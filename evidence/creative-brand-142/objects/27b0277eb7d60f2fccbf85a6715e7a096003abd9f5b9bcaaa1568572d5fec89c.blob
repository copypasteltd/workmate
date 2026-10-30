import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { advanceWorkflows } from "../src/business.js";
import { ErasureService } from "../src/erasure.js";
import { saveAsset } from "../src/storage.js";
import { nativeVideoFixture, startNativeVideo, videoOK as ok, videoCall as call, videoToolRequest as tool,
  videoFinish as complete, videoActor } from "./desktop-video-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, aiCalls = 0;
const ownedFixtures: Awaited<ReturnType<typeof nativeVideoFixture>>[] = [];
const provider = createServer((_req, res) => { aiCalls++; res.writeHead(502).end(); });
before(async () => {
  isolated = await isolatedTestEnvironment();
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-native-workflow-fixture",
    AI_MODEL: "synthetic-native-workflow-fixture", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000" }), { worker: false });
});
after(async () => {
  try { assert.equal(aiCalls, 0, "The company workflow control plane must never secretly execute a model"); await s?.app.close(); }
  finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); await isolated?.cleanup(); }
});
afterEach(async () => {
  // This is an API-control-plane fixture: no native process or AI request was
  // started. Close its known failed starts honestly; retain deliberately
  // reconciling cases, which must continue occupying a real capacity slot.
  for (const f of ownedFixtures.splice(0)) {
    const tasks = (await s.db.control.query("SELECT * FROM tasks WHERE project_id=$1 AND execution_location='desktop' ORDER BY (desktop_workflow_run_id IS NULL),created_at", [f.project])).rows;
    for (const task of tasks) {
      const url = f.base + "/desktop-executions/" + task.id;
      if (task.status === "queued") await call(s, f.c, "POST", url + "/cancel", {});
      if (task.status === "running") await call(s, f.c, "POST", url + "/finish", { ...complete, status: "failed", output: "Controlled API fixture only: native process was never started; no provider request occurred." });
    }
  }
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE execution_location='desktop' AND status='running'");
  await s.desktopExecutions.recover();
});
const definition = () => ({ steps: [{ kind: "codex", role_key: "fullstack", prompt: "Write a local release checklist file.", budget_micros: 100000 },
  { kind: "approval", message: "Approve the reviewed release checklist before testing." },
  { kind: "codex", role_key: "software-qa", prompt: "Read the local checklist and write its test result.", budget_micros: 150000 }] });
async function fixture() {
  const f = await nativeVideoFixture(s); ownedFixtures.push(f);
  const root = await startNativeVideo(s, f, { role_key: "workflow-consultant" });
  return { ...f, root };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const company = async (f: Fixture, name: string, args: unknown, callId?: string) =>
  (await ok(s, f.c, "POST", f.root.url + "/tools", tool(name, args, callId))).output;
async function published(f: Fixture, d: unknown = definition()) {
  const draft = await company(f, "workflow_save", { name: "Private local release", definition: d });
  return company(f, "workflow_publish", { workflow_id: draft.workflow_id, expected_version: draft.version });
}
async function launch(f: Fixture, p: any = undefined) {
  p ??= await published(f);
  const requested = await company(f, "workflow_run", { workflow_id: p.workflow_id, version: p.version, definition_hash: p.definition_hash });
  return { ...requested, url: f.root.url + "/workflow-runs/" + requested.run.id };
}
const decision = (f: Fixture, r: any, stage = "launch", choice = "approve") => ok(s, f.c, "POST", r.url + "/decision", {
  expected_revision: r.run.revision, stage, decision: choice, definition_hash: r.definition_hash,
});
const advance = (f: Fixture, r: any) => ok(s, f.c, "POST", r.url + "/advance", { expected_revision: r.run.revision });
const nativeRun = async (id: string) => (await s.db.control.query("SELECT * FROM workflow_runs WHERE id=$1", [id])).rows[0];

test("native workflow specialist exposes eight scoped tools and no model approval or cloud dispatch tool", async () => {
  const f = await fixture();
  assert.deepEqual(f.root.started.company_tools.filter((v: any) => v.name.startsWith("workflow_")).map((v: any) => v.name).sort(),
    ["workflow_list", "workflow_read", "workflow_validate", "workflow_save", "workflow_publish", "workflow_run", "workflow_status", "workflow_cancel"].sort());
  assert.ok(f.root.started.company_tools.length <= 16);
  for (const denied of ["workflow_approve", "workflow_advance", "workflow_cloud_run"])
    assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool(denied, {}))).status, 403);
});

test("native workflow drafts validate roles, bounded schemas and live dataset access before any child reservation", async () => {
  const f = await fixture();
  const valid = await company(f, "workflow_validate", { definition: definition() });
  assert.equal(valid.step_budget_micros, 250000); assert.equal(valid.execution_location, "desktop");
  for (const d of [{ steps: [] }, { steps: Array(9).fill(definition().steps[0]) }, { steps: [{ ...definition().steps[0], kind: "shell", command: "unknown" }] },
    { steps: [{ ...definition().steps[0], budget_micros: 1 }] }, { ...definition(), cloud_fallback: true }, { steps: [{ ...definition().steps[0], extra: "unknown" }] }])
    assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_validate", { definition: d }))).status, 400);
  for (const role_key of ["workflow-consultant", "unknown-native-role"])
    assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_validate", { definition: { steps: [{ ...definition().steps[0], role_key }] } }))).data.error.code, "NATIVE_WORKFLOW_ROLE_NOT_READY");
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_validate", { definition: { steps: [{ kind: "analytics.summary", dataset_id: randomUUID() }] } }))).status, 404);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id IS NOT NULL AND project_id=$1", [f.project])).rows[0].n, 0);
});

test("published native versions are immutable, revisions use compare-and-swap and historical runs retain their exact definition", async () => {
  const f = await fixture(), p = await published(f), r = await launch(f, p);
  const changed = { steps: [{ kind: "approval", message: "A different explicit approval" }] };
  const updated = await company(f, "workflow_save", { workflow_id: p.workflow_id, expected_version: p.version, name: "New private release", definition: changed });
  assert.equal(updated.version, p.version + 1); assert.equal(updated.state, "draft");
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_save", { workflow_id: p.workflow_id, expected_version: p.version, name: "Stale overwrite", definition: changed }))).data.error.code, "WORKFLOW_VERSION_CHANGED");
  const history = await company(f, "workflow_read", { workflow_id: p.workflow_id, version: p.version });
  assert.deepEqual(history.published.definition, definition()); assert.deepEqual((await nativeRun(r.run.id)).definition, definition());
  await assert.rejects(s.db.control.query("UPDATE workflow_versions SET definition='{}' WHERE workflow_id=$1", [p.workflow_id]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE workflow_versions SET source_refs='{}' WHERE workflow_id=$1", [p.workflow_id]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE workflow_runs SET definition='{}' WHERE id=$1", [r.run.id]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE workflows SET private_owner=NULL,origin_task_id=NULL,execution_location='cloud' WHERE id=$1", [p.workflow_id]), /immutable/);
});

test("native workflow launch waits for explicit fee confirmation, binds the exact revision and rejects cloud approval bypass", async () => {
  const f = await fixture(), r = await launch(f);
  assert.equal(r.customer_confirmation_required, true); assert.equal(r.run.authorized, false); assert.equal(r.step_budget_micros, 250000);
  assert.equal((await call(s, f.c, "POST", r.url + "/advance", { expected_revision: r.run.revision })).data.error.code, "WORKFLOW_CUSTOMER_CONFIRMATION_REQUIRED");
  const approved = await decision(f, r); assert.equal(approved.run.authorized, true); assert.equal(approved.run.revision, 2);
  assert.equal((await call(s, f.c, "POST", r.url + "/decision", { expected_revision: 1, stage: "launch", decision: "approve", definition_hash: r.definition_hash })).data.error.code, "WORKFLOW_RUN_CHANGED");
  assert.equal((await call(s, f.c, "POST", f.base + "/workflow-runs/" + r.run.id + "/decision", { decision: "approve" })).status, 409);
  const canceled = await company(f, "workflow_cancel", { run_id: r.run.id, expected_revision: approved.run.revision });
  assert.equal(canceled.run.state, "cancelled");
});

test("native workflow creates exactly one local child per cursor with its role Skills, private fee reservation and no cloud outbox", async () => {
  const f = await fixture(), r = await launch(f); r.run = (await decision(f, r)).run;
  const first = await advance(f, r), again = await advance(f, { ...r, run: first.run });
  assert.equal(first.action, "codex"); assert.equal(first.child.task_id, again.child.task_id);
  assert.equal(first.child.role_key, "fullstack"); assert.equal(first.child.fields.workspace_hash, f.fields.workspace_hash);
  assert.notEqual(first.child.fields.local_session_id, f.fields.local_session_id);
  const child = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [first.child.task_id])).rows[0];
  assert.equal(child.execution_location, "desktop"); assert.equal(child.private_owner, f.c.id); assert.equal(child.desktop_workflow_run_id, r.run.id); assert.equal(child.budget_micros, "100000");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1", [child.id])).rows[0].n, 0);
  const started = await ok(s, f.c, "POST", f.base + "/desktop-executions/" + child.id + "/start", first.child.fields);
  assert.ok(started.skills.some((skill: any) => skill.key.includes("fullstack") || skill.key.includes("software")));
  assert.equal(started.company_tools.some((tool: any) => tool.name.startsWith("workflow_")), false);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1 AND status='reserved'", [child.id])).rows[0].n, 1);
});

test("native workflow advances actual child receipts through explicit approval and succeeds only after its final local child", async () => {
  const f = await fixture(), r = await launch(f); r.run = (await decision(f, r)).run;
  const first = await advance(f, r);
  await ok(s, f.c, "POST", f.base + "/desktop-executions/" + first.child.task_id + "/start", first.child.fields);
  await ok(s, f.c, "POST", f.base + "/desktop-executions/" + first.child.task_id + "/finish", { ...complete, output: "Client-reported local checklist" });
  const pause = await advance(f, { ...r, run: first.run }); assert.equal(pause.action, "approval"); assert.equal(pause.run.cursor, 1);
  r.run = (await decision(f, { ...r, run: pause.run }, "step")).run;
  const second = await advance(f, r); assert.equal(second.child.role_key, "software-qa"); assert.equal(second.run.cursor, 2);
  const secondURL = f.base + "/desktop-executions/" + second.child.task_id;
  await ok(s, f.c, "POST", secondURL + "/start", second.child.fields);
  await ok(s, f.c, "POST", secondURL + "/finish", { ...complete, output: "Client-reported test result" });
  const done = await advance(f, { ...r, run: second.run }); assert.equal(done.action, "terminal"); assert.equal(done.run.state, "succeeded"); assert.equal(done.run.cursor, 3);
  assert.equal(done.run.results.length, 3); assert.ok(done.run.results.filter((v: any) => v.kind === "codex").every((v: any) => v.result_origin === "desktop_client_report"));
  await ok(s, f.c, "POST", secondURL + "/finish", { ...complete, output: "Client-reported test result" });
});

test("same-project members and other native families cannot read or operate private native workflow definitions, versions or runs", async () => {
  const f = await fixture(), p = await published(f), r = await launch(f), other = await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
  const list = await ok(s, other.c, "GET", f.base + "/workflows"); assert.equal(list.items.length, 0); assert.equal(list.runs.length, 0);
  assert.equal((await call(s, other.c, "GET", r.url)).status, 404);
  await s.db.tx(async tx => {
    assert.equal((await tx.query("SELECT 1 FROM workflow_versions WHERE workflow_id=$1", [p.workflow_id])).rowCount, 0);
  }, f.tenant, false, other.c.id);
  assert.equal((await call(s, f.web, "GET", r.url)).status, 403);
});

test("cloud workflow workers and schedules cannot take over native Codex steps", async () => {
  const f = await fixture(), p = await published(f), r = await launch(f); r.run = (await decision(f, r)).run;
  await advanceWorkflows(s.db, s.catalog, s.storage);
  assert.equal((await nativeRun(r.run.id)).active_task, null);
  assert.equal((await call(s, f.web, "POST", f.base + "/workflows/" + p.workflow_id + "/run", {})).status, 409);
  assert.equal((await call(s, f.web, "POST", f.base + "/workflows/" + p.workflow_id + "/publish", {})).status, 404);
});

test("stopping a native consultant cancels its run and prevents a prepared child from starting", async () => {
  const f = await fixture(), r = await launch(f); r.run = (await decision(f, r)).run;
  const first = await advance(f, r);
  await ok(s, f.c, "POST", f.root.url + "/cancel", {});
  assert.equal((await nativeRun(r.run.id)).state, "cancelled");
  assert.equal((await call(s, f.c, "POST", f.base + "/desktop-executions/" + first.child.task_id + "/start", first.child.fields)).status, 409);
  assert.equal((await s.db.control.query("SELECT cancel_requested FROM tasks WHERE id=$1", [first.child.task_id])).rows[0].cancel_requested, true);
  await s.desktopExecutions.recover();
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [first.child.task_id])).rows[0].status, "released");
});

test("native child unknown outcomes stop the workflow without automatically enqueueing a replacement", async () => {
  const f = await fixture(), r = await launch(f); r.run = (await decision(f, r)).run;
  const first = await advance(f, r), url = f.base + "/desktop-executions/" + first.child.task_id;
  await ok(s, f.c, "POST", url + "/start", first.child.fields);
  await ok(s, f.c, "POST", url + "/finish", { ...complete, status: "unknown" });
  const stopped = await advance(f, { ...r, run: first.run }); assert.equal(stopped.run.state, "failed"); assert.equal(stopped.run.error_code, "WORKFLOW_STEP_RECONCILIATION_REQUIRED");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id=$1", [r.run.id])).rows[0].n, 1);
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [first.child.task_id])).rows[0].status, "reconciling");
});

test("admin deletion scrubs immutable private workflow version content through the controlled erasure path", async () => {
  const f = await fixture(), p = await published(f);
  await s.db.control.query("UPDATE workflows SET content_state='deleted' WHERE id=$1", [p.workflow_id]);
  await new ErasureService(s.db, s.storage).advance(100);
  const v = (await s.db.control.query("SELECT * FROM workflow_versions WHERE workflow_id=$1", [p.workflow_id])).rows[0];
  assert.deepEqual(v.definition, {}); assert.deepEqual(v.role_hashes, {}); assert.deepEqual(v.source_refs, {}); assert.equal(v.definition_hash, p.definition_hash);
});

test("unpublished native snapshots cannot run and a child budget above the current plan fails before consent", async () => {
  const f = await fixture(), draft = await company(f, "workflow_save", { name: "Not published", definition: definition() });
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_run", { workflow_id: draft.workflow_id, version: draft.version, definition_hash: draft.definition_hash }))).data.error.code, "WORKFLOW_VERSION_CHANGED");
  const over = { steps: [{ ...definition().steps[0], budget_micros: 6_000_000_000 }] };
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", tool("workflow_validate", { definition: over }))).data.error.code, "PLAN_BUDGET_LIMIT");
});

test("concurrent native advances share one charged child identity and reject the losing stale revision", async () => {
  const f = await fixture(), r = await launch(f); r.run = (await decision(f, r)).run;
  const replies = await Promise.all(Array.from({ length: 4 }, () => call(s, f.c, "POST", r.url + "/advance", { expected_revision: r.run.revision })));
  assert.equal(replies.filter(reply => reply.status === 200).length, 1);
  assert.ok(replies.filter(reply => reply.status !== 200).every(reply => reply.status === 409 && reply.data.error.code === "WORKFLOW_RUN_CHANGED"));
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id=$1", [r.run.id])).rows[0].n, 1);
});

test("native workflow content quarantine fences inference, cached reads, local child start and downstream private deliveries", async () => {
  const f = await fixture(), p = await published(f), r = await launch(f, p); r.run = (await decision(f, r)).run;
  const first = await advance(f, r);
  const read = tool("workflow_read", { workflow_id: p.workflow_id });
  await ok(s, f.c, "POST", f.root.url + "/tools", read);
  const artifact = (await ok(s, f.c, "POST", f.root.url + "/tools", tool("deliver_text", {
    filename: "SOP.md", mime_type: "text/markdown", content: "A private SOP based on the read workflow snapshot." }))).output;
  assert.equal((await s.app.inject({ method: "GET", url: f.base + "/assets/" + artifact.id + "/download?version=1", headers: { Authorization: "Bearer " + f.c.access_token } })).statusCode, 200);
  await s.db.control.query("UPDATE workflows SET content_state='quarantined' WHERE id=$1", [p.workflow_id]);
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", read)).data.error.code, "TASK_SOURCE_REVOKED");
  assert.equal((await call(s, f.c, "POST", f.base + "/desktop-executions/" + first.child.task_id + "/start", first.child.fields)).status, 409);
  assert.equal((await s.app.inject({ method: "GET", url: f.base + "/assets/" + artifact.id + "/download?version=1", headers: { Authorization: "Bearer " + f.c.access_token } })).statusCode, 404);
});

test("native workflow launch confirmation cannot be reused for a different definition hash", async () => {
  const f = await fixture(), r = await launch(f);
  const b = { expected_revision: r.run.revision, stage: "launch", decision: "approve", definition_hash: "0".repeat(64) };
  assert.equal((await call(s, f.c, "POST", r.url + "/decision", b)).data.error.code, "WORKFLOW_RUN_CHANGED");
  assert.equal((await nativeRun(r.run.id)).authorized_at, null);
});

test("explicitly published native SOPs retain workflow provenance and withdraw after the workflow is quarantined", async () => {
  const f = await fixture(), p = await published(f);
  const artifact = await company(f, "deliver_text", { filename: "Private-SOP.md", mime_type: "text/markdown", content: "A customer-authorized SOP based on the retained workflow." });
  const shared = await ok(s, f.web, "POST", f.base + "/assets/" + artifact.id + "/publish", { expected_version: 1, name: "Shared-SOP.md" });
  const metadata = (await s.db.control.query("SELECT metadata FROM asset_versions WHERE asset_id=$1 AND version=1", [shared.id])).rows[0].metadata;
  assert.ok(metadata.publication_sources.workflows.some((ref: any) => ref.workflow_id === p.workflow_id && ref.version === p.version));
  const other = await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
  const download = () => s.app.inject({ method: "GET", url: f.base + "/assets/" + shared.id + "/download?version=1", headers: { Authorization: "Bearer " + other.c.access_token } });
  assert.equal((await download()).statusCode, 200);
  await s.db.control.query("UPDATE workflows SET content_state='quarantined' WHERE id=$1", [p.workflow_id]);
  assert.equal((await download()).statusCode, 404);
});

async function readWorkflowSource(f: Fixture) {
  const source = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.c.id,
    name: "workflow-source.txt", mime: "text/plain", kind: "file", bytes: Buffer.from("Authorized reusable release instructions") }), f.tenant, false, f.c.id);
  await company(f, "asset_text_read", { asset_id: source.id });
  const version = (await s.db.control.query("SELECT id FROM asset_versions WHERE asset_id=$1 AND version=1", [source.id])).rows[0].id;
  return { ...source, version_id: version };
}
async function nextConsultant(f: Fixture): Promise<Fixture> {
  return { ...f, root: await startNativeVideo(s, { ...f, fields: { ...f.fields, local_session_id: randomUUID() } }, { role_key: "workflow-consultant" }) };
}

test("reused native workflows preserve original file lineage across fresh sessions, child admission, cached reads and published SOPs", async () => {
  const creator = await fixture(), source = await readWorkflowSource(creator), p = await published(creator);
  const frozen = (await s.db.control.query("SELECT source_refs FROM workflow_versions WHERE workflow_id=$1 AND version=$2", [p.workflow_id, p.version])).rows[0].source_refs;
  assert.ok(frozen.versions.includes(source.version_id));
  await ok(s, creator.c, "POST", creator.root.url + "/finish", complete);
  const f = await nextConsultant(creator), r = await launch(f, p); r.run = (await decision(f, r)).run;
  const first = await advance(f, r), cached = tool("workflow_read", { workflow_id: p.workflow_id });
  await ok(s, f.c, "POST", f.root.url + "/tools", cached);
  const artifact = await company(f, "deliver_text", { filename: "Reused-SOP.md", mime_type: "text/markdown", content: "A SOP derived from the reusable workflow source." });
  const shared = await ok(s, f.web, "POST", f.base + "/assets/" + artifact.id + "/publish", { expected_version: 1, name: "Shared-reused-SOP.md" });
  const metadata = (await s.db.control.query("SELECT metadata FROM asset_versions WHERE asset_id=$1 AND version=1", [shared.id])).rows[0].metadata;
  assert.ok(metadata.publication_sources.versions.includes(source.version_id));
  const other = await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
  const download = (asset: string, token: string) => s.app.inject({ method: "GET", url: f.base + "/assets/" + asset + "/download?version=1", headers: { Authorization: "Bearer " + token } });
  assert.equal((await download(shared.id, other.c.access_token!)).statusCode, 200);
  const fresh = await nextConsultant(creator);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [source.id]);
  assert.equal((await call(s, f.c, "POST", f.root.url + "/tools", cached)).data.error.code, "TASK_SOURCE_REVOKED");
  assert.equal((await call(s, f.c, "POST", f.base + "/desktop-executions/" + first.child.task_id + "/start", first.child.fields)).data.error.code, "TASK_SOURCE_REVOKED");
  assert.equal((await call(s, fresh.c, "POST", fresh.root.url + "/tools", tool("workflow_read", { workflow_id: p.workflow_id }))).data.error.code, "TASK_SOURCE_REVOKED");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM native_workflow_reads WHERE task_id=$1", [fresh.root.task.task_id])).rows[0].n, 0, "A refused first read must roll back its ledger and definition response");
  assert.equal((await download(artifact.id, f.c.access_token!)).statusCode, 404);
  assert.equal((await download(shared.id, other.c.access_token!)).statusCode, 404);
});

test("reusable native source snapshots outlive the creator task while derived versions retain original external governance", async () => {
  const creator = await fixture(), source = await readWorkflowSource(creator), p = await published(creator);
  await ok(s, creator.c, "POST", creator.root.url + "/finish", complete);
  await s.db.control.query("UPDATE tasks SET content_state='deleted',retention_expires_at=now()-interval '1 day' WHERE id=$1", [creator.root.task.task_id]);
  const second = await nextConsultant(creator);
  await company(second, "workflow_read", { workflow_id: p.workflow_id });
  const derived = await published(second, { steps: [{ kind: "approval", message: "Review the retained source-based instructions." }] });
  const refs = (await s.db.control.query("SELECT source_refs FROM workflow_versions WHERE workflow_id=$1 AND version=$2", [derived.workflow_id, derived.version])).rows[0].source_refs;
  assert.ok(refs.versions.includes(source.version_id));
  assert.ok(refs.workflows.some((v: any) => v.workflow_id === p.workflow_id && v.version === p.version));
  await ok(s, second.c, "POST", second.root.url + "/finish", complete);
  const third = await nextConsultant(creator), args = { workflow_id: derived.workflow_id, version: derived.version };
  await company(third, "workflow_read", args);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [source.id]);
  assert.equal((await call(s, third.c, "POST", third.root.url + "/tools", tool("workflow_read", args))).data.error.code, "TASK_SOURCE_REVOKED");
});
