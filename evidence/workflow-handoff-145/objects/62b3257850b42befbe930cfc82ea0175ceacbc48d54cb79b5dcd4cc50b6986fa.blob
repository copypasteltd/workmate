import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { LocalCodexSession, type LocalCodexProfile, type LocalSessionBinding, type LocalCodexHooks } from "../../src/local-codex.js";
import type { LocalInputRequest } from "../../src/local-input.js";
import { LocalProgramController, type ProgramJournal } from "../../src/local-programs.js";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal } from "../../src/local-agent.js";
import { withOwnedNativeProcesses, interceptNativeRPC } from "../native-startup-faults.js";
import { LocalStartupCoordinator, type LocalStartupJournal } from "../../src/local-startup.js";
import { startupFixture, startupTurnFixture } from "../startup-receipt-fixture.js";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lock = JSON.parse(await readFile(new URL("../../contracts/local-codex-runtime.json", import.meta.url), "utf8"));
const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(executable && path.isAbsolute(executable), "Set COPYPASTE_LOCAL_CODEX_TEST_BIN to the locked absolute native Codex binary. No PATH fallback.");
const skill = "---\nname: native-fixture-method\ndescription: Verify a local fixture without fabricating results.\n---\nNATIVE_SKILL_FROM_DISK_73D6. Inspect actual tool results and preserve unrelated files.";
type Action = { command?: string; input?: { questions: any[] }; company?: { tool: string; arguments: Record<string, unknown> }; program?: { tool: string; arguments: Record<string, unknown> }; stall?: () => void; hold?: () => Promise<void>; stage?: number };

function emit(res: ServerResponse, type: string, payload: Record<string, unknown>) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}
function completed(res: ServerResponse, index: number, item: any) {
  const response = { id: "resp_local_" + index, object: "response", model: "copypaste-native-fixture", created_at: 1, status: "in_progress", output: [] };
  emit(res, "response.created", { response });
  emit(res, "response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : item });
  if (item.type === "function_call") {
    emit(res, "response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments });
    emit(res, "response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments });
  } else {
    emit(res, "response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
    emit(res, "response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
  }
  emit(res, "response.output_item.done", { output_index: 0, item });
  emit(res, "response.completed", { response: { ...response, status: "completed", output: [item], usage: {
    input_tokens: 17, output_tokens: 5, total_tokens: 22, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
  } } });
  res.end();
}
function commandTool(tools: any[]): { name: string; parameters: any } | undefined {
  for (const tool of tools ?? []) {
    if (tool.type === "namespace") {
      const nested = commandTool(tool.tools ?? []);
      if (nested) return { ...nested, name: tool.name + "." + nested.name };
    }
    if (["exec_command", "shell", "shell_command"].includes(tool.name)) return { name: tool.name, parameters: tool.parameters };
  }
}
function inputTool(tools: any[]): { name: string; parameters: any } | undefined {
  for (const tool of tools ?? []) {
    if (tool.type === "namespace") { const child = inputTool(tool.tools); if (child) return { ...child, name: tool.name + "." + child.name }; }
    if (tool.name === "request_user_input") return { name: tool.name, parameters: tool.parameters };
  }
}
async function fixture() {
  const parent = path.resolve(".data/native-local-tests");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "session-"));
  const workspace = path.join(directory, "workspace"), outside = path.join(directory, "outside"), stateRoot = path.join(directory, "state");
  for (const folder of [workspace, outside, stateRoot]) await mkdir(folder);
  const token = randomBytes(32).toString("hex");
  const requests: any[] = [], actions: Action[] = [], sessions: LocalCodexSession[] = [], events: any[] = [];
  let handlerError: unknown, readyPid = 0, authority = true;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      requests.push({ url: req.url, authorized: req.headers.authorization === "Bearer " + token, body });
      await writeFile(path.join(directory, "last-request-body.json"), JSON.stringify(body));
      assert.ok(req.url === "/v1/responses" || req.url === "/v1/desktop-inference/v1/responses");
      assert.equal(req.headers.authorization, "Bearer " + token);
      const action = actions[0];
      assert.ok(action, "Unexpected additional provider dispatch");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      if (action.hold) await action.hold();
      if (action.stall) {
        actions.shift();
        emit(res, "response.created", { response: { id: "resp_stalled", object: "response", status: "in_progress", output: [] } });
        action.stall();
      } else if (action.input && !action.stage) {
        const tool = inputTool(body.tools);
        assert.ok(tool, "The pinned native runtime must advertise request_user_input in ordinary working mode");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_input_" + requests.length, type: "function_call", name: tool.name,
          call_id: "call_input_" + requests.length, arguments: JSON.stringify(action.input) });
      } else if (action.program && !action.stage) {
        assert.ok(body.tools.some((tool: any) => tool.type === "namespace" && tool.name === "copypaste_programs"
          && tool.tools.some((child: any) => child.name === action.program!.tool)), "Native Codex must declare the exact approved-program namespace");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_program_" + requests.length, type: "function_call", namespace: "copypaste_programs",
          name: action.program.tool, call_id: "call_program_" + requests.length, arguments: JSON.stringify(action.program.arguments) });
      } else if (action.company && !action.stage) {
        assert.ok(body.tools.some((tool: any) => tool.type === "namespace" && tool.name === "copypaste"
          && tool.tools.some((child: any) => child.name === action.company!.tool)), "Exact company namespace must be declared by native Codex");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_company_" + requests.length, type: "function_call", namespace: "copypaste",
          name: action.company.tool, call_id: "call_company_" + requests.length, arguments: JSON.stringify(action.company.arguments) });
      } else if (action.command && !action.stage) {
        const tool = commandTool(body.tools);
        assert.ok(tool, "Codex must advertise its native terminal tool");
        const properties = tool.parameters?.properties ?? {};
        const args = "cmd" in properties
          ? { cmd: action.command, workdir: workspace, yield_time_ms: 1000, max_output_tokens: 2000 }
          : "command" in properties && properties.command.type === "array"
            ? { command: ["powershell.exe", "-NoProfile", "-Command", action.command], workdir: workspace, timeout_ms: 10000 }
            : { command: action.command, workdir: workspace, timeout_ms: 10000 };
        action.stage = 1;
        completed(res, requests.length, { id: "fc_local_" + requests.length, type: "function_call", name: tool.name,
          call_id: "call_local_" + requests.length, arguments: JSON.stringify(args) });
      } else {
        actions.shift();
        completed(res, requests.length, { id: "msg_local_" + requests.length, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "LOCAL_CODEX_NATIVE_COMPLETE", annotations: [] }] });
      }
    } catch (error) {
      handlerError = error;
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile: LocalCodexProfile = { executable: executable!, version: lock.runtime_version, executableSha256: lock.windows_x64_sha256,
    companyOrigin: origin, baseURL: origin + "/v1", model: "copypaste-native-fixture", effort: "medium" };
  const actor = randomUUID();
  const binding: LocalSessionBinding = { sessionId: randomUUID(), actorId: actor, tenantId: randomUUID(), projectId: randomUUID(), workspace, stateRoot,
    grant: { id: randomUUID(), actorId: actor, mode: "full-access", revision: 1, expiresAt: Date.now() + 300000 },
    skills: [{ key: "native-fixture-method", content: skill, sha256: digest(skill) }] };
  const make = (p = profile, b = binding, companyTool?: LocalCodexHooks["companyTool"], userInput?: LocalCodexHooks["userInput"], programTool?: LocalCodexHooks["programTool"], authorize?: LocalCodexHooks["authorize"]) => {
    const session = new LocalCodexSession(p, b, { authorize: authorize ?? (async () => { if (!authority) throw new Error("Account revoked"); }),
      companyTool, userInput, programTool, event: async (kind, value) => { events.push({ kind, value }); if (kind === "local.runtime.ready") readyPid = Number(value.pid); } });
    sessions.push(session); return session;
  };
  const start = (session: LocalCodexSession, expiresAt = Date.now() + 300000) => session.start({ token, expiresAt });
  const checkpoint = () => readFile(path.join(stateRoot, "local-codex", binding.sessionId, "checkpoint.json"), "utf8").then(JSON.parse);
  const clean = async () => {
    await Promise.all(sessions.map((session) => session.close()));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (handlerError) throw handlerError;
  };
  return { profile, binding, make, start, checkpoint, clean, requests, actions, events, workspace, outside, stateRoot,
    pid: () => readyPid, revokeAuthority: () => { authority = false; }, token, directory };
}
const quoted = (value: string) => "'" + value.replaceAll("'", "''") + "'";

