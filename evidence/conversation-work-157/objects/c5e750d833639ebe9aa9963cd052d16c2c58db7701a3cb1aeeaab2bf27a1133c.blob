import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyCall,historyOk} from "./admin-history-fixture.js";
import {workFixture,workStart,workCall,workPayload,workRow,WorkRuntime,deferred,waitFor} from "./conversation-work-fixture-157-v1.js";
import {conversationMutation} from "../src/conversation-mutation.js";
let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});

test("two running tasks share a conversation but keep independent cancellation, budget and final receipts",{timeout:25000},async()=>{
 const f=await workFixture(s),a=await workStart(s,f,"Review Hong Kong campaign creative independently"),enteredA=deferred(),enteredB=deferred(),goA=deferred(),goB=deferred();
 const ra=new WorkRuntime(s,async()=>{enteredA.resolve();await goA.promise;}),rb=new WorkRuntime(s,async()=>{enteredB.resolve();await goB.promise;});
 const pa=ra.run(f,a.task_id);let pb:Promise<void>|undefined;
 try{await enteredA.promise;const b=await workStart(s,f,"Build the separate campaign landing page");pb=rb.run(f,b.task_id);await enteredB.promise;
  assert.equal((await workRow(s,f,a.task_id)).status,"running");assert.equal((await workRow(s,f,b.task_id)).status,"running");
  const holds=(await s.db.control.query("SELECT task_id,amount_micros::text,status FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id",[[a.task_id,b.task_id]])).rows;
  assert.equal(holds.length,2);assert.ok(holds.every(h=>h.amount_micros==="1000000"&&h.status==="reserved"));
  await historyOk(s,f.owner,"POST",f.base+"/tasks/"+a.task_id+"/cancel");goA.resolve();await pa;
  assert.equal((await workRow(s,f,a.task_id)).status,"cancelled");assert.equal((await workRow(s,f,b.task_id)).cancel_requested,false);assert.equal(rb.calls[0].signal.aborted,false);
  goB.resolve();await pb;assert.equal((await workRow(s,f,b.task_id)).status,"succeeded");
  const totals=(await s.db.control.query("SELECT task_id,count(*)::int AS n FROM ledger WHERE task_id=ANY($1::uuid[]) GROUP BY task_id ORDER BY task_id",[[a.task_id,b.task_id]])).rows;
  await ra.run(f,a.task_id);await rb.run(f,b.task_id);assert.equal(ra.calls.length,1);assert.equal(rb.calls.length,1);
  assert.deepEqual((await s.db.control.query("SELECT task_id,count(*)::int AS n FROM ledger WHERE task_id=ANY($1::uuid[]) GROUP BY task_id ORDER BY task_id",[[a.task_id,b.task_id]])).rows,totals);
  const c=await historyOk(s,f.owner,"GET",f.base+"/conversations/"+f.conversation.id);assert.notEqual(c.tasks[0].title,c.tasks[1].title);assert.ok(c.messages.some((m:any)=>m.role==="assistant"&&m.task_id===b.task_id));
 }finally{goA.resolve();goB.resolve();await Promise.allSettled([pa,...(pb?[pb]:[])]);}
});

test("legacy notes and paid delegations replay exact original payloads after another work advances the conversation",async()=>{
 const f=await workFixture(s),url=f.base+"/conversations/"+f.conversation.id+"/messages";
 const a={client_message_id:randomUUID(),expected_version:1,intent:"delegate",body:"Prepare campaign illustration options",mode:"execute",budget_micros:1000000};
 const first=await historyOk(s,f.owner,"POST",url,a),b={...a,client_message_id:randomUUID(),expected_version:2,body:"Prepare a separate landing page outline"};
 const second=await historyOk(s,f.owner,"POST",url,b);assert.notEqual(first.task.id,second.task.id);
 const retried=await historyOk(s,f.owner,"POST",url,a);assert.equal(retried.task.id,first.task.id);
 assert.equal((await historyCall(s,f.owner,"POST",url,{...a,client_message_id:randomUUID()})).status,409);
 await historyOk(s,f.owner,"POST",url,{client_message_id:randomUUID(),expected_version:3,intent:"note",body:"Shared campaign note",mode:"ask"});
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE conversation_id=$1",[f.conversation.id])).rows[0].n,2);
});

