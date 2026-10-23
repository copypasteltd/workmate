import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConversationState, budgetMicros, type ChatIO, type ChatScope } from "../src/conversation.js";

const scope = (): ChatScope => ({ actor: randomUUID(), tenant: randomUUID(), project: randomUUID() });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const store = new Map<string, any>(), receipts = new Map<string, any>(), requests: any[] = [];
  const conversations = new Map<string, any>(), tasks = new Map<string, any>(), agent = randomUUID();
  let lostCreate = false, lostTask = false, rejectTask = false, deniedRead = false;
  const io: ChatIO = {
    read: async key => structuredClone(store.get(key)),
    write: async (key, value) => { store.set(key, structuredClone(value)); },
    changed: () => {},
    upload: async (_scope, file) => ({ name: file.name, version: { id: randomUUID() } }),
    request: async (s, path, method = "GET", body?: any, key?: string) => {
      requests.push(structuredClone({ s, path, method, body, key }));
      if (path.endsWith("/agents")) return { items: [{ id: agent, enabled: true, content_state: "active" }] };
      if (path.endsWith("/conversations") && method === "GET") return { items: [...conversations.values()] };
      if (path.endsWith("/conversations") && method === "POST") {
        if (!receipts.has(key!)) { const c = { id: randomUUID(), agent_id: agent, agent_version: 1, name: body.name, version: 1, messages: [], tasks: [] }; conversations.set(c.id, c); receipts.set(key!, c); }
        if (lostCreate) { lostCreate = false; throw new Error("response lost after commit"); }
        return structuredClone(receipts.get(key!));
      }
      if (path === "/v1/tasks") {
        if (rejectTask) throw Object.assign(new Error("source revoked"), { status: 409 });
        if (!receipts.has(key!)) {
          const t = { id: randomUUID(), status: "queued", content_state: "active", input_context: { canonical_request: { input: body.input } } };
          const c = conversations.get(body.conversation_id); c.tasks.push(t); c.messages.push({ role: "user", body: body.input.prompt, task_id: t.id });
          tasks.set(t.id, t); receipts.set(key!, { task_id: t.id });
        }
        if (lostTask) { lostTask = false; throw new Error("response lost after reservation"); }
        return structuredClone(receipts.get(key!));
      }
      if (path.includes("/conversations/")) { if (deniedRead) throw Object.assign(new Error("permission lost"), { status: 403 }); return structuredClone(conversations.get(path.split("/").at(-1)!)); }
      if (path.includes("/events?")) return { items: [{ id: 1, kind: "message.delta", body: { text: "Actual server fragment" } }] };
      if (path.includes("/tasks/")) return structuredClone(tasks.get(path.split("/").at(-1)!));
      throw new Error("Unexpected operation " + path);
    },
  };
  return { io, store, requests, conversations, tasks, loseCreate: () => { lostCreate = true; }, loseTask: () => { lostTask = true; }, rejectTask: () => { rejectTask = true; }, denyRead: () => { deniedRead = true; } };
}

