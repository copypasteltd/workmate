import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Problem } from '../src/lib.js';
import { parseToolArguments, safeToolFeedback, ToolInputFailure, RuntimeToolState } from '../src/runtime-tool-feedback.js';
import { canonicalEvent } from '../src/task-events.js';

const tool={name:'chart_render',inputSchema:{type:'object',properties:{title:{type:'string'},narrative:{type:'array',items:{type:'object',properties:{text:{type:'string'}}}}}}};
test('safe input feedback identifies only trusted fields without values, messages, rejected keys or dynamic paths',()=>{
 const marker='private-customer-secret';
 const e=new ToolInputFailure([
  {code:'custom',path:['title'],message:marker},
  {code:'custom',path:['narrative',0,'text'],message:marker},
  {code:'custom',path:[marker],message:marker},
 ]);
 const result=safeToolFeedback(e,tool);
 assert.equal(result.operation_outcome,'not_performed');assert.equal(result.can_correct_arguments,true);
 assert.deepEqual(result.fields?.map(v=>v.path),['arguments.title','arguments.narrative[].text','arguments']);
 assert.ok(!JSON.stringify(result).includes(marker));
});
test('argument parse boundary prevents business execution, while downstream validation is not proof of no side effects',()=>{
 let writes=0;const schema=z.object({title:z.string().refine(s=>!/[0-9]/.test(s),'private validator text')}).strict();
 try {parseToolArguments(schema,{title:'2026 private value'});writes++;assert.fail('must reject');}
 catch(e){assert.equal(safeToolFeedback(e,tool).operation_outcome,'not_performed');}
 assert.equal(writes,0);
 const parsed=schema.safeParse({title:2026});assert.equal(parsed.success,false);
 assert.equal(safeToolFeedback(parsed.error,tool).operation_outcome,'unverified');
});
test('domain feedback is static; arbitrary provider messages, Problem details and prototype keys never become correction permission',()=>{
 const secret='private-key-and-source';
 for(const error of [new Error(secret),new Problem(500,'REPORT_NARRATIVE_INVALID_EXTRA',secret,{secret}),new Problem(422,'toString',secret)]){
  const result=safeToolFeedback(error,tool);assert.equal(result.can_correct_arguments,false);assert.ok(!JSON.stringify(result).includes(secret));
 }
 const result=safeToolFeedback(new Problem(422,'REPORT_NARRATIVE_INVALID',secret),tool);
 assert.equal(result.operation_outcome,'not_performed');assert.match(result.guidance,/placeholders/);assert.ok(!JSON.stringify(result).includes(secret));
});
test('unrecovered delivery fails, actual same-tool recovery clears it, read failure alone does not invent a failed delivery',()=>{
 const state=new RuntimeToolState(),failure=safeToolFeedback(new Error('controlled'),tool);
 state.fail('analysis_file_inspect',failure);assert.equal(state.unresolvedDelivery,false);
 state.fail('chart_render',failure);assert.equal(state.unresolvedDelivery,true);assert.equal(state.terminalCode,'TOOL_DELIVERY_INCOMPLETE');
 state.complete('deliver_text');assert.equal(state.unresolvedDelivery,true);
 state.complete('chart_render');assert.equal(state.unresolvedDelivery,false);
});
test('canonical stream preserves bounded safe tool feedback and excludes arbitrary private body fields',()=>{
 const value=canonicalEvent({kind:'runtime.tool.failed',seq:7,created_at:new Date(),body:{tool:'chart_render',call_ref:'a'.repeat(16),code:'TOOL_INPUT_INVALID',category:'validation',guidance:'private prose',arguments:{secret:'never'}}});
 assert.equal(value.type,'runtime.tool.failed');assert.deepEqual(value.payload,{tool:'chart_render',call_ref:'a'.repeat(16),code:'TOOL_INPUT_INVALID',category:'validation'});
});
