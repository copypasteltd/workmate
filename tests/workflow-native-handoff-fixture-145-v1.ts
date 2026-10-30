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


export {s, fixture, published, launch, decision, advance, nativeRun, company, complete, ok, call, tool};
