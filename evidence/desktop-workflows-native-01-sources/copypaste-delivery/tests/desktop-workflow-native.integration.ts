import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopWorkflowModelFixture } from "../scripts/desktop-workflow-model-fixture.js";

// Responses and customer choices are explicit fixtures. Every Codex process,
// command, company tool, identity, database transition and fee is real.
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop");
const owned = path.resolve(".data/native-workflows", randomUUID());
let system: any, isolated: any, fixture: any, Controller: any, Session: any, locked: any;
let model: DesktopWorkflowModelFixture | undefined, providerError: unknown, requests = 0;
const controllers: any[] = [];
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer native-workflow-fixture");
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
    assert.equal(req.url, "/v1/responses"); assert.equal(body.model, "native-workflow-fixture");
    const item = model!.next(body, ++requests); assert.ok(item);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_native_flow_" + requests, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
    emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item });
    if (item.type === "message") emit("response.output_text.delta", { output_index: 0, content_index: 0, item_id: item.id, delta: item.content[0].text });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } }); res.end();
  } catch (error) { providerError = error; if (!res.headersSent) res.writeHead(502); res.end(); }
});
const wait = async (read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms = 60000) => {
  const deadline = Date.now() + ms;
  do { if (providerError) throw providerError; const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  throw new Error("Native workflow timed out: " + label);
};
const exists = async (file: string) => access(file).then(() => true, () => false);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
before(async () => {
  await mkdir(owned, { recursive: true });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const load = (repo: string, file: string) => import(pathToFileURL(path.join(repo, file)).href);
  const { isolatedTestEnvironment } = await load(platform, "tests/native-test-environment.ts");
  const { buildApp } = await load(platform, "src/server.ts"), { loadConfig } = await load(platform, "src/config.ts");
  ({ nativeVideoFixture: fixture } = await load(platform, "tests/desktop-video-fixture.ts"));
  ({ LocalAgentController: Controller } = await load(desktop, "src/local-agent.ts"));
  ({ LocalCodexSession: Session } = await load(desktop, "src/local-codex.ts"));
  locked = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
  assert.ok(path.isAbsolute(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!));
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "native-workflow-fixture", AI_MODEL: "native-workflow-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 0 });
});
after(async () => {
  for (const controller of controllers) await controller.close();
  if (system) { await system.app.close(); await system.db.close(); }
  provider.closeAllConnections(); if (provider.listening) await new Promise<void>(resolve => provider.close(() => resolve()));
  await isolated?.cleanup(); process.chdir(delivery);
  if (providerError) throw providerError;
});

for (const mode of ["execute", "stop", "revoke"] as const) test("actual native workflow " + mode + " uses local child Codex and company receipts", { timeout: 150000 }, async t => {
  const f = await fixture(system), directory = path.join(owned, mode), workspace = path.join(directory, "workspace"), outside = path.join(directory, "outside.txt");
  await mkdir(workspace, { recursive: true });
  model = new DesktopWorkflowModelFixture(workspace, outside); model.begin(mode);
  const epoch = randomUUID(), profiles: any[] = [], decisions: string[] = []; let journal: any = null;
  const controller = new Controller({ read: async () => journal, write: async (next: any) => { journal = structuredClone(next); await writeFile(path.join(directory, "journal.json"), JSON.stringify(next)); },
    identity: async () => ({ actorId: f.c.id, epoch }), localEpoch: async () => epoch,
    request: async (url: string, options: any = {}) => {
      if (options.signal?.aborted) throw new Error("REQUEST_ABORTED");
      const result = await system.app.inject({ method: options.method ?? "GET", url,
        headers: { Authorization: "Bearer " + f.c.access_token, ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }) });
      return { status: result.statusCode, body: result.json() };
    }, chooseWorkspace: async () => workspace, consent: async (grant: string) => { assert.equal(grant, "full-access"); return true; },
    approval: async () => { throw new Error("Full access must not invent per-command approval"); }, changed: () => {}, stateRoot: path.join(directory, "state"),
    companyOrigin: system.app.listeningOrigin, executable: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN,
    runtime: { version: locked.runtime_version, sha256: locked.windows_x64_sha256 },
  }, (profile: any, binding: any, hooks: any) => {
    profiles.push({ version: profile.version, sha256: profile.executableSha256, session_id: binding.sessionId, permission: binding.grant.mode,
      skills: binding.skills.map((skill: any) => ({ key: skill.key, sha256: skill.sha256 })), tools: binding.companyTools.map((tool: any) => tool.name) });
    return new Session(profile, binding, hooks);
  }); controllers.push(controller);
  const scope = { tenant: f.tenant, project: f.project }, created = await controller.create(scope, "workflow-consultant");
  await controller.permission(created.id, "full-access");
  const list = async () => (await controller.list(scope)).sessions.find((row: any) => row.id === created.id);
  const job = controller.send(created.id, "Execute this explicitly synthetic bounded native workflow and deliver its SOP, executable JSON and recovery notes.", 1000000);
  let ended = false; void job.finally(() => { ended = true; }).catch(() => {});
  try {
    for (const stage of mode === "execute" ? ["launch", "step"] : ["launch"]) {
      const state = await wait(list, row => row.inputs?.some((input: any) => input.questions[0]?.id === "workflow_decision"), stage + " human consent");
      const input = state.inputs.find((value: any) => value.questions[0]?.id === "workflow_decision");
      if (stage === "launch") {
        assert.ok(input.questions[0].question.includes(mode === "execute" ? "HK$ 0.20" : "HK$ 0.10"));
        assert.equal(profiles.length, 1); assert.equal(await exists(outside), false);
      } else { assert.equal(await readFile(path.join(workspace, "native-flow-checklist.txt"), "utf8"), "native-checklist-verified"); assert.equal(await exists(path.join(workspace, "native-flow-qa.txt")), false); }
      decisions.push(stage); await controller.answer(created.id, input.requestId, { workflow_decision: { answers: ["批准 / Approve"] } });
    }
    if (mode === "execute") {
      const state = await wait(list, row => !row.busy && row.task?.status === "succeeded", "two native children and delivery", 90000); await job;
      assert.equal(await readFile(outside, "utf8"), "native-child-full-access");
      assert.equal(await readFile(path.join(workspace, "native-flow-qa.txt"), "utf8"), "native-checklist-verified-qa");
      const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [state.task.task_id])).rows[0];
      assert.equal(run.state, "succeeded"); assert.equal(run.cursor, 3); assert.equal(run.results[1].actor_id, f.c.id);
      const children = (await system.db.control.query("SELECT t.*,d.state AS native_state FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.desktop_workflow_run_id=$1 ORDER BY t.desktop_workflow_cursor", [run.id])).rows;
      assert.deepEqual(children.map((row: any) => row.role_key), ["fullstack", "software-qa"]);
      assert.ok(children.every((row: any) => row.status === "succeeded" && row.native_state === "finished" && row.execution_location === "desktop" && row.charged_micros === "60"));
      const assets = (await system.db.control.query("SELECT a.name,a.private_owner FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.metadata->>'task_id'=$1 ORDER BY a.name", [state.task.task_id])).rows;
      assert.deepEqual(assets.map((row: any) => row.name), ["SOP.md", "recovery.md", "workflow.json"]); assert.ok(assets.every((row: any) => row.private_owner === f.c.id));
      assert.equal(profiles.length, 3); assert.ok(profiles.every(profile => profile.permission === "full-access" && profile.skills.length > 0 && profile.sha256 === locked.windows_x64_sha256));
      assert.ok(profiles[0].tools.includes("workflow_run")); assert.ok(profiles.slice(1).every(profile => !profile.tools.includes("workflow_run")));
      assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])", [[state.task.task_id, ...children.map((row: any) => row.id)]])).rows[0].n, 0);
      t.diagnostic(JSON.stringify({ native_profiles: profiles, child_task_ids: children.map((row: any) => row.id), child_usage_micros: children.map((row: any) => row.charged_micros), human_decisions: decisions, native_tool_outputs: model.observations }));
    } else {
      const marker = path.join(workspace, "native-flow-" + mode + "-started.txt");
      await wait(() => exists(marker), Boolean, "real child shell starts");
      const beforeStop = await list(), pids = beforeStop.events.filter((event: any) => event.kind === "local.runtime.ready").map((event: any) => event.value.pid);
      assert.equal(pids.length, 2); assert.ok(pids.every(alive));
      await controller[mode === "stop" ? "stop" : "revoke"](created.id);
      await wait(async () => pids.every((pid: number) => !alive(pid)), Boolean, "root and child process exit"); await job;
      await new Promise(resolve => setTimeout(resolve, 10000));
      assert.equal(await exists(path.join(workspace, "native-flow-" + mode + "-forbidden.txt")), false);
      const state = await list(); assert.equal(state.busy, false); assert.equal(state.inputs.length, 0);
      if (mode === "revoke") { assert.equal(state.revoked, true); assert.equal(state.permission, null); }
      const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [state.task.task_id])).rows[0]; assert.equal(run.state, "cancelled");
      const children = (await system.db.control.query("SELECT status,cancel_requested FROM tasks WHERE desktop_workflow_run_id=$1", [run.id])).rows;
      assert.equal(children.length, 1); assert.equal(children[0].cancel_requested, true);
      assert.ok(["cancelled", "reconciling"].includes(children[0].status));
      t.diagnostic(JSON.stringify({ exited_native_pids: pids, forbidden_late_write_absent: true, wait_after_stop_ms: 10000, child_state: children[0].status, no_automatic_replay: true, human_decisions: decisions }));
    }
  } finally { await controller.close(); if (!ended) await job.catch(() => {}); }
});
