import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptWorkSubmission, clearWorkDrafts, loadWorkDraft, newWorkDraft, openWorkDraft,
  prepareWorkSubmission, rejectWorkSubmission, removedWorkSubmission, saveWorkDraft, updateWorkDraft,
  saveWorkSelection, workSelection, updateWorkAttachments, durableWorkSubmission, assertWorkScope, type WorkScope } from "../src/work-draft.ts";

const rows = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
  getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value),
  removeItem: (key: string) => rows.delete(key),
} });
const scope = (): WorkScope => ({ user: crypto.randomUUID(), tenant: crypto.randomUUID(), project: crypto.randomUUID() });
const body = () => ({ title: "Approved marketing brief", prompt: "Prepare a bilingual campaign from approved materials", mode: "execute", budget_micros: 20000000, role_key: "designer" });
function draft(s: WorkScope) { return openWorkDraft(s, { role: "designer", prompt: "Private customer product details" }); }

test("customer drafts are isolated by authenticated actor, tenant and project, and a different account removes their text", () => {
  const s = scope(), d = updateWorkDraft(draft(s), { title: "Customer-only brief" });
  assert.equal(loadWorkDraft(s)?.values.title, d.values.title);
  assert.equal(loadWorkDraft({ ...s, user: crypto.randomUUID() }), null);
  assert.equal(loadWorkDraft({ ...s, tenant: crypto.randomUUID() }), null);
  assert.equal(loadWorkDraft({ ...s, project: crypto.randomUUID() }), null);
  clearWorkDrafts(crypto.randomUUID());
  assert.equal(loadWorkDraft(s), null);
  assert.ok(![...rows.values()].some(value => value.includes("Customer-only brief")));
});

test("lost-response recovery retains the exact endpoint, key and parameters while edits and replacement drafts are blocked", async () => {
  const s = scope(), first = await prepareWorkSubmission(draft(s), body());
  const restored = openWorkDraft(s, { role: "fullstack", prompt: "A new shortcut must not replace pending work" });
  assert.deepEqual(restored.pending, first.pending);
  assert.deepEqual((await prepareWorkSubmission(restored, { ...body(), prompt: "Altered" })).pending, first.pending);
  assert.throws(() => updateWorkDraft(restored, { prompt: "Different content" }), /LOCKED/);
  assert.throws(() => newWorkDraft(s), /LOCKED/);
});

test("accepted work is recoverable before navigation, clears its source text, and another explicit task receives a new key", async () => {
  const s = scope(), submitted = await prepareWorkSubmission(draft(s), body());
  const target = "/app/tasks/" + crypto.randomUUID();
  acceptWorkSubmission(submitted, target);
  const receipt = openWorkDraft(s);
  assert.equal(receipt.accepted, target);
  assert.equal(receipt.values.prompt, ""); assert.equal(receipt.pending, undefined);
  const another = newWorkDraft(s, { role: "designer" }); saveWorkDraft(another);
  const next = await prepareWorkSubmission(another, body());
  assert.notEqual(next.pending?.key, submitted.pending?.key);
});

test("explicit sign-out clears plaintext but retains only a digest and key to recover an identical unknown request", async () => {
  const s = scope(), payload = body(), first = await prepareWorkSubmission(draft(s), payload);
  clearWorkDrafts();
  assert.equal(loadWorkDraft(s), null);
  assert.ok([...rows.keys()].some(key => key.startsWith("cp_work_attempt_v1:")));
  assert.ok(![...rows.values()].some(value => value.includes(payload.prompt)));
  assert.equal((await prepareWorkSubmission(draft(s), payload)).pending?.key, first.pending?.key);
});

test("definite validation rejection permits correction; another account and another body cannot reuse the original key", async () => {
  const s = scope(), first = await prepareWorkSubmission(draft(s), body());
  const editable = rejectWorkSubmission(first);
  const edited = updateWorkDraft(editable, { title: "Corrected campaign" });
  const second = await prepareWorkSubmission(edited, { ...body(), title: "Corrected campaign" });
  assert.notEqual(second.pending?.key, first.pending?.key);
  const other = { ...s, user: crypto.randomUUID() };
  assert.notEqual((await prepareWorkSubmission(draft(other), body())).pending?.key, first.pending?.key);
});

