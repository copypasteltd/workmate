import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const state='.data/acceptance-189/realowner-state.private.json';
let browser,context;const result={stage:196,status:'running',scope:'Revoke only the owned QA browser session after a test-tool exception exposed its authentication header. No customer password, model key or other session is changed.'};
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});context=await browser.newContext({storageState:JSON.parse(await readFile(state,'utf8'))});const p=await context.newPage();await p.goto('https://agent.copypaste.hk/login',{waitUntil:'domcontentloaded'});
 const r=await p.evaluate(async()=>{const read=await fetch('/v1/session/context',{credentials:'include'});if(read.status===401)return{already_revoked:true};if(!read.ok)throw Error('Session status '+read.status);const data=await read.json(),revoke=await fetch('/v1/auth/logout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':data.csrf_token},body:'{}'});return{revoke_status:revoke.status,after:(await fetch('/v1/session/context',{credentials:'include'})).status};});assert.ok(r.already_revoked||r.revoke_status>=200&&r.revoke_status<300&&r.after===401);result.status='revoked';result.verification=r;
}catch(e){result.status='failed';result.error=e.name+': '+e.message.split('\n')[0];}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});result.owned_browser_closed=true;await writeFile('.data/deployment-196/qa-session-revocation.sanitized.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
assert.equal(result.status,'revoked');
