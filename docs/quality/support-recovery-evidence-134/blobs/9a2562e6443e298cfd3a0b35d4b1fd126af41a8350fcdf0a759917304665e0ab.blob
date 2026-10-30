import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { LocalAgentController, type LocalAgentIO, type LocalAgentJournal, type LocalRuntimeFactory } from "../src/local-agent.js";
import { rendererApiOperation } from "../src/config.js";
import { startupFixture, startupTurnFixture } from "./startup-receipt-fixture.js";

async function fixture() {
  const parent = path.resolve(".data/geo-controller-tests"); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, "owned-"));
  const actor = { actorId: randomUUID(), epoch: randomUUID() }, scope = { tenant: randomUUID(), project: randomUUID() };
  const input = { ...scope, experiment: randomUUID(), expected_sha256: "a".repeat(64), name: "Fixed observations", budget: "10000" };
  const runtime = { version: "0.163.0-alpha.11", sha256: "0".repeat(64) }, calls: any[] = [], bindings: any[] = [], reviews: any[] = [];
  let journal: LocalAgentJournal | null = null, consent = true, lost = false, unknown = false, dispatches = 0;
  const accepted = new Map<string, any>(), tasks = new Map<string, any>();
  const io: LocalAgentIO = {
    read: async () => structuredClone(journal), write: async v => { journal = structuredClone(v); }, identity: async () => ({ ...actor }), localEpoch: async () => actor.epoch,
    stateRoot: root, companyOrigin: "http://127.0.0.1:4310", executable: path.join(root, "codex.exe"), runtime, changed: () => {},
    chooseWorkspace: async () => { throw new Error("A GEO observation must not request customer files"); }, consent: async () => { throw new Error("No general local permission prompt"); }, approval: async () => "decline",
    browser: () => { throw new Error("No browser tools in an observation"); }, program: () => { throw new Error("No program tools in an observation"); },
    geoConsent: async r => { reviews.push(r); return consent; },
    request: async (url, options) => {
      calls.push({ url, ...structuredClone(options) });
      if (url.endsWith("/runtime")) return { status: 200, body: { role_keys: ["assistant"] } };
      if (url.endsWith("/desktop-configuration")) return { status: 200, body: { id: input.experiment, sha256: input.expected_sha256,
        runtime: { pinned_version: runtime.version, windows_x64_sha256: runtime.sha256 }, quota: { available: 10 },
        role_key: "assistant", model_alias: "synthetic-geo", questions: [{ key: "q1", text: "First independent question" }, { key: "q2", text: "Second independent question" }] } };
      if (url.endsWith("/desktop-runs")) {
        const b = options!.body as any, key = options!.idempotencyKey!;
        assert.equal(journal?.sessions.length, 2, "Commit the complete batch journal before reserving money");
        assert.ok(journal!.sessions.every(r => r.operation?.createKey === key));
        if (!accepted.has(key)) {
          const sessions = b.sessions.map((s: any) => { const task = { task_id: randomUUID(), state: "prepared", status: "queued" }; tasks.set(task.task_id, task);
            return { question_key: s.question_key, local_session_id: s.local_session_id, task_id: task.task_id, sample_id: randomUUID(), budget_micros: b.per_question_budget_micros, role_key: "assistant" }; });
          accepted.set(key, { id: randomUUID(), experiment_id: input.experiment, execution_location: "desktop", protocol: "codex-desktop-geo-v1", total_budget_micros: "20000", sessions });
        }
        if (lost) { lost = false; throw new Error("Reservation response lost after server acceptance"); }
        return { status: 201, body: structuredClone(accepted.get(key)) };
      }
      const task = tasks.get(url.split("/").at(-2)!); assert.ok(task, "Only the original native tasks may be used");
      if (url.endsWith("/start")) { task.status = task.state = "running"; return { status: 200, body: { ...startupFixture(task), runtime: { pinned_version: runtime.version, windows_x64_sha256: runtime.sha256 },
        observation_protocol: "codex-desktop-geo-v1", inference_path: "/v1/desktop-inference/v1", skills: [], company_tools: [], project_configuration: null, model: "synthetic-geo", effort: "max", role_instructions: "Pinned observer", prompt: "Fixed question",
        } }; }
      if (url.endsWith("/turn-admission")) return startupTurnFixture(task, options?.body);
      if (url.endsWith("/heartbeat")) return { status: 200, body: { ...task } };
      if (url.endsWith("/finish")) { const b = options!.body as any; task.state = b.status === "unknown" ? "reconciling" : "finished"; task.status = b.status === "unknown" ? "reconciling" : b.status === "completed" ? "succeeded" : "failed"; return { status: 200, body: { ...task } }; }
      if (url.endsWith("/cancel")) { task.state = "finished"; task.status = "cancelled"; return { status: 200, body: { ...task } }; }
      throw new Error("Unexpected request " + url);
    },
  };
  const factory: LocalRuntimeFactory = (_p, b, hooks) => { bindings.push(b); return {
    start: async () => { await hooks.authorize(); }, turn: async () => { dispatches++; if (unknown) throw new Error("Native accepted outcome unknown");
      return { threadId: randomUUID(), turnId: randomUUID(), text: "Actual fixture turn result", status: "completed", nativeTokenUsage: null }; },
    close: async () => {}, interrupt: async () => {}, revoke: async () => {},
  }; };
  const controller = new LocalAgentController(io, factory);
  return { controller, io, actor, scope, input, calls, bindings, reviews, accepted, factory, tasks,
    consent: (v: boolean) => { consent = v; }, lose: () => { lost = true; }, unknown: () => { unknown = true; }, dispatches: () => dispatches,
    journal: () => structuredClone(journal), clean: async () => { await controller.close(); assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); } };
}