for (const fault of [
  { method: "initialize", timeout: false, twice: false },
  { method: "thread/start", timeout: false, twice: false },
  { method: "thread/start", timeout: true, twice: false },
  { method: "thread/resume", timeout: false, twice: false },
  { method: "initialize", timeout: false, twice: true },
] as const) test(`real pinned native startup recovery at ${fault.method}, timeout=${fault.timeout}, twice=${fault.twice}`, { timeout: 180000 }, async () => {
  const f = await fixture();
  try {
    if (fault.method === "thread/resume") {
      const seed = f.make(); await f.start(seed); f.actions.push({});
      await seed.turn("Finish the prior task before testing startup of a new task", new AbortController().signal); await seed.close();
    }
    const initialRequests = f.requests.length;
    const taskId = randomUUID(), fence = randomUUID(), secondFence = randomUUID(), deadline = Date.now() + 300000;
    const checkpoint: { startup?: LocalStartupJournal } = {}, calls: string[] = [], snapshots: any[] = [];
    await withOwnedNativeProcesses(f.profile.executable, f.workspace, (row, index) => {
      if (index === 1 || fault.twice) interceptNativeRPC(row, fault.method, (_request, complete) => {
        complete(); if (!fault.timeout) row.child.kill("SIGKILL");
      });
    }, async owned => {
      const coordinator = new LocalStartupCoordinator({
        checkpoint, taskId, fields: { device_id: randomUUID(), local_session_id: f.binding.sessionId }, signal: new AbortController().signal,
        assertOwner: async () => {}, authorize: async () => {}, persist: async () => { snapshots.push(structuredClone(checkpoint)); },
        stopHeartbeat: async () => {}, startHeartbeat: () => {}, event: async () => {},
        request: async (route, body: any) => {
          calls.push(route);
          if (route === "/turn-admission") return { status: 200, body: { admitted: true, task_id: taskId, startup_fencing_token: secondFence } };
          const recovering = route === "/startup-recovery";
          if (recovering) {
            assert.equal(owned.length, 1); assert.equal(owned[0].closed, true, "Old process must be terminal before requesting recovery");
            assert.equal(f.requests.length, initialRequests); assert.equal(body.startup_fencing_token, fence);
          }
          return { status: 200, body: { task_id: taskId, state: "running", status: "running",
            startup: { protocol: "desktop-startup-recovery-v1", attempt: recovering ? 2 : 1, max_attempts: 2,
              state: "preparing", fencing_token: recovering ? secondFence : fence, contract_sha256: "a".repeat(64), deadline_at: new Date(deadline).toISOString() },
            credential: { token: f.token, expires_at: new Date(deadline).toISOString() } } };
        },
      });
      const initial = await coordinator.admission(randomUUID());
      const starting = coordinator.start(initial, () => ({ runtime: f.make(), closeResources: async () => {} }));
      if (fault.twice) {
        await assert.rejects(starting, (error: any) => ["LOCAL_CODEX_DISCONNECTED", "LOCAL_CODEX_EXITED"].includes(error?.code));
        await assert.rejects(coordinator.admission(randomUUID()), { code: "LOCAL_STARTUP_OWNER_REVIEW_REQUIRED" });
        assert.equal(f.requests.length, initialRequests);
      } else {
        const begun = await starting; await coordinator.admitTurn(); f.actions.push({});
        const result = await begun.runtime.turn("Complete the original task once", new AbortController().signal);
        assert.equal(result.status, "completed"); await begun.runtime.close(); await begun.closeResources();
        assert.equal(f.requests.length, initialRequests + 1);
      }
      assert.equal(owned.length, 2); assert.ok(owned.every(row => row.closed));
      assert.equal(calls.filter(route => route === "/start").length, 1);
      assert.equal(calls.filter(route => route === "/startup-recovery").length, 1);
      assert.ok(!JSON.stringify(snapshots).includes(f.token));
      console.log("# native_startup_recovery " + JSON.stringify({ method: fault.method, timeout: fault.timeout, twice: fault.twice,
        native_processes: owned.length, model_requests: f.requests.length - initialRequests, prior_task_requests: initialRequests, native_processes_closed: owned.every(row => row.closed), company_api: "synthetic; real SQL qualified separately" }));
    });
  } finally { await f.clean(); }
});

for (const phase of ["company-authority", "verified-binary", "owned-lock", "spawn-authority"] as const)
  for (const withdrawal of ["close", "revoke"] as const)
    test(`native startup ${withdrawal} at ${phase} prevents a late process and releases any acquired lock`, { timeout: 120000 }, async () => {
      const f = await fixture(); let release!: () => void, pending: Promise<void> | undefined, closing: Promise<void> | undefined;
      try {
        let entered!: () => void, authorizations = 0;
        const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
        const wait = async () => { entered(); await gate; };
        const native = f.make(f.profile, f.binding, undefined, undefined, undefined, async () => {
          authorizations++;
          if ((phase === "company-authority" && authorizations === 1) || (phase === "spawn-authority" && authorizations === 2)) await wait();
        });
        // Delay real preparation at its ownership boundaries; the pinned
        // binary/profile checks and filesystem operations remain real.
        const internal = native as any;
        if (phase === "verified-binary" || phase === "owned-lock") {
          const method = phase === "verified-binary" ? "verifyProfile" : "takeLock", original = internal[method].bind(native);
          internal[method] = async (...args: unknown[]) => { await original(...args); await wait(); };
        }
        pending = f.start(native); const rejected = assert.rejects(pending, { code: "LOCAL_SESSION_CLOSED" });
        await ready; closing = native[withdrawal](); release(); await rejected; await closing;
        assert.equal(internal.child, undefined, "A cancelled preparation must never spawn a native agent afterwards");
        assert.equal(internal.lock, undefined); assert.equal(f.requests.length, 0); assert.equal(f.events.some(e => e.kind === "local.runtime.ready"), false);
        await assert.rejects(readFile(path.join(f.stateRoot, "local-codex", f.binding.sessionId, "process.lock")), { code: "ENOENT" });
      } finally { release?.(); await pending?.catch(() => {}); await closing?.catch(() => {}); await f.clean(); }
    });

