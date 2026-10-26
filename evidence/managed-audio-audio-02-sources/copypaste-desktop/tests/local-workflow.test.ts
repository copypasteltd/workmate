import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { executeLocalWorkflow, type NativeWorkflowIO } from "../src/local-workflow.js";

const canonical = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
const hash = (v: any) => createHash("sha256").update(canonical(v)).digest("hex");
const clone = <T>(v: T): T => structuredClone(v);
function fixture() {
  const definition = { steps: [
    { kind: "codex", role_key: "fullstack", prompt: "Write the authorized local checklist.", budget_micros: 100001 },
    { kind: "approval", message: "Approve this exact checklist before the QA step." },
    { kind: "codex", role_key: "software-qa", prompt: "Read and verify the exact local checklist.", budget_micros: 200001 },
  ] };
  let current: any = { id: randomUUID(), workflow_id: randomUUID(), version: 3, revision: 1, state: "running", cursor: 0,
    authorized: false, execution_location: "desktop", definition, results: [] };
  const initial = { run: clone(current), definition_hash: hash(definition), step_budget_micros: 300002,
    customer_confirmation_required: true, budget_excludes_current_consultant: true };
  const calls: any[] = [], questions: any[] = [], children: any[] = [], events: any[] = [];
  const abort = new AbortController(); let choice = "批准 / Approve", authorized = true, afterAdvance: ((value: any) => any) | undefined;
  let childFailure: Error | undefined, childDone = false, oldChildId = "";
  const io: NativeWorkflowIO = { base: "/native-parent", threadId: "parent-native-thread", turnId: "parent-native-turn", signal: abort.signal,
    authorize: async () => { if (!authorized) throw new Error("WITHDRAWN"); },
    read: async () => ({ run: clone(current) }),
    ask: async (request, signal, authorize) => {
      await authorize(); assert.equal(signal.aborted, false); questions.push(clone(request));
      return { workflow_decision: { answers: [choice] } };
    },
    event: async value => { events.push(clone(value)); },
    child: async (child, run) => {
      assert.equal(questions.length, run.cursor === 0 ? 1 : 2, "A native child cannot launch before the required human decisions");
      children.push(clone(child)); if (childFailure) throw childFailure; childDone = true;
    },
    request: async (url, body: any, key) => {
      calls.push({ url, body: clone(body), key }); assert.equal(body.expected_revision, current.revision);
      if (url.endsWith("/decision")) {
        assert.equal(body.definition_hash, initial.definition_hash);
        current.revision++;
        if (body.decision === "cancel") current.state = "cancelled";
        else if (body.stage === "launch") current.authorized = true;
        else { assert.equal(current.state, "awaiting_approval"); current.state = "running"; current.cursor++; }
        return { run: clone(current) };
      }
      assert.ok(url.endsWith("/advance"));
      let result: any;
      if (childDone) {
        current.results.push({ kind: "codex", task_id: oldChildId, status: "succeeded", charged_micros: "12" });
        current.cursor++; current.revision++; childDone = false;
      }
      if (current.cursor === 1) {
        current.state = "awaiting_approval"; current.revision++;
        result = { action: "approval", message: definition.steps[1].message, run: clone(current) };
      } else if (current.cursor === 3) {
        current.state = "succeeded"; current.revision++;
        result = { action: "terminal", run: clone(current) };
      } else {
        oldChildId = randomUUID(); current.revision++;
        result = { action: "codex", run: clone(current), child: { task_id: oldChildId, role_key: definition.steps[current.cursor].role_key,
          fields: { device_id: randomUUID(), local_session_id: randomUUID(), workspace_hash: "a".repeat(64), runtime_sha256: "b".repeat(64), runtime_version: "pinned-fixture" } } };
      }
      return afterAdvance ? afterAdvance(result) : result;
    },
  };
  return { io, initial, calls, questions, children, events, abort, current: () => current,
    choose: (v: string) => { choice = v; }, withdraw: () => { authorized = false; },
    failChild: () => { childFailure = new Error("UNKNOWN_CHILD_OUTCOME"); },
    alter: (fn: (value: any) => any) => { afterAdvance = fn; } };
}

