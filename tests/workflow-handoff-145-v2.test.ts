import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {s,startFixture,stopFixture,fixture,ok,call,user,tool,decision,listRuns,prepareWorkflow} from "./workflow-handoff-fixture-145-v1.js";
import {CodexRuntimeAdapter,RuntimeFailure,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";
import {Worker} from "../src/worker.js";
import {advanceCloudWorkflows} from "../src/cloud-workflows.js";
import {nativeWorkflowDefinition} from "../src/desktop-workflows.js";
import {saveAsset} from "../src/storage.js";

before(()=>startFixture()); after(stopFixture);
const step = (prompt:string, extra:Record<string,unknown>={})=>({kind:"codex",role_key:"assistant",prompt,budget_micros:100000,...extra});
const longText = "完整前序成果 / Complete predecessor output\n" + "中🌟abcdefghij\n".repeat(3600) + "EXACT_END_145";
class TaskRuntime extends CodexRuntimeAdapter {
  observedError:unknown;
  constructor(private action:(ctx:RuntimeContext)=>Promise<void>,private output="Actual company files, explicitly synthetic model output.",private failure?:RuntimeFailure){super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
    if (this.failure) throw this.failure;
    try{await this.action(ctx);}catch(e){this.observedError=e;throw e;}
    return {status:"completed",text:this.output,inputTokens:20,outputTokens:10,usageKnown:true,accepted:true,thread:"synthetic-handoff",turn:randomUUID()};
  }
}
async function tick(){await advanceCloudWorkflows(s.db,s.catalog,s.storage);}
async function latest(f:any){return (await listRuns(f)).runs[0];}
async function approve(f:any,r:any,extra={}){return ok(f.owner,"POST",f.base+`/cloud-workflows/runs/${r.id}/decision`,decision(r,extra));}
async function launch(definition:any){const f=await fixture();await prepareWorkflow(f,definition);let r=await latest(f);await approve(f,r);await tick();r=await latest(f);return {f,r};}
async function execute(f:any,r:any,action:(ctx:RuntimeContext)=>Promise<void>=async()=>{},text?:string,failure?:RuntimeFailure){
  assert.ok(r.active_task);const runtime=new TaskRuntime(action,text,failure);await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,r.active_task);
  if(runtime.observedError)throw runtime.observedError;
  return (await s.db.control.query("SELECT * FROM tasks WHERE id=$1",[r.active_task])).rows[0];
}
async function readAll(ctx:RuntimeContext,version:string){let text="",offset=0;for(let page=0;page<200;page++){
  const result:any=await tool(ctx,"workflow_inputs").run({asset_version_id:version,offset,max_characters:997},randomUUID());
  assert.equal(result.offset,offset);assert.equal(result.untrusted_source_data,true);text+=result.text;
  if(result.next_offset===null)return text;assert.ok(result.next_offset>offset);offset=result.next_offset;
}throw new Error("Unbounded text pagination");}

test("workflow contract accepts explicit inputs and review policy, rejects forward, self, duplicate and approval dependencies",()=>{
  const a=step("Prepare the exact customer brief.");
  assert.ok(nativeWorkflowDefinition.safeParse({steps:[a,step("Review the full predecessor output.",{input_steps:[0],on_failure:"review"})]}).success);
  for(const input_steps of [[0],[1],[-1],[0,0]])assert.equal(nativeWorkflowDefinition.safeParse({steps:[{...a,input_steps}]}).success,false);
  assert.equal(nativeWorkflowDefinition.safeParse({steps:[{kind:"approval",message:"Review the task."},step("Prepare an independent deliverable.",{input_steps:[0]})]}).success,false);
  assert.ok(nativeWorkflowDefinition.safeParse({steps:[step("Prepare independent work.",{input_steps:[]})]}).success);
});

