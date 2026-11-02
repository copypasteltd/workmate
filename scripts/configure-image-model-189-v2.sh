#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_189'
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import assert from 'node:assert/strict';

const folder='/root/cfg/workmate/live-189-v1/',stateFile=folder+'image-model-gpt-image-2-state.private.json';
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
async function operation(label,url,body,headers={}){
 const entry=state.operations[label]??={key:randomUUID(),body};await save();assert.deepEqual(entry.body,body);
 if(entry.result)return entry.result;
 const result=await api(url,body,{...headers,'Idempotency-Key':entry.key});entry.result=result;await save();return result;
}
const report={stage:189,status:'running',at:new Date().toISOString(),model:'gpt-image-2',old_failed_validation_preserved:true};
try{
 const challenge=await api('/v1/admin/auth/challenge',{email:secret.admin_email});
 const mail=JSON.parse(await readFile(process.env.DATA_DIR+'/mailbox/'+challenge.challenge_id+'.json','utf8'));
 const previous=Number((await control.query('SELECT last_totp_step FROM admin_principals WHERE email=$1',[secret.admin_email])).rows[0].last_totp_step);
 if(previous>=Math.floor(Date.now()/30000))await new Promise(resolve=>setTimeout(resolve,(previous+1)*30000-Date.now()+250));
 const totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret.admin_totp_secret),digits:6,period:30,algorithm:'SHA1'}).generate();
 const verified=await api('/v1/admin/auth/verify',{challenge_id:challenge.challenge_id,code:mail.text.match(/code is (\d{6})/)[1],totp});csrf=verified.csrf_token;
 assert.equal((await api('/v1/admin/me')).highest_admin,true);
 const source=(await control.query(`SELECT r.id,c.base_url,c.allow_private_network FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id JOIN capability_model_connections c ON c.release_id=r.id WHERE h.data_mode='configured_services' AND h.profile_key='internal-text-v1'`)).rows[0];
 const previousImage=(await control.query('SELECT definition FROM capability_releases WHERE id=$1',['5f31cfbd-7e34-4f87-8e12-23b23be7f399'])).rows[0];
 assert.ok(source&&previousImage);assert.equal(previousImage.definition.rates.length,1);
 report.base_url=source.base_url;report.company_tariff_hkd_micros_per_image=previousImage.definition.rates[0];
 report.tariff_basis='Existing company image tariff retained; not a claim about the upstream invoice.';
 const draft={document:{kernel:'codex',gateway_policy:'company_internal_only',profile_key:'internal-image2-v1',model_alias:'gpt-image-2',reasoning_effort:null,rates:previousImage.definition.rates},connection:{base_url:source.base_url,reuse_from_release_id:source.id,allow_private_network:source.allow_private_network},reason:'Owner instructed gpt-image-2 using the same upstream address and API key as the current text model. Retain the existing company image tariff.'};
 if(!state.release_id){const previous=await api('/v1/admin/capability-releases/a2dfd382-bc5c-492f-97d1-c93afbb25450');const edit={...draft,expected_version:previous.version,expected_revision:previous.management_revision};const created=await operation('edit','/v1/admin/capability-releases/'+previous.id+'/edits',edit);assert.equal(created.state,'succeeded');state.release_id=created.result_ids[0];state.model_id=previous.model_id;await save();}
 report.release_id=state.release_id;
 const release=await api('/v1/admin/capability-releases/'+state.release_id);
 const command={expected_version:release.version,reason:'Actual generation and edit validation of owner-selected gpt-image-2 before publication.'};
 const connection=await api('/v1/admin/capability-releases/'+state.release_id+'/connection-test',command);report.connection_test=connection;assert.equal(connection.reachable,true);assert.equal(connection.model_available,true);
 console.log(JSON.stringify({phase:'actual_image_generation_and_edit_validation_started',release_id:state.release_id,model:state.model}));
 const validation=await operation('validation','/v1/admin/capability-releases/'+state.release_id+'/validations',command);report.validation=validation;
 assert.equal(validation.state,'passed','Actual image generation/edit must pass before publishing');
 const preview=await api('/v1/admin/capability-releases/'+state.release_id+'/publications-previews',command);assert.equal(preview.decision,'super_admin_direct');
 const publication=await operation('publication','/v1/admin/capability-releases/'+state.release_id+'/publications',command,{'X-Admin-Preview-ID':preview.preview_id});assert.equal(publication.state,'succeeded');report.publication_id=publication.id;
 const head=(await control.query(`SELECT p.release_id,r.definition->>'model_alias' AS alias,c.base_url,(c.encrypted_api_key=s.encrypted_api_key) AS same_key FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id JOIN capability_model_connections c ON c.release_id=r.id JOIN capability_model_connections s ON s.release_id=$1 WHERE h.data_mode='configured_services' AND h.profile_key='internal-image2-v1'`,[source.id])).rows[0];
 assert.equal(head.release_id,state.release_id);assert.equal(head.alias,'gpt-image-2');assert.equal(head.base_url,source.base_url);assert.equal(head.same_key,true);report.current=head;
 report.status='published_and_verified';
}catch(error){report.status='failed';report.error=error.name+': '+String(error.message).split('\n')[0];}
finally{
 if(csrf)await api('/v1/admin/auth/logout',{}).catch(()=>{});
 await control.end();
 const file=folder+'image-model-'+randomUUID()+'.sanitized.json';
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({...report,receipt:file}));
}
assert.equal(report.status,'published_and_verified');
WM_IMAGE_189
