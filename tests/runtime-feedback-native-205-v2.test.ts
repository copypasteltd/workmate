import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CodexRuntimeAdapter} from '../src/runtime.js';
import {parseToolArguments} from '../src/runtime-tool-feedback.js';
import {fixture} from './runtime-feedback-fixture-205-v2.js';
const schema=z.object({title:z.string().refine(s=>!/[0-9]/.test(s),'PRIVATE_VALIDATOR')}).strict();
for(const repairSecond of [false,true])test(`actual pinned Codex ${repairSecond?'explicitly repairs original call':'independent output retains prior failure'} without changing usage`,{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true,toolCount:2,validSecond:true,repairSecond});let writes=0;
 try{f.context.tools[0].run=async args=>{const v=parseToolArguments(schema,args);writes++;return {delivered:v.title};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,repairSecond?'completed':'failed');assert.equal(writes,1);assert.equal(r.inputTokens,51);assert.equal(r.outputTokens,15);assert.equal(r.usageKnown,true);
  const failure=f.events.find(e=>e.kind==='runtime.tool.failed')!.body;
  assert.equal(failure.outcome_version,2);assert.equal(failure.failure_ref,failure.call_ref);
  const recovered=f.events.find(e=>e.kind==='runtime.tool.recovered');assert.equal(!!recovered,repairSecond);
  if(recovered)assert.equal(recovered.body.repair_of,failure.failure_ref);
  assert.ok(!JSON.stringify(f.inputs).includes('PRIVATE_VALIDATOR'));
 }finally{await f.close();}
});
test('actual native duplicate unknown operation is rejected before the handler, with known provider usage retained',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true,toolCount:2,validSecond:true});let effects=0;
 try{f.context.tools[0].run=async()=>{effects++;throw Error('PRIVATE_UNKNOWN');};const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(effects,1);assert.equal(r.status,'failed');assert.equal(r.usageKnown,true);assert.equal(r.inputTokens,51);
  assert.ok(f.events.some(e=>e.kind==='runtime.tool.repair_rejected'&&e.body.code==='TOOL_RECOVERY_NOT_ALLOWED'));assert.ok(!JSON.stringify(f.inputs).includes('PRIVATE_UNKNOWN'));
 }finally{await f.close();}
});
test('actual native inherits two separate same-tool obligations and cannot clear either with final prose',{timeout:120000},async t=>{
 const f=await fixture(t,{});try{f.context.pendingToolOutcomes=['a','b'].map(c=>({tool:'chart_render',failure_ref:c.repeat(16),call_ref:c.repeat(16),arguments_sha256:c.repeat(64),code:'TOOL_INPUT_INVALID',category:'validation' as const,operation_outcome:'not_performed' as const,can_correct_arguments:true}));
 const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(r.status,'failed');assert.equal(r.errorCode,'TOOL_DELIVERY_INCOMPLETE');assert.equal(r.usageKnown,true);
 }finally{await f.close();}
});

test('actual pinned Codex can correct a mistyped recovery reference without creating a phantom obligation',{timeout:120000},async t=>{const f=await fixture(t,{tool:true,toolCount:3,validSecond:true,repairSecond:true,guessedSecond:true});let writes=0;try{f.context.tools[0].run=async args=>{const v=parseToolArguments(schema,args);writes++;return {delivered:v.title};};const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(r.status,'completed');assert.equal(writes,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.failed').length,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.repair_rejected').length,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.recovered').length,1);assert.equal(r.inputTokens,68);assert.equal(r.outputTokens,20);assert.ok(JSON.stringify(f.inputs).includes('correction_references'));}finally{await f.close();}});
