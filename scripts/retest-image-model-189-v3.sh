#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v4/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_RETEST_IMAGE_189'
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import assert from 'node:assert/strict';

const folder='/root/cfg/workmate/live-189-v4/',stateFile=folder+'image-retest-189-v3.private.json';
let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={stage:189,model:'gpt-image-2',operations:{}};}
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
async function operation(label,url,makeBody,headers={}){
 const entry=state.operations[label]??={key:randomUUID(),body:await makeBody()};await save();
 if(entry.result)return entry.result;
 const result=await api(url,entry.body,{...headers,'Idempotency-Key':entry.key});entry.result=result;await save();return result;
}
const report={stage:189,status:'running',at:new Date().toISOString(),model:'gpt-image-2',original_failures_preserved:true,capacity_releases:[]};
try{
 const challenge=await api('/v1/admin/auth/challenge',{email:secret.admin_email});
 const mail=JSON.parse(await readFile(process.env.DATA_DIR+'/mailbox/'+challenge.challenge_id+'.json','utf8'));
 const principal=(await control.query('SELECT id,last_totp_step FROM admin_principals WHERE email=$1',[secret.admin_email])).rows[0];
 const previous=Number(principal.last_totp_step);
 if(previous>=Math.floor(Date.now()/30000))await new Promise(resolve=>setTimeout(resolve,(previous+1)*30000-Date.now()+250));
 const totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret.admin_totp_secret),digits:6,period:30,algorithm:'SHA1'}).generate();
 const verified=await api('/v1/admin/auth/verify',{challenge_id:challenge.challenge_id,code:mail.text.match(/code is (\d{6})/)[1],totp});csrf=verified.csrf_token;
 assert.equal((await api('/v1/admin/me')).highest_admin,true);
 const source=(await control.query(`SELECT r.id,c.base_url,c.encrypted_api_key FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id JOIN capability_model_connections c ON c.release_id=r.id WHERE h.data_mode='configured_services' AND h.profile_key='internal-text-v1'`)).rows[0];
 const releaseId='23c14286-d6a8-4876-9384-51cfcbbdc405';
 const release=await api('/v1/admin/capability-releases/'+releaseId);
 assert.equal(release.document.model_alias,'gpt-image-2');
 const binding=(await control.query('SELECT base_url,(encrypted_api_key=$2) AS same_key FROM capability_model_connections WHERE release_id=$1',[releaseId,source.encrypted_api_key])).rows[0];
 assert.equal(binding.base_url,source.base_url);assert.equal(binding.same_key,true);
 report.release_id=releaseId;report.base_url=binding.base_url;report.same_upstream_key_as_text=true;
 for(const [id,expectedHttp] of [['b29c076a-1fdd-497a-a5c3-71090cdcb56c',403],['54d8c94a-b193-4102-84fb-048be7a8a304',403],['03f7f43a-feee-4290-b64a-4452e02a643a',200],['5cbc9945-9af1-45f7-bf83-57019c13a103',200]]){
  const row=await api('/v1/admin/ai/requests/generation/'+id);
  assert.equal(row.data_mode,'configured_services');assert.equal(row.actor_id,principal.id);assert.equal(row.request_class,'image');assert.equal(row.http_status,expectedHttp);assert.equal(row.state,'unknown');assert.equal(row.cost.state,'unknown');assert.ok(row.finished_at);
  const allocated=async()=> (await control.query('SELECT ai_budget_used(envelope_id,platform_period_id)::text AS used FROM ai_request_budget_allocations WHERE provider_request_id=$1',[id])).rows;
  const beforeBudget=await allocated();
  if(row.capacity_held){
   const evidence=await operation('termination-evidence:'+id,'/v1/admin/ai/requests/generation/'+id+'/evidence',async()=>({document:{schema_version:1,purpose:'termination_only',data_mode:row.data_mode,operation_id:row.operation_id,request_hash:row.request_hash,provider_reference:'Recorded terminal upstream HTTP '+expectedHttp+' response',source_reference:'Original gateway request '+id+' and its recorded validation receipt; HTTP 200 observations include validations eab47ede-ffe5-424a-93f1-35ea72cc2b90 and 568ed719-1472-4528-abb6-ae71beedb33c',source_note:expectedHttp===403?'The original gateway operation received a terminal HTTP 403 response and has a recorded finish time. This statement confirms only termination and does not assert any usage quantity, invoice amount or no-charge status.':'The synchronous image response was fully consumed as HTTP 200 before image verification failed. The model-specific diagnostic validation recorded a complete inline PNG with a 1254-square IHDR, contrary to the requested 1024 square. The request has ended; this statement does not assert any confirmed usage quantity, invoice, zero charge or successful validation.',observed_at:new Date().toISOString(),terminated:true,outcome:'failed',currency:'HKD',billed_micros:null,usage:{kind:'image'}},reason:'Owner requested another actual image validation; release only the ended request capacity and retain all unknown financial facts.'}));
   assert.equal(evidence.state,'succeeded');
   const command={action:'ai.capacity.release',channel:'generation',request_id:id,evidence_id:evidence.result_ids[0],reason:'Highest administrator confirms the terminal synchronous HTTP response, retaining the unknown cost, original observation, budget and audit.'};
   let entry=state.operations['capacity:'+id];
   if(!entry){const preview=await api('/v1/admin/ai/previews',command);assert.equal(preview.decision,'super_admin_direct');entry=state.operations['capacity:'+id]={key:randomUUID(),body:{command,preview_id:preview.preview_id}};await save();}
   const released=await operation('capacity:'+id,'/v1/admin/ai/operations',async()=>entry.body);assert.equal(released.state,'succeeded');
  }
  const after=await api('/v1/admin/ai/requests/generation/'+id);
  assert.equal(after.capacity_held,false);assert.equal(after.state,'unknown');assert.equal(after.cost.state,'unknown');assert.equal(after.cost.amount_micros,null);assert.deepEqual(await allocated(),beforeBudget);assert.ok(after.termination_confirmation_id);
  report.capacity_releases.push({request_id:id,capacity_held:false,cost_state:after.cost.state,original_state:after.state,budget_unchanged:true,termination_confirmation_id:after.termination_confirmation_id});
 }
 const command={expected_version:release.version,reason:'Owner explicitly requested a fresh actual generation and edit retest of gpt-image-2 after the upstream group permission refusal.'};
 const connection=await api('/v1/admin/capability-releases/'+releaseId+'/connection-test',command);report.connection_test=connection;assert.equal(connection.reachable,true);assert.equal(connection.model_available,true);
 console.log(JSON.stringify({phase:'fresh_actual_generation_and_edit_started',model:'gpt-image-2',release_id:releaseId}));
 const validation=await operation('fresh-validation','/v1/admin/capability-releases/'+releaseId+'/validations',async()=>command);report.validation=validation;
 report.requests=(await control.query('SELECT id,operation,model_alias,state,http_status,outcome_code,usage_known,finished_at FROM ai_gateway_requests WHERE subject_kind=\'validation\' AND validation_id=$1 ORDER BY created_at',[validation.id])).rows;
 assert.equal(validation.state,'passed','Actual image generation and edit must pass before publication');
 const preview=await api('/v1/admin/capability-releases/'+releaseId+'/publications-previews',command);assert.equal(preview.decision,'super_admin_direct');
 const publication=await operation('publication','/v1/admin/capability-releases/'+releaseId+'/publications',async()=>command,{'X-Admin-Preview-ID':preview.preview_id});assert.equal(publication.state,'succeeded');report.publication_id=publication.id;
 const head=(await control.query(`SELECT p.release_id,r.definition->>'model_alias' AS alias,c.base_url,(c.encrypted_api_key=s.encrypted_api_key) AS same_key FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id JOIN capability_model_connections c ON c.release_id=r.id JOIN capability_model_connections s ON s.release_id=$1 WHERE h.data_mode='configured_services' AND h.profile_key='internal-image2-v1'`,[source.id])).rows[0];
 assert.equal(head.release_id,releaseId);assert.equal(head.alias,'gpt-image-2');assert.equal(head.base_url,source.base_url);assert.equal(head.same_key,true);report.current=head;report.status='published_and_verified';
}catch(error){report.status='failed';report.error=error.name+': '+String(error.message).split('\n')[0];}
finally{
 if(csrf)await api('/v1/admin/auth/logout',{}).catch(()=>{});
 await control.end();
 const file=folder+'image-retest-'+randomUUID()+'.sanitized.json';
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
}
assert.equal(report.status,'published_and_verified');
WM_RETEST_IMAGE_189
