import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal, type LocalAgentRuntime, type LocalRuntimeFactory } from "../src/local-agent.js";
import { localRuntimeLock } from "../src/local-runtime.js";
import type { LocalCodexHooks } from "../src/local-codex.js";
import { startupFixture, startupTurnFixture } from "./startup-receipt-fixture.js";
import { nativeDeliveryRevision } from "../src/delivery-revision.js";
const reference = (taskId: string) => ({ source_task_id: taskId, expected_version: 5, expected_delivery_hash: "a".repeat(64), target: { kind: "output" } });

test("a revision passes its exact fixed source through native admission and preserves the original local permission", async () => {
  const f = await fixture();
  try {
    const session = await f.create(); await f.controller.permission(session.id, "workspace-write");
    await f.controller.send(session.id, "Create original local delivery", 100000);
    const original = f.calls.filter(c => c.url.endsWith("/desktop-executions")).at(-1), prior = f.journal()!.sessions[0].lastTask!.task_id;
    const result = await f.controller.revise(session.id, randomUUID(), "Revise the original local delivery", 100000, reference(prior));
    assert.equal(result.state, "succeeded"); assert.equal(f.turns(), 2);
    const next = f.calls.filter(c => c.url.endsWith("/desktop-executions")).at(-1);
    assert.deepEqual(next.body.delivery_revision, reference(prior)); assert.equal(next.body.local_session_id, original.body.local_session_id);
    assert.equal(next.body.workspace_hash, original.body.workspace_hash); assert.equal(f.grants.at(-1).mode, "workspace-write");
    assert.ok(f.calls.every(c => !/\/tasks$|\/revisions$/.test(c.url)));
  } finally { await f.clean(); }
});
test("terminal native revision receipts replay after restart without a second hold or Codex turn; changed target conflicts", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined;
  try {
    const session = await f.create(); await f.controller.permission(session.id, "full-access"); await f.controller.send(session.id, "Create original local delivery", 100000);
    const prior = f.journal()!.sessions[0].lastTask!.task_id, selection = reference(prior), id = randomUUID();
    const first = await f.controller.revise(session.id, id, "Change the original headline", 100000, selection), created = f.created(), turns = f.turns();
    assert.deepEqual(await f.controller.revise(session.id, id, "Change the original headline", 100000, selection), first);
    await assert.rejects(f.controller.revise(session.id, id, "Change the original headline", 100000, { ...selection, target: { kind: "whole" } }), { code: "LOCAL_DISPATCH_CONFLICT" });
    await f.controller.close(); restored = new LocalAgentController(f.io, () => { throw new Error("Terminal receipts must not restart Codex"); });
    assert.deepEqual(await restored.revise(session.id, id, "Change the original headline", 100000, selection), first);
    assert.equal(f.created(), created); assert.equal(f.turns(), turns);
  } finally { await restored?.close(); await f.clean(); }
});
test("an unknown native admission persists the fixed source and resumes that operation instead of creating another task", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined;
  try {
    const session = await f.create(); await f.controller.permission(session.id, "full-access"); await f.controller.send(session.id, "Create original local delivery", 100000);
    const source = reference(f.journal()!.sessions[0].lastTask!.task_id), id = randomUUID(); f.loseCreate();
    await assert.rejects(f.controller.revise(session.id, id, "Use this retained source for the revision", 100000, source));
    const journal = f.journal()!; assert.deepEqual(journal.sessions[0].operation!.deliveryRevision, source); const count = f.created();
    await f.controller.close(); restored = new LocalAgentController(f.io, f.factory); await restored.permission(session.id, "full-access");
    const result = await restored.revise(session.id, id, "Use this retained source for the revision", 100000, source);
    assert.equal(result.state, "succeeded"); assert.equal(f.created(), count);
  } finally { await restored?.close(); await f.clean(); }
});
test("wrong-session delivery references and revoked permissions cannot create a native reservation", async () => {
  const f = await fixture();
  try {
    const session = await f.create(); await f.controller.permission(session.id, "full-access"); await f.controller.send(session.id, "Create original local delivery", 100000);
    const count = f.created(); await assert.rejects(f.controller.revise(session.id, randomUUID(), "Revise another session", 100000, reference(randomUUID())), { code: "LOCAL_REVISION_SESSION_CHANGED" });
    const prior = f.journal()!.sessions[0].lastTask!.task_id; await f.controller.revoke(session.id);
    await assert.rejects(f.controller.revise(session.id, randomUUID(), "Revision after permission revocation", 100000, reference(prior)));
    assert.equal(f.created(), count);
  } finally { await f.clean(); }
});
test("native revision descriptors are bounded and contain no renderer-supplied permissions or model credentials", () => {
  const value = reference(randomUUID()); assert.deepEqual(nativeDeliveryRevision(value), value);
  for (const other of [{ ...value, full_permission: true }, { ...value, expected_version: 0 }, { ...value, expected_delivery_hash: "invalid" }, { ...value, target: { kind: "forged" } }]) assert.throws(() => nativeDeliveryRevision(other));
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
  let pendingTurn: (() => Promise<any>) | undefined, pendingStart: (() => Promise<void>) | undefined;
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
        const startup = startupFixture(task);
        if (startLost) { startLost = false; throw new Error("Fixture lost start response after acceptance"); }
        return { status: 200, body: { ...startup, runtime: runtimeBody,
        inference_path: "/v1/desktop-inference/v1", skills: [], model: "synthetic-native", effort: "max", prompt: "fixture", role_instructions: "Use real local tools",
        credential: startup.credential } }; }
      if (url.endsWith("/turn-admission")) return startupTurnFixture(task, options?.body);
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
      start: async credential => { assert.ok(credential.token.startsWith("ONLY_")); await hooks.authorize(); if (startFailure) throw new Error("Fixture binary unavailable"); await pendingStart?.(); },
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
    starting: (fn: () => Promise<void>) => { pendingStart = fn; },
  };
}

