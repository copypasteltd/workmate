import {launch,authenticate,ok,privateRoot} from './live-client-189-v2.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const file=path.join(privateRoot,'image-web-isolated-setup-189-v1.private.json');
const old=JSON.parse(await readFile('.data/deployment-179/real-mode-prepared-188.sanitized.json','utf8'));
let report;try{report=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;report={stage:189,status:'running',at:new Date().toISOString(),email:'qa-image-189-'+randomUUID().slice(0,8)+'@workmate.local',operations:{},scope:'Owned isolated image QA account/workspace, HK$10 credit allowance and one-day manual Pro. No payment, global limit change or release of old uncertain requests.'};}
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
let browser,admin,user;
async function command(label,body){
 const entry=report.operations[label]??={body,key:randomUUID()};assert.deepEqual(entry.body,body);await save();if(entry.result)return entry.result;
 const headers={'X-CSRF-Token':admin.csrf};const preview=await ok(admin.page,'/v1/admin/directory/preview',body,headers);
 const result=await ok(admin.page,'/v1/admin/directory/commands',{preview_id:preview.id,payload_hash:preview.payload_hash},{...headers,'Idempotency-Key':entry.key});assert.equal(result.state,'succeeded');entry.result=result;await save();return result;
}
try{
 await save();browser=await launch();
 user=await authenticate(browser,'realqa','qa-live-188@workmate.local');
 const base=`/v1/tenants/${old.qa_workspace.id}/projects/${old.qa_workspace.project_id}`,id='8e92d03a-8578-4cce-bf41-7f28102b928f';
 const queued=await ok(user.page,base+'/tasks/'+id);
 if(queued.status==='queued'){
  await ok(user.page,'/v1/tasks/'+id+'/controls',{action:'cancel',expected_version:queued.version},{'X-CSRF-Token':user.csrf,'X-Tenant-ID':old.qa_workspace.id});
  const cancelled=await ok(user.page,base+'/tasks/'+id);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.charged_micros,'0');report.cancelled_unstarted_task_id=id;await save();
 }
 await user.context.close();user=null;
 admin=await authenticate(browser,'admin');assert.equal(admin.identity.highest_admin,true);
 if(!report.qa_user_id){const created=await command('user',{action:'users.create',email:report.email,display_name:'Owned image acceptance 189',reason:'Create only an isolated owned image-service acceptance account; email verification remains required on first sign-in.'});report.qa_user_id=created.result.items[0].id;await save();}
 if(!report.qa_workspace){const created=await command('workspace',{action:'tenants.create',name:'Owned image acceptance 189 '+randomUUID().slice(0,8),owner_id:report.qa_user_id,project_name:'Real image generation acceptance',reason:'Keep historical unknown-cost Desktop tasks and the existing tenant capacity policy intact.'});report.qa_workspace=created.result.items[0];await save();}
 const headers={'X-CSRF-Token':admin.csrf},root='/v1/admin/billing/accounts/'+report.qa_workspace.billing_account_id;
 if(!report.credit_operation){const account=await ok(admin.page,root),body={action:'credit_limit',expected_version:account.version,new_limit:{currency:'HKD',amount_micros:'10000000'},reason:'Owned image-service acceptance HK$10 credit allowance, not a received payment.'};const preview=await ok(admin.page,root+'/previews',body,headers),result=await ok(admin.page,root+'/credit-limit',body,{...headers,'X-Admin-Preview-ID':preview.preview_id});assert.equal(result.state,'succeeded');report.credit_operation=result.id;await save();}
 if(!report.pro_grant_id){const grants='/v1/admin/entitlement-grants',subject={kind:'tenant',id:report.qa_workspace.id},holder=await ok(admin.page,grants+'/subjects/tenant/'+subject.id),options=await ok(admin.page,grants+'/plan-options');const plan=options.items.find(p=>p.plan_id==='3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c12');assert.ok(plan);const body={subject,plan_version_id:plan.id,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),overlap_policy:'reject',source:'manual',auto_renew:false,expected_subject_version:holder.version,reason:'One-day owned image acceptance Pro grant; no payment or global admission policy change.'};const preview=await ok(admin.page,'/v1/admin/entitlement-previews',body,headers),result=await ok(admin.page,grants,body,{...headers,'X-Admin-Preview-ID':preview.preview_id});assert.equal(result.state,'succeeded');report.pro_grant_id=result.result_ids[0];report.pro_ends_at=body.ends_at;await save();}
 report.status='prepared';await save();console.log(JSON.stringify({status:report.status,file,qa_workspace:report.qa_workspace}));
}catch(error){report.status='failed';report.error=String(error.message);await save();throw error;}
finally{await user?.context.close();await admin?.context.close();await browser?.close();report.owned_browser_closed=true;await save();}