for (const method of ["initialize", "thread/start"] as const)
  for (const withdrawal of ["close", "revoke"] as const)
    test(`native startup ${withdrawal} drains a real process with a pending ${method} RPC`, { timeout: 120000 }, async () => {
      const f = await fixture();
      try {
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        await withOwnedNativeProcesses(f.profile.executable, f.workspace, row => {
          interceptNativeRPC(row, method, (_request, complete) => { complete(); entered(); });
        }, async owned => {
          const native = f.make(), pending = f.start(native);
          const rejected = assert.rejects(pending, { code: "LOCAL_SESSION_CLOSED" });
          await ready; const before = Date.now(); await native[withdrawal](); await rejected;
          assert.ok(Date.now() - before < 10000, "Closing must interrupt startup without waiting for its 30-second RPC deadline");
          assert.equal(owned.length, 1); assert.equal(owned[0].closed, true); assert.equal(f.requests.length, 0);
          assert.equal(f.events.some(e => e.kind === "local.runtime.ready"), false);
          await assert.rejects(readFile(path.join(f.stateRoot, "local-codex", f.binding.sessionId, "process.lock")), { code: "ENOENT" });
        });
      } finally { await f.clean(); }
    });

test("actual customer-local Codex startup exceeding 45 seconds retains the original lease and runs exactly one turn", { timeout: 180000 }, async () => {
  const f = await fixture(); let controller: LocalAgentController | undefined;
  try {
    let journal: LocalAgentJournal | null = null, leaseUntil = 0, heartbeats = 0, creates = 0, starts = 0, finishes = 0;
    const actor = { actorId: f.binding.actorId, epoch: randomUUID() }, taskId = randomUUID();
    let state = "prepared", status = "queued";
    const task = { task_id: taskId, state: "running", status: "running" };
    const runtime = { pinned_version: lock.runtime_version, windows_x64_sha256: lock.windows_x64_sha256, role_keys: ["fullstack"] };
    const io: LocalAgentIO = {
      read: async () => structuredClone(journal), write: async value => { journal = structuredClone(value); },
      identity: async () => actor, localEpoch: async () => actor.epoch, changed: () => {}, chooseWorkspace: async () => f.workspace,
      consent: async () => true, approval: async () => "decline", stateRoot: f.stateRoot, companyOrigin: f.profile.companyOrigin,
      executable: f.profile.executable, runtime: { version: lock.runtime_version, sha256: lock.windows_x64_sha256 },
      request: async (url, options) => {
        if (url.endsWith("/runtime")) return { status: 200, body: runtime };
        if (url.endsWith("/desktop-executions")) { creates++; return { status: 200, body: { task_id: taskId, state, status } }; }
        if (url.endsWith("/start")) {
          starts++; state = status = "running"; leaseUntil = Date.now() + 45000;
          const begun = startupFixture(task);
          return { status: 200, body: { ...begun, runtime, inference_path: "/v1/desktop-inference/v1", skills: f.binding.skills,
            model: f.profile.model, effort: f.profile.effort, prompt: "Complete the retained original customer-local task", role_instructions: "Use the company provider",
            credential: { token: f.token, expires_at: begun.credential.expires_at } } };
        }
        if (url.endsWith("/turn-admission")) return startupTurnFixture(task, options?.body);
        if (url.endsWith("/heartbeat")) {
          assert.ok(Date.now() < leaseUntil, "Real elapsed startup must not expire the original 45-second company lease");
          heartbeats++; leaseUntil = Date.now() + 45000; return { status: 200, body: { task_id: taskId, state, status } };
        }
        assert.ok(url.endsWith("/finish")); assert.equal((options?.body as any).status, "completed");
        finishes++; state = "finished"; status = "succeeded"; return { status: 200, body: { task_id: taskId, state, status } };
      },
    };
    controller = new LocalAgentController(io);
    const session = (await controller.create({ tenant: f.binding.tenantId, project: f.binding.projectId }, "fullstack"))!;
    await controller.permission(session.id, "full-access");
    const delays: { method: string; released: boolean }[] = [];
    await withOwnedNativeProcesses(f.profile.executable, f.workspace, row => {
      const stream = row.child.stdin, original = stream.write, timers = new Set<ReturnType<typeof setTimeout>>();
      stream.write = function (...args: any[]) {
        let request: any; try { request = JSON.parse(Buffer.isBuffer(args[0]) ? args[0].toString() : args[0]); } catch {}
        if (["initialize", "thread/start"].includes(request?.method)) {
          const record = { method: request.method as string, released: false }; delays.push(record);
          const timer = setTimeout(() => { timers.delete(timer); record.released = true; Reflect.apply(original, stream, args); }, 24000);
          timers.add(timer); return true;
        }
        return Reflect.apply(original, stream, args);
      } as typeof stream.write;
      row.child.once("close", () => { for (const timer of timers) clearTimeout(timer); });
    }, async owned => {
      f.actions.push({}); const began = Date.now();
      await controller!.send(session.id, "Complete once after native startup", 100000);
      const elapsed = Date.now() - began;
      assert.ok(elapsed >= 48000); assert.ok(heartbeats >= 5);
      assert.equal(creates, 1); assert.equal(starts, 1); assert.equal(finishes, 1); assert.equal(f.requests.length, 1);
      assert.equal(owned.length, 1); assert.equal(owned[0].closed, true);
      assert.deepEqual(delays, [{ method: "initialize", released: true }, { method: "thread/start", released: true }]);
      assert.ok(!JSON.stringify(journal).includes(f.token));
      console.log("# native_startup_lease " + JSON.stringify({ elapsed_ms: elapsed, heartbeats, task_reservations_simulated: creates, native_processes: owned.length, model_requests: f.requests.length, native_processes_closed: owned.every(row => row.closed) }));
    });
  } finally { await controller?.close(); await f.clean(); }
});

