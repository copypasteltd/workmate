import test from 'node:test';
import assert from 'node:assert/strict';
import {withinPreviewDeadline} from '../src/preview-deadline.js';

test('a browser protocol that never replies cannot prevent cancellation from reaching owned cleanup',async()=>{
 const controller=new AbortController();let cleaned=false,finish!:()=>void;
 const work=withinPreviewDeadline(controller.signal,()=>new Promise<void>(resolve=>{finish=resolve;}));
 const settled=work.finally(()=>{cleaned=true;});
 controller.abort();
 await assert.rejects(settled,/PREVIEW_STOPPED/);assert.equal(cleaned,true);
 // The original protocol reply can arrive after cleanup without replaying work.
 finish();await Promise.resolve();assert.equal(cleaned,true);
});

test('an already cancelled preview never starts another protocol operation',async()=>{
 const controller=new AbortController();controller.abort();let started=0;
 await assert.rejects(withinPreviewDeadline(controller.signal,async()=>{started++;}),/PREVIEW_STOPPED/);
 assert.equal(started,0);
});

test('successful results and actual browser failures are preserved before the deadline',async()=>{
 const controller=new AbortController();const value={actual:true};
 assert.equal(await withinPreviewDeadline(controller.signal,async()=>value),value);
 const failure=new Error('Actual protocol failure');
 await assert.rejects(withinPreviewDeadline(controller.signal,async()=>{throw failure;}),e=>e===failure);
 controller.abort();
});
