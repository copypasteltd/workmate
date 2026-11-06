import {context,WEB,ADMIN,ok} from './live-client-189-v2.mjs';
import assert from 'node:assert/strict';

// One retry is permitted only for an actual safe page GET. Authentication
// callbacks, code exchanges, writes and responses are never replayed here.
export async function navigate(page,url){
 const target=new URL(url);
 assert.ok([WEB,ADMIN].includes(target.origin),'Owned company page origin');
 assert.ok(target.pathname==='/'||target.pathname==='/login'||target.pathname==='/downloads'||target.pathname==='/readiness'||target.pathname==='/role-acceptance'||target.pathname==='/app'||target.pathname.startsWith('/app/'),'Read-only page navigation');
 for(let attempt=0;;attempt++){
  try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});assert.ok(response&&response.ok(),'Company page GET must succeed');return response;}
  catch(e){
   const transient=e.name==='TimeoutError'||/net::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT|CONNECTION_RESET|NETWORK_CHANGED)/.test(e.message)||/interrupted by another navigation to "chrome-error:\/\/chromewebdata\//.test(e.message);
   if(attempt!==0||!transient)throw Error(e.name+': '+e.message.split('\n')[0]);
  }
 }
}

export async function existingOwner(browser){
 const c=await context(browser,{storageState:'.data/acceptance-189/realowner-state.private.json'});
 try{
  const page=await c.newPage();await navigate(page,WEB+'/app');
  const identity=await ok(page,'/v1/session/context');
  assert.equal(identity.user.email,'agent-test-20261102@workmate.local');
  assert.ok(identity.memberships.some(m=>m.id==='f5b06ebd-ec59-414c-ad1a-04224d202fc0'));
  return {context:c,page,identity,csrf:identity.csrf_token};
 }catch(e){await c.close().catch(()=>{});throw e;}
}
