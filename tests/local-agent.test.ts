import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal, type LocalAgentRuntime, type LocalRuntimeFactory } from "../src/local-agent.js";
import { localRuntimeLock } from "../src/local-runtime.js";
import { rendererApiOperation } from "../src/config.js";
import type { LocalCodexHooks } from "../src/local-codex.js";
import type { LocalInputRequest } from "../src/local-input.js";
import { GuardedBrowserSession } from "../src/browser-session.js";

test("closing the app while a send is persisting prevents a later task reservation or native start", async () => {
  const f = await fixture();
  try {
    const session = await f.create(); await f.controller.permission(session.id, "full-access");
    let entered!: () => void, release!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.io.write;
    f.io.write = async journal => { entered(); await gate; await original(journal); };
    const calls = f.calls.length, send = f.controller.send(session.id, "A task still waiting for its local journal write", 100000);
    await pending; const closing = f.controller.close(); release();
    await assert.rejects(send, /LOCAL_APP_CLOSED/); await closing;
    assert.equal(f.calls.length, calls); assert.equal(f.turns(), 0); assert.equal(f.runtimes.length, 0);
    await assert.rejects(f.controller.create(f.scope, "fullstack"), /LOCAL_APP_CLOSED/);
  } finally { await f.clean(); }
});

test("existing native records retain their original tool set after the browser factory becomes available",async()=>{
  const f=await fixture();let created=0;
  try{
    const session=await f.create();await f.controller.permission(session.id,"full-access");
    f.io.browser=()=>{created++;throw new Error("Legacy thread must not acquire new dynamic tools");};
    await f.controller.send(session.id,"Continue the original native thread",10000);
    assert.equal(created,0);assert.equal(f.runtimeHooks[0].browserTool,undefined);
  }finally{await f.clean();}
});

test("new native browser bindings retain actual actor/project/workspace ownership and cannot bypass a read-only grant",async()=>{
  const f=await fixture();let driverCalls=0,owner:any;
  try{
    f.io.browser=(value,authorize)=>{owner=value;return new GuardedBrowserSession({execute:async()=>{driverCalls++;return {success:true,contentItems:[]};},close:async()=>{}},authorize);};
    const session=await f.create();await f.controller.permission(session.id,"read-only");
    f.pending(async()=>{
      await assert.rejects(f.runtimeHooks.at(-1)!.browserTool!({namespace:"copypaste_browser",tool:"open",arguments:{url:"https://example.com"},callId:"browser_read_only",threadId:"native",turnId:"turn"},new AbortController().signal),{code:"BROWSER_FULL_ACCESS_REQUIRED"});
      return {status:"completed",text:"No page opened",threadId:"native",turnId:"turn",nativeTokenUsage:null};
    });
    await f.controller.send(session.id,"Read-only browser attempt",10000);
    assert.equal(driverCalls,0);assert.equal(owner.actorId,f.actor.actorId);assert.equal(owner.epoch,f.actor.epoch);
    assert.equal(owner.tenantId,f.scope.tenant);assert.equal(owner.projectId,f.scope.project);assert.equal(owner.sessionId,session.id);assert.equal(owner.workspace,session.workspace);
  }finally{await f.clean();}
});

for(const action of ["stop","revoke","logout","close"] as const)test(action+" closes the owned browser even while the native tool is waiting",async()=>{
  const f=await fixture();let closed=0,entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  try{
    f.io.browser=(_owner,authorize)=>new GuardedBrowserSession({execute:async(_tool,_args,signal)=>new Promise((_resolve,reject)=>{entered();signal.addEventListener("abort",()=>reject(new Error("browser wait interrupted")),{once:true});}),close:async()=>{closed++;}},authorize);
    const session=await f.create();await f.controller.permission(session.id,"full-access");
    f.pending(async()=>{
      await f.runtimeHooks.at(-1)!.browserTool!({namespace:"copypaste_browser",tool:"wait",arguments:{tab_id:"11111111-1111-1111-1111-111111111111",state:"text",text:"never"},callId:"browser_wait",threadId:"native",turnId:"turn"},new AbortController().signal);
      throw new Error("Interrupted browser wait cannot complete normally");
    });
    const pending=f.controller.send(session.id,"Wait in the local browser",10000);const failed=assert.rejects(pending,/browser wait interrupted/);
    await ready;
    if(action==="stop")await f.controller.stop(session.id);
    else if(action==="revoke")await f.controller.revoke(session.id);
    else if(action==="logout")await f.controller.invalidate();
    else await f.controller.close();
    await failed;assert.equal(closed,1);
  }finally{await f.clean();}
});

