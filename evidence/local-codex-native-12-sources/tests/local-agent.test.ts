import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal, type LocalAgentRuntime } from "../src/local-agent.js";
import { localRuntimeLock } from "../src/local-runtime.js";
import { rendererApiOperation } from "../src/config.js";

async function fixture() {
  const parent = path.resolve(".data/controller-tests"); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "owned-"));
  const scope = { tenant: randomUUID(), project: randomUUID() }, actor = { actorId: randomUUID(), epoch: randomUUID() };
  let journal: LocalAgentJournal | null = null, consent = true, turns = 0, created = 0, finishLost = false, startFailure = false, startLost = false;
  const calls: any[] = [], grants: any[] = [], runtimes: LocalAgentRuntime[] = [];
  const tasks = new Map<string, any>();
  const runtimeBody = { pinned_version: localRuntimeLock.version, windows_x64_sha256: localRuntimeLock.sha256, role_keys: ["fullstack"] };
  let pendingTurn: (() => Promise<any>) | undefined;
  const io: LocalAgentIO = {
    read: async () => structuredClone(journal), write: async j => { journal = structuredClone(j); },
    identity: async () => ({ ...actor }), changed: () => {}, chooseWorkspace: async () => directory,
    consent: async () => consent, approval: async () => "decline", stateRoot: directory, companyOrigin: "http://127.0.0.1:4310",
    executable: path.join(directory, "codex.exe"), runtime: localRuntimeLock,
    request: async (url, options) => {
      calls.push({ url, ...options });
      if (url.endsWith("/runtime")) return { status: 200, body: runtimeBody };
      if (url.endsWith("/desktop-executions")) {
        const id = randomUUID(); created++; const task = { task_id: id, status: "queued", state: "prepared", charged_micros: "0", accrued_micros: "0" }; tasks.set(id, task); return { status: 200, body: task };
      }
      const id = url.split("/").at(-2)!, task = tasks.get(id);
      if (!task) throw new Error("Unknown fixture task");
      if (url.endsWith("/start")) { task.status = task.state = "running";
        if (startLost) { startLost = false; throw new Error("Fixture lost start response after acceptance"); }
        return { status: 200, body: { ...task, runtime: runtimeBody,
        inference_path: "/v1/desktop-inference/v1", skills: [], model: "synthetic-native", effort: "max", prompt: "fixture", role_instructions: "Use real local tools",
        credential: { token: "ONLY_THE_TRUSTED_NATIVE_RUNTIME_CAN_RECEIVE_THIS_TOKEN", expires_at: new Date(Date.now() + 300000).toISOString() } } }; }
      if (url.endsWith("/heartbeat")) return { status: 200, body: { ...task } };
      if (url.endsWith("/cancel")) { task.cancel_requested = true; return { status: 200, body: { ...task } }; }
      if (url.endsWith("/finish")) {
        const report = options?.body as any; task.status = report.status === "unknown" ? "reconciling" : report.status === "completed" ? "succeeded" : "failed";
        if (finishLost) { finishLost = false; throw new Error("Fixture lost finish response after acceptance"); }
        return { status: 200, body: { ...task } };
      }
      throw new Error("Unexpected fixture request");
    },
  };
  const controller = new LocalAgentController(io, (_profile, binding, hooks) => {
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
  });
  const create = async () => (await controller.create(scope, "fullstack"))!;
  const clean = async () => { await controller.close(); assert.equal(path.dirname(directory), parent); await rm(directory, { recursive: true, force: true }); };
  return { controller, io, scope, actor, calls, grants, runtimes, create, clean, turns: () => turns, created: () => created,
    setConsent: (v: boolean) => { consent = v; }, loseFinish: () => { finishLost = true; }, failStart: () => { startFailure = true; }, loseStart: () => { startLost = true; },
    pending: (fn: () => Promise<any>) => { pendingTurn = fn; }, journal: () => structuredClone(journal),
  };
}
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
  } finally { await f.clean(); }
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
