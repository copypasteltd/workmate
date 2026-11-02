import {launch,context,authenticate,WEB,ADMIN} from './live-client-189-v2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const run=path.resolve('.data/recheck-190/browser-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:190,at:new Date().toISOString(),scope:'Fresh protected-mailbox OTP/customer login, administrator OTP/TOTP, real public config/catalog and read-only management resources. Canonical HTTPS via existing owned application-host CONNECT; this is distinct from direct public connectivity checks.',checks:[],javascript_errors:[],new_paid_tasks:0};
let browser,guest,admin,user;
const add=(name,status,details={})=>{report.checks.push({name,status,...details});console.log(JSON.stringify({name,status,...details}));};
const failure=e=>({error_class:e.name,message:String(e.message).split('\n')[0].slice(0,220)});
const timer=setTimeout(()=>void browser?.close(),240000);timer.unref();
async function read(page,route){return page.evaluate(async route=>{const r=await fetch(route,{credentials:'include',signal:AbortSignal.timeout(15000)});const b=await r.json();return {status:r.status,body:b};},route);}
try{
 browser=await launch();guest=await context(browser);
 for(const origin of [WEB,ADMIN]){
  try{const r=await guest.request.get(origin+'/health/ready',{timeout:12000});const b=await r.json();add(origin+' readiness',r.status()===200&&b.data_mode==='configured_services'?'passed':'failed',{http_status:r.status(),data_mode:b.data_mode,kernel:b.kernel});}
  catch(e){add(origin+' readiness','failed',failure(e));}
 }
 try{
  admin=await authenticate(browser,'admin');admin.page.on('pageerror',e=>report.javascript_errors.push({client:'admin',error_class:e.name}));
  add('Fresh administrator OTP plus TOTP and highest-admin identity',admin.identity.highest_admin?'passed':'failed');
  for(const route of ['/v1/admin/overview','/v1/admin/users','/v1/admin/tenants','/v1/admin/capability-releases','/v1/admin/approvals/summary','/v1/admin/quality']){
   try{const r=await read(admin.page,route);add('Admin GET '+route,r.status===200?'passed':'failed',{http_status:r.status,...(r.status===200?{}:{error_code:r.body?.error?.code})});}
   catch(e){add('Admin GET '+route,'failed',failure(e));}
  }
  for(const route of ['/users','/tenants','/catalog','/provider-control']){
   try{await admin.page.goto(ADMIN+route,{waitUntil:'networkidle',timeout:20000});const alerts=await admin.page.locator('.error-notice,[role="alert"]').allTextContents();add('Admin actual page '+route,alerts.length?'needs_review':'passed',{visible_alert_count:alerts.length});}
   catch(e){add('Admin actual page '+route,'failed',failure(e));}
  }
 }catch(e){add('Fresh administrator sign-in','failed',failure(e));}
 try{
  user=await authenticate(browser,'imageqa190','qa-image-189-e3e12abe@workmate.local');user.page.on('pageerror',e=>report.javascript_errors.push({client:'web',error_class:e.name}));
  add('Fresh customer OTP received in protected test mailbox and login completed','passed');
  const config=await read(user.page,'/v1/public/config');
  add('Public configured-services mode',config.status===200&&config.body.data_mode==='configured_services'?'passed':'failed',{http_status:config.status,data_mode:config.body.data_mode,services:config.body.services});
  const roles=await read(user.page,'/v1/catalog/roles');
  add('Preset specialist catalog',roles.status===200&&roles.body.items?.length>=12?'passed':'failed',{http_status:roles.status,role_count:roles.body.items?.length,availability:roles.body.items?.map(r=>({role_key:r.role_key,available:r.available}))});
  const base='/v1/tenants/e8a85531-0660-472e-a501-488d6f51455c/projects/da4ccb95-7b7d-4538-bc47-1f300642a5a9';
  const task=await read(user.page,base+'/tasks/76ee4703-63d0-4524-8269-ab55d3192970');
  add('Existing real image task remains succeeded with unchanged measured charge',task.status===200&&task.body.status==='succeeded'&&String(task.body.charged_micros)==='39961'?'passed':'failed',{http_status:task.status,task_status:task.body.status,charged_micros:task.body.charged_micros});
  for(const route of ['/app/roles','/app/assets']){
   try{await user.page.goto(WEB+route,{waitUntil:'networkidle',timeout:20000});const alerts=await user.page.locator('.error-notice,[role="alert"]').allTextContents();add('Web actual page '+route,alerts.length?'needs_review':'passed',{visible_alert_count:alerts.length});}
   catch(e){add('Web actual page '+route,'failed',failure(e));}
  }
 }catch(e){add('Fresh customer login/configuration inspection','failed',failure(e));}
}catch(e){add('Browser launch','failed',failure(e));}
finally{
 clearTimeout(timer);await admin?.context.close().catch(()=>{});await user?.context.close().catch(()=>{});await guest?.close().catch(()=>{});await browser?.close().catch(()=>{});
 report.owned_browsers_closed=true;report.finished_at=new Date().toISOString();report.status=report.checks.some(r=>r.status==='failed')?'failed':report.checks.some(r=>r.status==='needs_review')?'needs_review':'passed';
 await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json')}));
}
