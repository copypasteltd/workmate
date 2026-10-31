import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConversationState, type ChatIO, type ChatScope } from "../src/conversation.js";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const scope: ChatScope = { actor: randomUUID(), tenant: randomUUID(), project: randomUUID() }, task = { id: randomUUID(), status: "needs_input", content_state: "active" };
  const dependency = { id: randomUUID(), task_id: task.id, version: 1, kind: "question", state: "pending", description: "Which audience?", question_options: ["Retail", "Finance"] };
  const conversation = { id: randomUUID(), messages: [{ role: "assistant", body: "Please confirm the audience." }], tasks: [task] };
  const requests: any[] = []; let denied = false, gate: Promise<unknown> | undefined;
  const io: ChatIO = { read: async () => null, write: async () => {}, upload: async () => { throw new Error("Not an upload"); }, changed: () => {},
    request: async (s, path, method = "GET", body, key) => {
      requests.push({ scope: s, path, method, body, key });
      if (method === "POST") { if (gate) await gate; task.status = "queued"; return structuredClone(task); }
      if (path.endsWith("/project-configuration")) return { published: null };
      if (path.includes("/conversations/")) return structuredClone(conversation);
      if (path.endsWith("/dependencies")) { if (denied) throw new Error("Input source revoked"); return { items: [structuredClone(dependency)] }; }
      if (path.includes("/events?")) return { items: [] };
      if (path.endsWith("/tasks/" + task.id)) return structuredClone(task);
      throw new Error("Unexpected test operation");
    } };
  const state = new ConversationState(io); state.scope = scope; state.conversation = structuredClone(conversation);
  return { state, task, scope, conversation, dependency, requests, deny: () => { denied = true; }, hold: (p: Promise<unknown>) => { gate = p; } };
}
test("cloud clarification loads inside the current chat and a free answer retains its original task and project scope", async () => {
  const f = fixture(); await f.state.refresh(); assert.equal(f.state.inputRequests[0].id, f.dependency.id);
  await f.state.answerInput(f.dependency.id, 1, "Hong Kong retail founders");
  const writes = f.requests.filter(r => r.method === "POST"); assert.equal(writes.length, 1); assert.equal(writes[0].scope, f.scope);
  assert.deepEqual(writes[0].body, { expected_version: 1, answer: "Hong Kong retail founders" }); assert.ok(writes[0].path.endsWith(f.dependency.id + "/resolutions")); assert.ok(writes[0].key);
  assert.equal(f.state.progress.task.id, f.task.id); assert.equal(f.state.progress.task.status, "queued"); assert.deepEqual(f.state.inputRequests, []);
});
test("stale, resource and nonwaiting inputs cannot use the business-answer operation", async () => {
  const f = fixture(); await f.state.refresh(); await assert.rejects(f.state.answerInput(f.dependency.id, 9, "stale"));
  f.state.inputRequests[0].kind = "file"; await assert.rejects(f.state.answerInput(f.dependency.id, 1, "wrong type"));
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
});
test("revoked dependency reads remove the protected questions and conversation text", async () => {
  const f = fixture(); await f.state.refresh(); f.deny(); await assert.rejects(f.state.refresh(), /revoked/);
  assert.equal(f.state.unavailable, true); assert.deepEqual(f.state.inputRequests, []); assert.deepEqual(f.state.conversation.messages, []);
});
test("a delayed answer from an old identity cannot reload questions or results into the new scope", async () => {
  const f = fixture(); await f.state.refresh(); const gate = deferred<void>(); f.hold(gate.promise);
  const pending = f.state.answerInput(f.dependency.id, 1, "Original answer"); const count = f.requests.length;
  f.state.reset(); f.state.scope = { actor: randomUUID(), tenant: randomUUID(), project: randomUUID() }; gate.resolve(); await pending;
  assert.equal(f.requests.length, count); assert.deepEqual(f.state.inputRequests, []); assert.equal(f.state.conversation, null); assert.equal(f.state.progress.task, null);
});