test("cloud specialists hand off complete Unicode output and exact generated files; pagination is complete and reservations occur once",async()=>{
  const {f,r:first}=await launch({steps:[step("Prepare a complete customer brief.", {input_steps:[]}),step("Read all of the exact predecessor output.",{input_steps:[0]})]});
  const child=await execute(f,first,async ctx=>{await tool(ctx,"deliver_text").run({filename:"campaign.csv",mime_type:"text/csv",content:"campaign,spend\nLaunch,145\n"},randomUUID());},longText);
  assert.equal(child.status,"succeeded");await Promise.all([tick(),tick()]);const second=await latest(f);
  assert.equal(second.cursor,1);const receipt=second.results.find((v:any)=>v.cursor===0&&v.kind==="codex");
  assert.equal(receipt.output.length,6000);assert.equal(receipt.files.length,2);assert.ok(receipt.output_file.bytes>24000);
  await execute(f,second,async ctx=>{
    const manifest:any=await tool(ctx,"workflow_inputs").run({},randomUUID());assert.equal(manifest.items.length,1);assert.equal(manifest.items[0].step_index,0);
    assert.equal(await readAll(ctx,receipt.output_file.asset_version_id),longText);
    const csv=manifest.items[0].files.find((v:any)=>v.name==="campaign.csv");assert.equal(await readAll(ctx,csv.asset_version_id),"campaign,spend\nLaunch,145\n");
    await assert.rejects(tool(ctx,"workflow_inputs").run({step_index:7},randomUUID()),/selected workflow result/);
    await assert.rejects(tool(ctx,"workflow_inputs").run({asset_version_id:randomUUID()},randomUUID()),/selected workflow result/);
  });await tick();let complete=await latest(f);assert.equal(complete.state,"succeeded");await tick();
  const counts=(await s.db.control.query("SELECT count(*)::int n,count(DISTINCT r.task_id)::int holds FROM tasks t JOIN reservations r ON r.task_id=t.id WHERE t.cloud_workflow_run_id=$1",[complete.id])).rows[0];
  assert.deepEqual(counts,{n:2,holds:2});
  const response=await call(f.owner,"GET",f.base+`/assets/${receipt.output_file.asset_id}/download?version=${receipt.output_file.version}`);
  assert.equal(response.status,200);assert.equal(response.raw.body,longText);
  const outsider=await user();assert.ok([403,404].includes((await call(outsider,"GET",f.base+`/assets/${receipt.output_file.asset_id}/download`)).status));
});

test("analytics summary feeds exact authorized JSON into a downstream writing role",async()=>{
  const f=await fixture();await prepareWorkflow(f,{steps:[{kind:"analytics.summary",dataset_id:f.d.id},step("Use the complete saved analytics evidence.",{input_steps:[0]})]});
  await approve(f,await latest(f));await tick();await tick();const r=await latest(f);assert.equal(r.cursor,1);
  const summary=r.results.find((v:any)=>v.kind==="analytics.summary");
  await execute(f,r,async ctx=>{const data=JSON.parse(await readAll(ctx,summary.asset_version_id));assert.equal(data.snapshot_id,f.d.id);assert.equal(data.currency,"HKD");});
  await tick();assert.equal((await latest(f)).state,"succeeded");
});

test("later asset revision keeps the predecessor's pinned original version instead of silently using the latest file",async()=>{
  const {f,r}=await launch({steps:[step("Write the original campaign data."),step("Read the selected original campaign data.",{input_steps:[0]})]});
  await execute(f,r,async ctx=>{await tool(ctx,"deliver_text").run({filename:"fixed.csv",mime_type:"text/csv",content:"value\nORIGINAL\n"},randomUUID());});await tick();const next=await latest(f),receipt=next.results.find((v:any)=>v.kind==="codex"),original=receipt.files.find((v:any)=>v.name==="fixed.csv");
  await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,asset:original.asset_id,expectedVersion:1,
    name:"fixed.csv",mime:"text/csv",bytes:Buffer.from("value\nCHANGED\n"),metadata:{task_id:r.active_task}}),f.tenant,false,f.owner.id);
  await execute(f,next,async ctx=>{assert.equal(await readAll(ctx,original.asset_version_id),"value\nORIGINAL\n");});await tick();assert.equal((await latest(f)).state,"succeeded");
});