async function fixture() {
  const parent = path.resolve(".data/controller-tests"); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "owned-"));
  const scope = { tenant: randomUUID(), project: randomUUID() }, actor = { actorId: randomUUID(), epoch: randomUUID() };
  let journal: LocalAgentJournal | null = null, consent = true, turns = 0, created = 0, finishLost = false, startFailure = false, startLost = false, createLost = false;
  const calls: any[] = [], grants: any[] = [], runtimes: LocalAgentRuntime[] = [], runtimeHooks: LocalCodexHooks[] = [];
  const tasks = new Map<string, any>();
  const createdKeys = new Map<string, string>();
  const runtimeBody = { pinned_version: localRuntimeLock.version, windows_x64_sha256: localRuntimeLock.sha256, role_keys: ["fullstack"] };
  let pendingTurn: (() => Promise<any>) | undefined;
  const io: LocalAgentIO = {
    read: async () => structuredClone(journal), write: async j => { journal = structuredClone(j); },
    identity: async () => ({ ...actor }), localEpoch: async () => actor.epoch, changed: () => {}, chooseWorkspace: async () => directory,
    consent: async () => consent, approval: async () => "decline", stateRoot: directory, companyOrigin: "http://127.0.0.1:4310",
    executable: path.join(directory, "codex.exe"), runtime: localRuntimeLock,
    request: async (url, options) => {
      calls.push({ url, ...options });
      if (url.endsWith("/runtime")) return { status: 200, body: runtimeBody };
      if (url.endsWith("/desktop-executions")) {
        const key = options!.idempotencyKey!;
        if (createdKeys.has(key)) return { status: 200, body: { ...tasks.get(createdKeys.get(key)!) } };
        const id = randomUUID(); created++; const task = { task_id: id, status: "queued", state: "prepared", charged_micros: "0", accrued_micros: "0" }; tasks.set(id, task); createdKeys.set(key, id);
        if (createLost) { createLost = false; throw new Error("Fixture lost create response after acceptance"); }
        return { status: 200, body: task };
      }
      const id = url.split("/").at(-2)!, task = tasks.get(id);
      if (!task) throw new Error("Unknown fixture task");
      if (url.endsWith("/start")) { task.status = task.state = "running";
        if (startLost) { startLost = false; throw new Error("Fixture lost start response after acceptance"); }
        return { status: 200, body: { ...task, runtime: runtimeBody,
        inference_path: "/v1/desktop-inference/v1", skills: [], model: "synthetic-native", effort: "max", prompt: "fixture", role_instructions: "Use real local tools",
        credential: { token: "ONLY_THE_TRUSTED_NATIVE_RUNTIME_CAN_RECEIVE_THIS_TOKEN", expires_at: new Date(Date.now() + 300000).toISOString() } } }; }
      if (url.endsWith("/heartbeat")) return { status: 200, body: { ...task } };
      if (url.endsWith("/cancel")) { task.cancel_requested = true; if (task.state === "prepared") { task.state = "finished"; task.status = "cancelled"; } return { status: 200, body: { ...task } }; }
      if (url.endsWith("/finish")) {
        const report = options?.body as any; task.status = report.status === "unknown" ? "reconciling" : report.status === "completed" ? "succeeded" : "failed";
        if (finishLost) { finishLost = false; throw new Error("Fixture lost finish response after acceptance"); }
        return { status: 200, body: { ...task } };
      }
      throw new Error("Unexpected fixture request");
    },
  };
  const factory: LocalRuntimeFactory = (_profile, binding, hooks) => {
    runtimeHooks.push(hooks);
    grants.push(binding.grant); let aborted: (() => void) | undefined;
    const runtime: LocalAgentRuntime = {
      start: async credential => { assert.ok(credential.token.startsWith("ONLY_")); await hooks.authorize(); if (startFailure) throw new Error("Fixture binary unavailable"); },
      turn: async (_prompt, signal) => {
        turns++; if (pendingTurn) return pendingTurn();
        if (signal?.aborted) throw new Error("Interrupted before native acceptance");
        return { status: "completed", text: "Fixture completion", threadId: "thread-controller", turnId: "turn-" + turns, nativeTokenUsage: null };
      },
      close: async () => { aborted?.(); }, interrupt: async () => { aborted?.(); }, revoke: async () => { aborted?.(); },
    };
    runtimes.push(runtime); return runtime;
  };
  const controller = new LocalAgentController(io, factory);
  const create = async () => (await controller.create(scope, "fullstack"))!;
  const clean = async () => { await controller.close(); assert.equal(path.dirname(directory), parent); await rm(directory, { recursive: true, force: true }); };
  return { controller, io, factory, scope, actor, calls, grants, runtimes, runtimeHooks, create, clean, turns: () => turns, created: () => created,
    setConsent: (v: boolean) => { consent = v; }, loseFinish: () => { finishLost = true; }, failStart: () => { startFailure = true; }, loseStart: () => { startLost = true; }, loseCreate: () => { createLost = true; },
    pending: (fn: () => Promise<any>) => { pendingTurn = fn; }, journal: () => structuredClone(journal),
  };
}
test("durable file dispatch replays its exact terminal receipt after restart without another reservation or native turn", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined;
  try {
    const s = await f.create(); await f.controller.permission(s.id, "workspace-write"); const id = randomUUID();
    const first = await f.controller.dispatch(s.id, id, "Process one frozen file", 10000);
    assert.equal(first.state, "succeeded"); assert.ok(first.taskId);
    await assert.rejects(f.controller.dispatch(s.id, id, "Different file", 10000), { code: "LOCAL_DISPATCH_CONFLICT" });
    await assert.rejects(f.controller.dispatch(s.id, id, "Process one frozen file", 20000), { code: "LOCAL_DISPATCH_CONFLICT" });
    await f.controller.close();
    restored = new LocalAgentController(f.io, () => { throw new Error("A terminal dispatch must not restart Codex"); });
    assert.deepEqual(await restored.dispatch(s.id, id, "Process one frozen file", 10000), first);
    assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
    f.actor.epoch = randomUUID(); await assert.rejects(restored.dispatch(s.id, id, "Process one frozen file", 10000), { code: "LOCAL_SESSION_NOT_FOUND" });
  } finally { await restored?.close(); await f.clean(); }
});
for (const lost of ["create", "start", "finish"] as const) test("file dispatch recovers a lost " + lost + " response under the original request ids", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined;
  try {
    const s = await f.create(); await f.controller.permission(s.id, "full-access"); const id = randomUUID();
    if (lost === "create") f.loseCreate(); else if (lost === "start") f.loseStart(); else f.loseFinish();
    await assert.rejects(f.controller.dispatch(s.id, id, "One paid file only", 10000));
    await f.controller.close(); restored = new LocalAgentController(f.io, f.factory);
    const receipt = await restored.dispatch(s.id, id, "One paid file only", 10000);
    assert.equal(receipt.state, "succeeded"); assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
    for (const suffix of ["/desktop-executions", "/start", "/finish"]) {
      const calls = f.calls.filter(call => call.url.endsWith(suffix));
      assert.equal(new Set(calls.map(call => call.idempotencyKey)).size, 1);
    }
  } finally { await restored?.close(); await f.clean(); }
});
test("concurrent replay of the same dispatch id never runs a second task", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "workspace-write"); const id = randomUUID();
    const receipts = await Promise.all([f.controller.dispatch(s.id, id, "Same frozen file", 10000), f.controller.dispatch(s.id, id, "Same frozen file", 10000)]);
    assert.ok(receipts.some(receipt => receipt.state === "succeeded")); assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
  } finally { await f.clean(); }
});
test("a running dispatch recovered after a crash reports unknown and never restarts the possibly accepted native action", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined;
  try {
    const s = await f.create(); await f.controller.permission(s.id, "workspace-write"); const id = randomUUID(); f.loseStart();
    await assert.rejects(f.controller.dispatch(s.id, id, "Possibly accepted native file", 10000));
    const journal = f.journal()!; journal.sessions[0].operation!.phase = "native_running"; await f.io.write(journal);
    await f.controller.close(); restored = new LocalAgentController(f.io, () => { throw new Error("Unknown native action must not be repeated"); });
    const receipt = await restored.dispatch(s.id, id, "Possibly accepted native file", 10000);
    assert.equal(receipt.state, "uncertain"); assert.equal(f.turns(), 0); assert.equal(f.created(), 1);
    assert.equal((await restored.list(f.scope)).sessions[0].uncertain, true);
  } finally { await restored?.close(); await f.clean(); }
});