test("native workflow requires separate exact fee consent and concrete human approval before the corresponding local children", async () => {
  const f = fixture(), result = await executeLocalWorkflow(f.io, f.initial);
  assert.equal(result.run.state, "succeeded"); assert.equal(f.children.length, 2); assert.equal(f.questions.length, 2);
  assert.match(f.questions[0].questions[0].question, /HK\$ 0\.300002/);
  assert.match(f.questions[0].questions[0].question, /HK\$ 0\.100001/);
  assert.ok(f.questions[0].questions[0].question.includes(f.initial.definition_hash));
  assert.ok(f.questions[1].questions[0].question.includes(f.initial.run.definition.steps[1].message!));
  assert.deepEqual(f.children.map(child => child.role_key), ["fullstack", "software-qa"]);
  assert.equal(f.events.at(-1).charged_micros, "24"); assert.equal(result.automatically_replayed, false);
});

test("declining native workflow fees creates no child or automatic retry", async () => {
  const f = fixture(); f.choose("取消流程 / Cancel workflow");
  const result = await executeLocalWorkflow(f.io, f.initial);
  assert.equal(result.run.state, "cancelled"); assert.equal(f.children.length, 0); assert.equal(f.calls.length, 1);
});

test("a native workflow rejects already authorized receipts and fabricated cost totals before asking or executing", async () => {
  for (const change of [(v: any) => { v.run.authorized = true; }, (v: any) => { v.step_budget_micros = 1; },
    (v: any) => { v.definition_hash = "0".repeat(64); }, (v: any) => { v.run.execution_location = "cloud"; }]) {
    const f = fixture(); change(f.initial);
    await assert.rejects(executeLocalWorkflow(f.io, f.initial));
    assert.equal(f.questions.length, 0); assert.equal(f.children.length, 0); assert.equal(f.calls.length, 0);
  }
});

test("native workflow frozen definitions and child-role boundaries are rechecked before launch", async () => {
  for (const mutate of [(v: any) => { v.run.definition.steps[0].prompt = "Replace the consented work"; },
    (v: any) => { v.child.role_key = "workflow-consultant"; }, (v: any) => { v.run.id = randomUUID(); },
    (v: any) => { v.run.revision = 0; }]) {
    const f = fixture(); f.alter(v => { mutate(v); return v; });
    await assert.rejects(executeLocalWorkflow(f.io, f.initial)); assert.equal(f.children.length, 0);
  }
});

test("unknown native child results never advance to another paid step or retry the child", async () => {
  const f = fixture(); f.failChild();
  await assert.rejects(executeLocalWorkflow(f.io, f.initial), /UNKNOWN_CHILD_OUTCOME/);
  assert.equal(f.children.length, 1); assert.equal(f.calls.filter(v => v.url.endsWith("/advance")).length, 1);
});

test("withdrawing native authority after consent prevents a queued child from executing", async () => {
  const f = fixture(); f.alter(v => { f.withdraw(); return v; });
  await assert.rejects(executeLocalWorkflow(f.io, f.initial), /WITHDRAWN/); assert.equal(f.children.length, 0);
});

test("an external workflow cancellation invalidates a pending human card and sends no stale approval", async () => {
  const f = fixture();
  f.io.ask = async (_request, signal) => {
    f.current().revision++; f.current().state = "cancelled";
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("CARD_WITHDRAWN")), { once: true }));
  };
  await assert.rejects(executeLocalWorkflow(f.io, f.initial), /CARD_WITHDRAWN/);
  assert.equal(f.calls.length, 0); assert.equal(f.children.length, 0);
});

test("stopping a native approval wait closes its watcher and never sends a decision", async () => {
  const f = fixture();
  f.io.ask = async (_request, signal) => {
    setTimeout(() => f.abort.abort(), 10);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("STOPPED")), { once: true }));
  };
  await assert.rejects(executeLocalWorkflow(f.io, f.initial), /STOPPED/); assert.equal(f.calls.length, 0); assert.equal(f.children.length, 0);
});
