#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_INVALID_189'
import pg from 'pg';
import {unseal,hash} from './dist/src/lib.js';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
const report={stage:189,scope:'Invalid-body endpoint diagnostics: missing model and prompt, no valid generation request or billing replay',checks:[]};
try{
 const row=(await db.query('SELECT base_url,encrypted_api_key FROM capability_model_connections WHERE release_id=$1',['a2dfd382-bc5c-492f-97d1-c93afbb25450'])).rows[0];
 const key=unseal(process.env.MASTER_KEY,row.encrypted_api_key);
 for(const namedHeaders of [false,true]){
  const response=await fetch(row.base_url+'/images/generations',{method:'POST',body:'{}',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(namedHeaders?{Accept:'application/json','User-Agent':'workmate-platform/189'}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  const entry={explicit_accept_and_user_agent:namedHeaders,status:response.status,content_type:response.headers.get('content-type'),body_sha256:hash(bytes),headers:Object.fromEntries(['server','via','x-request-id','x-sub2api-error','allow','access-control-allow-origin'].map(name=>[name,response.headers.get(name)]))};
  let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{}
  for(const field of ['code','type']){const value=body?.error?.[field];if(typeof value==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(value))entry['error_'+field]=value;}
  const message=String(body?.error?.message??'');
  entry.diagnostic_words=Object.fromEntries(['permission','api key','model','disabled','image','forbidden','support','OpenAI','ChatGPT','required'].map(word=>[word,message.toLowerCase().includes(word.toLowerCase())]));
  const privateFile='/root/cfg/workmate/live-189-v1/image-invalid-'+randomUUID()+'.private.txt';await writeFile(privateFile,bytes,{flag:'wx',mode:0o600});entry.private_response_file=privateFile;report.checks.push(entry);
 }
 const file='/root/cfg/workmate/live-189-v1/image-invalid-'+randomUUID()+'.sanitized.json';await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({...report,receipt:file}));
}finally{await db.end();}
WM_IMAGE_INVALID_189
