import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal } from "../src/local-agent.js";
import { localRuntimeLock } from "../src/local-runtime.js";

// Controller boundaries use synthetic saved journals and transport replies.
// Actual native/SQL transport-loss journeys live in the delivery repository.
async function fixture() {
  const parent = path.resolve(".data/controller-tests"); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "owned-receipt-"));
  const actor = { actorId: randomUUID(), epoch: randomUUID() }, scope = { tenant: randomUUID(), project: randomUUID() };
  const rootId = randomUUID(), childId = randomUUID(), calls: any[] = [];
  let journal: LocalAgentJournal | null = null, nativeStarts = 0, childCharges = 0, rootCharges = 0, childFinished = false;
  let failure: "none" | "before" | "after" | "wrong-task" | "not-terminal" = "none";
  let afterChild: (() => void) | undefined;
  const io: LocalAgentIO = {
    read: async () => structuredClone(journal), write: async next => { journal = structuredClone(next); },
    identity: async () => ({ ...actor }), localEpoch: async () => actor.epoch,
    changed: () => {}, chooseWorkspace: async () => directory, consent: async () => true, approval: async () => "decline",
    stateRoot: directory, companyOrigin: "http://127.0.0.1:4310", executable: path.join(directory, "never-start.exe"), runtime: localRuntimeLock,
    request: async (url, options) => {
      if (url.endsWith("/runtime")) return { status: 200, body: { pinned_version: localRuntimeLock.version, windows_x64_sha256: localRuntimeLock.sha256, role_keys: ["fullstack"] } };
      calls.push({ url, method: options?.method, body: structuredClone(options?.body), key: options?.idempotencyKey });
      if (url.includes("/" + childId + "/")) {
        if (url.endsWith("/cancel")) return { status: 200, body: { task_id: childId, state: "stopping", status: "running", cancel_requested: true } };
        assert.ok(url.endsWith("/finish"), "Receipt replay must never start a child, advance a workflow or call a tool");
        if (failure === "before") throw new Error("SYNTHETIC_RECEIPT_OFFLINE");
        if (failure === "wrong-task") return { status: 200, body: { task_id: randomUUID(), state: "finished", status: "succeeded" } };
        if (failure === "not-terminal") return { status: 200, body: { task_id: childId, state: "running", status: "running" } };
        if (!childFinished) { childCharges++; childFinished = true; }
        if (failure === "after") throw new Error("SYNTHETIC_RECEIPT_ACK_LOST");
        afterChild?.();
        return { status: 200, body: { task_id: childId, state: (options?.body as any).status === "unknown" ? "reconciling" : "finished", status: (options?.body as any).status === "unknown" ? "reconciling" : "succeeded" } };
      }
      if (url.endsWith("/" + rootId + "/finish")) {
        rootCharges++;
        return { status: 200, body: { task_id: rootId, state: "reconciling", status: "reconciling", charged_micros: "30", accrued_micros: "30" } };
      }
      throw new Error("Unexpected receipt-only request: " + url);
    },
  };
  const controllers: LocalAgentController[] = [];
  const makeController = () => { const value = new LocalAgentController(io, () => { nativeStarts++; throw new Error("NATIVE_REPLAY_FORBIDDEN"); }); controllers.push(value); return value; };
  const controller = makeController(), session = (await controller.create(scope, "fullstack"))!;
  await controller.permission(session.id, "full-access");
  const record = (await (controller as any).state()).sessions[0];
  record.operation = {
    createKey: randomUUID(), startKey: randomUUID(), finishKey: randomUUID(), cancelKey: randomUUID(),
    prompt: "Original interrupted parent", budget: 100000, taskId: rootId, phase: "settling",
    report: { status: "unknown", output: "", thread_id: "unknown", turn_id: "unknown" },
    workflow: { runId: randomUUID(), cursor: 0, taskId: childId, phase: "settling",
      report: { status: "completed", output: "A local file was written once", thread_id: "native-child", turn_id: "original-child-turn" } },
  };
  await (controller as any).persist();
  const original = structuredClone(record.operation);
  const view = async (c = controller) => (c as any).view((await (c as any).state()).sessions[0]);
  const clean = async () => { for (const c of controllers) await c.close(); assert.equal(path.dirname(directory), parent); await rm(directory, { recursive: true, force: true }); };
  return { controller, io, session, record, actor, scope, rootId, childId, original, calls, clean, view, makeController,
    journal: () => structuredClone(journal)!, nativeStarts: () => nativeStarts, childCharges: () => childCharges, rootCharges: () => rootCharges,
    fail: (value: typeof failure) => { failure = value; }, afterChild: (value: () => void) => { afterChild = value; } };
}

test("receipt synchronization flushes a saved child before clearing its interrupted parent", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.view()).receiptPending, true);
    await f.controller.retry(f.session.id);
    assert.deepEqual(f.calls.map(c => c.url.split("/").slice(-2)), [[f.childId, "finish"], [f.rootId, "finish"]]);
    assert.deepEqual(f.calls[0].body, f.original.workflow.report);
    assert.deepEqual(f.calls[1].body, f.original.report);
    assert.equal((await f.view()).phase, "idle"); assert.equal((await f.view()).receiptPending, false);
    assert.equal(f.nativeStarts(), 0); assert.equal(f.childCharges(), 1); assert.equal(f.rootCharges(), 1);
  } finally { await f.clean(); }
});