test("a queued file must revalidate its source before native startup; conversation retries cannot bypass the folder rule", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "workspace-write"); const id = randomUUID(); f.loseCreate();
    await assert.rejects(f.controller.dispatch(s.id, id, "Recheck the queued file", 10000));
    await assert.rejects(f.controller.retry(s.id), { code: "LOCAL_DISPATCH_RESUME_REQUIRED" });
    await assert.rejects(f.controller.dispatch(s.id, id, "Recheck the queued file", 10000, async () => { throw new Error("LOCAL_SCHEDULE_FILE_CONFLICT"); }), /LOCAL_SCHEDULE_FILE_CONFLICT/);
    assert.equal(f.turns(), 0); assert.equal(f.created(), 1);
    const replay = await f.controller.dispatch(s.id, id, "Recheck the queued file", 10000, async () => { assert.fail("Terminal receipt needs no new file access"); });
    assert.equal(replay.state, "failed"); assert.equal(f.calls.filter(call => call.url.endsWith("/finish")).at(-1).body.status, "failed");
  } finally { await f.clean(); }
});

test("a folder selection grants no execution permission; declined native consent never starts tools or reserves money", async () => {
  const f = await fixture(); try {
    const s = await f.create(); assert.equal(s.permission, null);
    await assert.rejects(f.controller.send(s.id, "Do work", 10000), { code: "LOCAL_PERMISSION_REQUIRED" });
    f.setConsent(false); assert.equal((await f.controller.permission(s.id, "full-access")).permission, null);
    assert.equal(f.created(), 0); assert.equal(f.runtimes.length, 0);
  } finally { await f.clean(); }

});
test("explicit native full permission reaches the runtime; public state never contains the scoped token or mutable internals", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "full-access");
    await f.controller.send(s.id, "Build locally", 10000);
    assert.equal(f.grants[0].mode, "full-access"); assert.equal(f.turns(), 1);
    const publicState = await f.controller.list(f.scope); assert.ok(!JSON.stringify(publicState).includes("ONLY_THE_TRUSTED"));
    publicState.sessions[0].messages[0].text = "Renderer tampering";
    assert.equal((await f.controller.list(f.scope)).sessions[0].messages[0].text, "Build locally");
    assert.ok(!JSON.stringify(f.journal()).includes("ONLY_THE_TRUSTED"));
  } finally { await f.clean(); }
});
test("a lost finish response retries only the saved receipt, never the native turn or task reservation", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "workspace-write"); f.loseFinish();
    await assert.rejects(f.controller.send(s.id, "One action only", 10000));
    let state = (await f.controller.list(f.scope)).sessions[0]; assert.equal(state.phase, "settling"); assert.equal(state.retryable, true);
    await f.controller.retry(s.id); assert.equal(f.turns(), 1); assert.equal(f.created(), 1);
    const finishes = f.calls.filter(c => c.url.endsWith("/finish")); assert.equal(finishes.length, 2);
    assert.equal(finishes[0].idempotencyKey, finishes[1].idempotencyKey); assert.deepEqual(finishes[0].body, finishes[1].body);
  } finally { await f.clean(); }
});
test("a native start failure reports definite failure before any turn and clears the controller lock", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "full-access"); f.failStart();
    await assert.rejects(f.controller.send(s.id, "Never accepted locally", 10000));
    assert.equal(f.turns(), 0); const state = (await f.controller.list(f.scope)).sessions[0]; assert.equal(state.busy, false); assert.equal(state.phase, "idle");
    assert.equal(f.calls.find(c => c.url.endsWith("/finish"))?.body.status, "failed");
  } finally { await f.clean(); }
  for (const action of ["stop", "retry"] as const) {
    const lost = await fixture(); try {
      const s = await lost.create(); await lost.controller.permission(s.id, "full-access"); lost.loseStart();
      await assert.rejects(lost.controller.send(s.id, "No native action was accepted", 10000));
      assert.equal((await lost.controller.list(lost.scope)).sessions[0].phase, "starting");
      if (action === "stop") { await lost.controller.revoke(s.id); await lost.controller.stop(s.id); }
      else {
        // A failed cancellation is retried using the original stable keys.
        const request = lost.io.request; let failCancel = true;
        lost.io.request = async (url, options) => { if (url.endsWith("/cancel") && failCancel) { failCancel = false; throw new Error("Fixture cancellation unavailable"); } return request(url, options); };
        await lost.controller.stop(s.id); await lost.controller.retry(s.id);
      }
      const state = (await lost.controller.list(lost.scope)).sessions[0];
      assert.equal(state.phase, "idle"); assert.equal(state.busy, false); assert.equal(lost.turns(), 0); assert.equal(lost.runtimes.length, 0);
      assert.equal(lost.calls.find(c => c.url.endsWith("/finish"))?.body.status, "failed");
    } finally { await lost.clean(); }
  }
  const lostCreate = await fixture(); try {
    const s = await lostCreate.create(); await lostCreate.controller.permission(s.id, "full-access"); lostCreate.loseCreate();
    await assert.rejects(lostCreate.controller.send(s.id, "Recover reservation only", 10000));
    await lostCreate.controller.revoke(s.id); await lostCreate.controller.stop(s.id);
    const state = (await lostCreate.controller.list(lostCreate.scope)).sessions[0];
    assert.equal(state.phase, "idle"); assert.equal(state.task.status, "cancelled"); assert.equal(lostCreate.created(), 1); assert.equal(lostCreate.turns(), 0);
    assert.equal(lostCreate.calls.filter(c => c.url.endsWith("/start")).length, 0);
  } finally { await lostCreate.clean(); }
});
test("a completed workflow child stops its heartbeat before native shutdown and terminal settlement", async t => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ["setInterval"] });
  try {
    const session = await f.create(); await f.controller.permission(session.id, "full-access");
    const controller = f.controller as any, journal = await controller.state(), record = journal.sessions[0];
    const childId = randomUUID(), childSession = randomUUID(), runId = randomUUID();
    const active = { abort: new AbortController(), done: Promise.resolve(), children: new Set(), browsers: new Set() };
    let closing = false, lateChecks = 0, finishes = 0;
    const request = f.io.request;
    f.io.request = async (url, options) => {
      if (!url.includes("/" + childId + "/")) return request(url, options);
      if (url.endsWith("/start")) return { status: 200, body: {
        runtime: { pinned_version: localRuntimeLock.version, windows_x64_sha256: localRuntimeLock.sha256 },
        inference_path: "/v1/desktop-inference/v1", skills: [], model: "synthetic-native", effort: "max",
        prompt: "Verify the completed native child", role_instructions: "Read the actual local checklist",
        credential: { token: "ONLY_THE_TRUSTED_NATIVE_RUNTIME_CAN_RECEIVE_THIS_TOKEN", expires_at: new Date(Date.now() + 300000).toISOString() },
      } };
      if (url.endsWith("/heartbeat")) {
        if (closing) lateChecks++;
        return { status: 200, body: { state: closing ? "finished" : "running", status: closing ? "succeeded" : "running" } };
      }
      assert.ok(url.endsWith("/finish")); finishes++;
      assert.equal(active.abort.signal.aborted, false, "Completed child must not revoke the parent workflow");
      assert.equal((options!.body as any).status, "completed");
      return { status: 200, body: { status: "succeeded" } };
    };
    f.pending(async () => {
      f.runtimes.at(-1)!.close = async () => {
        closing = true; t.mock.timers.tick(10000);
        await new Promise<void>(resolve => setImmediate(resolve));
      };
      return { status: "completed", text: "Verified child", threadId: "native", turnId: "turn", nativeTokenUsage: null };
    });
    const operation = { prompt: "Parent workflow", budget: 100000, phase: "native_running" };
    await controller.executeWorkflowChild(record, operation, active, { task_id: childId, role_key: "fullstack", fields: {
      device_id: journal.deviceId, local_session_id: childSession, workspace_hash: record.workspaceHash,
      runtime_version: localRuntimeLock.version, runtime_sha256: localRuntimeLock.sha256,
    } }, runId, 0, active.abort.signal, async () => {}, async () => {});
    assert.equal(lateChecks, 0); assert.equal(finishes, 1); assert.equal(active.abort.signal.aborted, false);
    assert.equal(active.children.size, 0);
  } finally { t.mock.timers.reset(); await f.clean(); }
});
test("an uncertain native result reports unknown and cannot be silently replayed or followed by another local turn", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "full-access"); f.pending(async () => { throw new Error("Native process lost after command accepted"); });
    await assert.rejects(f.controller.send(s.id, "At most once local action", 10000));
    const state = (await f.controller.list(f.scope)).sessions[0]; assert.equal(state.uncertain, true); assert.equal(state.task.status, "reconciling");
    await assert.rejects(f.controller.retry(s.id), { code: "LOCAL_REPLAY_NOT_ALLOWED" });
    await assert.rejects(f.controller.send(s.id, "Do not replay", 10000), { code: "LOCAL_OPERATION_PENDING" }); assert.equal(f.turns(), 1);
  } finally { await f.clean(); }
});
test("account invalidation revokes local grants and hides the previous account's journal", async () => {
  const f = await fixture(); try {
    const s = await f.create(); await f.controller.permission(s.id, "full-access"); await f.controller.invalidate();
    await assert.rejects(f.controller.send(s.id, "No access", 10000), { code: "LOCAL_PERMISSION_REQUIRED" });
    f.actor.actorId = randomUUID(); f.actor.epoch = randomUUID();
    assert.equal((await f.controller.list(f.scope)).sessions.length, 0);
    await assert.rejects(f.controller.permission(s.id, "full-access"), { code: "LOCAL_SESSION_NOT_FOUND" });
    await assert.rejects(f.controller.stop(s.id), { code: "LOCAL_SESSION_NOT_FOUND" });
  } finally { await f.clean(); }
  for (const action of ["stop", "revoke"] as const) {
    const offline = await fixture(); try {
      const s = await offline.create(); await offline.controller.permission(s.id, "full-access");
      let rejectTurn!: (e: Error) => void;
      offline.pending(async () => new Promise((_, reject) => { rejectTurn = reject; }));
      const sent = offline.controller.send(s.id, "Owned offline interruption", 10000).catch(e => e);
      while (!rejectTurn) await new Promise(resolve => setImmediate(resolve));
      let closed = false;
      offline.runtimes[0].interrupt = offline.runtimes[0].close = offline.runtimes[0].revoke = async () => { closed = true; rejectTurn(new Error("Owned local runtime stopped")); };
      offline.io.identity = async () => { throw new Error("Fixture company network unavailable"); };
      offline.io.request = async () => { throw new Error("Fixture company network unavailable"); };
      await offline.controller[action](s.id); await sent;
      assert.equal(closed, true); assert.equal(offline.turns(), 1);
      const row = offline.journal()!.sessions[0]; assert.equal(row.operation?.phase, "settling");
      if (action === "revoke") assert.equal(row.revoked, true);
    } finally { await offline.clean(); }
  }
});
test("concurrent native consent cannot race another permission grant or begin execution", async () => {
  const f = await fixture(); try {
    const s = await f.create(); let allow!: (v: boolean) => void;
    f.io.consent = async () => new Promise<boolean>(resolve => { allow = resolve; });
    const first = f.controller.permission(s.id, "full-access");
    while (!allow) await new Promise(r => setImmediate(r));
    await assert.rejects(f.controller.permission(s.id, "read-only"), { code: "LOCAL_STOP_BEFORE_PERMISSION_CHANGE" });
    allow(true); assert.equal((await first).permission, "full-access");
  } finally { await f.clean(); }
});
test("generic renderer API cannot retrieve native credentials or proxy native inference", () => {
  const base = `/v1/tenants/${randomUUID()}/projects/${randomUUID()}/desktop-executions`;
  for (const url of [base, base + "/runtime", base + "/" + randomUUID() + "/start", base.replace("desktop-executions", "%64esktop-executions") + "/" + randomUUID() + "/start", "/v1/desktop-inference/v1/responses"])
    for (const method of ["GET", "POST"]) assert.equal(rendererApiOperation(url, method), false);
  assert.equal(rendererApiOperation("/v1/session/context"), true);
});

