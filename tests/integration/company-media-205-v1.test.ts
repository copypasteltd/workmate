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
type Action = { disconnect?: boolean; command?: string; input?: { questions: any[] }; company?: { tool: string; arguments: Record<string, unknown> }; program?: { tool: string; arguments: Record<string, unknown> }; stall?: () => void; hold?: () => Promise<void>; stage?: number };

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
      if(action.disconnect){
        actions.shift();emit(res,"response.created",{response:{id:"resp_broken",object:"response",status:"in_progress",output:[]}});res.end();
      } else if (action.stall) {
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


for(const tool of ['audio_produce','generated_video_create'])test(`actual native ${tool} does not report a resolved blocked media job as completed`,{timeout:120000},async()=>{
 const f=await fixture();let calls=0;
 try{const b={...f.binding,companyTools:[{name:tool,description:'Controlled unavailable delivery fixture.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 const native=f.make(f.profile,b,async()=>{calls++;return {id:randomUUID(),task_id:randomUUID(),state:'completed',delivery_state:'blocked',usage_state:tool==='audio_produce'?'confirmed_company_tariff':'confirmed',kind:'speech',assets:[]};});await f.start(native);f.actions.push({company:{tool,arguments:{}}});
 await assert.rejects(native.turn('Inspect this original controlled media result.'),/LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN/);assert.equal(calls,1);assert.ok(f.events.some(e=>e.kind==='local.company-tool.failed'&&e.value.code==='LOCAL_COMPANY_TOOL_DELIVERY_UNCONFIRMED'));assert.ok(!f.events.some(e=>e.kind==='local.company-tool.completed'));
 }finally{await f.clean();}
});
