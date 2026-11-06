import {context,WEB} from './live-client-189-v2.mjs';
import {navigate} from './live-read-only-owner-198-v1.mjs';
import assert from 'node:assert/strict';
export {navigate};

/** Read-only stored-session check, bounded even when a public path stalls. */
export async function existingOwner(browser){
 const c=await context(browser,{storageState:'.data/acceptance-189/realowner-state.private.json'});
 try{
  const page=await c.newPage();await navigate(page,WEB+'/app');
  const r=await page.evaluate(async()=>{
   const r=await fetch('/v1/session/context',{credentials:'include',signal:AbortSignal.timeout(45000)});
   return {status:r.status,body:await r.json()};
  });
  assert.equal(r.status,200,'Existing real owner session must remain valid');
  const identity=r.body;
  assert.equal(identity.user.email,'agent-test-20261102@workmate.local');
  assert.ok(identity.memberships.some(m=>m.id==='f5b06ebd-ec59-414c-ad1a-04224d202fc0'));
  return {context:c,page,identity,csrf:identity.csrf_token};
 }catch(e){await c.close().catch(()=>{});throw e;}
}
