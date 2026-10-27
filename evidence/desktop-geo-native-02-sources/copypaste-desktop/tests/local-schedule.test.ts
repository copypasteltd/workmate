import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { LocalScheduleController, type ScheduleIO, type ScheduleJournal, type ScheduleContext, type ScheduleSettings } from "../src/local-schedule.js";
import type { LocalDispatchReceipt } from "../src/local-agent.js";

async function eventually(check: () => Promise<boolean>, message: string, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await wait(35); }
  assert.fail(message);
}
async function fixture(pollMs = 80) {
  const parent = path.resolve(".data/schedule-tests"); await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(path.join(parent, "owned-")), workspace = path.join(folder, "workspace"), state = path.join(folder, "state.json"); await mkdir(workspace);
  const sessionId = randomUUID(), context: ScheduleContext = { actorId: randomUUID(), epoch: randomUUID(), tenant: randomUUID(), project: randomUUID(), workspace,
    permission: "workspace-write", revoked: false, grantRevision: 1, expiresAt: Date.now() + 600000, busy: false, pending: false, uncertain: false, role: "fullstack" };
  const receipts = new Map<string, LocalDispatchReceipt>(), requests: { id: string; prompt: string; budget: number }[] = [];
  let paid = 0, consent = true, lost = false, parallel = 0, maximumParallel = 0, stops = 0;
  let hook: ((id: string, metadata: any) => Promise<LocalDispatchReceipt | void>) | undefined;
  const io: ScheduleIO = {
    read: async () => { try { return JSON.parse(await readFile(state, "utf8")); } catch (error: any) { if (error.code === "ENOENT") return null; throw error; } },
    write: async journal => { const temporary = state + "." + randomUUID(); await writeFile(temporary, JSON.stringify(journal)); await rename(temporary, state); },
    owner: async id => { if (id !== sessionId) throw new Error("LOCAL_SESSION_NOT_FOUND"); return { ...context }; }, context: async () => ({ ...context }),
    chooseInput: async () => workspace, confirm: async () => consent, changed: () => {}, stop: async () => { stops++; },
    dispatch: async (_session, id, prompt, budget, beforeNative) => {
      requests.push({ id, prompt, budget }); if (receipts.has(id)) return receipts.get(id)!;
      await beforeNative();
      parallel++; maximumParallel = Math.max(maximumParallel, parallel);
      try {
        paid++;
        const metadata = JSON.parse(prompt.split("\n").find(line => line.startsWith('{"job_id"'))!);
        const custom = await hook?.(id, metadata);
        const receipt: LocalDispatchReceipt = custom ?? { id, digest: "fixture", state: "succeeded", taskId: randomUUID() };
        if (receipt.state === "succeeded") {
          const bytes = await readFile(path.join(workspace, metadata.input_snapshot));
          await writeFile(path.join(workspace, metadata.output_directory, "summary.txt"), bytes);
        }
        receipts.set(id, receipt);
        if (lost) { lost = false; throw new Error("LOCAL_SCHEDULE_UNAVAILABLE"); }
        return receipt;
      } finally { parallel--; }
    },
  };
  let controller = new LocalScheduleController(io, pollMs);
  const settings: ScheduleSettings = { name: "CSV review", instruction: "Write a summary for this file", extensions: [".txt", ".csv"], quietMs: 500, budgetMicros: 10000,
    totalBudgetMicros: 100000, maxRuns: 10, includeExisting: false };
  const create = async (extra: Partial<ScheduleSettings> = {}) => { const rule = await controller.create(sessionId, { ...settings, ...extra }); assert.ok(rule); return rule; };
  const view = async () => (await controller.list(sessionId))[0];
  return { io, sessionId, workspace, context, create, view, requests, receipts, settings,
    get controller() { return controller; }, paid: () => paid, parallel: () => maximumParallel, stops: () => stops,
    setConsent: (value: boolean) => { consent = value; }, loseResult: () => { lost = true; }, setHook: (value: typeof hook) => { hook = value; },
    restart: async () => { await controller.close(); await controller.drain(); controller = new LocalScheduleController(io, pollMs); },
    clean: async () => { await controller.close(); await controller.drain(); assert.equal(path.dirname(folder), parent); await rm(folder, { recursive: true, force: true }); },
  };
}
test("a real filesystem watch debounces rapid edits, excludes its own outputs and dispatches each content fingerprint once", async () => {
  const f = await fixture(60000); try {
    await writeFile(path.join(f.workspace, "existing.txt"), "baseline"); const rule = await f.create();
    assert.equal(rule.state, "paused"); f.setConsent(false); await f.controller.activate(f.sessionId, rule.id); assert.equal((await f.view()).state, "paused");
    f.setConsent(true); await f.controller.activate(f.sessionId, rule.id);
    await writeFile(path.join(f.workspace, "fresh.txt"), "first"); await wait(100); await writeFile(path.join(f.workspace, "fresh.txt"), "second"); await wait(100); await writeFile(path.join(f.workspace, "fresh.txt"), "final");
    await eventually(async () => (await f.view()).jobs.some(job => job.state === "succeeded"), "Native watch did not process the stable change");
    const job = (await f.view()).jobs[0]; assert.equal(await readFile(path.join(f.workspace, job.output!, "summary.txt"), "utf8"), "final");
    await f.controller.checkNow(rule.id); await wait(650); await f.controller.checkNow(rule.id); await f.controller.drain();
    assert.equal(f.paid(), 1); assert.equal((await f.view()).jobTotal, 1); assert.equal(f.requests[0].budget, 10000);
    await writeFile(path.join(f.workspace, "fresh.txt"), "final"); await wait(1200); await f.controller.checkNow(rule.id); assert.equal(f.paid(), 1);
  } finally { await f.clean(); }
});
test("batch dispatch is serial, pause finishes the current file and resume handles only remaining work within both caps", async () => {
  const f = await fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await writeFile(path.join(f.workspace, "a.txt"), "A"); await writeFile(path.join(f.workspace, "b.txt"), "B");
    f.setHook(async () => { await held; }); const rule = await f.create({ includeExisting: true, maxRuns: 2, totalBudgetMicros: 20000 });
    await f.controller.activate(f.sessionId, rule.id); await eventually(async () => f.paid() === 1, "First file did not start");
    await f.controller.pause(f.sessionId, rule.id); release(); await f.controller.drain(); await wait(650);
    assert.equal(f.paid(), 1); assert.equal((await f.view()).jobs.filter(job => job.state === "succeeded").length, 1);
    await f.controller.activate(f.sessionId, rule.id);
    await eventually(async () => (await f.view()).jobs.filter(job => job.state === "succeeded").length === 2, "Remaining file did not finish");
    assert.equal(f.parallel(), 1); assert.equal(f.paid(), 2); assert.equal((await f.view()).allocatedBudgetMicros, 20000);
    await assert.rejects(f.controller.activate(f.sessionId, rule.id), { code: "LOCAL_SCHEDULE_LIMIT_REACHED" });
    await writeFile(path.join(f.workspace, "c.txt"), "C"); await wait(650); assert.equal(f.paid(), 2);
  } finally { release(); await f.clean(); }
});
test("lost result and restart recover the original job and output without spending on another execution", async () => {
  const f = await fixture(); try {
    const rule = await f.create(); f.loseResult(); await f.controller.activate(f.sessionId, rule.id); await writeFile(path.join(f.workspace, "one.txt"), "Only once");
    await eventually(async () => (await f.view()).state === "blocked", "Lost dispatch was not held");
    const original = (await f.view()).jobs[0]; assert.equal(original.state, "dispatching"); assert.equal(f.paid(), 1);
    await f.restart(); assert.equal((await f.view()).state, "blocked"); await wait(700); assert.equal(f.paid(), 1);
    await f.controller.activate(f.sessionId, rule.id); await eventually(async () => (await f.view()).jobs[0].state === "succeeded", "Original receipt was not recovered");
    assert.equal(f.paid(), 1); assert.equal(new Set(f.requests.map(request => request.id)).size, 1); assert.equal(f.requests.length, 2);
    assert.equal((await f.view()).jobs[0].id, original.id);
  } finally { await f.clean(); }
});
test("active rules reopen paused and require fresh confirmation before processing changes made while closed", async () => {
  const f = await fixture(); try {
    const rule = await f.create(); await f.controller.activate(f.sessionId, rule.id); await f.restart();
    assert.equal((await f.view()).state, "paused"); await writeFile(path.join(f.workspace, "offline.txt"), "Offline change"); await wait(700); assert.equal(f.paid(), 0);
    f.setConsent(false); await f.controller.activate(f.sessionId, rule.id); await wait(650); assert.equal(f.paid(), 0);
    f.setConsent(true); await f.controller.activate(f.sessionId, rule.id); await eventually(async () => f.paid() === 1, "Confirmed catch-up did not run");
  } finally { await f.clean(); }
});
test("a known changed original is reported as conflict after a paid run and prevents the next file", async () => {
  const f = await fixture(); try {
    await writeFile(path.join(f.workspace, "a.txt"), "A"); await writeFile(path.join(f.workspace, "b.txt"), "B");
    f.setHook(async () => { await writeFile(path.join(f.workspace, "a.txt"), "Changed while running"); });
    const rule = await f.create({ includeExisting: true }); await f.controller.activate(f.sessionId, rule.id);
    await eventually(async () => (await f.view()).state === "blocked", "Conflict did not stop the batch");
    assert.equal(f.paid(), 1); assert.equal((await f.view()).jobs.find(job => job.input.path === "a.txt")!.state, "conflict");
    await wait(650); assert.equal(f.paid(), 1);
  } finally { await f.clean(); }
});
test("unknown outcomes retain their original task, block further dispatch and cannot be silently resumed", async () => {
  const f = await fixture(); try {
    await writeFile(path.join(f.workspace, "a.txt"), "A"); f.setHook(async id => ({ id, digest: "fixture", state: "uncertain", taskId: randomUUID() }));
    const rule = await f.create({ includeExisting: true }); await f.controller.activate(f.sessionId, rule.id);
    await eventually(async () => (await f.view()).state === "blocked", "Unknown outcome was not blocked");
    assert.equal((await f.view()).jobs[0].state, "uncertain"); assert.ok((await f.view()).jobs[0].taskId);
    await assert.rejects(f.controller.activate(f.sessionId, rule.id), { code: "LOCAL_EXECUTION_RECONCILIATION_REQUIRED" }); assert.equal(f.paid(), 1);
  } finally { await f.clean(); }
});
test("withdrawal during activation invalidates the pending confirmation and cannot revive a paused rule", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  try {
    const rule = await f.create(); f.io.confirm = async () => { entered(); await held; return true; };
    const activation = f.controller.activate(f.sessionId, rule.id); const rejected = assert.rejects(activation, /LOCAL_ACCOUNT_CHANGED|LOCAL_SCHEDULE_INACTIVE/);
    await waiting; await f.controller.pause(f.sessionId, rule.id); release(); await rejected;
    await writeFile(path.join(f.workspace, "no.txt"), "No automatic execution"); await wait(700); assert.equal(f.paid(), 0); assert.equal((await f.view()).state, "paused");
  } finally { release(); await f.clean(); }
});
test("revoked grants and account changes stop dispatch, and a new login epoch cannot list the old rules", async () => {
  const f = await fixture(); try {
    const rule = await f.create(); await f.controller.activate(f.sessionId, rule.id); f.context.revoked = true; f.context.permission = null;
    await writeFile(path.join(f.workspace, "no.txt"), "No access"); await f.controller.checkNow(rule.id);
    assert.equal((await f.view()).state, "blocked"); assert.equal(f.paid(), 0);
    f.context.epoch = randomUUID(); assert.equal((await f.controller.list(f.sessionId)).length, 0);
    await assert.rejects(f.controller.pause(f.sessionId, rule.id), { code: "LOCAL_SCHEDULE_NOT_FOUND" });
  } finally { await f.clean(); }
});
test("failed journal persistence prevents native dispatch and leaves an actionable storage error", async () => {
  const f = await fixture(); const originalWrite = f.io.write; try {
    const rule = await f.create(); await f.controller.activate(f.sessionId, rule.id);
    f.io.write = async (journal: ScheduleJournal) => { if (journal.rules.some(row => row.jobs.length)) throw new Error("Disk full fixture"); await originalWrite(journal); };
    await writeFile(path.join(f.workspace, "no.txt"), "Must not dispatch");
    await eventually(async () => (await f.view()).reason === "LOCAL_SCHEDULE_STORAGE_UNAVAILABLE", "Storage failure did not stop the watcher");
    assert.equal(f.paid(), 0);
  } finally { f.io.write = originalWrite; await f.clean(); }
});
test("changes waiting behind a busy session supersede unpaid versions, including content that returns to an earlier unpaid fingerprint", async () => {
  const f = await fixture(); try {
    f.context.busy = true; const rule = await f.create(); await f.controller.activate(f.sessionId, rule.id);
    for (const [index, text] of ["A", "B", "A", "B"].entries()) {
      await writeFile(path.join(f.workspace, "changing.txt"), text);
      await eventually(async () => (await f.view()).jobTotal === index + 1, "Stable pending version did not coalesce");
    }
    assert.equal(f.paid(), 0); assert.equal((await f.view()).jobs.filter(job => job.state === "queued").length, 1);
    assert.equal((await f.view()).jobs.filter(job => job.state === "superseded").length, 3);
    f.context.busy = false; await f.controller.checkNow(rule.id);
    await eventually(async () => (await f.view()).jobs.some(job => job.state === "succeeded"), "Latest unpaid version was not processed");
    assert.equal(f.paid(), 1); const job = (await f.view()).jobs.find(job => job.state === "succeeded")!;
    assert.equal(await readFile(path.join(f.workspace, job.output!, "summary.txt"), "utf8"), "B");
    assert.ok(!JSON.stringify(await f.view()).includes("input_snapshot"), "Public history must omit internal persisted prompts");
  } finally { await f.clean(); }
});
test("revoking a rule stops only its active owned task and retains its original receipt without starting the next file", async () => {
  const f = await fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await writeFile(path.join(f.workspace, "a.txt"), "A"); await writeFile(path.join(f.workspace, "b.txt"), "B");
    f.setHook(async id => { await held; return { id, digest: "fixture", state: "cancelled", taskId: randomUUID() }; });
    const originalStop = f.io.stop; f.io.stop = async id => { assert.equal(id, f.sessionId); release(); return originalStop(id); };
    const rule = await f.create({ includeExisting: true }); await f.controller.activate(f.sessionId, rule.id);
    await eventually(async () => f.paid() === 1, "Owned work did not start"); await f.controller.revoke(f.sessionId, rule.id); await f.controller.drain();
    assert.equal(f.stops(), 1); assert.equal((await f.view()).state, "revoked"); assert.equal((await f.view()).jobs.filter(job => job.state === "cancelled").length, 2);
    assert.equal(f.paid(), 1); assert.ok((await f.view()).jobs.some(job => job.taskId));
    await assert.rejects(f.controller.activate(f.sessionId, rule.id), { code: "LOCAL_SCHEDULE_INACTIVE" });
  } finally { release(); await f.clean(); }
});
