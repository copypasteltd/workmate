import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopWorkflowModelFixture } from "../scripts/desktop-workflow-model-fixture.js";

// Model choices and transport faults are synthetic. Native Codex, local shell
// work, approvals, company authorization, SQL receipts and fees are actual.
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125");
const desktop = path.resolve("../copypaste-desktop-publication-125");
const owned = path.resolve(".data/workflow-recovery-130/native-" + randomUUID());
const load = (root: string, name: string) => import(pathToFileURL(path.join(root, name)).href);
const observations: any[] = [];
let system: any, isolated: any, makeFixture: any, Controller: any, Session: any, locked: any, native: any;
let model: DesktopWorkflowModelFixture, providerError: unknown, serial = 0;
const controllers: any[] = [], providerCalls: any[] = [];
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer synthetic-workflow-recovery-130");
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "synthetic-workflow-recovery-130");
    if (req.url === "/v1/responses/input_tokens") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return;
    }
    assert.equal(req.url, "/v1/responses");
    const number = ++serial, item = model.next(body, number); assert.ok(item);
    providerCalls.push({ serial: number, output_type: item.type, output_name: item.name });
    await writeFile(path.join(owned, "provider-" + number + ".json"), JSON.stringify({ request: body, item }), { flag: "wx" });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_workflow_recovery_" + number, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
    emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item });
    if (item.type === "message") emit("response.output_text.delta", { output_index: 0, content_index: 0, item_id: item.id, delta: item.content[0].text });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } }); res.end();
  } catch (error) { providerError = error; if (!res.headersSent) res.writeHead(502); res.end(); }
});
const exists = (name: string) => access(name).then(() => true, () => false);
async function until(read: () => Promise<any>, accept: (value: any) => boolean, label: string, milliseconds = 120000) {
  const deadline = Date.now() + milliseconds;
  do {
    if (providerError) throw providerError;
    const value = await read(); if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + label);
}
async function bounded<T>(promise: Promise<T>, milliseconds: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

before(async () => {
  await mkdir(owned, { recursive: true });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const { isolatedTestEnvironment } = await load(platform, "tests/native-test-environment.ts");
  const { buildApp } = await load(platform, "src/server.ts"), { loadConfig } = await load(platform, "src/config.ts");
  ({ nativeVideoFixture: makeFixture } = await load(platform, "tests/desktop-video-fixture.ts"));
  ({ LocalAgentController: Controller } = await load(desktop, "src/local-agent.ts"));
  ({ LocalCodexSession: Session } = await load(desktop, "src/local-codex.ts"));
  native = await load(desktop, "tests/native-startup-faults.ts");
  locked = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
  assert.ok(path.isAbsolute(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!));
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-workflow-recovery-130",
    AI_MODEL: "synthetic-workflow-recovery-130", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 0 });
});
after(async () => {
  for (const controller of controllers) await controller.close();
  await system?.app.close();
  provider.closeAllConnections(); if (provider.listening) await new Promise<void>(resolve => provider.close(() => resolve()));
  await isolated?.cleanup(); process.chdir(delivery);
  assert.ok(process.env.COPYPASTE_WORKFLOW_OBSERVATIONS);
  await writeFile(process.env.COPYPASTE_WORKFLOW_OBSERVATIONS!, JSON.stringify({ at: new Date().toISOString(), observations,
    provider_calls: providerCalls, owned_directory: owned, provider_closed: !provider.listening, fixture_cleanup_called: true }, null, 2) + "\n", { flag: "wx" });
  if (providerError) throw providerError;
});