function nativeProtocolFixture(native: LocalCodexSession) {
  const internal = native as unknown as { child: ChildProcessWithoutNullStreams; eventTail: Promise<void> };
  const child = internal.child; assert.ok(child?.pid && child.exitCode === null);
  const replies: any[] = [], write = child.stdin.write;
  child.stdin.write = function (...args: any[]) {
    let value: any;
    try { value = JSON.parse(Buffer.isBuffer(args[0]) ? args[0].toString() : args[0]); } catch {}
    if (String(value?.id).startsWith("copypaste_fixture_")) {
      replies.push(value);
      const callback = args.find((arg, index) => index > 0 && typeof arg === "function");
      if (callback) queueMicrotask(() => callback());
      return true;
    }
    return Reflect.apply(write, child.stdin, args);
  } as typeof write;
  return { child, replies, drain: () => internal.eventTail,
    inject: (value: unknown) => child.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n")),
    restore: () => { child.stdin.write = write; } };
}

test("native local turns reject pre-turn tools and foreign notifications, usage and approvals without losing the active task", { timeout: 120000 }, async () => {
  const f = await fixture(); let release = () => {}, restore = () => {}, toolCalls = 0, inputs = 0;
  try {
    const binding = { ...f.binding, companyTools: [{ name: "project_assets", description: "Read the private fixture project.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, binding, async () => { toolCalls++; return { assets: [] }; },
      async () => { inputs++; return {}; });
    await f.start(native);
    const protocol = nativeProtocolFixture(native); restore = protocol.restore;
    const threadId = (await f.checkpoint()).threadId;
    protocol.inject({ id: "copypaste_fixture_before_turn", method: "item/tool/call", params: {
      threadId, turnId: "not-started", namespace: "copypaste", tool: "project_assets", callId: "call_fixture_before", arguments: {} } });
    protocol.inject({ id: "copypaste_fixture_early_approval", method: "item/commandExecution/requestApproval", params: {
      threadId, turnId: "not-started", itemId: "fixture_early" } });
    await protocol.drain();
    assert.equal(toolCalls, 0); assert.equal(f.requests.length, 0);
    assert.equal(protocol.replies[0].result.success, false); assert.equal(protocol.replies[1].result.decision, "decline");
    let reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.actions.push({ hold: () => { reached(); return held; } });
    const pending = native.turn("Complete the actual local task after rejecting foreign protocol frames.");
    void pending.catch(() => {});
    await ready; await protocol.drain();
    const started = f.events.find(e => e.kind === "turn/started")?.value;
    assert.ok(started?.turn?.id); const scope = { threadId: started.threadId, turnId: started.turn.id };
    let index = 0;
    for (const fields of [{ ...scope, threadId: "foreign-thread" }, { ...scope, turnId: "foreign-turn" }, { turnId: scope.turnId }]) {
      protocol.inject({ method: "turn/started", params: { ...fields, turn: { id: "FOREIGN_TURN", status: "inProgress" } } });
      protocol.inject({ method: "thread/tokenUsage/updated", params: { ...fields, tokenUsage: { total: { inputTokens: 999999, outputTokens: 999999 } } } });
      protocol.inject({ method: "item/agentMessage/delta", params: { ...fields, delta: "FOREIGN_OUTPUT" } });
      protocol.inject({ method: "item/commandExecution/outputDelta", params: { ...fields, delta: "FOREIGN_COMMAND" } });
      protocol.inject({ method: "turn/completed", params: { ...fields, turn: { id: fields.turnId, status: "completed" } } });
      protocol.inject({ id: "copypaste_fixture_tool_" + index, method: "item/tool/call", params: {
        ...fields, namespace: "copypaste", tool: "project_assets", callId: "call_fixture_" + index, arguments: {} } });
      protocol.inject({ id: "copypaste_fixture_input_" + index, method: "item/tool/requestUserInput", params: { ...fields, questions: [] } });
      for (const method of ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"])
        protocol.inject({ id: "copypaste_fixture_approval_" + index++, method, params: { ...fields, itemId: "fixture" } });
    }
    protocol.inject({ method: "turn/completed", params: { ...scope, turn: { status: "completed" } } });
    await protocol.drain();
    assert.equal(toolCalls, 0); assert.equal(inputs, 0);
    assert.ok(protocol.replies.filter(r => r.id.includes("_tool_")).every(r => r.result.success === false));
    assert.ok(protocol.replies.filter(r => r.id.includes("_approval_")).every(r => r.result.decision === "decline"));
    assert.equal(f.events.some(e => JSON.stringify(e.value).includes("FOREIGN_")), false);
    release(); const result = await pending;
    assert.equal(result.status, "completed"); assert.equal(result.turnId, scope.turnId);
    assert.equal(result.text, "LOCAL_CODEX_NATIVE_COMPLETE"); assert.deepEqual(result.nativeTokenUsage, { input: 17, output: 5 });
    assert.equal(f.requests.length, 1);
    f.actions.push({}); const next = await native.turn("Continue the same valid local thread.");
    assert.equal(next.status, "completed"); assert.equal(next.threadId, result.threadId); assert.notEqual(next.turnId, result.turnId);
    assert.equal(f.requests.length, 2); assert.equal(toolCalls, 0);
  } finally { release(); restore(); await f.clean(); }
});

test("a real native completion recovers a lost turn-start reply without replay or a second provider dispatch", { timeout: 120000 }, async () => {
  const f = await fixture(); let restore = () => {};
  try {
    const native = f.make(); await f.start(native);
    const protocol = nativeProtocolFixture(native), child = protocol.child;
    const write = child.stdin.write, emit = child.stdout.emit, decoder = new StringDecoder("utf8");
    let requestId: unknown, buffer = "", dropped = 0;
    child.stdin.write = function (...args: any[]) {
      const request = JSON.parse(String(args[0])); if (request.method === "turn/start") requestId = request.id;
      return Reflect.apply(write, child.stdin, args);
    } as typeof write;
    child.stdout.emit = function (event: string | symbol, ...args: any[]) {
      if (event !== "data") return Reflect.apply(emit, child.stdout, [event, ...args]);
      buffer += decoder.write(Buffer.from(args[0]));
      const lines = buffer.split("\n"); buffer = lines.pop()!;
      const kept = lines.filter(line => {
        let value: any; try { value = JSON.parse(line); } catch { return true; }
        if (requestId !== undefined && value.id === requestId && value.result?.turn?.id) { dropped++; return false; }
        return true;
      });
      return kept.length ? Reflect.apply(emit, child.stdout, ["data", Buffer.from(kept.join("\n") + "\n")]) : true;
    } as typeof emit;
    restore = () => { child.stdin.write = write; child.stdout.emit = emit; protocol.restore(); };
    f.actions.push({}); const result = await native.turn("Complete the real task even when the RPC acknowledgement is lost.");
    assert.equal(dropped, 1); assert.equal(buffer, ""); assert.equal(result.status, "completed");
    assert.equal(result.text, "LOCAL_CODEX_NATIVE_COMPLETE"); assert.deepEqual(result.nativeTokenUsage, { input: 17, output: 5 });
    assert.equal(f.requests.length, 1); assert.equal((await f.checkpoint()).phase, "ready");
  } finally { restore(); await f.clean(); }
});

test("native RPC rejection diagnostics expose neither native content nor structured error payloads", { timeout: 60000 }, async () => {
  const f = await fixture(); let restore = () => {};
  try {
    const native = f.make(); await f.start(native);
    const protocol = nativeProtocolFixture(native), write = protocol.child.stdin.write;
    protocol.child.stdin.write = function (...args: any[]) {
      const request = JSON.parse(String(args[0]));
      if (request.method === "turn/start") {
        queueMicrotask(() => protocol.inject({ id: request.id, error: { code: { private: "PRIVATE_NATIVE_CONTENT" },
          message: "PRIVATE_NATIVE_CONTENT", data: { prompt: "PRIVATE_NATIVE_CONTENT" } } }));
        const callback = args.find((arg, index) => index > 0 && typeof arg === "function");
        if (callback) queueMicrotask(() => callback());
        return true;
      }
      return Reflect.apply(write, protocol.child.stdin, args);
    } as typeof write;
    restore = () => { protocol.child.stdin.write = write; protocol.restore(); };
    await assert.rejects(native.turn("Exercise controlled native rejection without dispatch."), { code: "LOCAL_CODEX_RPC_REJECTED" });
    await native.close(); await protocol.drain();
    assert.equal(f.requests.length, 0);
    const diagnostic = f.events.find(e => e.kind === "local.runtime.rpc_rejected")?.value;
    assert.deepEqual(diagnostic, { method: "turn/start", native_code: null, detail: "Native request rejected" });
    assert.equal(JSON.stringify(f.events).includes("PRIVATE_NATIVE_CONTENT"), false);
  } finally { restore(); await f.clean(); }
});

test("native Codex transports the versioned website-analysis schema and returns exact authenticated tool evidence", { timeout: 180000 }, async () => {
  const { connectorReadInput } = await import("../../../copypaste-platform/src/analysis-role-tools.js");
  const { desktopCompanyToolSchema } = await import("../../../copypaste-platform/src/desktop-tool-policy.js");
  const { z } = await import("../../../copypaste-platform/node_modules/zod/index.js");
  const schema = desktopCompanyToolSchema(z.toJSONSchema(connectorReadInput, { io: "input" }));
  const f = await fixture(), calls: any[] = [];
  const args = { snapshot_id: randomUUID(), analysis: { profile: "ga4_traffic", account_id: "201", date_from: "2026-10-01", date_to: "2026-10-07", group_by: ["channel"] } };
  const report = { kind: "captured_web_analytics", calculation_sha256: digest("native-web-analysis-fixture"),
    summary: { metrics: { totalRevenue: { value: "-199.5", unit: "HKD" }, totalUsers: { value: null, null_reason: "non_additive_unique_users" } } },
    report_downloads: { json: "/v1/connector-snapshots/" + args.snapshot_id + "/web-analysis?format=json" },
    additional_ai_charge_micros: "0" };
  try {
    const binding = { ...f.binding, grant: { ...f.binding.grant, mode: "read-only" as const }, companyTools: [{ name: "connector_read", description: "Read captured website facts and deterministic website analysis.", inputSchema: schema }] };
    const native = f.make(f.profile, binding, async call => {
      calls.push(call); assert.equal(call.namespace, "copypaste"); assert.equal(call.tool, "connector_read");
      assert.deepEqual(connectorReadInput.parse(call.arguments), { ...args, offset: 0, limit: 12 });
      return report;
    });
    await f.start(native); f.actions.push({ company: { tool: "connector_read", arguments: args } });
    const turn = await native.turn("Read the captured GA4 website report using connector_read. Preserve unknown values and signed revenue.");
    assert.equal(turn.status, "completed"); assert.equal(calls.length, 1); assert.equal(f.requests.length, 2);
    const out = f.requests[1].body.input.find((item: any) => item.type === "function_call_output" && item.call_id === "call_company_1");
    assert.ok(out); assert.deepEqual(JSON.parse(out.output), report);
    const tool = f.requests[0].body.tools.find((item: any) => item.type === "namespace" && item.name === "copypaste").tools.find((item: any) => item.name === "connector_read");
    assert.ok(JSON.stringify(tool.parameters).includes("ga4_traffic"));
    const operational = f.events.filter(event => event.kind.startsWith("local.company-tool."));
    assert.equal(operational.filter(event => event.kind === "local.company-tool.completed").length, 1);
    assert.ok(!JSON.stringify(operational).includes(report.calculation_sha256), "Company-tool operational receipts must not duplicate private report bodies");
  } finally { await f.clean(); }
});
const writeCommand = (file: string, content: string) => `[IO.File]::WriteAllText(${quoted(file)}, ${quoted(content)}); Write-Output ('runtime-token-present=' + [bool][Environment]::GetEnvironmentVariable('COPYPASTE_LOCAL_INFERENCE_TOKEN'))`;

for (const mode of ["read-only","full-access"] as const) test(`native Codex transports frozen budget preview and enforces ${mode} preparation rights`,{timeout:180000},async()=>{
 const {budgetToolPreview,budgetToolPrepare}=await import("../../../copypaste-platform/src/external-budget-model.js");
 const {desktopCompanyToolSchema}=await import("../../../copypaste-platform/src/desktop-tool-policy.js");
 const {z}=await import("../../../copypaste-platform/node_modules/zod/index.js");
 const f=await fixture(),calls:any[]=[];
 const args={connection_id:randomUUID(),account_id:"101",budget_id:"700",new_average_daily_micros:"125000000"};
 const preview={preview_id:randomUUID(),source_sha256:digest("exact-native-budget-preview"),before:{amount_micros:"100000000",currency:"HKD"},desired_average_daily_micros:"125000000",provider_mutations:0};
 try{
  const binding={...f.binding,grant:{...f.binding.grant,mode},companyTools:[
   {name:"external_budget_preview",description:"Preview an exact authorized Google Ads average daily budget.",inputSchema:desktopCompanyToolSchema(z.toJSONSchema(budgetToolPreview,{io:"input"}))},
   {name:"external_budget_prepare",description:"Prepare a frozen operation under explicit policy; never self-confirm.",inputSchema:desktopCompanyToolSchema(z.toJSONSchema(budgetToolPrepare,{io:"input"}))},
  ]};
  const native=f.make(f.profile,binding,async call=>{calls.push(call);if(call.tool==="external_budget_preview"){assert.deepEqual(budgetToolPreview.parse(call.arguments),args);return preview;}
   assert.equal(mode,"full-access");assert.deepEqual(budgetToolPrepare.parse(call.arguments),{...args,preview_id:preview.preview_id,expected_source_sha256:preview.source_sha256});
   return {id:randomUUID(),state:"awaiting_confirmation",provider_mutations:0};
  });
  await f.start(native);f.actions.push({company:{tool:"external_budget_preview",arguments:args}});
  assert.equal((await native.turn("Preview the exact configured budget without a mutation.")).status,"completed");
  f.actions.push({company:{tool:"external_budget_prepare",arguments:{...args,preview_id:preview.preview_id,expected_source_sha256:preview.source_sha256}}});
  await native.turn("Exercise the frozen preparation permission boundary; never confirm it.");
  assert.equal(calls.length,mode==="read-only"?1:2);
  if(mode==="read-only")assert.ok(f.events.some(e=>e.kind==="local.company-tool.failed"&&e.value.code==="LOCAL_COMPANY_TOOL_READ_ONLY"));
  else assert.equal(f.events.filter(e=>e.kind==="local.company-tool.completed").length,2);
 }finally{await f.clean();}
});

const inputQuestions = [{ id: "palette", header: "Palette", question: "Which palette should the actual work use?", options: [
  { label: "Company blue", description: "Use the existing CopyPaste palette." }, { label: "Warm neutral", description: "Use the reviewed warm neutral palette." },
] }, { id: "format", header: "Format", question: "Choose the requested output format.", options: [
  { label: "HTML", description: "A locally editable HTML file." }, { label: "PDF", description: "A portable document." },
] }];

test("real native Codex lists, runs and inspects a customer-approved program with exact argv and no shell or inference credential inheritance", { timeout: 120000 }, async () => {
  const f = await fixture(); let journal: ProgramJournal | null = null, programs: LocalProgramController | undefined;
  try {
    const taskId = randomUUID(), binding = { ...f.binding, programToolsVersion: 1 as const }, owner = {
      actorId: binding.actorId, epoch: randomUUID(), tenant: binding.tenantId, project: binding.projectId, workspace: f.workspace,
      permission: "full-access", revoked: false, grantRevision: 1, expiresAt: binding.grant.expiresAt, programToolsVersion: 1 as const,
    };
    programs = new LocalProgramController({ read: async () => structuredClone(journal), write: async value => { journal = structuredClone(value); },
      owner: async () => owner, context: async () => owner, choose: async () => process.execPath, confirm: async () => true, changed: () => {},
      host: path.resolve(".data/native-program-host/local-program-host.exe") });
    const approved = await programs.approve(binding.sessionId); assert.ok(approved);
    const programSession = programs.session({ sessionId: binding.sessionId, taskId }, async () => {}), results: any[] = [];
    const native = f.make(f.profile, binding, undefined, undefined, async (call, signal) => {
      const result = await programSession.call(call, signal); results.push({ tool: call.tool, value: JSON.parse(result.contentItems[0].text) }); return result;
    });
    await f.start(native); f.actions.push({ program: { tool: "list", arguments: {} } });
    const first = await native.turn("Inspect the customer-approved native program catalog."); assert.equal(first.status, "completed");
    assert.equal(results[0].value.programs[0].id, approved.id);
    const output = path.join(f.workspace, "native-argv.json"), script = path.join(f.workspace, "approved-native.cjs");
    await writeFile(script, "require('fs').writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),token:!!process.env.COPYPASTE_LOCAL_INFERENCE_TOKEN}));console.log('NATIVE_APPROVED_PROGRAM_OUTPUT');");
    const argv = [script, output, "香港設計", "literal\"quote", "trailing\\", "", "$(no-shell);&|"];
    f.actions.push({ program: { tool: "run", arguments: { program_id: approved.id, argv, timeout_ms: 10000 } } });
    const second = await native.turn("Run the selected native program with the exact structured arguments."); assert.equal(second.status, "completed"); assert.equal(second.threadId, first.threadId);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { args: argv.slice(2), token: false });
    const receipt = results[1].value; assert.equal(receipt.state, "succeeded"); assert.equal(receipt.exitCode, 0); assert.equal(receipt.taskId, taskId);
    assert.match(receipt.stdout, /NATIVE_APPROVED_PROGRAM_OUTPUT/); assert.deepEqual(receipt.argv, argv);
    f.actions.push({ program: { tool: "status", arguments: { receipt_id: receipt.id } } });
    const third = await native.turn("Read the original program receipt without executing it again."); assert.equal(third.threadId, first.threadId);
    assert.deepEqual(results[2].value, receipt); assert.equal(journal!.receipts.length, 1);
    assert.ok(f.requests.every(request => request.authorized));
    assert.ok(f.requests.at(-1).body.input.some((item: any) => item.type === "function_call_output" && JSON.stringify(item.output).includes(receipt.id)));
    assert.equal(f.events.filter(event => event.kind === "local.program-tool.completed").length, 3);
  } finally { await programs?.close(); await f.clean(); }
});
test("native user input resumes the original working turn with explicit answers", { timeout: 120000 }, async () => {
  const f = await fixture(), inputs: LocalInputRequest[] = [];
  try {
    const native = f.make(f.profile, f.binding, undefined, async request => {
      inputs.push(request);
      return { palette: { answers: ["Company blue"] }, format: { answers: ["NATIVE_USER_CHOSEN_HTML_74"] } };
    });
    await f.start(native); f.actions.push({ input: { questions: inputQuestions } });
    const result = await native.turn("Ask the customer about palette and output format before continuing.");
    assert.equal(result.status, "completed"); assert.equal(inputs.length, 1, JSON.stringify(f.requests.at(-1)?.body.input.slice(-2)));
    assert.equal(inputs[0].threadId, result.threadId); assert.equal(inputs[0].turnId, result.turnId);
    assert.equal(typeof inputs[0].isBlocking, "boolean"); assert.equal(inputs[0].questions.length, 2);
    assert.equal(f.requests.length, 2);
    assert.equal(inputs[0].questions[1].isOther, true);
    const output = f.requests[1].body.input.find((item: any) => item.type === "function_call_output" && item.call_id === "call_input_1");
    assert.deepEqual(JSON.parse(output.output).answers, { palette: { answers: ["Company blue"] }, format: { answers: ["NATIVE_USER_CHOSEN_HTML_74"] } });
    assert.ok(!JSON.stringify(f.events).includes("NATIVE_USER_CHOSEN_HTML_74"));
  } finally { await f.clean(); }
});
for (const withdrawal of ["interrupt", "revoke"] as const) test(`native user input does not block ${withdrawal} or terminal processing`, { timeout: 120000 }, async () => {
  const f = await fixture(); let entered!: () => void, aborted = false;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    const native = f.make(f.profile, f.binding, undefined, async (_request, signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true }); entered();
      return new Promise(() => {}); // Even an uncooperative UI hook cannot hold shutdown.
    });
    await f.start(native); f.actions.push({ input: { questions: inputQuestions } });
    const turn = native.turn("Ask a question and wait for the user."); void turn.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native question was not displayed")), 30000); })]); }
    finally { if (timer) clearTimeout(timer); }
    const started = Date.now(); await native[withdrawal]();
    await turn.catch(() => null); await native.close();
    assert.equal(aborted, true); assert.ok(Date.now() - started < 12000); assert.equal(f.requests.length, 1);
  } finally { await f.clean(); }
});

