import {launch,context,authenticate,call,ok,WEB,ADMIN,API,privateRoot,screenshot} from './live-client-188-v1.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const run=path.join(privateRoot,'public-baseline-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:188,status:'running',at:new Date().toISOString(),checks:[],transport:'Real public HTTPS over owned application-host CONNECT transport. Browser validates TLS; no response/cookie/origin rewrites.'};
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
let browser,admin,user,c;
try{
 browser=await launch();c=await context(browser);
 for(const origin of [WEB,ADMIN,API]){const r=await c.request.get(origin+'/health/ready');assert.equal(r.status(),200);const health=await r.json();assert.equal(health.kernel,'codex');}
 pass('all three actual public HTTPS origins serve a ready Codex API with valid TLS');
 admin=await authenticate(browser,'admin');assert.equal(admin.identity.highest_admin,true);pass('actual administrator email OTP and TOTP sign-in works');
 const account=JSON.parse(await readFile('.data/account-186/provisioning-v5.sanitized.json','utf8'));
 user=await authenticate(browser,'user',account.email);assert.equal(user.identity.user.id,account.user_id);pass('actual user email OTP sign-in works');
 const cfg=await ok(user.page,'/v1/public/config');report.data_mode=cfg.data_mode;report.services=cfg.services;assert.equal(cfg.data_mode,'simulated');
 await user.page.goto(WEB+'/app/roles',{waitUntil:'networkidle'});await user.page.locator('.role-card').first().waitFor();assert.ok(await user.page.locator('.demo-notice').isVisible());
 pass('existing demo banner accurately follows the live API data mode');
 const roles=await ok(user.page,'/v1/catalog/roles');assert.ok(roles.items.length>=12);report.role_count=roles.items.length;pass('live specialist catalogue exposes at least twelve roles');
 const releases=await ok(admin.page,'/v1/admin/capability-releases');report.models=(releases.items??[]).map(r=>({id:r.id,alias:r.document?.model_alias,state:r.state,current:r.current,validation:r.validation_state}));
 pass('administrator can read the real saved model configurations');
 const cross=await call(user.page,'/v1/admin/me');assert.ok([401,403].includes(cross.status));pass('ordinary user session cannot access administrator identity');
 await screenshot(user.page,path.join(run,'baseline-role-page.png'));
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;}
finally{await user?.context.close();await admin?.context.close();await c?.close();await browser?.close();report.browser_closed=true;report.sessions_retained_for_same_task=true;await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