test("HKD budgets convert exactly and reject exponent, negative, zero and over-limit amounts", () => {
  assert.equal(budgetMicros("9999.99"), "9999990000"); assert.equal(budgetMicros("0.01"), "10000");
  for (const bad of ["0", "-1", "1e3", "20.001", "10000.01", "Infinity", "1,000"]) assert.throws(() => budgetMicros(bad));
});
test("messages bind uploaded immutable versions, never asset IDs or unsent unrelated files", async () => {
  const f = fixture(), s = new ConversationState(f.io), version = randomUUID();
  f.io.upload = async () => ({ id: randomUUID(), version: { id: version } });
  await s.open(scope()); await s.attach(new File(["Approved source"], "brief.txt", { type: "text/plain" }));
  assert.equal(s.attachments[0].state, "ready"); s.draft = "Analyse the attached brief"; await s.send("20.01");
  const task = f.requests.find(r => r.path === "/v1/tasks");
  assert.deepEqual(task.body.input.asset_version_ids, [version]); assert.equal(task.body.budget.amount_micros, "20010000");
  assert.equal(f.tasks.size, 1); assert.equal(s.attachments.length, 0); assert.equal(s.draft, "");
});
test("in-flight or failed uploads block messages; removing an in-flight file does not reattach it", async () => {
  const f = fixture(), s = new ConversationState(f.io), upload = deferred<any>(); f.io.upload = () => upload.promise;
  await s.open(scope()); s.draft = "Use this file";
  const work = s.attach(new File(["content"], "pending.txt"));
  await assert.rejects(s.send("20"), /uploads/); s.removeAttachment(s.attachments[0].id);
  upload.resolve({ version: { id: randomUUID() } }); await work; assert.equal(s.attachments.length, 0);
  f.io.upload = async () => { throw new Error("upload denied"); };
  await s.attach(new File(["content"], "failed.txt")); assert.equal(s.attachments[0].state, "failed");
  await assert.rejects(s.send("20"), /uploads/); assert.equal(f.tasks.size, 0);
});
test("lost conversation response replays its original creation key and creates only one conversation", async () => {
  const f = fixture(), s = new ConversationState(f.io); await s.open(scope()); s.draft = "Draft an ad campaign"; f.loseCreate();
  await assert.rejects(s.send("20"), /lost/); const p = structuredClone(s.pending);
  assert.ok(p); await s.send("99"); assert.equal(f.conversations.size, 1); assert.equal(f.tasks.size, 1);
  const creates = f.requests.filter(r => r.method === "POST" && r.path.endsWith("/conversations"));
  assert.equal(creates.length, 2); assert.equal(creates[0].key, creates[1].key);
  assert.equal(f.requests.find(r => r.path === "/v1/tasks").body.budget.amount_micros, "20000000");
});
test("panel reopening after lost task acceptance preserves body, file versions and key without a second task", async () => {
  const f = fixture(), first = new ConversationState(f.io), selected = scope(); await first.open(selected);
  await first.attach(new File(["approved"], "source.txt")); first.draft = "Read the selected source"; f.loseTask();
  await assert.rejects(first.send("30"), /lost/); const original = structuredClone(first.pending); first.reset();
  const next = new ConversationState(f.io); await next.open(selected); assert.deepEqual(next.pending, original);
  await next.send("900"); assert.equal(f.tasks.size, 1);
  const posts = f.requests.filter(r => r.path === "/v1/tasks"); assert.deepEqual(posts[0].body, posts[1].body); assert.equal(posts[0].key, posts[1].key);
});
test("account/project changes discard old upload completions and bind requests to their original scope", async () => {
  const f = fixture(), s = new ConversationState(f.io), old = scope(), next = scope(), upload = deferred<any>();
  f.io.upload = () => upload.promise; await s.open(old); const work = s.attach(new File(["old"], "old.txt"));
  await s.open(next); upload.resolve({ version: { id: randomUUID() } }); await work;
  assert.deepEqual(s.scope, next); assert.equal(s.attachments.length, 0); assert.equal(s.draft, "");
});
test("old restored conversation cannot overwrite a newly opened account", async () => {
  const f = fixture(), s = new ConversationState(f.io), old = scope(), next = scope(), read = deferred<any>(), id = randomUUID();
  f.store.set(`chat:${old.actor}:${old.tenant}:${old.project}`, { conversationId: id });
  const original = f.io.request; f.io.request = (scope, path, ...rest) => path.endsWith("/conversations/" + id) ? read.promise : original(scope, path, ...rest);
  const opening = s.open(old); await new Promise(r => setImmediate(r)); await s.open(next);
  read.resolve({ id, agent_id: randomUUID(), messages: [{ body: "other account secret" }] }); await opening;
  assert.deepEqual(s.scope, next); assert.equal(s.conversation, null);
});
test("known transactional source rejection preserves the draft and permits correction", async () => {
  const f = fixture(), s = new ConversationState(f.io); await s.open(scope()); s.draft = "Use the retained source"; f.rejectTask();
  await assert.rejects(s.send("20"), /revoked/); assert.equal(s.pending, undefined); assert.equal(s.draft, "Use the retained source"); assert.equal(f.tasks.size, 0);
});
test("active work prevents another paid turn; event batches deduplicate and denied reads clear prior text", async () => {
  const f = fixture(), s = new ConversationState(f.io); await s.open(scope()); s.draft = "Produce a campaign"; await s.send("20");
  s.draft = "Run another paid task"; await assert.rejects(s.send("20"), /current work/);
  await s.refresh(); await s.refresh(); assert.equal(s.progress.events.length, 1);
  f.denyRead(); await assert.rejects(s.refresh(), /permission/); assert.equal(s.unavailable, true); assert.equal(s.conversation.messages.length, 0); assert.equal(s.progress.events.length, 0);
  await assert.rejects(s.send("20"), /Refresh/); assert.equal(f.tasks.size, 1);
});
test("double submit shares a single serialized acceptance flow", async () => {
  const f = fixture(), s = new ConversationState(f.io); await s.open(scope()); s.draft = "One paid action";
  await Promise.all([s.send("20"), s.send("20")]); assert.equal(f.tasks.size, 1); assert.equal(f.conversations.size, 1);
});
test("an HTTP-successful quarantined task also clears retained conversation content", async () => {
  const f = fixture(), s = new ConversationState(f.io); await s.open(scope()); s.draft = "Analyse the launch"; await s.send("20");
  [...f.tasks.values()][0].content_state = "quarantined";
  await assert.rejects(s.refresh(), /sources are unavailable/);
  assert.equal(s.unavailable, true); assert.deepEqual(s.conversation.messages, []);
  assert.equal(s.progress.task, null); assert.equal(s.progress.events.length, 0);
});