for (const loss of ["before", "after"] as const) test(`receipt synchronization retains ${loss}-acceptance loss and only resends original reports`, async () => {
  const f = await fixture();
  try {
    f.fail(loss);
    await assert.rejects(f.controller.retry(f.session.id), /SYNTHETIC_RECEIPT_/);
    await assert.rejects(f.controller.retry(f.session.id), /SYNTHETIC_RECEIPT_/);
    assert.equal((await f.view()).phase, "settling"); assert.equal((await f.view()).receiptPending, true);
    assert.equal(f.rootCharges(), 0); assert.deepEqual(f.journal().sessions[0].operation!.workflow!.report, f.original.workflow.report);
    f.fail("none"); await f.controller.retry(f.session.id);
    const child = f.calls.filter(c => c.url.endsWith("/" + f.childId + "/finish"));
    assert.equal(child.length, 3); assert.equal(new Set(child.map(c => c.key)).size, 1);
    for (const call of child) assert.deepEqual(call.body, f.original.workflow.report);
    assert.equal(f.nativeStarts(), 0); assert.equal(f.childCharges(), 1); assert.equal(f.rootCharges(), 1);
  } finally { await f.clean(); }
});

for (const local of ["restored", "revoked", "expired", "saved-running-parent"] as const)
  test(`receipt synchronization ${local} uses no new native permission or turn`, async () => {
    const f = await fixture();
    try {
      if (local === "revoked") await f.controller.revoke(f.session.id);
      if (local === "expired") { f.record.grant.expiresAt = 1; await (f.controller as any).persist(); }
      await f.controller.close();
      if (local === "saved-running-parent") {
        const journal = f.journal(); journal.sessions[0].operation!.phase = "native_running";
        delete journal.sessions[0].operation!.report; await f.io.write(journal);
      }
      const restored = f.makeController(); await restored.retry(f.session.id);
      assert.deepEqual(f.calls[0].body, f.original.workflow.report);
      assert.equal(f.nativeStarts(), 0); assert.equal(f.childCharges(), 1); assert.equal(f.rootCharges(), 1);
      assert.equal((await f.view(restored)).uncertain, true);
      assert.equal((await f.view(restored)).phase, "idle");
    } finally { await f.clean(); }
  });

for (const reply of ["wrong-task", "not-terminal"] as const)
  test(`receipt synchronization rejects a ${reply} acknowledgement without losing its checkpoint`, async () => {
    const f = await fixture();
    try {
      f.fail(reply); await assert.rejects(f.controller.retry(f.session.id), /LOCAL_WORKFLOW_RECEIPT_INVALID/);
      assert.equal((await f.view()).receiptPending, true); assert.equal(f.rootCharges(), 0);
      assert.deepEqual(f.journal().sessions[0].operation!.workflow!.report, f.original.workflow.report);
      f.fail("none"); await f.controller.retry(f.session.id); assert.equal(f.nativeStarts(), 0);
    } finally { await f.clean(); }
  });

for (const when of ["before", "during"] as const)
  test(`receipt synchronization rejects an account switch ${when} child acknowledgement`, async () => {
    const f = await fixture();
    try {
      if (when === "before") f.actor.epoch = randomUUID();
      else f.afterChild(() => { f.actor.epoch = randomUUID(); });
      await assert.rejects(f.controller.retry(f.session.id), /LOCAL_(SESSION_NOT_FOUND|ACCOUNT_CHANGED)/);
      assert.equal(f.rootCharges(), 0); assert.equal(f.nativeStarts(), 0);
      assert.deepEqual(f.journal().sessions[0].operation!.workflow!.report, f.original.workflow.report);
      assert.equal(f.journal().sessions[0].operation!.workflow!.phase, "settling");
    } finally { await f.clean(); }
  });

for (const phase of ["prepared", "native_running"] as const)
  test(`receipt synchronization marks a restored ${phase} child unknown and cancels its original authority`, async () => {
    const f = await fixture();
    try {
      const journal = f.journal(), operation = journal.sessions[0].operation!;
      operation.phase = "native_running"; delete operation.report;
      operation.workflow!.phase = phase; delete operation.workflow!.report;
      await f.controller.close(); await f.io.write(journal);
      const restored = f.makeController(); await restored.retry(f.session.id);
      assert.deepEqual(f.calls.map(c => c.url.split("/").slice(-2)), [[f.childId, "cancel"], [f.childId, "finish"], [f.rootId, "finish"]]);
      assert.equal(f.calls[1].body.status, "unknown"); assert.equal(f.calls[1].body.output, "");
      assert.equal((await f.view(restored)).uncertain, true); assert.equal(f.nativeStarts(), 0);
    } finally { await f.clean(); }
  });

test("receipt synchronization persists an unknown child before contacting company services", async () => {
  const f = await fixture();
  try {
    delete f.record.operation.workflow.report; f.record.operation.workflow.phase = "prepared";
    f.io.write = async () => { throw new Error("SYNTHETIC_JOURNAL_WRITE_FAILED"); };
    await assert.rejects(f.controller.retry(f.session.id), /SYNTHETIC_JOURNAL_WRITE_FAILED/);
    assert.equal(f.calls.length, 0); assert.equal(f.nativeStarts(), 0);
  } finally { await f.clean(); }
});

test("receipt synchronization skips an acknowledged child while retrying the original parent receipt", async () => {
  const f = await fixture();
  try {
    f.record.operation.workflow.phase = "finished"; await (f.controller as any).persist();
    await f.controller.retry(f.session.id);
    assert.deepEqual(f.calls.map(c => c.url.split("/").slice(-2)), [[f.rootId, "finish"]]);
    assert.equal(f.nativeStarts(), 0);
  } finally { await f.clean(); }
});
