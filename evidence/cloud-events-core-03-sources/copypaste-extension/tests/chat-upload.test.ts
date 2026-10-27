import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrivateChatUploads } from "../src/chat-upload.js";
import type { ChatScope } from "../src/conversation.js";
const scope = (): ChatScope => ({ actor: randomUUID(), tenant: randomUUID(), project: randomUUID() });
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const selected = (bytes = Buffer.from("Approved private campaign source")) => ({ name: "brief.txt", type: "text/plain", base64: bytes.toString("base64") });
function fixture() {
  const store = new Map<string, any>(), sessions = new Map<string, any>(), keys = new Map<string, string>(), calls: any[] = [];
  let lose = "", denied = false, sharedResult = false;
  const io = {
    read: async (key: string) => structuredClone(store.get(key)),
    write: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
    request: async (s: ChatScope, path: string, method = "GET", body?: any, key?: string): Promise<any> => {
      calls.push(structuredClone({ s, path, method, body, key }));
      if (denied) throw Object.assign(new Error("private source access revoked"), { status: 403 });
      const suffix = path.split("/uploads")[1]; assert.notEqual(suffix, undefined, "Never use the project shared asset endpoint");
      if (!suffix && method === "POST") {
        assert.equal(body.project_id, s.project); assert.match(body.conversation_id, /^[a-f0-9-]{36}$/);
        let id = keys.get(key!);
        if (!id) { id = randomUUID(); keys.set(key!, id); sessions.set(id, { id, s, body, parts: new Map(), state: "pending" }); }
        else assert.deepEqual(sessions.get(id).body, body);
        if (lose === "create") { lose = ""; throw new Error("lost creation response after commit"); }
        return { upload_id: id };
      }
      const [, id, action, index] = suffix.split("/"), session = sessions.get(id); assert.ok(session);
      assert.deepEqual(session.s, s);
      if (method === "GET") return { upload_id: id, state: session.state, size_bytes: session.body.size_bytes, sha256: session.body.sha256, part_size_bytes: 4 * 1024 * 1024, parts: [...session.parts.values()].map((p: any) => ({ part_index: p.index, size_bytes: p.bytes.length, sha256: digest(p.bytes) })) };
      if (action === "parts") {
        const bytes = Buffer.from(body.base64, "base64"); assert.equal(body.sha256, digest(bytes));
        session.parts.set(Number(index), { index: Number(index), bytes });
        if (lose === "part") { lose = ""; throw new Error("lost part response after commit"); }
        return { part_index: Number(index), size_bytes: bytes.length, sha256: body.sha256 };
      }
      assert.equal(action, "complete"); assert.equal(body.sha256, session.body.sha256); assert.equal(body.size_bytes, session.body.size_bytes);
      const bytes = Buffer.concat([...session.parts.values()].sort((a: any, b: any) => a.index - b.index).map((p: any) => p.bytes));
      assert.equal(bytes.length, body.size_bytes); assert.equal(digest(bytes), body.sha256);
      session.result ??= { id: randomUUID(), private_owner: s.actor, tenant_id: s.tenant, project_id: s.project, version: { id: randomUUID(), sha256: body.sha256, bytes: body.size_bytes, metadata: { conversation_id: session.body.conversation_id } } };
      session.state = "completed";
      if (lose === "complete") { lose = ""; throw new Error("lost completion response after commit"); }
      return { ...session.result, ...(sharedResult ? { private_owner: null } : {}) };
    },
  };
  return { io, calls, store, sessions, lose: (phase: string) => { lose = phase; }, revoke: () => { denied = true; }, returnShared: () => { sharedResult = true; } };
}

test("exact private attachment re-selection reuses its verified immutable version without a second asset", async () => {
  const f = fixture(), s = scope(), c = randomUUID(), uploader = new PrivateChatUploads(f.io);
  const first = await uploader.upload(s, c, selected()), second = await uploader.upload(s, c, selected());
  assert.deepEqual(second, first); assert.equal(f.sessions.size, 1);
  assert.equal(first.private_owner, s.actor); assert.equal(first.version.metadata.conversation_id, c);
  assert.equal(f.calls.filter(x => x.path.endsWith("/parts/0")).length, 1);
});