test("unknown paid attempts never expire into a fresh task; only unsubmitted text expires after one day", async () => {
  const s = scope(), pending = await prepareWorkSubmission(draft(s), body());
  saveWorkDraft({ ...pending, saved: Date.now() - 86400000 * 20 });
  assert.equal(loadWorkDraft(s)?.pending?.key, pending.pending?.key);
  const other = scope(), editable = draft(other);
  saveWorkDraft({ ...editable, saved: Date.now() - 86400000 * 2 });
  assert.equal(loadWorkDraft(other), null);
});

test("corrupt or cross-project stored requests fail closed rather than silently creating paid work", async () => {
  const s = scope(), pending = await prepareWorkSubmission(draft(s), body());
  const key = [...rows.keys()].find(key => key.startsWith("cp_work_draft_v1:") && key.includes(s.user))!;
  rows.set(key, JSON.stringify({ ...pending, pending: { ...pending.pending, endpoint: pending.pending!.endpoint.replace(s.project, crypto.randomUUID()) } }));
  assert.throws(() => openWorkDraft(s), /INVALID/);
  rows.set(key, "{invalid"); assert.throws(() => openWorkDraft(s), /INVALID/);
});

test("a draft replaced during async preparation cannot be resurrected or submitted", async () => {
  const s = scope(), old = draft(s), preparing = prepareWorkSubmission(old, body());
  const next = newWorkDraft(s); saveWorkDraft(next);
  await assert.rejects(preparing, /WORK_DRAFT_CHANGED/);
  assert.equal(loadWorkDraft(s)?.id, next.id);
  acceptWorkSubmission(old, "/app/tasks/" + crypto.randomUUID());
  assert.equal(loadWorkDraft(s)?.id, next.id);
});

test("a confirmed removed response preserves the non-reexecution result and permits an explicit new intent", async () => {
  const s = scope(), pending = await prepareWorkSubmission(draft(s), body());
  removedWorkSubmission(pending);
  const removed = openWorkDraft(s);
  assert.equal(removed.removed, true); assert.equal(removed.pending, undefined); assert.equal(removed.values.prompt, "");
  const next = newWorkDraft(s, { role: "designer" }); saveWorkDraft(next);
  assert.notEqual((await prepareWorkSubmission(next, body())).pending?.key, pending.pending?.key);
});

test("disabled session storage preserves editable text but blocks paid submission before dispatch", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")!;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  try {
    const s = scope(), d = draft(s);
    assert.equal(saveWorkDraft(d), false);
    await assert.rejects(prepareWorkSubmission(d, body()), /WORK_STORAGE_REQUIRED/);
    assert.equal(openWorkDraft(s).values.prompt, d.values.prompt);
  } finally { Object.defineProperty(globalThis, "sessionStorage", original); }
});

test("expired-login display preferences retain the original actor scope and explicit sign-out clears them", () => {
  const s = scope(); saveWorkSelection(s);
  assert.deepEqual(workSelection(s.user), s);
  assert.equal(workSelection(crypto.randomUUID()), null);
  clearWorkDrafts(s.user); assert.deepEqual(workSelection(s.user), s);
  clearWorkDrafts(); assert.equal(workSelection(s.user), null);
});