test("waiting-input and paused work do not prevent independent new work, while unknown results stay out of the new context",{timeout:25000},async()=>{
 const f=await workFixture(s),a=await workStart(s,f,"Review campaign audience and ask for the missing market"),ra=new WorkRuntime(s,async(ctx,n)=>{if(n===1)await ctx.tools.find(t=>t.name==="request_input")!.run({requests:[{kind:"question",description:"Which market should the campaign target?"}]},"market-question");});
 await ra.run(f,a.task_id);assert.equal((await workRow(s,f,a.task_id)).status,"needs_input");
 const b=await workStart(s,f,"Prepare independent typography options"),row=await workRow(s,f,b.task_id);
 const checkpoint=(await s.db.control.query("SELECT id FROM conversation_messages WHERE task_id=$1 AND role='assistant'",[a.task_id])).rows.map(r=>r.id);assert.ok(checkpoint.length);
 assert.ok(row.input_context.history.every((h:any)=>!checkpoint.includes(h.id)));
 const d=(await historyOk(s,f.owner,"GET",f.base+"/tasks/"+a.task_id+"/dependencies")).items[0];
 await historyOk(s,f.owner,"POST",`/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`,{expected_version:d.version,answer:"Hong Kong businesses"});
 await ra.run(f,a.task_id);assert.equal((await workRow(s,f,a.task_id)).status,"succeeded");assert.equal((await workRow(s,f,b.task_id)).status,"queued");
 const c=await workStart(s,f,"Prepare independent colour palette"),rc=new WorkRuntime(s,async()=>{const t=await workRow(s,f,c.task_id);await historyOk(s,f.owner,"POST",f.base+"/tasks/"+c.task_id+"/controls",{action:"pause",expected_version:t.version});});
 await rc.run(f,c.task_id);assert.equal((await workRow(s,f,c.task_id)).status,"paused");await workStart(s,f,"Prepare independent SEO outline while palette is paused");
});

