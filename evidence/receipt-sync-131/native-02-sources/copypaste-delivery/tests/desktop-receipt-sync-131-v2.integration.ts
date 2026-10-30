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
const owned = path.resolve(".data/receipt-sync-131/native-" + randomUUID());
const load = (root: string, name: string) => import(pathToFileURL(path.join(root, name)).href);
const observations: any[] = [];
let system: any, isolated: any, makeFixture: any, Controller: any, Session: any, locked: any, native: any;
let model: DesktopWorkflowModelFixture, providerError: unknown, serial = 0;
const controllers: any[] = [], providerCalls: any[] = [];
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer synthetic-receipt-sync-131");
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "synthetic-receipt-sync-131");
    if (req.url === "/v1/responses/input_tokens") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return;
    }
    assert.equal(req.url, "/v1/responses");
    const number = ++serial, item = model.next(body, number); assert.ok(item);
    providerCalls.push({ serial: number, output_type: item.type, output_name: item.name });
    await writeFile(path.join(owned, "provider-" + number + ".json"), JSON.stringify({ request: body, item }), { flag: "wx" });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_receipt_sync_" + number, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
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
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-receipt-sync-131",
    AI_MODEL: "synthetic-receipt-sync-131", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
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

for (const mode of ["before-live", "after-restored", "before-restored-revoked"] as const)
  test("actual native receipt synchronization131 " + mode, { timeout: 240000 }, async t => {
    providerError = undefined;
    const f = await makeFixture(system), directory = path.join(owned, mode), workspace = path.join(directory, "workspace"), outside = path.join(directory, "outside.txt");
    await mkdir(workspace, { recursive: true }); model = new DesktopWorkflowModelFixture(workspace, outside); model.begin("execute");
    const epoch = randomUUID(), requestLog: any[] = [], profiles: any[] = [], firstCall = serial;
    let journal: any = null, childId: string | undefined, offline = true, controller: any, restored: any;
    const io: any = {
      read: async () => structuredClone(journal), write: async (next: any) => {
        journal = structuredClone(next); await writeFile(path.join(directory, "journal.json"), JSON.stringify(next));
      }, identity: async () => ({ actorId: f.c.id, epoch }), localEpoch: async () => epoch,
      request: async (url: string, options: any = {}) => {
        const childFinish = !!childId && url.endsWith("/" + childId + "/finish");
        requestLog.push({ url, method: options.method ?? "GET", key: options.idempotencyKey, body: structuredClone(options.body) });
        if (childFinish && offline && mode.startsWith("before")) throw new Error("SYNTHETIC_CHILD_FINISH_NOT_DISPATCHED");
        const reply = await system.app.inject({ method: options.method ?? "GET", url,
          headers: { Authorization: "Bearer " + f.c.access_token, ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }) });
        const result = { status: reply.statusCode, body: reply.json() };
        if (url.endsWith("/start") && result.status === 200) {
          const task = (await system.db.control.query("SELECT role_key FROM tasks WHERE id=$1", [result.body.task_id])).rows[0];
          if (task.role_key === "fullstack") childId = result.body.task_id;
        }
        if (childFinish && offline) { assert.equal(result.status, 200); throw new Error("SYNTHETIC_CHILD_FINISH_RESPONSE_LOST"); }
        return result;
      }, chooseWorkspace: async () => workspace, consent: async () => true,
      approval: async () => { throw new Error("Receipt sync cannot ask for another native command approval"); }, changed: () => {}, stateRoot: path.join(directory, "state"),
      companyOrigin: system.app.listeningOrigin, executable: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN,
      runtime: { version: locked.runtime_version, sha256: locked.windows_x64_sha256 },
    };
    await native.withOwnedNativeProcesses(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, workspace, () => {}, async (processes: any[]) => {
      controller = new Controller(io, (profile: any, binding: any, hooks: any) => {
        profiles.push({ pin: profile.executableSha256, permission: binding.grant.mode, session_id: binding.sessionId });
        return new Session(profile, binding, hooks);
      }); controllers.push(controller);
      const scope = { tenant: f.tenant, project: f.project }, session = await controller.create(scope, "workflow-consultant");
      await controller.permission(session.id, "full-access");
      const list = async (c = controller) => (await c.list(scope)).sessions.find((row: any) => row.id === session.id);
      const outcome: Promise<any> = controller.send(session.id, "Create the local developer checklist, then await my review before QA. Preserve original receipts if the connection is lost.", 1000000)
        .then((value: any) => ({ value }), (error: any) => ({ error: String(error) }));
      try {
        const pending = await until(list, row => row.inputs?.some((i: any) => i.questions[0]?.id === "workflow_decision"), "separate actual child fee consent");
        const input = pending.inputs.find((i: any) => i.questions[0]?.id === "workflow_decision");
        assert.ok(input.questions[0].question.includes("HK$ 0.20"));
        await controller.answer(session.id, input.requestId, { workflow_decision: { answers: ["批准 / Approve"] } });
        const stopped = await bounded(outcome, 120000, "Receipt loss did not stop actual native workflow"); assert.ok(stopped.error);
        const waiting = await list(), saved = structuredClone(journal.sessions[0].operation), rootId = waiting.task.task_id;
        assert.equal(waiting.busy, false); assert.equal(waiting.receiptPending, true); assert.equal(waiting.phase, "settling");
        assert.equal(saved.workflow.taskId, childId); assert.equal(saved.workflow.report.status, "completed");
        assert.equal(saved.report.status, "unknown");
        assert.equal(await readFile(path.join(workspace, "native-flow-checklist.txt"), "utf8"), "native-checklist-verified");
        assert.equal(await readFile(outside, "utf8"), "native-child-full-access");
        assert.equal(await exists(path.join(workspace, "native-flow-qa.txt")), false);
        assert.equal(processes.length, 2); assert.ok(processes.every(row => row.closed));
        const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [rootId])).rows[0];
        assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id=$1", [run.id])).rows[0].n, 1);
        assert.equal(requestLog.filter(row => row.url.endsWith("/" + rootId + "/finish")).length, 0);
        assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [childId])).rows[0].n, mode.startsWith("after") ? 1 : 0);
        const initialAttempts = requestLog.filter(row => row.url.endsWith("/" + childId + "/finish")); assert.ok(initialAttempts.length >= 2);
        await assert.rejects(controller.retry(session.id));
        assert.equal((await list()).receiptPending, true);
        if (mode.endsWith("revoked")) { await controller.revoke(session.id); assert.equal((await list()).revoked, true); }
        if (mode.includes("restored")) {
          await controller.close();
          restored = new Controller(io, () => { throw new Error("Receipt replay must never spawn a native process"); }); controllers.push(restored);
        }
        offline = false;
        const callsBeforeSync = serial, requestsBeforeSync = requestLog.length;
        await (restored ?? controller).retry(session.id);
        const complete = await list(restored ?? controller);
        assert.equal(complete.phase, "idle"); assert.equal(complete.receiptPending, false); assert.equal(complete.uncertain, true);
        assert.equal(serial, callsBeforeSync); assert.equal(processes.length, 2); assert.ok(processes.every(row => row.closed));
        assert.equal(complete.task.status, "reconciling");
        const syncRequests = requestLog.slice(requestsBeforeSync);
        assert.deepEqual(syncRequests.filter(row => row.method === "POST").map(row => row.url.split("/").slice(-2)), [[childId, "finish"], [rootId, "finish"]]);
        const childAttempts = requestLog.filter(row => row.url.endsWith("/" + childId + "/finish"));
        assert.equal(new Set(childAttempts.map(row => row.key)).size, 1);
        for (const row of childAttempts) assert.deepEqual(row.body, saved.workflow.report);
        assert.deepEqual(requestLog.find(row => row.url.endsWith("/" + rootId + "/finish")).body, saved.report);
        const tasks = (await system.db.control.query("SELECT t.*,d.state AS native_state,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id=$1 OR t.desktop_workflow_run_id=$2", [rootId, run.id])).rows;
        assert.equal(tasks.length, 2); const child = tasks.find((row: any) => row.id === childId);
        assert.equal(child.status, "succeeded"); assert.equal(child.native_state, "finished"); assert.equal(child.charged_micros, "60");
        for (const task of tasks) {
          assert.equal(task.execution_location, "desktop"); assert.equal(task.attempt, 1);
          assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
          assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [task.id])).rows[0].n, task.id === childId ? 1 : 0);
        }
        assert.equal(tasks.reduce((sum: number, row: any) => sum + Number(row.accrued_micros), 0), (serial - firstCall) * 30);
        assert.equal(tasks.reduce((sum: number, row: any) => sum + Number(row.charged_micros), 0), 60);
        const reservations = (await system.db.control.query("SELECT task_id,status,amount_micros FROM reservations WHERE task_id=ANY($1::uuid[])", [tasks.map((row: any) => row.id)])).rows;
        assert.equal(reservations.length, 2);
        assert.equal(reservations.find((row: any) => row.task_id === childId).status, "settled");
        assert.equal(reservations.find((row: any) => row.task_id === rootId).status, "reconciling");
        assert.equal(tasks.find((row: any) => row.id === rootId).charged_micros, "0");
        assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])", [tasks.map((row: any) => row.id)])).rows[0].n, 0);
        assert.equal(await exists(path.join(workspace, "native-flow-qa.txt")), false);
        const record = { mode, root_task: rootId, workflow_run: run.id, child_task: childId, child_finish_attempts: childAttempts,
          saved_child_report: saved.workflow.report, saved_root_report: saved.report, synchronization_requests: syncRequests,
          native_processes: processes.map((row: any) => ({ pid: row.child.pid, closed: row.closed, exit_code: row.exitCode })),
          provider_calls: serial - firstCall, no_provider_calls_during_sync: serial === callsBeforeSync, profiles,
          tasks: tasks.map((row: any) => ({ id: row.id, role: row.role_key, status: row.status, charged_micros: row.charged_micros, native_state: row.native_state })),
          reservations, restored_controller: !!restored, local_permission_revoked: complete.revoked, actual_tool_results: model.observations };
        observations.push(record); t.diagnostic(JSON.stringify(record));
      } finally { await restored?.close(); await controller.close(); await outcome; }
    });
  });

