#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_METADATA_189'
import pg from 'pg';
import {unseal,hash} from './dist/src/lib.js';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
const report={stage:189,scope:'Read-only GET/OPTIONS to image endpoint; no generation POST, no paid retry',checks:[]};
try{
 const row=(await db.query('SELECT base_url,encrypted_api_key FROM capability_model_connections WHERE release_id=$1',['a2dfd382-bc5c-492f-97d1-c93afbb25450'])).rows[0];
 const key=unseal(process.env.MASTER_KEY,row.encrypted_api_key);
 for(const method of ['GET','OPTIONS']){
  const response=await fetch(row.base_url+'/images/generations',{method,headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  const entry={method,status:response.status,content_type:response.headers.get('content-type'),body_sha256:hash(bytes)};
  let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{}
  for(const field of ['code','type']){const value=body?.error?.[field];if(typeof value==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(value))entry['error_'+field]=value;}
  const message=String(body?.error?.message??'');
  entry.diagnostic_words=Object.fromEntries(['permission','api key','model','disabled','image','forbidden','support','OpenAI','ChatGPT'].map(word=>[word,message.toLowerCase().includes(word.toLowerCase())]));
  const privateFile='/root/cfg/workmate/live-189-v1/image-upstream-'+method.toLowerCase()+'-'+randomUUID()+'.private.txt';
  await writeFile(privateFile,bytes,{flag:'wx',mode:0o600});
  entry.private_response_file=privateFile;report.checks.push(entry);
 }
 const file='/root/cfg/workmate/live-189-v1/image-upstream-'+randomUUID()+'.sanitized.json';
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({...report,receipt:file}));
}finally{await db.end();}
WM_IMAGE_METADATA_189