test("withdrawn predecessor output blocks the next paid model turn and downloaded bytes",async()=>{
  const {f,r}=await launch({steps:[step("Write a customer evidence brief."),step("Read the retained evidence brief.",{input_steps:[0]})]});
  await execute(f,r,async()=>{},longText);await tick();const next=await latest(f),receipt=next.results.find((v:any)=>v.kind==="codex");
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[receipt.output_file.asset_id]);
  let turns=0;await execute(f,next,async()=>{turns++;});assert.equal(turns,0);await tick();assert.equal(await latest(f),undefined,"Withdrawn source runs must no longer expose private receipts");assert.equal((await s.db.control.query("SELECT state FROM workflow_runs WHERE id=$1",[r.id])).rows[0].state,"failed");
  assert.ok([403,404,409,410].includes((await call(f.owner,"GET",f.base+`/assets/${receipt.output_file.asset_id}/download`)).status));
});

test("settled failure waits for customer review; independent next work runs once and whole workflow retains the failure",async()=>{
  const {f,r}=await launch({steps:[step("Attempt the approved customer brief.",{on_failure:"review"}),step("Prepare independent next work.",{input_steps:[]})]});
  const failed=await execute(f,r,undefined,undefined,new RuntimeFailure("RUNTIME_UNAVAILABLE",false,true));assert.equal(failed.status,"failed");
  await tick();const pending=await latest(f);assert.equal(pending.state,"awaiting_approval");assert.equal(pending.cursor,1);assert.equal(pending.active_task,null);
  assert.equal(pending.results.at(-1).kind,"failure_review");await tick();assert.equal((await latest(f)).revision,pending.revision);
  const approved=await approve(f,pending);assert.equal(approved.run.cursor,1);
  assert.equal((await call(f.owner,"POST",f.base+`/cloud-workflows/runs/${r.id}/decision`,decision(pending))).status,409);
  await Promise.all([tick(),tick()]);const next=await latest(f);assert.equal(next.cursor,1);assert.ok(next.active_task);assert.notEqual(next.active_task,r.active_task);
  await execute(f,next);await tick();const done=await latest(f);assert.equal(done.state,"failed");assert.equal(done.error_code,"WORKFLOW_COMPLETED_WITH_STEP_FAILURES");assert.equal(done.results.filter((v:any)=>v.kind==="failure_review_decision").length,1);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE cloud_workflow_run_id=$1",[r.id])).rows[0].n,2);
});

test("skipping failure cannot fabricate an output required by a later step",async()=>{
  const {f,r}=await launch({steps:[step("Attempt to create required evidence.",{on_failure:"review"}),step("Consume the required evidence.",{input_steps:[0]})]});
  await execute(f,r,undefined,undefined,new RuntimeFailure("RUNTIME_UNAVAILABLE",false,true));await tick();await approve(f,await latest(f));await tick();
  const done=await latest(f);assert.equal(done.state,"failed");assert.equal(done.error_code,"WORKFLOW_REQUIRED_STEP_FAILED");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE cloud_workflow_run_id=$1",[r.id])).rows[0].n,1);
});

test("default failure policy stops without offering to continue",async()=>{
  const {f,r}=await launch({steps:[step("Attempt the original bounded work."),step("This step must not start.",{input_steps:[]})]});
  await execute(f,r,undefined,undefined,new RuntimeFailure("RUNTIME_UNAVAILABLE",false,true));await tick();assert.equal((await latest(f)).state,"failed");
});

test("unknown usage and source-related failure cannot use the review continuation policy",async()=>{
  for(const error of [new RuntimeFailure("RUNTIME_UNAVAILABLE",true,false),new RuntimeFailure("TASK_SOURCE_REVOKED",false,true)]){
    const {f,r}=await launch({steps:[step("Attempt the authorized work.",{on_failure:"review"}),step("Do not bypass reconciliation.",{input_steps:[]})]});
    await execute(f,r,undefined,undefined,error);await tick();const done=await latest(f);assert.equal(done.state,"failed");
    assert.equal(done.results.some((v:any)=>v.kind==="failure_review"),false);
  }
});