const controllerInput: LocalInputRequest = { threadId: "thread-controller", turnId: "turn-1", itemId: "call-question", isBlocking: false, questions: [
  { id: "palette", header: "Palette", question: "Which palette?", isOther: true, isSecret: false, options: [{ label: "Blue", description: "Company color" }, { label: "Neutral", description: "Warm neutral" }] },
  { id: "note", header: "Note", question: "Provide the private fixture note.", isOther: false, isSecret: true, options: null },
] };
const controllerAnswers = { palette: { answers: ["Blue"] }, note: { answers: ["VOLATILE_USER_ANSWER_74"] } };
async function awaitingInput(f: Awaited<ReturnType<typeof fixture>>) {
  const session = await f.create(); await f.controller.permission(session.id, "full-access");
  let received: unknown;
  f.pending(async () => {
    received = await f.runtimeHooks[0].userInput!(structuredClone(controllerInput), new AbortController().signal);
    return { status: "completed", text: "Answered and completed", threadId: "thread-controller", turnId: "turn-1", nativeTokenUsage: null };
  });
  const sent = f.controller.send(session.id, "Ask before doing work", 10000); void sent.catch(() => {});
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = (await f.controller.list(f.scope)).sessions[0];
    if (state.inputs.length) return { session, sent, input: state.inputs[0], received: () => received };
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error("Controller question was not presented");
}
test("an explicit native answer resumes one owned operation without a new task, turn, budget or answer journal entry", async () => {
  const f = await fixture(); try {
    const waiting = await awaitingInput(f), id = waiting.session.id;
    assert.equal((await f.controller.list(f.scope)).sessions[0].busy, true);
    waiting.input.questions[0].question = "Renderer tampering";
    assert.equal((await f.controller.list(f.scope)).sessions[0].inputs[0].questions[0].question, "Which palette?");
    await f.controller.answer(id, waiting.input.requestId, controllerAnswers); await waiting.sent;
    assert.deepEqual(JSON.parse(JSON.stringify(waiting.received())), controllerAnswers);
    assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/start")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/finish")).length, 1);
    const state = (await f.controller.list(f.scope)).sessions[0]; assert.deepEqual(state.inputs, []); assert.equal(state.task.status, "succeeded");
    assert.ok(!JSON.stringify(f.journal()).includes("VOLATILE_USER_ANSWER_74"));
    assert.ok(!JSON.stringify(state).includes("VOLATILE_USER_ANSWER_74"));
    await assert.rejects(f.controller.answer(id, waiting.input.requestId, controllerAnswers), { code: "LOCAL_INPUT_NOT_FOUND" });
  } finally { await f.clean(); }
});
test("malformed answers, guessed native ids and a different account cannot answer a live question", async () => {
  const f = await fixture(); try {
    const waiting = await awaitingInput(f), id = waiting.session.id;
    await assert.rejects(f.controller.answer(id, "call-question", controllerAnswers), { code: "LOCAL_INPUT_NOT_FOUND" });
    await assert.rejects(f.controller.answer(id, randomUUID(), controllerAnswers), { code: "LOCAL_INPUT_NOT_FOUND" });
    await assert.rejects(f.controller.answer(id, waiting.input.requestId, { palette: { answers: ["Blue"] } }));
    assert.equal((await f.controller.list(f.scope)).sessions[0].inputs[0].submitting, false);
    const actor = { ...f.actor }; f.actor.actorId = randomUUID(); f.actor.epoch = randomUUID();
    await assert.rejects(f.controller.answer(id, waiting.input.requestId, controllerAnswers), { code: "LOCAL_SESSION_NOT_FOUND" });
    assert.equal(waiting.received(), undefined); Object.assign(f.actor, actor);
    await f.controller.answer(id, waiting.input.requestId, controllerAnswers); await waiting.sent;
  } finally { await f.clean(); }
});
test("simultaneous answer submissions are single use and cannot win a stop during company authorization", async () => {
  const f = await fixture(); try {
    const waiting = await awaitingInput(f), request = f.io.request;
    let entered!: () => void, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    let held = false;
    f.io.request = async (url, options) => { if (url.endsWith("/heartbeat") && !held) { held = true; entered(); await gate; } return request(url, options); };
    const answer = f.controller.answer(waiting.session.id, waiting.input.requestId, controllerAnswers); void answer.catch(() => {}); await ready;
    await assert.rejects(f.controller.answer(waiting.session.id, waiting.input.requestId, controllerAnswers), { code: "LOCAL_INPUT_ALREADY_SUBMITTING" });
    await f.controller.stop(waiting.session.id); release();
    await assert.rejects(answer); await assert.rejects(waiting.sent);
    assert.equal(waiting.received(), undefined); assert.equal((await f.controller.list(f.scope)).sessions[0].inputs.length, 0);
    assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
  } finally { await f.clean(); }
});
for (const action of ["stop", "revoke", "invalidate", "close"] as const) test(`waiting questions disappear on ${action} and cannot be answered or replayed`, async () => {
  const f = await fixture(); try {
    const waiting = await awaitingInput(f);
    await f.controller[action](waiting.session.id); await assert.rejects(waiting.sent);
    if (action === "close") await assert.rejects(f.controller.list(f.scope), /LOCAL_APP_CLOSED/);
    else { const state = (await f.controller.list(f.scope)).sessions[0]; assert.deepEqual(state.inputs, []); }
    assert.equal(waiting.received(), undefined);
    await assert.rejects(f.controller.answer(waiting.session.id, waiting.input.requestId, controllerAnswers));
    assert.equal(f.created(), 1); assert.equal(f.turns(), 1);
  } finally { await f.clean(); }
});
