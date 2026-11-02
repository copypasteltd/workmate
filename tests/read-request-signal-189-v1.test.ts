import test from 'node:test';
import assert from 'node:assert/strict';
import {clientFetch} from '../src/client-failure.js';

test('an explicit null signal follows Fetch semantics and does not inherit an aborted Request signal',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const controller=new AbortController();controller.abort(new Error('Old request signal'));
 const request=new Request('https://ai-api.copypaste.hk/v1/public/config',{signal:controller.signal});
 const init:RequestInit={signal:null};let calls=0;
 const response=new Response('{}',{status:200});
 globalThis.fetch=async(input,options)=>{assert.equal(input,request);assert.equal(options,init);if(++calls===1)throw new TypeError('Transient read failure');return response;};
 assert.equal(await clientFetch(request,init),response);assert.equal(calls,2);
});
