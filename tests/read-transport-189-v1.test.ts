import test from 'node:test';
import assert from 'node:assert/strict';
import { clientFetch, clientJson, ClientFailure } from '../src/client-failure.js';

test('a dropped body-free read retries once with exactly the original URL, credentials, headers and cancellation signal', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  const controller=new AbortController();
  const input=new URL('https://ai-api.copypaste.hk/v1/session/context');
  const init:RequestInit={method:'GET',headers:{Authorization:'Bearer synthetic-native-session'},credentials:'omit',redirect:'error',signal:controller.signal};
  const response=new Response('{"user":{"id":"synthetic-user"}}',{status:200});
  let calls=0;
  globalThis.fetch=async (url,options)=>{assert.equal(url,input);assert.equal(options,init);if(++calls===1)throw new TypeError('fetch failed',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});return response;};
  assert.equal(await clientFetch(input,init),response);assert.equal(calls,2);
});

test('reads stop after two connection failures and report a stable, credential-free code', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async()=>{calls++;throw new TypeError('synthetic private transport detail');};
  await assert.rejects(clientFetch('https://ai-api.copypaste.hk/v1/public/config'),error=>error instanceof ClientFailure&&error.code==='CLIENT_CONNECTION_UNAVAILABLE'&&!error.message.includes('private transport'));
  assert.equal(calls,2);
});

test('writes including Request-object methods never replay after a lost response', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  for(const method of ['POST','PUT','PATCH','DELETE']){
    let calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('Lost after possible commit');};
    await assert.rejects(clientFetch('https://ai-api.copypaste.hk/v1/write',{method,body:'{}'}),error=>error instanceof ClientFailure&&error.code==='CLIENT_RESULT_UNCONFIRMED');
    assert.equal(calls,1);
    calls=0;
    await assert.rejects(clientFetch(new Request('https://ai-api.copypaste.hk/v1/write',{method,body:'{}'})),error=>error instanceof ClientFailure&&error.code==='CLIENT_RESULT_UNCONFIRMED');
    assert.equal(calls,1);
  }
});

test('user cancellation suppresses a second read and preserves the exact abort reason', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});let calls=0;
  const controller=new AbortController(),reason=new Error('Owned view closed');
  globalThis.fetch=async()=>{calls++;controller.abort(reason);throw new TypeError('Connection interrupted');};
  await assert.rejects(clientFetch('https://ai-api.copypaste.hk/v1/public/config',{signal:controller.signal}),error=>error===reason);
  assert.equal(calls,1);
});

test('received HTTP failures and invalid JSON responses never create another request', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('Upstream unavailable',{status:503});};
  const response=await clientFetch('https://ai-api.copypaste.hk/v1/public/config');assert.equal(response.status,503);assert.equal(calls,1);
  await assert.rejects(clientJson(response,'GET'),error=>error instanceof ClientFailure&&error.code==='CLIENT_RESPONSE_INVALID');
  assert.equal(calls,1);
});
