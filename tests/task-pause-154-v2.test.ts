import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {ErasureService} from "../src/erasure.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyCall,historyOk,historyAdmin} from "./admin-history-fixture.js";
import {taskPauseFixture,pauseControl,pauseRow,PauseFixtureRuntime,retainedChecklist} from "./task-pause-fixture-154-v2.js";

let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
const counts=async(id:string)=>(await s.db.control.query("SELECT (SELECT count(*)::int FROM task_pause_checkpoints WHERE task_id=$1) checkpoints,(SELECT count(*)::int FROM ledger WHERE task_id=$1) ledger,(SELECT count(*)::int FROM task_tool_receipts WHERE task_id=$1) receipts",[id])).rows[0];

test("running cloud work pauses at a measured boundary and resumes the original thread, results and budget",async()=>{
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async(ctx,n)=>{
  const tool=ctx.tools.find(t=>t.name==="deliver_text")!;
  await tool.run(retainedChecklist,"retain-"+n);
  if(n===1) {
   const requested=await pauseControl(s,f,"pause");assert.equal(requested.status,"running");assert.equal(requested.pause_requested,true);assert.equal(ctx.signal.aborted,false);
   const state=await historyOk(s,f.owner,"GET","/v1/tasks/"+f.task.id+"/control-state");assert.equal(state.phase,"pause_requested");assert.equal(state.can_request_resume,false);
   await assert.rejects(tool.run({...retainedChecklist,filename:"must-not-start.txt"},"after-pause"),(e:any)=>e.code==="TASK_PAUSE_REQUESTED");
  } else assert.equal(ctx.thread,runtime.thread);
 });
 await runtime.run(f);const paused=await pauseRow(s,f);assert.equal(paused.status,"paused");assert.equal(paused.attempt,1);assert.equal(paused.runtime_thread,runtime.thread);
 assert.ok(Number(paused.accrued_micros)>0);assert.equal((await counts(f.task.id)).checkpoints,1);
 assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1",[f.task.id])).rows[0].status,"reserved");
 await pauseControl(s,f,"resume");await runtime.run(f);await runtime.run(f);
 const done=await pauseRow(s,f);assert.equal(done.status,"succeeded");assert.equal(done.attempt,2);assert.equal(done.budget_micros,paused.budget_micros);
 assert.equal(runtime.calls.length,2);assert.equal(Number(done.input_tokens),200);assert.equal(Number(done.output_tokens),100);assert.ok(Number(done.charged_micros)>=Number(paused.accrued_micros));
 assert.equal((await counts(f.task.id)).receipts,1);assert.equal((await s.db.control.query("SELECT state FROM task_pause_checkpoints WHERE task_id=$1",[f.task.id])).rows[0].state,"closed");
});

test("canceling a paused measured task settles its known cumulative usage once",async()=>{
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async()=>{await pauseControl(s,f,"pause");});
 await runtime.run(f);const paused=await pauseRow(s,f);
 await historyOk(s,f.owner,"POST",f.base+"/tasks/"+f.task.id+"/cancel");
 const one=await counts(f.task.id);await historyOk(s,f.owner,"POST",f.base+"/tasks/"+f.task.id+"/cancel");const done=await pauseRow(s,f);
 assert.equal(done.status,"cancelled");assert.equal(Number(done.charged_micros),Number(paused.accrued_micros));assert.deepEqual(await counts(f.task.id),one);assert.equal(runtime.calls.length,1);
});

test("supplying an input requested before pause does not silently dispatch another turn",async()=>{
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async(ctx,n)=>{
  if(n===1){await ctx.tools.find(t=>t.name==="request_input")!.run({requests:[{kind:"question",description:"Which campaign audience should be reviewed?"}]},"audience");await pauseControl(s,f,"pause");}
  else assert.equal(ctx.thread,runtime.thread);
 });
 await runtime.run(f);let row=await pauseRow(s,f);assert.equal(row.status,"needs_input");assert.equal(row.pause_requested,true);
 const inputs=await historyOk(s,f.owner,"GET",f.base+"/tasks/"+f.task.id+"/dependencies");
 const d=inputs.items[0];
 await historyOk(s,f.owner,"POST","/v1/tenants/"+f.tenant+"/task-dependencies/"+d.id+"/resolutions",{expected_version:d.version,answer:"Hong Kong retail founders"});
 row=await pauseRow(s,f);assert.equal(row.status,"paused");await runtime.run(f);assert.equal(runtime.calls.length,1);
 await pauseControl(s,f,"resume");await runtime.run(f);assert.equal((await pauseRow(s,f)).status,"succeeded");assert.equal(runtime.calls.length,2);
});

test("accepted work with unknown usage cannot create a resumable pause checkpoint",async()=>{
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async()=>{await pauseControl(s,f,"pause");});runtime.usageKnown=false;
 await runtime.run(f);const row=await pauseRow(s,f);assert.equal(row.status,"reconciling");assert.equal((await counts(f.task.id)).checkpoints,0);
 const r=await historyCall(s,f.owner,"POST",f.base+"/tasks/"+f.task.id+"/controls",{action:"resume",expected_version:row.version});assert.equal(r.status,409);
 await runtime.run(f);assert.equal(runtime.calls.length,1);
});

test("an administrator cannot resume paused work under the original user's revoked identity",async()=>{
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async()=>{await pauseControl(s,f,"pause");});
 await runtime.run(f);const paused=await pauseRow(s,f),admin=await historyAdmin(s,f.project,["admin.execution.resume"]);
 await s.db.control.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[f.owner.id]);
 const r=await historyCall(s,admin.client!,"POST","/v1/admin/execution/"+f.task.id+"/action",{action:"resume",version:paused.version,reason:"Explicit scoped resume after identity revocation"});
 assert.ok([401,403].includes(r.status),JSON.stringify(r.data));
 assert.equal((await s.db.control.query("SELECT status FROM tasks WHERE id=$1",[f.task.id])).rows[0].status,"paused");assert.equal(runtime.calls.length,1);
});

test("initial queued pause remains available and permanent erasure removes measured pause facts",async()=>{
 const initial=await taskPauseFixture(s);assert.equal((await pauseControl(s,initial,"pause")).status,"paused");assert.equal((await pauseControl(s,initial,"resume")).status,"queued");
 await historyOk(s,initial.owner,"POST",initial.base+"/tasks/"+initial.task.id+"/cancel");
 const f=await taskPauseFixture(s),runtime=new PauseFixtureRuntime(s,async()=>{await pauseControl(s,f,"pause");});
 await runtime.run(f);await assert.rejects(s.db.control.query("UPDATE task_pause_checkpoints SET input_tokens=input_tokens+1 WHERE task_id=$1",[f.task.id]),/immutable/);
 await historyOk(s,f.owner,"POST",f.base+"/tasks/"+f.task.id+"/cancel");
 await s.db.control.query("UPDATE tasks SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[f.task.id]);
 await new ErasureService(s.db,s.storage).advance(30);
 assert.equal((await counts(f.task.id)).checkpoints,0);
 assert.equal((await historyCall(s,f.owner,"GET","/v1/tasks/"+randomUUID()+"/control-state")).status,404);
});
