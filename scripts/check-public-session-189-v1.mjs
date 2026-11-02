import { launch, context, authenticate, WEB, ADMIN, API, ok, privateRoot } from './live-client-189-v1.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
let browser, guest, admin, user;
const report={stage:189,status:'running',at:new Date().toISOString(),checks:[],transport:'Owned application-host CONNECT; end-to-end canonical HTTPS with normal certificate validation.'};
try{
 browser=await launch();guest=await context(browser);
 for(const origin of [WEB,ADMIN,API]){
  const response=await guest.request.get(origin+'/health/ready',{timeout:30000});
  assert.equal(response.status(),200,origin+' readiness');
  const ready=await response.json();assert.equal(ready.kernel,'codex');assert.equal(ready.data_mode,'configured_services');
  report.checks.push({origin,status:response.status(),data_mode:ready.data_mode});
 }
 admin=await authenticate(browser,'admin');assert.equal(admin.identity.highest_admin,true);
 report.checks.push({name:'Actual administrator email OTP and TOTP authentication',status:'passed'});
 user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
 const config=await ok(user.page,'/v1/public/config');assert.equal(config.data_mode,'configured_services');
 report.checks.push({name:'Actual customer email OTP authentication and real-service mode',status:'passed'});
 report.status='passed';
}catch(error){report.status='failed';report.error=error.name+': '+String(error.message).split('\n')[0];}
finally{
 await admin?.context.close();await user?.context.close();await guest?.close();await browser?.close();
 report.owned_browser_closed=true;
 const file=path.join(privateRoot,'public-session-'+randomUUID()+'.json');
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,receipt:file}));
}
assert.equal(report.status,'passed');
