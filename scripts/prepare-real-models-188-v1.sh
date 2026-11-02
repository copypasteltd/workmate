#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/live-188-v3/candidate.env --input-type=module <<'WM_REAL_MODELS'
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import * as OTPAuth from 'otpauth';
import pg from 'pg';
import assert from 'node:assert/strict';
const folder='/root/cfg/workmate/live-188-v3/',stateFile=folder+'preparation-state.json';
let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={stage:188,operations:{},models:{}};}
const save=()=>writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const secret=JSON.parse(await readFile('/root/cfg/workmate/qa-login-context.json','utf8'));
const control=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await control.connect();
const jar=new Map();let csrf;
async function api(url,body,headers={}){
 const r=await fetch('http://127.0.0.1:63079'+url,{method:body===undefined?'GET':'POST',headers:{Origin:process.env.ADMIN_ORIGIN,Referer:process.env.ADMIN_ORIGIN+'/',Cookie:[...jar.values()].join('; '),'Sec-Fetch-Site':'same-origin',...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(240000)});
 for(const h of r.headers.getSetCookie()){const pair=h.split(';')[0];jar.set(pair.slice(0,pair.indexOf('=')),pair);}
 const data=r.status===204?null:await r.json();if(!r.ok)throw new Error(url+' '+r.status+' '+(data?.error?.code??'UNKNOWN'));
 return data;
}
async function operation(label,url,body,headers={}){
 if(state.operations[label]?.result)return state.operations[label].result;
 const entry=state.operations[label]??={key:randomUUID(),body};await save();assert.deepEqual(entry.body,body);
 const result=await api(url,body,{...headers,'Idempotency-Key':entry.key});entry.result=result;await save();return result;
}
const report={stage:188,status:'running',at:new Date().toISOString(),checks:[],models:{}};
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
async function directory(label,body){
 if(state.operations[label]?.result)return state.operations[label].result;
 const preview=await api('/v1/admin/directory/preview',body);assert.equal(preview.approval,false);
 return operation(label,'/v1/admin/directory/commands',{preview_id:preview.id,payload_hash:preview.payload_hash});
}
async function credit(label,id,amount){
 if(state.operations[label]?.result)return state.operations[label].result;
 const account=await api('/v1/admin/billing/accounts/'+id),body={action:'credit_limit',expected_version:account.version,new_limit:{currency:'HKD',amount_micros:amount},reason:'Stage188 owner-authorized real Agent acceptance credit allowance; no payment received.'};
 const preview=await api('/v1/admin/billing/accounts/'+id+'/previews',body);assert.equal(preview.decision,'super_admin_direct');
 return operation(label,'/v1/admin/billing/accounts/'+id+'/credit-limit',body,{'X-Admin-Preview-ID':preview.preview_id});
}
try{
 const challenge=await api('/v1/admin/auth/challenge',{email:secret.admin_email});
 const mail=JSON.parse(await readFile(process.env.DATA_DIR+'/mailbox/'+challenge.challenge_id+'.json','utf8'));
 const previous=Number((await control.query('SELECT last_totp_step FROM admin_principals WHERE email=$1',[secret.admin_email])).rows[0].last_totp_step);
 if(previous>=Math.floor(Date.now()/30000))await new Promise(r=>setTimeout(r,(previous+1)*30000-Date.now()+250));
 const totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret.admin_totp_secret),digits:6,period:30,algorithm:'SHA1'}).generate();
 const verified=await api('/v1/admin/auth/verify',{challenge_id:challenge.challenge_id,code:mail.text.match(/code is (\d{6})/)[1],totp});csrf=verified.csrf_token;
 assert.equal((await api('/v1/admin/me')).highest_admin,true);pass('canonical administrator OTP/TOTP authenticates the isolated real-mode candidate');
 const original=(await control.query('SELECT r.definition,c.base_url,c.allow_private_network FROM capability_releases r JOIN capability_model_connections c ON c.release_id=r.id WHERE r.id=$1',['786d90e0-8d36-4f8a-a7d7-93e9b7176015'])).rows[0];
 for(const [name,profile,alias,rates,effort] of [
  ['text','internal-text-v1',original.definition.model_alias,original.definition.rates,original.definition.reasoning_effort],
  ['image','internal-image2-v1','gpt-image-2',[Number(process.env.AI_IMAGE_HKD_MICROS_PER_IMAGE??10000)],null],
 ]){
  const entry=state.models[name]??={};await save();
  const body={document:{kernel:'codex',gateway_policy:'company_internal_only',profile_key:profile,model_alias:alias,reasoning_effort:effort,rates},connection:{base_url:original.base_url,reuse_from_release_id:'786d90e0-8d36-4f8a-a7d7-93e9b7176015',allow_private_network:original.allow_private_network},reason:'Owner-authorized stage188 real-service cutover; retain existing configured text tariff and established image tariff.'};
  if(!entry.release_id){const op=await operation(name+'_draft','/v1/admin/capability-releases/drafts',body);assert.equal(op.state,'succeeded');entry.release_id=op.result.release_id;await save();}
  const model=await api('/v1/admin/capability-releases/'+entry.release_id);assert.equal(model.data_mode,'configured_services');
  const command={expected_version:model.version,reason:'Stage188 actual supplier, pinned Codex and metered usage acceptance before public cutover.'};
  if(!entry.validation){entry.connection_test=await api('/v1/admin/capability-releases/'+entry.release_id+'/connection-test',command);await save();assert.equal(entry.connection_test.reachable,true);console.log(JSON.stringify({phase:'real_model_validation_started',profile,alias}));
   const result=await operation(name+'_validation','/v1/admin/capability-releases/'+entry.release_id+'/validations',command);entry.validation=result;await save();}
  report.models[name]={release_id:entry.release_id,alias,state:entry.validation.state,result:entry.validation.result};
  if(entry.validation.state!=='passed'){report.models[name].published=false;console.log(JSON.stringify({phase:'real_model_validation_failed',profile,evidence:entry.validation.result}));continue;}
  pass(name+' model passes actual supplier qualification with known usage');
  if(!entry.publication){const preview=await api('/v1/admin/capability-releases/'+entry.release_id+'/publications-previews',command);assert.equal(preview.decision,'super_admin_direct');entry.publication=await operation(name+'_publication','/v1/admin/capability-releases/'+entry.release_id+'/publications',command,{'X-Admin-Preview-ID':preview.preview_id});await save();assert.equal(entry.publication.state,'succeeded');}
  report.models[name].published=true;pass(name+' real model published through audited highest-administrator policy');
 }
 assert.equal(report.models.text?.published,true,'Real text model must pass before preparing customer scopes');
 const existing=JSON.parse(await readFile('/root/cfg/workmate/agent-test-20261102.sanitized.json','utf8'));
 if(!state.owner_workspace){const result=await directory('owner_real_workspace',{action:'tenants.create',name:'Agent 真实能力测试工作区',owner_id:existing.user_id,project_name:'真实模型能力验证',reason:'Owner-authorized stage188 mode transition; preserve original demo workspace and give the existing test user a real-service scope.'});state.owner_workspace=result.result.items[0];await save();}
 await credit('owner_real_credit',state.owner_workspace.billing_account_id,'100000000000');pass('existing requested test user has a real workspace with the authorized HK$100,000 credit limit');
 if(!state.qa_user){const result=await directory('qa_real_user',{action:'users.create',email:'qa-live-188@workmate.local',display_name:'Real service acceptance',reason:'Dedicated owner-authorized acceptance identity; customer users are not modified.'});state.qa_user=result.result.items[0];await save();}
 if(!state.qa_workspace){const result=await directory('qa_real_workspace',{action:'tenants.create',name:'QA 188 · Real service acceptance',owner_id:state.qa_user.id,project_name:'Actual model and file acceptance',reason:'Dedicated stage188 real-service acceptance workspace.'});state.qa_workspace=result.result.items[0];await save();}
 await credit('qa_real_credit',state.qa_workspace.billing_account_id,'200000000');pass('isolated real QA account created with bounded HK$200 test credit');
 report.health=await api('/health/ready');report.owner_workspace=state.owner_workspace;report.qa_workspace=state.qa_workspace;report.qa_user_id=state.qa_user.id;
 report.status='prepared';
}catch(e){report.status='failed';report.error=e.message;}
finally{
 if(csrf)await api('/v1/admin/auth/logout',{}).catch(()=>{});await control.end();
 const target=folder+'model-preparation-'+randomUUID()+'.sanitized.json';await writeFile(target,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,receipt:target,error:report.error,models:report.models}));
}
assert.equal(report.status,'prepared');
WM_REAL_MODELS