for (const mode of ["recover-children", "withdraw-stalled-child", "complete-stalled-child"] as const)
  test("actual native workflow recovery130 " + mode, { timeout: 240000 }, async t => {
    providerError = undefined;
    const f = await makeFixture(system), directory = path.join(owned, mode), workspace = path.join(directory, "workspace"), outside = path.join(directory, "outside.txt");
    await mkdir(workspace, { recursive: true });
    model = new DesktopWorkflowModelFixture(workspace, outside); model.begin("execute");
    const epoch = randomUUID(), profiles: any[] = [], startedReceipts = new Map<string, any>(), decisions: string[] = [];
    let journal: any = null, controller: any, childToHold: string | undefined, held: any, releaseHeartbeat: (() => void) | undefined;
    let heartbeatSignal: AbortSignal | undefined, heldHeartbeat = false, requestKeys: any[] = [];
    const firstCall = serial;
    await native.withOwnedNativeProcesses(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, workspace, (row: any, index: number) => {
      if (mode === "recover-children" && [2, 4].includes(index)) {
        native.interceptNativeRPC(row, index === 2 ? "initialize" : "thread/start", (_request: any, complete: () => void) => { complete(); row.child.kill("SIGKILL"); });
      } else if (mode !== "recover-children" && index === 3) {
        let restore!: () => void;
        restore = native.interceptNativeRPC(row, "initialize", (request: any, complete: (error?: Error) => void) => { held = { row, request, complete, restore }; });
      }
    }, async (processes: any[]) => {
      controller = new Controller({ read: async () => structuredClone(journal), write: async (next: any) => {
        journal = structuredClone(next); await writeFile(path.join(directory, "journal.json"), JSON.stringify(next));
      }, identity: async () => ({ actorId: f.c.id, epoch }), localEpoch: async () => epoch,
      request: async (url: string, options: any = {}) => {
        if (options.signal?.aborted) throw new Error("REQUEST_ABORTED_BEFORE_DISPATCH");
        const result = await system.app.inject({ method: options.method ?? "GET", url,
          headers: { Authorization: "Bearer " + f.c.access_token, ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }) });
        const response = { status: result.statusCode, body: result.json() };
        if (url.endsWith("/start") && response.status === 200) {
          const id = response.body.task_id, task = (await system.db.control.query("SELECT role_key FROM tasks WHERE id=$1", [id])).rows[0];
          startedReceipts.set(id, { task_id: id, deadline: response.body.startup.deadline_at,
            contract: response.body.startup.contract_sha256, fence: response.body.startup.fencing_token });
          if (task.role_key === "software-qa") childToHold = id;
        }
        if (url.endsWith("/startup-recovery")) requestKeys.push({ path: url, key: options.idempotencyKey, body: options.body, status: response.status });
        if (mode !== "recover-children" && childToHold && held && !heldHeartbeat && url.endsWith("/" + childToHold + "/heartbeat")) {
          heldHeartbeat = true; heartbeatSignal = options.signal;
          // Deliberately uncooperative transport: the trusted controller must
          // stop its wait without requiring this response to arrive.
          return new Promise(resolve => { releaseHeartbeat = () => resolve(response); });
        }
        return response;
      }, chooseWorkspace: async () => workspace, consent: async (permission: string) => { assert.equal(permission, "full-access"); return true; },
      approval: async () => { throw new Error("Explicit full access does not fabricate command approvals"); }, changed: () => {}, stateRoot: path.join(directory, "state"),
      companyOrigin: system.app.listeningOrigin, executable: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN,
      runtime: { version: locked.runtime_version, sha256: locked.windows_x64_sha256 },
      }, (profile: any, binding: any, hooks: any) => {
        profiles.push({ sha256: profile.executableSha256, session_id: binding.sessionId, permission: binding.grant.mode,
          skill_keys: binding.skills.map((s: any) => s.key), tools: binding.companyTools.map((tool: any) => tool.name) });
        return new Session(profile, binding, hooks);
      }); controllers.push(controller);
      const scope = { tenant: f.tenant, project: f.project }, created = await controller.create(scope, "workflow-consultant");
      await controller.permission(created.id, "full-access");
      const list = async () => (await controller.list(scope)).sessions.find((r: any) => r.id === created.id);
      const job = controller.send(created.id, "Execute the frozen developer and QA workflow, with separate fee and human review, and retain original company receipts.", 1000000);
      const outcome = job.then((value: any) => ({ value, error: undefined }), (error: any) => ({ value: undefined, error }));
      try {
        for (const stage of ["launch", "step"]) {
          const state = await until(list, row => row.inputs?.some((input: any) => input.questions[0]?.id === "workflow_decision"), stage + " actual human card");
          const input = state.inputs.find((i: any) => i.questions[0]?.id === "workflow_decision");
          if (stage === "launch") {
            assert.ok(input.questions[0].question.includes("HK$ 0.20")); assert.equal(profiles.length, 1);
            assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id IN (SELECT id FROM workflow_runs WHERE origin_task_id=$1)", [state.task.task_id])).rows[0].n, 0);
          } else {
            assert.equal(await readFile(path.join(workspace, "native-flow-checklist.txt"), "utf8"), "native-checklist-verified");
            assert.equal(await exists(path.join(workspace, "native-flow-qa.txt")), false);
          }
          decisions.push(stage); await controller.answer(created.id, input.requestId, { workflow_decision: { answers: ["批准 / Approve"] } });
        }
        let withdrawalElapsed: number | undefined;
        if (mode !== "recover-children") {
          await until(async () => held, Boolean, "actual QA native initialize held before work");
          await until(async () => heldHeartbeat, Boolean, "actual company child heartbeat accepted, response withheld");
          assert.ok(heartbeatSignal);
          if (mode === "withdraw-stalled-child") {
            const calls = serial, began = Date.now(); await controller.revoke(created.id);
            const stopped = await bounded(outcome, 12000, "Withdrawal waited for the withheld company heartbeat");
            withdrawalElapsed = Date.now() - began; assert.ok(stopped.error);
            assert.ok(processes.every(row => row.closed)); assert.equal(serial, calls);
            assert.equal(await exists(path.join(workspace, "native-flow-qa.txt")), false);
          } else {
            held.restore();
            held.row.child.stdin.write(JSON.stringify(held.request) + "\n", (error: Error | undefined) => held.complete(error));
          }
        }
        const finished = await bounded(outcome, 120000, "Native workflow did not reach its recorded outcome");
        const state = await list(), rootId = state.task.task_id;
        const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [rootId])).rows[0];
        const children = (await system.db.control.query("SELECT t.*,d.state AS native_state,d.startup_state,d.startup_attempt,d.startup_deadline_at,d.startup_contract_sha256 FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.desktop_workflow_run_id=$1 ORDER BY t.desktop_workflow_cursor", [run.id])).rows;
        assert.equal(state.busy, false); assert.equal(children.length, 2); assert.deepEqual(children.map((r: any) => r.role_key), ["fullstack", "software-qa"]);
        assert.ok(processes.every(row => row.closed));
        assert.equal(await readFile(outside, "utf8"), "native-child-full-access");
        assert.ok(profiles.every(p => p.sha256 === locked.windows_x64_sha256 && p.permission === "full-access" && p.skill_keys.length > 0));
        assert.ok(profiles[0].tools.includes("workflow_run")); assert.ok(profiles.slice(1).every(p => !p.tools.includes("workflow_run")));
        for (const child of children) {
          assert.equal(child.execution_location, "desktop"); assert.equal(child.attempt, 1);
          assert.equal(new Date(child.startup_deadline_at).getTime(), new Date(startedReceipts.get(child.id).deadline).getTime());
          assert.equal(child.startup_contract_sha256, startedReceipts.get(child.id).contract);
          assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [child.id])).rows[0].n, 1);
          assert.ok((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [child.id])).rows[0].n <= 1);
        }
        const recoveries = (await system.db.control.query("SELECT * FROM desktop_startup_recoveries WHERE task_id=ANY($1::uuid[]) ORDER BY task_id", [children.map((c: any) => c.id)])).rows;
        if (mode === "withdraw-stalled-child") {
          assert.equal(run.state, "cancelled"); assert.equal(state.revoked, true); assert.equal(state.permission, null);
          assert.equal(children[0].status, "succeeded"); assert.equal(children[0].charged_micros, "60");
          assert.ok(["cancelled", "reconciling", "failed"].includes(children[1].status)); assert.equal(children[1].charged_micros, "0");
          assert.equal(recoveries.length, 0); assert.equal(heartbeatSignal!.aborted, true);
        } else {
          assert.equal(finished.error, undefined); assert.equal(state.task.status, "succeeded"); assert.equal(run.state, "succeeded"); assert.equal(run.cursor, 3);
          assert.equal(await readFile(path.join(workspace, "native-flow-qa.txt"), "utf8"), "native-checklist-verified-qa");
          assert.ok(children.every((c: any) => c.status === "succeeded" && c.native_state === "finished" && c.charged_micros === "60"));
          const tasks = (await system.db.control.query("SELECT charged_micros FROM tasks WHERE id=$1 OR desktop_workflow_run_id=$2", [rootId, run.id])).rows;
          assert.equal(tasks.reduce((sum: number, r: any) => sum + Number(r.charged_micros), 0), (serial - firstCall) * 30);
          if (mode === "recover-children") {
            assert.equal(processes.length, 5); assert.equal(recoveries.length, 2); assert.equal(requestKeys.length, 2);
            assert.ok(children.every((c: any) => c.startup_attempt === 2));
            for (const receipt of recoveries) {
              assert.equal(receipt.state, "ready"); assert.equal(receipt.proof.safe, true);
              assert.equal(receipt.proof.model_requests, 0); assert.equal(receipt.proof.input_count_requests, 0); assert.equal(receipt.proof.company_tool_admissions, 0);
            }
          } else { assert.equal(processes.length, 3); assert.equal(recoveries.length, 0); assert.equal(heartbeatSignal!.aborted, true); }
        }
        assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])", [[rootId, ...children.map((c: any) => c.id)]])).rows[0].n, 0);
        const calls = serial; releaseHeartbeat?.(); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(serial, calls);
        const record = { mode, root_task: rootId, workflow_run: run.id, child_tasks: children.map((c: any) => ({ id: c.id, status: c.status, startup_attempt: c.startup_attempt,
          deadline: c.startup_deadline_at, charged_micros: c.charged_micros })), native_processes: processes.map((p: any) => ({ pid: p.child.pid, closed: p.closed, exit_code: p.exitCode })),
          provider_calls: serial - firstCall, recovery_proofs: recoveries.map((r: any) => r.proof), request_keys: requestKeys, decisions, withdrawal_elapsed_ms: withdrawalElapsed,
          stalled_heartbeat_cancelled: heartbeatSignal?.aborted, profiles, actual_tool_results: model.observations };
        observations.push(record); t.diagnostic(JSON.stringify(record));
      } finally { releaseHeartbeat?.(); await controller.close(); await outcome; }
    });
  });