test("GEO preparation is consented, independently bound, durable before reservation and separate from general local sessions", async () => {
  const f = await fixture(); try {
    const receipt = await f.controller.prepareGeo(f.input); assert.equal(receipt!.sessions.length, 2); assert.equal(f.dispatches(), 0);
    assert.equal(f.reviews[0].totalBudgetMicros, "20000");
    const rows = (await f.controller.list(f.scope, true)).sessions; assert.equal(rows.length, 2); assert.equal((await f.controller.list(f.scope)).sessions.length, 0);
    assert.equal(new Set(rows.map(r => r.workspace)).size, 2); assert.ok(rows.every(r => r.permission === "read-only" && r.phase === "starting"));
    await assert.rejects(f.controller.permission(rows[0].id, "full-access"), { code: "LOCAL_OBSERVATION_PERMISSION_FIXED" });
    await assert.rejects(f.controller.send(rows[0].id, "Replace the measured question", 10000), { code: "GEO_NEW_RUN_REQUIRED" });
    await f.controller.retry(rows[0].id); await f.controller.retry(rows[1].id); assert.equal(f.dispatches(), 2);
    assert.ok(f.bindings.every(b => b.observationProtocol === "codex-desktop-geo-v1" && b.grant.mode === "read-only" && !b.companyTools && !b.browserToolsVersion && !b.programToolsVersion));
    await assert.rejects(f.controller.retry(rows[0].id), { code: "LOCAL_REPLAY_NOT_ALLOWED" });
  } finally { await f.clean(); }
});
test("lost batch admission survives restart and reuses one reservation rather than replacing unknown work", async () => {
  const f = await fixture(); let restored: LocalAgentController | undefined; try {
    f.lose(); await assert.rejects(f.controller.prepareGeo(f.input), /response lost/); assert.equal(f.accepted.size, 1);
    await assert.rejects(f.controller.prepareGeo(f.input), { code: "GEO_LOCAL_RESERVATION_PENDING" });
    const first = f.journal()!.sessions[0]; await f.controller.close(); restored = new LocalAgentController(f.io, f.factory);
    await restored.retry(first.id); assert.equal(f.accepted.size, 1); assert.equal(f.dispatches(), 1);
    const requests = f.calls.filter(c => c.url.endsWith("/desktop-runs")); assert.equal(requests.length, 2);
    assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey); assert.deepEqual(requests[0].body, requests[1].body);
    assert.ok(f.journal()!.sessions.every(r => r.operation?.taskId || r.lastTask?.status === "succeeded"));
  } finally { await restored?.close(); await f.clean(); }
});
test("unknown accepted native GEO is reported once and never restarts a turn; a prepared question can stop without inference", async () => {
  const f = await fixture(); try {
    const receipt = await f.controller.prepareGeo(f.input); f.unknown();
    await assert.rejects(f.controller.retry(receipt!.local_sessions[0]), /outcome unknown/);
    const rows = (await f.controller.list(f.scope, true)).sessions; assert.equal(rows[0].uncertain, true); assert.equal(rows[0].task.status, "reconciling");
    await assert.rejects(f.controller.retry(rows[0].id), { code: "LOCAL_REPLAY_NOT_ALLOWED" });
    await f.controller.stop(rows[1].id); assert.equal(f.dispatches(), 1); assert.equal(f.journal()!.sessions[1].lastTask.status, "cancelled");
    assert.equal(f.calls.filter(c => c.url.endsWith("/finish")).length, 1);
  } finally { await f.clean(); }
});
test("declined or stale-account GEO consent creates no reservation, and native admission stays outside the renderer API", async () => {
  const f = await fixture(); try {
    f.consent(false); assert.equal(await f.controller.prepareGeo(f.input), null); assert.equal(f.accepted.size, 0); assert.equal(f.journal()?.sessions.length ?? 0, 0);
    f.io.geoConsent = async () => { f.actor.epoch = randomUUID(); return true; };
    await assert.rejects(f.controller.prepareGeo(f.input), { code: "LOCAL_ACCOUNT_CHANGED" }); assert.equal(f.accepted.size, 0);
    const base = `/v1/tenants/${f.scope.tenant}/projects/${f.scope.project}/geo/experiments/${f.input.experiment}`;
    assert.equal(rendererApiOperation(base + "/desktop-runs", "POST"), false);
    assert.equal(rendererApiOperation(base + "/desktop-configuration", "GET"), false);
    assert.equal(rendererApiOperation(base + "/runs", "GET"), true);
  } finally { await f.clean(); }
});
