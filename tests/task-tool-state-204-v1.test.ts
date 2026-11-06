import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainTaskActivity, pendingToolFeedback } from '../renderer/src/task-tool-state.js';
test('long streamed replies retain current failure even beyond the display window, then successful recovery replaces it',()=>{
 const failed={id:1,kind:'runtime.tool.failed',body:{tool:'chart_render',code:'TOOL_INPUT_INVALID',category:'validation',call_ref:'a'.repeat(16)}};
 let items=retainTaskActivity([], [failed]);
 for(let i=2;i<=900;i++)items=retainTaskActivity(items,[{id:i,kind:'message.appended',body:{text:'controlled'}}]);
 assert.equal(pendingToolFeedback(items)[0]?.code,'TOOL_INPUT_INVALID');assert.ok(items.length<=528);
 items=retainTaskActivity(items,[{id:901,kind:'runtime.tool.completed',body:{tool:'chart_render'}}]);
 assert.equal(pendingToolFeedback(items).length,0);
});
test('feedback presentation ignores private text, unsafe references and invalid event names and bounds current items',()=>{
 const items=Array.from({length:12},(_,i)=>({id:i,kind:'runtime.tool.failed',body:{tool:'tool_'+i,code:'unsafe private text',call_ref:'bad private key',category:'private',guidance:'never shown'}}));
 const output=pendingToolFeedback(items);
 assert.equal(output.length,4);assert.ok(output.every(v=>v.code==='TOOL_EXECUTION_FAILED'&&v.reference===''&&v.category==='execution'));
 assert.ok(!JSON.stringify(output).includes('never shown'));
 assert.deepEqual(pendingToolFeedback([{id:99,kind:'arbitrary',body:{tool:'chart_render'}}]),[]);
});
