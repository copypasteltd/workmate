#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_189'
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import assert from 'node:assert/strict';

const folder='/root/cfg/workmate/live-189-v1/',stateFile=folder+'desktop-qa-plan-state.private.json';
let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={stage:189,operations:{}};}
const save=()=>writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const secret=JSON.parse(await readFile('/root/cfg/workmate/qa-login-context.json','utf8'));
const control=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await control.connect();
const jar=new Map();let csrf;
async function api(url,body,headers={}){
 const response=await fetch('http://127.0.0.1:63073'+url,{method:body===undefined?'GET':'POST',headers:{Origin:process.env.ADMIN_ORIGIN,Referer:process.env.ADMIN_ORIGIN+'/',Cookie:[...jar.values()].join('; '),'Sec-Fetch-Site':'same-origin',...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(240000)});
 for(const header of response.headers.getSetCookie()){const pair=header.split(';')[0];jar.set(pair.slice(0,pair.indexOf('=')),pair);}
 const data=response.status===204?null:await response.json();
 if(!response.ok)throw Error(url+' '+response.status+' '+(data?.error?.code??'UNKNOWN'));
 return data;
}
async function operation(label,url,body,headers={}){
 const entry=state.operations[label]??={key:randomUUID(),body};await save();assert.deepEqual(entry.body,body);
 if(entry.result)return entry.result;
 const result=await api(url,body,{...headers,'Idempotency-Key':entry.key});entry.result=result;await save();return result;
}
const report={stage:189,status:'running',at:new Date().toISOString(),scope:'Time-limited Pro grant on the existing owned acceptance workspace through normal audited admin APIs. Preserve all uncertain tasks, original credit and provider concurrency limits.'};
try{
 const challenge=await api('/v1/admin/auth/challenge',{email:secret.admin_email});
 const mail=JSON.parse(await readFile(process.env.DATA_DIR+'/mailbox/'+challenge.challenge_id+'.json','utf8'));
 const previous=Number((await control.query('SELECT last_totp_step FROM admin_principals WHERE email=$1',[secret.admin_email])).rows[0].last_totp_step);
 if(previous>=Math.floor(Date.now()/30000))await new Promise(resolve=>setTimeout(resolve,(previous+1)*30000-Date.now()+250));
 const totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret.admin_totp_secret),digits:6,period:30,algorithm:'SHA1'}).generate();
 const verified=await api('/v1/admin/auth/verify',{challenge_id:challenge.challenge_id,code:mail.text.match(/code is (\d{6})/)[1],totp});csrf=verified.csrf_token;
 assert.equal((await api('/v1/admin/me')).highest_admin,true);

 const tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0';
 const owned=(await control.query("SELECT tenant_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner' AND status='active' AND NOT admin_suspended",[tenant,'d81349e4-77fc-4321-a9ba-24dca9714376'])).rows[0];assert.ok(owned);
 const root='/v1/admin/entitlement-grants',subject={kind:'tenant',id:tenant};
 const holder=await api(root+'/subjects/tenant/'+tenant),options=await api(root+'/plan-options');
 const plan=options.items.find(p=>p.plan_id==='3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c12');assert.ok(plan);
 const body=state.operations.grant?.body??{subject,plan_version_id:plan.id,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),overlap_policy:'reject',source:'manual',auto_renew:false,expected_subject_version:holder.version,reason:'Owned Desktop 189 real acceptance: temporary published Pro entitlement while an earlier uncertain request remains reserved. No payment, credit change, request release or policy bypass.'};
 const preview=await api('/v1/admin/entitlement-previews',body);assert.equal(preview.decision,'recent_mfa');
 const result=await operation('grant',root,body,{'X-Admin-Preview-ID':preview.preview_id});assert.equal(result.state,'succeeded');
 const grant=await api(root+'/'+result.result_ids[0]);assert.equal(grant.state,'active');assert.equal(grant.auto_renew,false);
 report.subject=subject;report.grant_id=grant.id;report.operation_id=result.id;report.ends_at=body.ends_at;report.status='granted';
}catch(error){report.status='failed';report.error=error.name+': '+String(error.message).split('\n')[0];}
finally{
 if(csrf)await api('/v1/admin/auth/logout',{}).catch(()=>{});await control.end();
 const file=folder+'desktop-qa-plan-'+randomUUID()+'.sanitized.json';
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
}
assert.equal(report.status,'granted');
WM_IMAGE_189