test("native company tools use their exact namespace and persist across same-thread follow-ups", { timeout: 180000 }, async () => {
  const f = await fixture();
  const calls: any[] = [], artifact = { id: randomUUID(), name: "fixture-design.svg", version: { id: randomUUID(), version: 1 } };
  const binding = { ...f.binding, companyTools: [{ name: "font_catalog", description: "Read the company font catalog.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
  try {
    const invoke: LocalCodexHooks["companyTool"] = async call => { calls.push(call); return { artifact, marker: "COMPANY_RESULT_FROM_REGISTERED_HANDLER" }; };
    const first = f.make(f.profile, binding, invoke); await f.start(first);
    f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const one = await first.turn("Use the registered company font catalog."); await first.close();
    const second = f.make(f.profile, binding, invoke); await f.start(second);
    f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const two = await second.turn("Read that same company tool in this follow-up.");
    assert.equal(one.threadId, two.threadId); assert.notEqual(one.turnId, two.turnId);
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.namespace === "copypaste" && call.tool === "font_catalog" && call.threadId === one.threadId));
    assert.notEqual(calls[0].turnId, calls[1].turnId);
    assert.ok(f.requests.some(request => JSON.stringify(request.body.input).includes("COMPANY_RESULT_FROM_REGISTERED_HANDLER")));
    assert.equal(f.events.filter(event => event.kind === "local.company-tool.completed").length, 2);
    assert.deepEqual(f.events.find(event => event.kind === "local.company-tool.completed").value.artifacts,
      [{ id: artifact.id, name: artifact.name, version: 1, asset_version_id: artifact.version.id }]);
    assert.equal(f.requests.length, 4);
  } finally { await f.clean(); }
});

test("native company writes are denied in local read-only mode before dispatch", { timeout: 120000 }, async () => {
  const f = await fixture(); let calls = 0;
  try {
    const b = { ...f.binding, grant: { ...f.binding.grant, mode: "read-only" as const },
      companyTools: [{ name: "image2_generate", description: "Generate an image through the company.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async () => { calls++; throw new Error("Must not dispatch"); }); await f.start(native);
    f.actions.push({ company: { tool: "image2_generate", arguments: {} } });
    await native.turn("Exercise the explicit read-only denial fixture.");
    assert.equal(calls, 0);
    assert.ok(f.events.some(event => event.kind === "local.company-tool.failed" && event.value.code === "LOCAL_COMPANY_TOOL_READ_ONLY"));
    assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("native company uncertainty stops the turn and never repeats an accepted operation", { timeout: 120000 }, async () => {
  const f = await fixture(); let calls = 0;
  try {
    const b = { ...f.binding, companyTools: [{ name: "image2_generate", description: "Company uncertain-image fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async () => { calls++; throw new Error("Synthetic lost accepted company response"); }); await f.start(native);
    f.actions.push({ company: { tool: "image2_generate", arguments: {} } });
    await assert.rejects(native.turn("Exercise the lost accepted company response.")); await native.close();
    assert.equal(calls, 1); assert.equal(f.requests.length, 1); assert.equal((await f.checkpoint()).phase, "uncertain");
    assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("native company work is aborted when the owning local runtime closes", { timeout: 120000 }, async () => {
  const f = await fixture(); let entered!: () => void, aborted = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const b = { ...f.binding, companyTools: [{ name: "font_catalog", description: "Company abort fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async (_call, signal) => { entered(); return new Promise((_resolve, reject) => {
      const stop = () => { aborted = true; reject(new Error("Owned company call aborted")); };
      signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    }); });
    await f.start(native); f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const turn = native.turn("Keep the company fixture waiting until Stop."); const rejected = assert.rejects(turn);
    let entryTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([started, new Promise((_resolve, reject) => { entryTimer = setTimeout(() => reject(new Error("Native tool did not enter")), 30000); })]); }
    finally { if (entryTimer) clearTimeout(entryTimer); }
    await native.close(); await rejected;
    assert.equal(aborted, true); assert.equal(f.requests.length, 1); assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("a clean local thread survives inference credential expiry and resumes only with a fresh credential", { timeout: 120000 }, async t => {
  const f = await fixture();
  try {
    const expiresAt = Date.now() + 30000;
    const first = f.make(); await f.start(first, expiresAt);
    f.actions.push({}); const result = await first.turn("Create the owned clean checkpoint.", t.signal);
    // Wait for this short-lived credential, never for a remote scheduled job.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 300))); await first.close();
    assert.equal((await f.checkpoint()).phase, "ready");
    const resumed = f.make(); await f.start(resumed);
    f.actions.push({}); const next = await resumed.turn("Continue with the renewed company credential.", t.signal);
    assert.equal(next.threadId, result.threadId); assert.notEqual(next.turnId, result.turnId);
  } finally { await f.clean(); }
});

test("native full access edits an existing file outside cwd, loads the real Skill and resumes the same local thread", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const target = path.join(f.outside, "existing.txt");
    await writeFile(target, "before");
    const session = f.make();
    await f.start(session);
    const pid = f.pid();
    assert.ok(pid > 0 && pid !== process.pid);
    f.actions.push({ command: writeCommand(target, "after-local-native-turn") });
    const result = await session.turn("Update the owned fixture using the local terminal and the selected Skill.", t.signal);
    assert.equal(result.status, "completed");
    assert.equal(await readFile(target, "utf8"), "after-local-native-turn");
    assert.ok(f.requests.length >= 2);
    assert.ok(f.requests.every((request) => request.authorized));
    assert.ok(f.requests.every((request) => request.body.model === f.profile.model && request.body.reasoning?.effort === f.profile.effort));
    assert.ok(JSON.stringify(f.requests[0].body.input).includes("NATIVE_SKILL_FROM_DISK_73D6"), "Skill content must be loaded by native Codex from disk");
    assert.ok(JSON.stringify(f.requests.at(-1).body.input).includes("runtime-token-present=False"), "Native shell must not inherit the inference credential");
    assert.equal(JSON.stringify(f.events).includes(f.token), false);
    assert.equal((await f.checkpoint()).phase, "ready");
    const duplicate = f.make();
    await assert.rejects(f.start(duplicate), { code: "LOCAL_SESSION_ALREADY_OWNED" });
    await session.close();
    assert.throws(() => process.kill(pid, 0));
    const continued = f.make();
    await f.start(continued);
    f.actions.push({});
    const next = await continued.turn("Continue this same local session and report the completed fixture.", t.signal);
    assert.equal(next.status, "completed");
    assert.equal(next.threadId, result.threadId);
    assert.notEqual(next.turnId, result.turnId);
    t.diagnostic(JSON.stringify({ version: lock.runtime_version, native_binary_sha256: lock.windows_x64_sha256,
      outside_cwd_file_sha256: digest(await readFile(target)), same_thread: true, credential_excluded_from_shell: true }));
  } finally { await f.clean(); }
});

test("native full-to-read-only downgrade prevents a later outside-cwd write and cannot be rolled back by an old grant", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const target = path.join(f.outside, "read-only.txt");
    await writeFile(target, "unchanged");
    const session = f.make(); await f.start(session);
    await session.updatePermission({ ...f.binding.grant, mode: "read-only", revision: 2 });
    await assert.rejects(session.updatePermission(f.binding.grant), { code: "LOCAL_PERMISSION_VERSION_CONFLICT" });
    f.actions.push({ command: writeCommand(target, "must-not-be-written") });
    const result = await session.turn("Attempt the owned write so the read-only denial can be verified.", t.signal);
    assert.equal(result.status, "completed");
    assert.equal(await readFile(target, "utf8"), "unchanged");
    assert.ok(f.events.some((event) => event.kind === "local.permission.changed" && event.value.mode === "read-only"));
    await session.close();
    await assert.rejects(f.start(f.make()), { code: "LOCAL_PERMISSION_VERSION_CONFLICT" });
  } catch (error) {
    t.diagnostic(JSON.stringify(f.events.filter((event) => event.kind === "local.runtime.rpc_rejected")));
    throw error;
  } finally { await f.clean(); }
});

test("local binary, provider, Skill and permission-owner mismatches dispatch no inference", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    for (const [profile, binding, code] of [
      [{ ...f.profile, executableSha256: "0".repeat(64) }, f.binding, "LOCAL_CODEX_HASH_MISMATCH"],
      [{ ...f.profile, version: "0.0.0" }, f.binding, "LOCAL_CODEX_VERSION_MISMATCH"],
      [{ ...f.profile, baseURL: "https://other.example.invalid/v1" }, f.binding, "LOCAL_GATEWAY_INVALID"],
      [f.profile, { ...f.binding, grant: { ...f.binding.grant, actorId: randomUUID() } }, "LOCAL_PERMISSION_REQUIRED"],
      [f.profile, { ...f.binding, skills: [{ ...f.binding.skills[0], content: "changed" }] }, "LOCAL_SKILL_INVALID"],
    ] as const) await assert.rejects(f.start(f.make(profile, binding)), { code });
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("native interruption and revocation stop only this owned process and reject further local turns", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    const controller = new AbortController();
    f.actions.push({ stall: () => controller.abort() });
    const result = await session.turn("Wait for the owned interruption fixture.", AbortSignal.any([controller.signal, t.signal]));
    assert.equal(result.status, "interrupted");
    await session.revoke();
    assert.equal((await f.checkpoint()).phase, "revoked");
    assert.throws(() => process.kill(f.pid(), 0));
    await assert.rejects(session.turn("Do not run after revocation."), { code: "LOCAL_SESSION_NOT_READY" });
  } finally { await f.clean(); }
});

test("an abruptly lost native turn preserves an uncertain checkpoint and refuses blind replay", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    f.actions.push({ stall: () => process.kill(f.pid()) });
    await assert.rejects(session.turn("This accepted fixture loses its native process."), { code: "LOCAL_CODEX_EXITED" });
    await session.close();
    assert.equal((await f.checkpoint()).phase, "uncertain");
    const calls = f.requests.length;
    await assert.rejects(f.start(f.make()), { code: "LOCAL_CHECKPOINT_RECONCILIATION_REQUIRED" });
    assert.equal(f.requests.length, calls);
  } finally { await f.clean(); }
});

test("current account authority is checked before each native turn", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    f.revokeAuthority();
    await assert.rejects(session.turn("Must not dispatch after account revocation."), /Account revoked/);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.checkpoint()).phase, "ready");
  } finally { await f.clean(); }
});

test("changing a materialized Skill is rejected before another provider request", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    const file = path.join(f.stateRoot, "local-codex", f.binding.sessionId, "home/skills/native-fixture-method/SKILL.md");
    await writeFile(file, skill + "\nChanged after authorization.");
    await assert.rejects(session.turn("Must not load a changed Skill."), { code: "LOCAL_SKILL_CHANGED" });
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("a previous account or project checkpoint cannot be taken over or rewritten", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session); await session.close();
    const before = await f.checkpoint(), foreignActor = randomUUID();
    const materialized = path.join(f.stateRoot, "local-codex", f.binding.sessionId, "home/skills/native-fixture-method/SKILL.md");
    const skillBefore = await readFile(materialized);
    const foreignSkill = skill + "\nForeign session content must not be materialized.";
    const skills = [{ ...f.binding.skills[0], content: foreignSkill, sha256: digest(foreignSkill) }];
    for (const binding of [
      { ...f.binding, skills, actorId: foreignActor, grant: { ...f.binding.grant, actorId: foreignActor } },
      { ...f.binding, skills, projectId: randomUUID() },
    ]) {
      await assert.rejects(f.start(f.make(f.profile, binding)), { code: "LOCAL_CHECKPOINT_BINDING_MISMATCH" });
      assert.deepEqual(await f.checkpoint(), before);
      assert.deepEqual(await readFile(materialized), skillBefore, "Rejected ownership must not overwrite the original session Skill");
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("an unused local session can reopen without replaying inference or resuming a nonexistent native rollout", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const first = f.make(); await f.start(first);
    const initial = await f.checkpoint(); await first.close();
    const second = f.make(); await f.start(second);
    const reopened = await f.checkpoint();
    assert.equal(reopened.hasTurns, false);
    assert.notEqual(reopened.threadId, initial.threadId);
    assert.equal(reopened.binding, initial.binding);
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("native read-only Codex can read a registered exact method without gaining write permission", {timeout:120000}, async()=>{
 const f=await fixture(), id=randomUUID(), calls:any[]=[];
 try {
  const binding={...f.binding,grant:{...f.binding.grant,mode:"read-only" as const},companyTools:[{name:"solution_read",description:"Read a pinned installed reusable method.",inputSchema:{type:"object",properties:{installation_id:{type:"string"}},required:["installation_id"],additionalProperties:false}}]};
  const native=f.make(f.profile,binding,async call=>{calls.push(call);return {solution_version_id:randomUUID(),version:1,instructions:"NATIVE_PINNED_METHOD_READ_96",private_materials_or_credentials_copied:false};});
  await f.start(native);f.actions.push({company:{tool:"solution_read",arguments:{installation_id:id}}});
  await native.turn("Read the registered installed method within the current read-only permission.");
  assert.equal(calls.length,1);assert.equal(calls[0].tool,"solution_read");assert.equal(calls[0].arguments.installation_id,id);
  assert.ok(f.requests.some(r=>JSON.stringify(r.body.input).includes("NATIVE_PINNED_METHOD_READ_96")));
  assert.equal(f.events.filter(e=>e.kind==="local.company-tool.completed").length,1);
  assert.equal(f.events.some(e=>e.kind==="local.company-tool.failed"),false);
 } finally {await f.clean();}
});