test("admission and result settlement finish without an inverse conversation-wallet wait",{timeout:25000},async()=>{
 const f=await workFixture(s),a=await workStart(s,f,"Prepare the first parallel campaign task"),entered=deferred(),go=deferred(),runtime=new WorkRuntime(s,async()=>{entered.resolve();await go.promise;});
 const run=runtime.run(f,a.task_id);let locker:any,request:Promise<any>|undefined;
 try{await entered.promise;locker=await s.db.control.connect();await locker.query("BEGIN");await locker.query("SELECT 1 FROM wallets WHERE tenant_id=$1 FOR UPDATE",[f.tenant]);
  request=workStart(s,f,"Prepare the second task during first result settlement");
  await waitFor(()=>s.db.tx(async tx=>!(await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",["conversation-commit:"+f.conversation.id])).rows[0].locked,undefined,true));
  go.resolve();await locker.query("COMMIT");locker.release();locker=null;const b=await request;await run;
  assert.equal((await workRow(s,f,a.task_id)).status,"succeeded");assert.equal((await workRow(s,f,b.task_id)).status,"queued");
 }finally{go.resolve();if(locker){await locker.query("ROLLBACK");locker.release();}await Promise.allSettled([run,...(request?[request]:[])]);}
});

test("contended conversation commit fails promptly and the unchanged request can be retried",async()=>{
 const f=await workFixture(s),held=deferred(),release=deferred(),key=randomUUID(),body=workPayload(f,"Prepare one independent campaign checklist");
 const lock=s.db.tx(async tx=>{await conversationMutation(tx,f.conversation.id,true);held.resolve();await release.promise;},f.tenant,true);
 try{await held.promise;const denied=await workCall(s,f,body,key);assert.equal(denied.status,409);assert.equal(denied.data.error.code,"CONVERSATION_CHANGING");}
 finally{release.resolve();await lock;}
 const accepted=await workCall(s,f,body,key),replayed=await workCall(s,f,body,key);assert.equal(accepted.status,202);assert.equal(replayed.data.task_id,accepted.data.task_id);
});

test("per-user plan quotas and current permissions still reject independent new admission without charging",async()=>{
 const f=await workFixture(s);await s.db.control.query("UPDATE entitlements SET plan_body=jsonb_set(plan_body,'{max_active_tasks}','1'::jsonb) WHERE tenant_id=$1",[f.tenant]);
 await workStart(s,f,"Prepare one permitted independent campaign task");
 const denied=await workCall(s,f,workPayload(f,"Prepare another campaign task above the plan quota"));assert.equal(denied.status,409);assert.equal(denied.data.error.code,"PLAN_TASK_LIMIT");
 await s.db.control.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",[f.project,f.owner.id]);
 const revoked=await workCall(s,f,workPayload(f,"Try an unauthorized independent campaign task"));assert.equal(revoked.status,403);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations r JOIN tasks t ON t.id=r.task_id WHERE t.conversation_id=$1",[f.conversation.id])).rows[0].n,1);
});

test("Extension preserves selected input/stop target, independent sends, uncertain receipt and discards a delayed old target",{timeout:25000},async()=>{
 const f=await workFixture(s),a=await workStart(s,f,"Prepare one independent campaign task"),b=await workStart(s,f,"Prepare the other independent campaign task");
 const {ConversationState}=await import(pathToFileURL(path.resolve("../copypaste-extension/src/conversation.ts")).href);
 const storage=new Map<string,any>();let lost=false;const io:any={read:async(k:string)=>storage.get(k),write:async(k:string,v:any)=>{storage.set(k,v);},changed:()=>{},upload:async()=>{throw new Error("No upload in work target checks");},request:async(_scope:any,p:string,m="GET",body?:any,key?:string)=>{
  if(p==="/v1/tasks"){const r=await workCall(s,f,body,key);if(r.status>=400)throw Object.assign(new Error(JSON.stringify(r.data)),{status:r.status});if(lost){lost=false;throw new Error("Synthetic lost acceptance reply");}return r.data;}
  return historyOk(s,f.owner,m,p,body);
 }};
 const state=new ConversationState(io);await state.open({actor:f.owner.id,tenant:f.tenant,project:f.project});await state.select(f.conversation.id);await state.refresh();
 await state.selectTask(a.task_id);assert.equal(state.progress.task.id,a.task_id);await state.stop();assert.equal((await workRow(s,f,a.task_id)).status,"cancelled");assert.equal((await workRow(s,f,b.task_id)).status,"queued");
 await state.selectTask(b.task_id);const blocked=deferred(),started=deferred(),original=io.request;
 io.request=async(...args:any[])=>{if(args[1]===f.base+"/tasks/"+b.task_id){started.resolve();await blocked.promise;}return original(...args);};
 const poll=state.refresh();await started.promise;const selected=state.selectTask(a.task_id);blocked.resolve();await Promise.all([poll,selected]);assert.equal(state.progress.task.id,a.task_id);io.request=original;
 state.draft="Prepare a third task while the second remains queued";lost=true;await assert.rejects(state.send("1"),/lost acceptance/);assert.ok(state.pending);const pending=structuredClone(state.pending);
 await state.send("1");assert.equal(state.pending,undefined);assert.equal(state.draft,"");assert.notEqual(state.progress.task.id,a.task_id);assert.notEqual(state.progress.task.id,b.task_id);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE conversation_id=$1",[f.conversation.id])).rows[0].n,3);assert.equal(pending.prompt,"Prepare a third task while the second remains queued");state.reset();
});
