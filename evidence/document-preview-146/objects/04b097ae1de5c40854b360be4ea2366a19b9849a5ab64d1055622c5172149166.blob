import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {executeLocalWorkflow,type NativeWorkflowIO} from "../src/local-workflow.js";
const canonical=(v:any):string=>v&&typeof v==="object"?Array.isArray(v)?"["+v.map(canonical).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const copy=<T>(v:T):T=>structuredClone(v);
function fixture(){
  const definition={steps:[{kind:"codex",role_key:"fullstack",prompt:"Prepare the customer local work.",budget_micros:100000,on_failure:"review"},
    {kind:"codex",role_key:"software-qa",prompt:"Prepare independent remaining work.",budget_micros:100000,input_steps:[]}]};
  const current:any={id:randomUUID(),workflow_id:randomUUID(),version:1,revision:1,state:"running",cursor:0,authorized:false,execution_location:"desktop",definition,results:[]};
  const initial={run:copy(current),definition_hash:createHash("sha256").update(canonical(definition)).digest("hex"),step_budget_micros:200000,customer_confirmation_required:true,budget_excludes_current_consultant:true};
  const questions:any[]=[],children:any[]=[],abort=new AbortController();let completed=false,active="",forge=false,skip=false;
  const io:NativeWorkflowIO={base:"/approved-native-parent",threadId:"native-root",turnId:"native-turn",signal:abort.signal,
    authorize:async()=>{},read:async()=>({run:copy(current)}),event:async()=>{},
    ask:async request=>{questions.push(request);return {workflow_decision:{answers:[skip&&questions.length===2?"取消流程 / Cancel workflow":"批准 / Approve"]}};},
    child:async child=>{children.push(copy(child));completed=true;},
    request:async(url,body:any)=>{
      assert.equal(body.expected_revision,current.revision);current.revision++;
      if(url.endsWith("/decision")){
        if(body.decision==="cancel")current.state="cancelled";
        else if(body.stage==="launch")current.authorized=true;
        else {assert.equal(current.state,"awaiting_approval");current.state="running";current.results.push({kind:"failure_review_decision",cursor:0,status:"approved",automatically_replayed:false});}
        return {run:copy(current)};
      }
      assert.ok(url.endsWith("/advance"));
      if(completed){completed=false;if(current.cursor===0){current.cursor=1;current.state="awaiting_approval";current.results.push({kind:"failure_review",cursor:0,task_id:active,role_key:"fullstack",status:"awaiting_customer",charged_micros:"0",error_code:"STEP_FAILED",automatically_replayed:false});}
        else {current.cursor=2;current.state="failed";current.error_code="WORKFLOW_COMPLETED_WITH_STEP_FAILURES";}}
      if(current.state==="awaiting_approval")return {action:"approval",message:"Customer review required",run:copy(current),failure_review:{...copy(current.results.at(-1)),...(forge?{cursor:1}:{})}};
      if(current.state==="failed")return {action:"terminal",run:copy(current)};
      active=randomUUID();return {action:"codex",run:copy(current),child:{task_id:active,role_key:definition.steps[current.cursor].role_key,fields:{device_id:randomUUID(),local_session_id:randomUUID(),workspace_hash:"a".repeat(64),runtime_sha256:"b".repeat(64),runtime_version:"fixture"}}};
    }};
  return {initial,io,questions,children,current,setForged:()=>{forge=true;},setCancel:()=>{skip=true;}};
}
test("trusted native runner reviews a known failed step before independent remaining local work and keeps the failure",async()=>{
  const f=fixture(),result=await executeLocalWorkflow(f.io,f.initial);
  assert.equal(result.run.state,"failed");assert.equal(result.run.error_code,"WORKFLOW_COMPLETED_WITH_STEP_FAILURES");assert.equal(f.children.length,2);assert.equal(f.questions.length,2);
  assert.match(f.questions[0].questions[0].question,/Input steps/);assert.match(f.questions[1].questions[0].question,/will never be retried/);
});
test("customer rejection at failure review prevents the next local child",async()=>{
  const f=fixture();f.setCancel();const result=await executeLocalWorkflow(f.io,f.initial);assert.equal(result.run.state,"cancelled");assert.equal(f.children.length,1);
});
test("trusted native runner rejects a failure review inconsistent with the frozen step and saved receipt",async()=>{
  const f=fixture();f.setForged();await assert.rejects(executeLocalWorkflow(f.io,f.initial),/LOCAL_WORKFLOW_CONTRACT_INVALID/);assert.equal(f.children.length,1);assert.equal(f.questions.length,1);
});
test("trusted native runner rejects future input references before asking for any budget approval",async()=>{
  const f=fixture();(f.initial.run.definition.steps[0] as any).input_steps=[1];await assert.rejects(executeLocalWorkflow(f.io,f.initial),/LOCAL_WORKFLOW_CONTRACT_INVALID/);assert.equal(f.questions.length,0);assert.equal(f.children.length,0);
});