test("pinned attachments persist with the original request and cannot be changed after preparation", async () => {
  const s=scope(),file={id:crypto.randomUUID(),assetId:crypto.randomUUID(),name:"private-brief-203.txt"};
  const d=updateWorkAttachments(draft(s),[file]);assert.deepEqual(loadWorkDraft(s)?.attachments,[file]);
  const b={...body(),dependencies:[{kind:"file",description:"Explicit materials",resource_ids:[file.id]}]};
  const p=await prepareWorkSubmission(d,b);assert.deepEqual(openWorkDraft(s).pending?.body,b);
  assert.throws(()=>updateWorkAttachments(p,[]),/LOCKED/);
  assert.deepEqual((await prepareWorkSubmission(p,{...b,prompt:"Do not replace unknown work"})).pending,p.pending);
  const accepted=acceptWorkSubmission(p,"/app/tasks/"+crypto.randomUUID());assert.equal(accepted.attachments,undefined);
  assert.ok(!JSON.stringify(loadWorkDraft(s)).includes(file.name));
});
test("attachments changed during asynchronous preparation invalidate the entire pending request", async()=>{
  const s=scope(),d=draft(s),pending=prepareWorkSubmission(d,body()),file={id:crypto.randomUUID(),assetId:crypto.randomUUID(),name:"later.txt"};
  updateWorkAttachments(d,[file]);await assert.rejects(pending,/WORK_DRAFT_CHANGED/);assert.deepEqual(loadWorkDraft(s)?.attachments,[file]);
});
test("a stale pending component cannot overwrite a newer accepted work receipt", async()=>{
  const s=scope(),p=await prepareWorkSubmission(draft(s),body()),destination="/app/tasks/"+crypto.randomUUID();
  acceptWorkSubmission(p,destination);assert.throws(()=>durableWorkSubmission(p),/WORK_DRAFT_CHANGED/);assert.equal(loadWorkDraft(s)?.accepted,destination);
});
test("a storage outage during replay preserves the original unknown request and never changes its key", async()=>{
  const s=scope(),p=await prepareWorkSubmission(draft(s),body()),original=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage")!;
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,get(){throw Error("Storage unavailable");}});
  try{await assert.rejects(prepareWorkSubmission(p,body()),/WORK_STORAGE_REQUIRED/);assert.equal(loadWorkDraft(s)?.pending?.key,p.pending?.key);}
  finally{Object.defineProperty(globalThis,"sessionStorage",original);}
  assert.deepEqual(durableWorkSubmission(p).pending,p.pending);
});
test("a store that silently drops the paid request is rejected by exact readback", async()=>{
  const s=scope(),d=draft(s),original=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage")!,store=original.value;
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{...store,setItem(){}}});
  try{await assert.rejects(prepareWorkSubmission(d,body()),/WORK_STORAGE_REQUIRED/);}
  finally{Object.defineProperty(globalThis,"sessionStorage",original);}
  assert.equal(loadWorkDraft(s)?.pending,undefined);
});
test("scope checks reject another account, company or project while retaining the original draft",()=>{
  const s=scope(),d=draft(s);assert.doesNotThrow(()=>assertWorkScope(d,s));
  for(const key of ["user","tenant","project"] as const)assert.throws(()=>assertWorkScope(d,{...s,[key]:crypto.randomUUID()}),/WORK_SCOPE_CHANGED/);
  assert.equal(loadWorkDraft(s)?.id,d.id);
});
test("attachment metadata is bounded, distinct and copied rather than retained by mutable reference",()=>{
  const s=scope(),d=draft(s),file={id:crypto.randomUUID(),assetId:crypto.randomUUID(),name:"before.txt"};
  const next=updateWorkAttachments(d,[file]);file.name="modified.txt";assert.equal(next.attachments?.[0].name,"before.txt");
  assert.throws(()=>updateWorkAttachments(next,[file,file]),/WORK_ATTACHMENTS_INVALID/);
  assert.throws(()=>updateWorkAttachments(next,Array.from({length:21},()=>({...file,id:crypto.randomUUID()}))),/WORK_ATTACHMENTS_INVALID/);
  assert.throws(()=>updateWorkAttachments(next,[{...file,id:"not-a-version"}]),/WORK_ATTACHMENTS_INVALID/);
});
test("legacy drafts without attachment metadata still restore and retain their original paid identity",async()=>{
  const s=scope(),d=draft(s);delete d.attachments;saveWorkDraft(d);
  assert.equal(openWorkDraft(s).attachments,undefined);const p=await prepareWorkSubmission(d,body());assert.equal(openWorkDraft(s).pending?.key,p.pending?.key);
});
