"""Prepare the complete original draft suite plus meaningful new boundary cases, before testing."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];web=root/'dev/copypaste-web';old=web/'tests/work-draft.test.ts';new=web/'tests/work-draft-203-v1.test.ts';assert not new.exists()
text=old.read_text('utf8').replace('  saveWorkSelection, workSelection, type WorkScope','  saveWorkSelection, workSelection, updateWorkAttachments, durableWorkSubmission, assertWorkScope, type WorkScope')
text=text.replace('test("disabled session storage retains a page-local retry without claiming reload persistence"','test("disabled session storage preserves editable text but blocks paid submission before dispatch"')
text=text.replace('    const submitted = await prepareWorkSubmission(d, body());\n    assert.equal(openWorkDraft(s).pending?.key, submitted.pending?.key);','    await assert.rejects(prepareWorkSubmission(d, body()), /WORK_STORAGE_REQUIRED/);\n    assert.equal(openWorkDraft(s).values.prompt, d.values.prompt);')
assert text!=old.read_text('utf8');text+='''

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
'''
new.write_text(text,encoding='utf8',newline='\n')
p=web/'package.json';value=json.loads(p.read_text('utf8'));assert value['scripts']['test']=='npm run typecheck && node --import tsx --test tests/*.test.ts';value['scripts']['test']='npm run typecheck && node scripts/run-current-tests-203-v1.mjs';p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'complete_original_suite_carried_forward_with_boundaries','original_test_unchanged':True}))
