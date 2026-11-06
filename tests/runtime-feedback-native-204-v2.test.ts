import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CodexRuntimeAdapter} from '../src/runtime.js';
import {parseToolArguments} from '../src/runtime-tool-feedback.js';
import {fixture} from './runtime-feedback-fixture-204-v1.js';
const input=z.object({title:z.string().refine(s=>!/[0-9]/.test(s),'private-error-do-not-publish')}).strict();
test('actual native Codex receives safe invalid-input feedback, corrects before one delivery, and retains all measured usage',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true,toolCount:2,validSecond:true});let writes=0;
 try {
  f.context.tools[0].run=async args=>{const parsed=parseToolArguments(input,args);writes++;return {delivered:parsed.title};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,'completed');assert.equal(writes,1);assert.equal(r.inputTokens,51);assert.equal(r.outputTokens,15);assert.equal(r.usageKnown,true);
  const feedback=f.events.find(e=>e.kind==='runtime.tool.failed')?.body;
  assert.equal(feedback.code,'TOOL_INPUT_INVALID');assert.equal(feedback.operation_outcome,'not_performed');assert.equal(feedback.fields[0].path,'arguments.title');
  assert.ok(f.events.some(e=>e.kind==='runtime.tool.recovered'));
  assert.match(JSON.stringify(f.inputs.slice(1)),/TOOL_INPUT_INVALID/);
  assert.ok(!JSON.stringify(f.inputs).includes('private-error-do-not-publish'));
 } finally {await f.close();}
});
test('actual native final prose cannot declare success while chart delivery failed',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true});let writes=0;
 try {
  f.context.tools[0].run=async args=>{parseToolArguments(input,args);writes++;return {};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,'failed');assert.equal(r.errorCode,'TOOL_DELIVERY_INCOMPLETE');assert.equal(writes,0);
  assert.equal(r.usageKnown,true);assert.equal(r.inputTokens,34);assert.equal(r.outputTokens,10);
 } finally {await f.close();}
});

test('a new native turn inherits durable delivery failure and cannot replace it with completion prose',{timeout:120000},async t=>{
 const f=await fixture(t,{});
 try {f.context.unresolvedDeliveryToolNames=['chart_render'];const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,'failed');assert.equal(r.errorCode,'TOOL_DELIVERY_INCOMPLETE');assert.equal(r.usageKnown,true);assert.ok(r.inputTokens>0);
 } finally {await f.close();}
});
test('a recorded successful registered tool clears inherited failure while retaining measured native usage',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true});let calls=0;
 try {f.context.unresolvedDeliveryToolNames=['chart_render'];f.context.tools[0].run=async()=>{calls++;return {delivered:'Explicit controlled successful handler result'};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(calls,1);assert.equal(r.status,'completed');assert.equal(r.usageKnown,true);assert.ok(r.inputTokens>0);assert.ok(f.events.some(e=>e.kind==='runtime.tool.recovered'));
 } finally {await f.close();}
});
