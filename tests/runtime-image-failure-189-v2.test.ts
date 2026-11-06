import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexRuntimeAdapter} from '../src/runtime.js';
import {fixture} from './runtime-image-fixture-189-v1.js';

test('a real native completed turn cannot report success after an unrecovered image tool failure', {timeout:120000}, async t=>{
 const f=await fixture(t,{tool:true});
 try {
  f.context.tools[0].run=async()=>{throw new Error('private-upstream-diagnostic-never-publish');};
  const result=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(result.status,'failed');assert.equal(result.errorCode,'IMAGE_TOOL_FAILED');
  assert.equal(result.usageKnown,true);assert.equal(result.inputTokens,34);assert.equal(result.outputTokens,10);
  assert.ok(f.events.some(v=>v.kind==='runtime.tool.failed'&&v.body.code==='IMAGE_TOOL_FAILED'));
  assert.ok(!JSON.stringify(f.events).includes('private-upstream-diagnostic'));
 } finally {await f.close();}
});

test('a duplicate unknown image operation is blocked before re-execution and keeps actual measured usage', {timeout:120000}, async t=>{
 const f=await fixture(t,{tool:true,toolCount:2});let calls=0;
 try {
  f.context.tools[0].run=async()=>{if(++calls===1)throw new Error('fixture failure');return {retained_image:'controlled fixture'};};
  const result=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.errorCode,'IMAGE_TOOL_FAILED');assert.ok(!f.events.some(e=>e.kind==='runtime.tool.recovered'));
  assert.equal(result.usageKnown,true);assert.equal(result.inputTokens,51);assert.equal(result.outputTokens,15);
 } finally {await f.close();}
});
