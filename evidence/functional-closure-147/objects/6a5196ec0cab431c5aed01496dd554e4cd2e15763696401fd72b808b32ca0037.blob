import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {s,fixture,handoff,request,admission,admitted,completed,asset,returned,ok,call,videoActor} from "./task-local-handoff-fixture-147-v2.js";

test("offline request persists without creating or charging a native task; inbox is owner scoped",async()=>{
  const f=await fixture(),h=await handoff(f);
  assert.equal(h.state,"waiting");assert.equal(h.native_task_id,null);assert.equal(h.os_permission_required,true);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE project_id=$1 AND execution_location='desktop'",[f.project])).rows[0].n,0);
  const inbox=await ok(s,f.c,"GET",f.base+"/local-handoffs");assert.equal(inbox.items[0].id,h.id);
  assert.equal((await ok(s,f.web,"GET",f.base+"/tasks/"+f.task.id)).status,"needs_input");
});
test("parallel web requests and lost responses retain one handoff and conflicting fees do not overwrite it",async()=>{
  const f=await fixture(),key=randomUUID();
  const [a,b]=await Promise.all([ok(s,f.web,"POST",f.requestURL,request(f),key),ok(s,f.web,"POST",f.requestURL,request(f),key)]);
  assert.equal(a.id,b.id);assert.equal((await handoff(f)).id,a.id);
  assert.equal((await call(s,f.web,"POST",f.requestURL,{...request(f),budget_micros:200000})).status,409);
});
test("one native admission is bound to a fixed device/workspace/family; changed keys cannot duplicate execution",async()=>{
  const f=await fixture(),h=await handoff(f),body=admission(f,h),key=randomUUID();
  const a=await ok(s,f.c,"POST",f.base+"/desktop-executions",body,key),b=await ok(s,f.c,"POST",f.base+"/desktop-executions",body,key);
  assert.equal(a.task_id,b.task_id);assert.equal((await admitted(f,h)).task_id,a.task_id);
  const other=await call(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h,{local_session_id:randomUUID()}));assert.equal(other.status,409);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE input_context->>'local_handoff_id'=$1",[h.id])).rows[0].n,1);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1",[a.task_id])).rows[0].n,0);
});
test("ordinary web authorization cannot start local work and altered prompt/role/fees are rejected",async()=>{
  const f=await fixture(),h=await handoff(f);
  assert.equal((await call(s,f.web,"POST",f.base+"/desktop-executions",admission(f,h))).status,403);
  for(const extra of [{prompt:h.prompt+" altered"},{role_key:"frontend"},{budget_micros:200000},{agent_id:randomUUID(),agent_version:1}])
    assert.equal((await call(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h,extra))).status,409);
});
test("complete validates the entire return and resumes the same original conversation/task exactly once",async()=>{
  const f=await fixture(),h=await handoff(f),done=await completed(f,h),a=await asset(f),url=f.base+"/local-handoffs/"+h.id+"/complete";
  assert.equal(done.h.ready_to_return,true);
  const invalid=await call(s,f.web,"POST",url,returned(done.h,[a.version.id,randomUUID()]));assert.equal(invalid.status,404);
  assert.equal((await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id)).state,"working");
  const r=await ok(s,f.web,"POST",url,returned(done.h,[a.version.id]));assert.equal(r.source_task_id,f.task.id);assert.equal(r.source_status,"queued");
  assert.equal((await ok(s,f.web,"POST",url,returned(done.h,[a.version.id]))).revision,r.revision);
  const original=(await s.db.control.query("SELECT * FROM tasks WHERE id=$1",[f.task.id])).rows[0];
  assert.equal(original.conversation_id,f.conversation.id);assert.equal(original.attempt,0);assert.equal(original.execution_location,"cloud");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1 AND dispatched_at IS NULL",[f.task.id])).rows[0].n,1);
});
test("a native-result lineage can be returned without invalidating either the original task or the reviewed child",async()=>{
  const f=await fixture(),h=await handoff(f),done=await completed(f,h),a=await asset(f,f.web.id,{task_id:done.native.task_id});
  await ok(s,f.web,"POST",f.base+"/local-handoffs/"+h.id+"/complete",returned(done.h,[a.version.id]));
  assert.equal((await ok(s,f.web,"GET",f.base+"/tasks/"+f.task.id)).status,"queued");
  assert.equal((await ok(s,f.c,"GET",f.base+"/desktop-executions/"+done.native.task_id)).status,"succeeded");
});
test("return before known settled native success is refused; no fabricated OS success resolves inputs",async()=>{
  const f=await fixture(),h=await handoff(f);await admitted(f,h);const a=await asset(f),current=await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id);
  assert.equal((await call(s,f.web,"POST",f.base+"/local-handoffs/"+h.id+"/complete",returned(current,[a.version.id]))).status,409);
  assert.equal((await ok(s,f.web,"GET",f.base+"/tasks/"+f.task.id)).status,"needs_input");
});
test("same-project editors cannot access the owner's local request or reuse its native admission",async()=>{
  const f=await fixture(),h=await handoff(f),other=await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",[f.tenant,other.web.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",[f.tenant,f.project,other.web.id]);
  assert.equal((await ok(s,other.web,"GET",f.base+"/local-handoffs")).items.length,0);
  assert.equal((await call(s,other.web,"GET",f.base+"/local-handoffs/"+h.id)).status,404);
  assert.equal((await call(s,other.c,"POST",f.base+"/desktop-executions",admission(f,h))).status,404);
});
test("manual input resolution cancels the waiting local request and cannot later start a duplicate local task",async()=>{
  const f=await fixture(),h=await handoff(f),a=await asset(f);
  const resolved=await call(s,f.web,"POST",`/v1/tenants/${f.tenant}/task-dependencies/${f.dep.id}/resolutions`,{expected_version:f.dep.version,resource_ids:[a.version.id]});assert.equal(resolved.status,202);
  assert.equal((await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id)).state,"cancelled");
  assert.equal((await call(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h))).status,409);
});
test("cancelled requests persist as receipts, leave the parent waiting and block cached admission",async()=>{
  const f=await fixture(),h=await handoff(f),key=randomUUID();await ok(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h),key);
  const current=await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id);
  await ok(s,f.web,"POST",f.base+"/local-handoffs/"+h.id+"/cancel",{expected_revision:current.revision,confirm:true});
  assert.equal((await call(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h),key)).status,409);
  assert.equal((await ok(s,f.web,"GET",f.base+"/tasks/"+f.task.id)).status,"needs_input");
});
