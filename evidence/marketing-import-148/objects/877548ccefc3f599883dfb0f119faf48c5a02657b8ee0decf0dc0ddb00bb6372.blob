import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {executeLocalWorkflow,type NativeWorkflowIO} from "../src/local-workflow.js";
import {parseLocalInput} from "../src/local-input.js";
const canonical=(v:any):string=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=(v:any)=>createHash('sha256').update(canonical(v)).digest('hex');
function fixture(){
  const fields=Array.from({length:5},(_,i)=>({key:'brief_'+i,label:'Customer brief '+i,type:'text',required:true})),values=Object.fromEntries(fields.map((f,i)=>[f.key,'FIELD_'+i+'_BEGIN\n'+'x'.repeat(3850)+'\nFIELD_'+i+'_END']));
  const definition={input_schema:{fields},steps:[{kind:'codex',role_key:'fullstack',prompt:'Use the fixed reviewed customer inputs.',budget_micros:100000}]};
  const current:any={id:randomUUID(),workflow_id:randomUUID(),version:1,revision:1,state:'running',cursor:0,authorized:false,execution_location:'desktop',definition,results:[],input_values:values,input_files:[],input_hash:digest({values,files:[]})};
  const copy=()=>structuredClone(current),initial={run:copy(),definition_hash:digest(definition),step_budget_micros:100000,customer_confirmation_required:true,budget_excludes_current_consultant:true};
  const questions:any[]=[],requests:any[]=[],children:any[]=[];let cancel=false,changed=false,completed=false;
  const io:NativeWorkflowIO={base:'/native',threadId:'root',turnId:'turn',signal:new AbortController().signal,authorize:async()=>{},read:async()=>({run:copy()}),event:async()=>{},
    ask:async(request,signal,authorize)=>{parseLocalInput(request);assert.equal(signal.aborted,false);questions.push(request);await authorize();
      const q=request.questions[0];if(changed){current.input_values.brief_0='changed';current.input_hash=digest({values:current.input_values,files:[]});}
      return {[q.id]:{answers:[q.id==='workflow_inputs_review'?(cancel?'取消流程 / Cancel workflow':'繼續核對 / Continue review'):'批准 / Approve']}};},
    child:async child=>{children.push(child);completed=true;},request:async(url,body:any)=>{
      requests.push({url,body});assert.equal(body.expected_revision,current.revision);current.revision++;
      if(url.endsWith('/decision')){assert.equal(body.input_hash,current.input_hash);if(body.decision==='cancel')current.state='cancelled';else current.authorized=true;return {run:copy()};}
      if(completed){current.state='succeeded';current.cursor=1;return {action:'terminal',run:copy()};}
      return {action:'codex',run:copy(),child:{task_id:randomUUID(),role_key:'fullstack',fields:{device_id:randomUUID(),local_session_id:randomUUID(),workspace_hash:'a'.repeat(64),runtime_sha256:'b'.repeat(64),runtime_version:'fixture'}}};
    }};
  return {initial,current,io,questions,requests,children,cancel:()=>{cancel=true;},withdraw:()=>{changed=true;}};
}
test('large fixed business inputs are reviewed completely in bounded native cards before fee approval and one child start',async()=>{
  const f=fixture(),r=await executeLocalWorkflow(f.io,f.initial);assert.equal(r.run.state,'succeeded');assert.equal(f.children.length,1);
  const cards=f.questions.filter(q=>q.questions[0].id==='workflow_inputs_review');assert.ok(cards.length>5);const all=cards.map(q=>q.questions[0].question).join('');
  for(let i=0;i<5;i++){assert.match(all,new RegExp('FIELD_'+i+'_BEGIN'));assert.match(all,new RegExp('FIELD_'+i+'_END'));}
  assert.equal(f.questions.at(-1).questions[0].id,'workflow_decision');assert.equal(f.requests[0].body.stage,'launch');assert.equal(f.requests[0].body.input_hash,f.initial.run.input_hash);
});
test('rejecting fixed input review cancels the original run without any child launch or fee approval',async()=>{
  const f=fixture();f.cancel();const r=await executeLocalWorkflow(f.io,f.initial);assert.equal(r.run.state,'cancelled');assert.equal(f.children.length,0);assert.equal(f.questions.length,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.decision,'cancel');
});
test('changed inputs during native review invalidate confirmation before paid admission',async()=>{
  const f=fixture();f.withdraw();await assert.rejects(executeLocalWorkflow(f.io,f.initial),/LOCAL_WORKFLOW_APPROVAL_WITHDRAWN/);assert.equal(f.requests.length,0);assert.equal(f.children.length,0);
});
test('a forged input hash is rejected before any native consent or request',async()=>{
  const f=fixture();f.initial.run.input_hash='0'.repeat(64);await assert.rejects(executeLocalWorkflow(f.io,f.initial),/LOCAL_WORKFLOW_INPUTS_INVALID/);assert.equal(f.questions.length,0);assert.equal(f.requests.length,0);
});
