import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { reviewFolder, selectFolderEntry, folderManifest, type FolderFile } from "../src/folder-import.js";
import { FolderTransfer } from "../src/folder-transfer.js";
import { ConversationState, type ChatIO } from "../src/conversation.js";

function file(path: string, text = "selected bytes") {
  const f = new File([text], path.split("/").at(-1)!, { type: "text/plain" });
  Object.defineProperty(f, "webkitRelativePath", { value: path }); return f as File & FolderFile;
}
function fixture() {
  const scope = { actor: randomUUID(), tenant: randomUUID(), project: randomUUID() }, agent = randomUUID();
  const uploads: { file: File; conversation: string; asset: any; text: string }[] = [], tasks: any[] = [];
  const io: ChatIO = {
    read: async () => null, write: async () => {}, changed: () => {},
    request: async (s, path, method, body: any) => {
      if (path.endsWith("/project-configuration")) return { published: null };
      if (path.endsWith("/agents")) return { items: [] };
      if (path.endsWith("/conversations") && method !== "POST") return { items: [] };
      if (path.endsWith("/conversations")) return { id: randomUUID(), agent_id: agent, tenant_id: s.tenant, project_id: s.project, created_by: s.actor, ...body };
      if (path === "/v1/tasks") { tasks.push(body); return { task_id: randomUUID() }; }
      if (path.includes("/conversations/")) return { id: path.split("/").at(-1), messages: [], tasks: [] };
      throw new Error("unexpected request " + path);
    },
    upload: async (_s, f, conversation) => {
      const bytes = Buffer.from(await f.arrayBuffer());
      const asset = { id: randomUUID(), version: { id: randomUUID(), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length } };
      uploads.push({ file: f, conversation, asset, text: bytes.toString() }); return asset;
    },
  };
  const chat = new ConversationState(io), transfer = new FolderTransfer(chat, () => {});
  return { scope, chat, transfer, io, uploads, tasks };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

test("review does not read file bytes or upload, reserves the index slot and starts generated/hidden paths unchecked", async () => {
  let reads = 0; const f = file("Brand/copy/brief.txt"); f.arrayBuffer = async () => { reads++; return new ArrayBuffer(1); };
  const x = fixture(); await x.chat.open(x.scope);
  x.transfer.choose([f, file("Brand/.env"), file("Brand/node_modules/a.js"), file("Brand/dist/out.js")]);
  assert.equal(reads, 0); assert.equal(x.uploads.length, 0); assert.equal(x.chat.conversation, null);
  assert.deepEqual(x.transfer.current!.entries.filter(e => e.selected).map(e => e.relativePath), ["copy/brief.txt"]);
  assert.equal(x.transfer.current!.capacity, 19);
  x.transfer.cancel(); assert.equal(x.chat.attachments.length, 0); assert.equal(reads, 0);
});
test("relative-path validation rejects traversal, absolute/Windows paths, multiple roots, duplicates and malformed files", () => {
  for (const bad of ["/Brand/a.txt", "Brand/../a.txt", "Brand/./a.txt", "Brand//a.txt", "C:/Brand/a.txt", "Brand/sub:a/a.txt", "Brand\\a.txt", "Brand/\u0000a.txt", "a.txt", "Brand/" + "a/".repeat(14) + "a.txt"])
    assert.throws(() => reviewFolder([file(bad)]), /folder|path/);
  assert.throws(() => reviewFolder([file("One/a.txt"), file("Two/b.txt")]));
  assert.throws(() => reviewFolder([file("One/a.txt"), file("One/a.txt")]));
  for (const size of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => reviewFolder([{ ...file("One/a.txt"), name: "a.txt", webkitRelativePath: "One/a.txt", type: "text/plain", size } as FolderFile]));
});
test("selection enforces capacity, allows explicit hidden-file selection and never selects empty or oversize files", () => {
  const huge = file("Root/huge.txt"); Object.defineProperty(huge, "size", { value: 5 * 1024 * 1024 + 1 });
  const plan = reviewFolder([file("Root/a.txt"), file("Root/b.txt"), file("Root/.env"), file("Root/empty.txt", ""), huge], 3);
  assert.equal(plan.entries.filter(e => e.selected).length, 2);
  const hidden = plan.entries.find(e => e.relativePath === ".env")!, first = plan.entries.find(e => e.relativePath === "a.txt")!;
  assert.throws(() => selectFolderEntry(plan, hidden.id, true), /up to 2/);
  selectFolderEntry(plan, first.id, false); selectFolderEntry(plan, hidden.id, true); assert.equal(hidden.selected, true);
  for (const e of plan.entries.filter(e => e.unavailable)) assert.throws(() => selectFolderEntry(plan, e.id, true));
  assert.throws(() => reviewFolder([], 20)); assert.throws(() => reviewFolder(Array.from({ length: 1001 }, (_, i) => file(`Root/${i}.txt`))));
  assert.throws(() => reviewFolder([file("Root/a.txt")], 1));
});
test("same basenames retain independent relative paths and bounded Unicode upload names", () => {
  const root = "香港".repeat(30), name = "😀".repeat(100) + ".txt";
  const plan = reviewFolder([file(`${root}/a/${name}`), file(`${root}/b/${name}`)]);
  assert.notEqual(plan.entries[0].uploadName, plan.entries[1].uploadName);
  for (const e of plan.entries) { assert.ok(e.uploadName.length <= 180); assert.equal(Buffer.from(e.uploadName).toString(), e.uploadName); }
});
test("explicit confirm creates exact private versions plus JSON index without sending a task", async () => {
  const x = fixture(); await x.chat.open(x.scope); x.transfer.choose([file("Brand/copy/brief.txt", "Approved copy"), file("Brand/ads/brief.txt", "Ad data")]);
  await x.transfer.start(); assert.equal(x.transfer.phase, "ready"); assert.equal(x.chat.importing, false);
  assert.equal(x.uploads.length, 3); assert.equal(x.tasks.length, 0); assert.equal(x.chat.attachments.length, 3);
  const index = JSON.parse(x.uploads[2].text); assert.equal(index.protocol, "copypaste.selected-folder.v1");
  assert.deepEqual(index.files.map((v: any) => v.relative_path), ["ads/brief.txt", "copy/brief.txt"]);
  for (const [i, row] of index.files.entries()) { assert.equal(row.asset_version_id, x.uploads[i].asset.version.id); assert.equal(row.sha256, x.uploads[i].asset.version.sha256); }
  assert.equal(new Set(x.uploads.map(u => u.conversation)).size, 1);
  x.transfer.cancel(); assert.equal(x.chat.attachments.length, 3, "closing success keeps the customer's selected attachments");
  x.chat.draft = "Read the index and its files"; await x.chat.send("20");
  assert.deepEqual(x.tasks[0].input.asset_version_ids, x.uploads.map(u => u.asset.version.id));
});
test("a failed file retries the same immutable File and chip, skips completed files and never starts a partial task", async () => {
  const x = fixture(); await x.chat.open(x.scope);
  const original = x.io.upload, tries: File[] = []; let failed = false;
  x.io.upload = async (s, f, c) => { tries.push(f); if (!failed && f.name.endsWith("b.txt")) { failed = true; throw new Error("network lost"); } return original(s, f, c); };
  x.transfer.choose([file("Root/a.txt"), file("Root/b.txt")]); await x.transfer.start();
  assert.equal(x.transfer.phase, "failed"); assert.equal(x.transfer.completed, 1); assert.equal(x.chat.attachments.length, 2);
  const failedId = x.chat.attachments[1].id; x.chat.draft = "Use files";
  await assert.rejects(x.chat.send("20"), /folder upload/); assert.equal(x.tasks.length, 0);
  await assert.rejects(x.chat.select(""), /folder/); await assert.rejects(x.chat.attach(file("Root/extra.txt")), /folder/);
  x.chat.removeAttachment(failedId); assert.equal(x.chat.attachments.length, 2);
  await x.transfer.start(); assert.equal(x.transfer.phase, "ready"); assert.equal(x.chat.attachments.length, 3);
  assert.equal(x.chat.attachments[1].id, failedId); assert.equal(tries[1], tries[2]);
  assert.equal(tries.filter(f => f.name.endsWith("a.txt")).length, 1);
});
test("index failure retains all files, retries only the identical index and blocks Send until it is verified", async () => {
  const x = fixture(); await x.chat.open(x.scope); const original = x.io.upload, indexes: File[] = []; let fail = true;
  x.io.upload = async (s, f, c) => { if (f.type === "application/json") { indexes.push(f); if (fail) { fail = false; throw new Error("index response lost"); } } return original(s, f, c); };
  x.transfer.choose([file("Root/a.txt")]); await x.transfer.start(); assert.equal(x.transfer.phase, "failed");
  await assert.rejects(x.chat.send("20"), /folder/); await x.transfer.start();
  assert.equal(x.transfer.phase, "ready"); assert.equal(indexes[0], indexes[1]); assert.equal(x.uploads.length, 2);
});
test("wrong size/hash or incomplete upload receipts cannot produce a ready folder index", async () => {
  for (const change of [(a: any) => { a.version.bytes++; }, (a: any) => { a.version.sha256 = "f".repeat(64); }, (a: any) => { delete a.id; }]) {
    const x = fixture(); await x.chat.open(x.scope); const original = x.io.upload;
    x.io.upload = async (...args) => { const a = await original(...args); change(a); return a; };
    x.transfer.choose([file("Root/a.txt")]); await x.transfer.start();
    assert.equal(x.transfer.phase, "failed"); assert.equal(x.uploads.length, 1); assert.equal(x.chat.attachments[0].state, "failed");
    await assert.rejects(x.chat.send("20"), /folder/);
  }
});
test("account change during a byte read clears the old review and never uploads it to either account", async () => {
  const x = fixture(); await x.chat.open(x.scope); const read = deferred<ArrayBuffer>();
  const f = file("Root/a.txt"); f.arrayBuffer = () => read.promise;
  x.transfer.choose([f]); const work = x.transfer.start();
  await x.chat.open({ ...x.scope, actor: randomUUID() }); assert.equal(x.transfer.current, undefined);
  read.resolve(new TextEncoder().encode("old").buffer); await work;
  assert.equal(x.uploads.length, 0); assert.equal(x.chat.attachments.length, 0); assert.equal(x.chat.importing, false);
});
test("cancel or scope change during upload ignores late success and preserves unrelated attachments", async () => {
  for (const switchAccount of [false, true]) {
    const x = fixture(); await x.chat.open(x.scope); await x.chat.attach(file("Root/existing.txt"));
    const upload = deferred<any>(), started = deferred<void>(); x.io.upload = async () => { started.resolve(); return upload.promise; };
    x.transfer.choose([file("Root/a.txt"), file("Root/b.txt")]); const work = x.transfer.start(); await started.promise;
    if (switchAccount) { await x.chat.open({ ...x.scope, actor: randomUUID() }); assert.equal(x.transfer.current, undefined); }
    else x.transfer.cancel();
    upload.resolve({ id: randomUUID(), version: { id: randomUUID(), sha256: "a".repeat(64), bytes: 14 } }); await work;
    assert.equal(x.chat.attachments.length, switchAccount ? 0 : 1); assert.equal(x.chat.importing, false); assert.equal(x.tasks.length, 0);
  }
});
test("review is invalidated by changing conversation; final capacity is rechecked at confirmation", async () => {
  const x = fixture(); await x.chat.open(x.scope); x.transfer.choose([file("Root/a.txt")]);
  await x.chat.select(randomUUID()); assert.equal(x.transfer.current, undefined);
  await x.chat.attach(file("Root/first.txt"));
  x.transfer.choose(Array.from({ length: 18 }, (_, i) => file(`Root/${i}.txt`)));
  await x.chat.attach(file("Root/other.txt")); await assert.rejects(x.transfer.start(), /attachment limit/);
  assert.equal(x.uploads.length, 2); assert.equal(x.chat.importing, false);
});
test("manifest refuses missing, duplicated and substituted immutable upload receipts", () => {
  const plan = reviewFolder([file("Root/a.txt"), file("Root/b.txt")]);
  const valid = plan.entries.map(e => ({ relativePath: e.relativePath, uploadName: e.uploadName, assetId: randomUUID(), versionId: randomUUID(), sha256: "a".repeat(64), bytes: e.file.size }));
  assert.equal(folderManifest(plan, valid).files.length, 2);
  assert.throws(() => folderManifest(plan, valid.slice(1)));
  assert.throws(() => folderManifest(plan, [valid[0], valid[0]]));
  assert.throws(() => folderManifest(plan, [valid[0], { ...valid[1], versionId: valid[0].versionId }]));
  assert.throws(() => folderManifest(plan, [valid[0], { ...valid[1], uploadName: "another-file.txt" }]));
});