test("concurrent selection of identical bytes creates one private upload and one immutable result", async () => {
  const f = fixture(), uploader = new PrivateChatUploads(f.io), s = scope(), c = randomUUID();
  const results = await Promise.all([uploader.upload(s, c, selected()), uploader.upload(s, c, selected())]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.sessions.size, 1);
  assert.equal(f.calls.filter(x => x.path.endsWith("/uploads")).length, 1);
});

test("worker replacement after lost create acceptance replays the original manifest and key", async () => {
  const f = fixture(), s = scope(), c = randomUUID(); f.lose("create");
  await assert.rejects(new PrivateChatUploads(f.io).upload(s, c, selected()), /lost creation/);
  await new PrivateChatUploads(f.io).upload(s, c, selected());
  const creates = f.calls.filter(x => x.path.endsWith("/uploads"));
  assert.equal(f.sessions.size, 1); assert.equal(creates.length, 2); assert.equal(creates[0].key, creates[1].key); assert.deepEqual(creates[0].body, creates[1].body);
});

test("a 5 MiB private file resumes after a committed part response is lost, verifying both real byte ranges", async () => {
  const f = fixture(), s = scope(), c = randomUUID(), bytes = Buffer.alloc(5 * 1024 * 1024, 65); bytes[bytes.length - 1] = 66;
  const file = selected(bytes); f.lose("part");
  await assert.rejects(new PrivateChatUploads(f.io).upload(s, c, file), /lost part/);
  const result = await new PrivateChatUploads(f.io).upload(s, c, file);
  assert.equal(result.version.sha256, digest(bytes)); assert.equal(f.sessions.size, 1);
  const parts = f.calls.filter(x => x.path.includes("/parts/")); assert.equal(parts.length, 2);
  assert.ok(parts[0].path.endsWith("/parts/0")); assert.ok(parts[1].path.endsWith("/parts/1"));
});

test("lost completion resumes the same accepted asset without reuploading or creating another version", async () => {
  const f = fixture(), s = scope(), c = randomUUID(); f.lose("complete");
  await assert.rejects(new PrivateChatUploads(f.io).upload(s, c, selected()), /lost completion/);
  const expected = [...f.sessions.values()][0].result;
  assert.deepEqual(await new PrivateChatUploads(f.io).upload(s, c, selected()), expected);
  assert.equal(f.sessions.size, 1); assert.equal(f.calls.filter(x => x.path.includes("/parts/")).length, 1);
});

test("changing conversation, project, actor or bytes never reuses another private upload receipt", async () => {
  const f = fixture(), uploader = new PrivateChatUploads(f.io), s = scope(), c = randomUUID();
  const cases = [[s, c, selected()], [s, randomUUID(), selected()], [{ ...s, project: randomUUID() }, c, selected()], [{ ...s, actor: randomUUID() }, c, selected()], [s, c, selected(Buffer.from("A different private source"))]] as const;
  for (const [scoped, conversation, file] of cases) await uploader.upload(scoped, conversation, file);
  assert.equal(f.sessions.size, cases.length); assert.equal(f.store.size, cases.length);
});

test("revocation between attempts stops recovery before completion and never falls back to shared upload", async () => {
  const f = fixture(), s = scope(), c = randomUUID(); f.lose("part");
  await assert.rejects(new PrivateChatUploads(f.io).upload(s, c, selected()), /lost part/); f.revoke();
  await assert.rejects(new PrivateChatUploads(f.io).upload(s, c, selected()), /revoked/);
  assert.equal(f.calls.filter(x => x.path.endsWith("/complete")).length, 0); assert.equal(f.sessions.size, 1);
});

test("an HTTP-successful shared result is rejected instead of being presented as a private attachment", async () => {
  const f = fixture(); f.returnShared();
  await assert.rejects(new PrivateChatUploads(f.io).upload(scope(), randomUUID(), selected()), /Private file ownership/);
});

test("invalid scope or file bytes are rejected before any network request or receipt write", async () => {
  const f = fixture(), uploader = new PrivateChatUploads(f.io), s = scope(), c = randomUUID();
  await assert.rejects(uploader.upload({ ...s, actor: "" }, c, selected()));
  for (const file of [{ ...selected(), base64: "" }, { ...selected(), name: "../source.txt" }, { ...selected(), base64: "YWJj====" }, selected(Buffer.alloc(5 * 1024 * 1024 + 1))]) await assert.rejects(uploader.upload(s, c, file));
  assert.equal(f.calls.length, 0); assert.equal(f.store.size, 0);
});
