import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {s,fixture,launch,decision,advance,complete,ok,tool} from "./workflow-native-handoff-fixture-145-v1.js";

const text="Customer-reported local work; not independently verified OS execution.\n"+"本機結果🌟\n".repeat(1800)+"NATIVE_EXACT_END_145";
const steps=(extra={})=>({steps:[{kind:"codex",role_key:"fullstack",prompt:"Prepare the local customer report.",budget_micros:100000,...extra},
  {kind:"codex",role_key:"software-qa",prompt:"Read the full predecessor report from the approved same workspace.",budget_micros:100000,input_steps:[0]}]});
test("native control plane prepares actual pinned predecessor readers without creating any cloud task execution",async()=>{
  const f=await fixture(),r=await launch(f,undefined);
  // Use the default original workflow, including its separate human review.
  r.run=(await decision(f,r)).run;const first=await advance(f,r),url=f.base+"/desktop-executions/"+first.child.task_id;
  await ok(s,f.c,"POST",url+"/start",first.child.fields);
  await ok(s,f.c,"POST",url+"/finish",{...complete,output:text});
  const review=await advance(f,{...r,run:first.run});r.run=(await decision(f,{...r,run:review.run},"step")).run;
  const next=await advance(f,r),nextURL=f.base+"/desktop-executions/"+next.child.task_id;
  const started=await ok(s,f.c,"POST",nextURL+"/start",next.child.fields);
  assert.ok(started.company_tools.some((v:any)=>v.name==="workflow_inputs"));
  const manifest=(await ok(s,f.c,"POST",nextURL+"/tools",tool("workflow_inputs",{}))).output;
  assert.equal(manifest.items[0].result_origin,"desktop_client_report");const file=manifest.items[0].files[0];let offset=0,all="";
  do{const page=(await ok(s,f.c,"POST",nextURL+"/tools",tool("workflow_inputs",{asset_version_id:file.asset_version_id,offset,max_characters:1501},randomUUID()))).output;all+=page.text;if(page.next_offset===null)break;offset=page.next_offset;}while(offset<100000);
  assert.equal(all,text);assert.equal(next.child.fields.workspace_hash,first.child.fields.workspace_hash);assert.equal(next.child.fields.device_id,first.child.fields.device_id);
  await ok(s,f.c,"POST",nextURL+"/finish",{...complete,output:"Explicit control-plane fixture QA report."});
  const done=await advance(f,{...r,run:next.run});assert.equal(done.run.state,"succeeded");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE desktop_workflow_run_id=$1 AND execution_location<>'desktop'",[r.run.id])).rows[0].n,0);
});

test("native failure review skips only after a customer decision and retains the final failure",async()=>{
  const f=await fixture();const definition=steps({on_failure:"review"});definition.steps[1].input_steps=[];
  const {published}=await import("./workflow-native-handoff-fixture-145-v1.js");const r=await launch(f,await published(f,definition));r.run=(await decision(f,r)).run;
  const first=await advance(f,r),url=f.base+"/desktop-executions/"+first.child.task_id;
  await ok(s,f.c,"POST",url+"/start",first.child.fields);await ok(s,f.c,"POST",url+"/finish",{...complete,status:"failed",output:"Known failed, no provider request or unverified operation."});
  const pending=await advance(f,{...r,run:first.run});assert.equal(pending.run.state,"awaiting_approval");
  const warning=await advance(f,{...r,run:pending.run});assert.equal(warning.action,"approval");assert.equal(warning.failure_review.kind,"failure_review");
  r.run=(await decision(f,{...r,run:warning.run},"step")).run;assert.equal(r.run.cursor,1);
  const second=await advance(f,r),next=f.base+"/desktop-executions/"+second.child.task_id;
  await ok(s,f.c,"POST",next+"/start",second.child.fields);await ok(s,f.c,"POST",next+"/finish",{...complete,output:"Independent known completion."});
  const done=await advance(f,{...r,run:second.run});assert.equal(done.run.state,"failed");assert.equal(done.run.error_code,"WORKFLOW_COMPLETED_WITH_STEP_FAILURES");
});
