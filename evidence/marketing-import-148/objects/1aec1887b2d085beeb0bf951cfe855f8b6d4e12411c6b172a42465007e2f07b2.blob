import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {s,startFixture,stopFixture,fixture,ok,call,tool,decision,listRuns,FixtureRuntime} from "./workflow-handoff-fixture-145-v1.js";
import {Worker} from "../src/worker.js";
import {advanceCloudWorkflows} from "../src/cloud-workflows.js";
import {advanceCloudSchedules} from "../src/cloud-schedules.js";
import {saveAsset} from "../src/storage.js";
import {nativeWorkflowDefinition} from "../src/desktop-workflows.js";
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";

before(()=>startFixture());after(stopFixture);
const definition=()=>({input_schema:{fields:[{key:"brief",label:"Campaign brief",type:"text",required:true},{key:"target",type:"number",required:true},
  {key:"enabled",type:"boolean",required:true},{key:"source",type:"file"}]},output_schema:{fields:[{key:"report",label:"Complete report",type:"text",step_index:0,required:true},
  {key:"deliverables",type:"files",step_index:0,required:true}]},steps:[{kind:"codex",role_key:"assistant",prompt:"Read the named fixed inputs and prepare the complete reviewed report.",budget_micros:100000}]});
const values=()=>({brief:"Hong Kong campaign",target:0.75,enabled:false});
async function executeConsultant(f:any,action:(ctx:RuntimeContext)=>Promise<void>){
  const current=await ok(f.owner,"GET",f.base+"/conversations/"+f.conversation.id);
  const accepted=await ok(f.owner,"POST",f.base+`/conversations/${f.conversation.id}/messages`,{body:"Prepare a fixed workflow using my explicit business values.",expected_version:current.version,
    intent:"delegate",mode:"execute",budget_micros:1000000,client_message_id:randomUUID()});
  const runtime=new FixtureRuntime(action);await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,accepted.task.id);if(runtime.failure)throw runtime.failure;
  return accepted.task;
}
async function prepare(f:any,d:any=definition(),inputs:any=values(),check?:(ctx:RuntimeContext,args:any)=>Promise<void>){
  let requested:any;
  const origin=await executeConsultant(f,async ctx=>{
    const saved:any=await tool(ctx,"workflow_save").run({name:"Fixed campaign contract",definition:d},randomUUID());
    const p:any=await tool(ctx,"workflow_publish").run({workflow_id:saved.workflow.id,expected_version:saved.workflow.version},randomUUID());
    const args={workflow_id:saved.workflow.id,version:saved.workflow.version,definition_hash:p.definition_hash,inputs};
    if(check)await check(ctx,args);
    requested=await tool(ctx,"workflow_run").run(args,randomUUID());
    assert.equal((await tool(ctx,"workflow_run").run(args,randomUUID()) as any).run.id,requested.run.id);
  });
  return {origin,r:requested.run};
}
const current=async(f:any,id:string)=>(await listRuns(f)).runs.find((r:any)=>r.id===id);
const approve=async(f:any,r:any,extra={})=>ok(f.owner,"POST",f.base+`/cloud-workflows/runs/${r.id}/decision`,decision(r,{input_hash:r.input_hash,...extra}));
const tick=()=>advanceCloudWorkflows(s.db,s.catalog,s.storage);
class OutputRuntime extends CodexRuntimeAdapter{
  error:unknown;constructor(private action:(ctx:RuntimeContext)=>Promise<void>,private output:string){super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{try{await this.action(ctx);}catch(e){this.error=e;throw e;}
    return {status:"completed",text:this.output,inputTokens:20,outputTokens:10,usageKnown:true,accepted:true,thread:"synthetic-contract",turn:randomUUID()};}
}

test("workflow schemas reject duplicate names, invalid types, forward output indices and approval-only outputs",()=>{
  assert.ok(nativeWorkflowDefinition.safeParse(definition()).success);
  for(const d of [{...definition(),input_schema:{fields:[{key:"same",type:"text"},{key:"same",type:"text"}]}},
    {...definition(),input_schema:{fields:[{key:"brief",type:"shell"}]}},
    {...definition(),output_schema:{fields:[{key:"report",type:"text",step_index:1}]}},
    {...definition(),steps:[{kind:"approval",message:"Review the business contract."}]}])assert.equal(nativeWorkflowDefinition.safeParse(d).success,false);
});
test("required, unknown and wrongly typed values fail before reservation; zero, false and decimal values survive exact binding",async()=>{
  const f=await fixture();const {r}=await prepare(f,definition(),{brief:"A",target:0,enabled:false},async(ctx,args)=>{
    for(const inputs of [{},{...values(),target:"1"},{...values(),enabled:"false"},{...values(),brief:" "},{...values(),unknown:"no"},{...values(),source:randomUUID()}])
      await assert.rejects(tool(ctx,"workflow_run").run({...args,inputs},randomUUID()));
  });
  assert.deepEqual(r.input_values,{brief:"A",target:0,enabled:false});assert.equal(r.state,"awaiting_approval");assert.equal(r.authorized,false);
  assert.match(r.input_hash,/^[a-f0-9]{64}$/);assert.deepEqual(r.input_files,[]);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE cloud_workflow_run_id=$1",[r.id])).rows[0].n,0);
});
test("approval requires the reviewed input hash and database values cannot be rewritten",async()=>{
  const f=await fixture(),{r}=await prepare(f);
  for(const input_hash of [undefined,"0".repeat(64)])assert.equal((await call(f.owner,"POST",f.base+`/cloud-workflows/runs/${r.id}/decision`,decision(r,{input_hash}))).status,409);
  await assert.rejects(s.db.control.query("UPDATE workflow_runs SET input_values=$2 WHERE id=$1",[r.id,{...values(),brief:"silently replaced"}]),/immutable/i);
  await approve(f,r);await tick();const next=await current(f,r.id);assert.ok(next.active_task);
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context=input_context-'workflow_binding' WHERE id=$1",[next.active_task]),/immutable/i);
  const t=(await s.db.control.query("SELECT input_context FROM tasks WHERE id=$1",[next.active_task])).rows[0];
  assert.equal(t.input_context.workflow_binding.input_hash,r.input_hash);assert.deepEqual(t.input_context.workflow_binding.values,values());
});
test("named exact-version files read fully through workflow_inputs; named text output retains the complete saved Unicode content",async()=>{
  const f=await fixture(),bytes=Buffer.from("Named original\n"+"中🌟abcdefgh\n".repeat(2000)+"EXACT_NAMED_END_147");
  const a=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"named-brief.txt",mime:"text/plain",bytes}),f.tenant,false,f.owner.id);
  const {r}=await prepare(f,definition(),{...values(),source:a.version.id});
  await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,asset:a.id,expectedVersion:1,name:"named-brief.txt",mime:"text/plain",bytes:Buffer.from("REPLACED_LATEST")}),f.tenant,false,f.owner.id);
  await approve(f,r);await tick();const next=await current(f,r.id),text="Full named report\n"+"中🌟output\n".repeat(1800)+"EXACT_OUTPUT_END_147";
  const runtime=new OutputRuntime(async ctx=>{
    const manifest:any=await tool(ctx,"workflow_inputs").run({},randomUUID());assert.equal(manifest.named_inputs.target,0.75);assert.equal(manifest.named_inputs.enabled,false);
    assert.equal(manifest.named_files[0].asset_version_id,a.version.id);let read="",offset=0;
    for(let page=0;page<200;page++){const p:any=await tool(ctx,"workflow_inputs").run({input_name:"source",asset_version_id:a.version.id,offset,max_characters:997},randomUUID());read+=p.text;if(p.next_offset===null)break;assert.ok(p.next_offset>offset);offset=p.next_offset;}
    assert.equal(read,bytes.toString());await assert.rejects(tool(ctx,"workflow_inputs").run({input_name:"not_approved"},randomUUID()));
    await tool(ctx,"deliver_text").run({filename:"campaign.csv",mime_type:"text/csv",content:"campaign,target\nHK,0.75\n"},randomUUID());
  },text);
  await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,next.active_task);if(runtime.error)throw runtime.error;await tick();
  const done=await current(f,r.id);assert.equal(done.state,"succeeded");assert.equal(done.named_outputs.report,text);
  assert.ok(done.named_outputs.deliverables.some((v:any)=>v.name==="campaign.csv"));assert.ok(done.results.find((v:any)=>v.kind==="codex").output.length<text.length);
});
test("withdrawn named input prevents model execution and hides private run metadata",async()=>{
  const f=await fixture(),a=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"withdrawn.txt",mime:"text/plain",bytes:Buffer.from("private business")}),f.tenant,false,f.owner.id);
  const {r}=await prepare(f,definition(),{...values(),source:a.version.id});await approve(f,r);await tick();const next=await current(f,r.id);let calls=0;
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[a.id]);
  await new Worker(s.db,s.catalog,s.storage,new OutputRuntime(async()=>{calls++;},"Must never run")).run(f.tenant,next.active_task);await tick();
  assert.equal(calls,0);assert.equal(await current(f,r.id),undefined);
  assert.ok([404,409].includes((await call(f.owner,"POST",f.base+`/cloud-workflows/runs/${r.id}/decision`,decision(r,{input_hash:r.input_hash}))).status));
});
test("separate prepared runs keep distinct business inputs and cannot change a request through another tool key",async()=>{
  const f=await fixture(),one=await prepare(f,definition(),values(),async(ctx,args)=>{
    await tool(ctx,"workflow_run").run(args,randomUUID());
    await assert.rejects(tool(ctx,"workflow_run").run({...args,inputs:{...values(),target:99}},randomUUID()),/review|changed/i);
  });
  const two=await prepare(f,definition(),{...values(),target:99});
  assert.notEqual(one.r.id,two.r.id);assert.notEqual(one.r.input_hash,two.r.input_hash);assert.equal(one.r.input_values.target,0.75);assert.equal(two.r.input_values.target,99);
});
test("scheduled runs inherit the customer-approved inputs and refuse forged recurring replacements",async()=>{
  const f=await fixture(),{r}=await prepare(f),at=Math.floor(Date.now()/60000)*60000+120_000,d=new Date(at),time=d.toISOString().slice(11,16);
  const p=await ok(f.owner,"POST",f.base+"/cloud-workflow-schedules/requests",{source_run_id:r.id,name:"Fixed contract schedule",calendar:{timezone:"UTC",frequency:"daily",weekdays:[],time},
    catch_up:"latest",starts_at:new Date(at-30_000).toISOString(),ends_at:new Date(at+86400_000).toISOString(),expected_output:"The fixed named report"});
  const q=p;assert.deepEqual(q.body.input_binding.values,values());assert.equal(q.body.input_binding.input_hash,r.input_hash);
  await ok(f.owner,"POST",f.base+`/cloud-workflow-schedules/requests/${q.id}/decision`,{decision:"activate",specification_hash:q.specification_hash,max_budget_micros:q.body.max_budget_micros});
  await advanceCloudSchedules(s.db,s.catalog,s.storage,at+60_000);
  const generated=(await s.db.control.query("SELECT * FROM workflow_runs WHERE cloud_schedule_id IS NOT NULL AND project_id=$1",[f.project])).rows[0];
  assert.ok(generated);assert.deepEqual(generated.input_values,values());assert.equal(generated.input_hash,r.input_hash);
  await assert.rejects(s.db.control.query("UPDATE workflow_runs SET input_values='{}'::jsonb WHERE id=$1",[generated.id]),/immutable/i);
});
