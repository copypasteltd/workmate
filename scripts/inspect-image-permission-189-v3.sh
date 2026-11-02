#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_PERMISSION_189'
import pg from 'pg';
import {unseal,hash} from './dist/src/lib.js';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const row=(await c.query('SELECT base_url,encrypted_api_key FROM capability_model_connections WHERE release_id=$1',['23c14286-d6a8-4876-9384-51cfcbbdc405'])).rows[0];
 const response=await fetch(row.base_url.replace(/\/$/,'')+'/images/generations',{method:'POST',headers:{Authorization:'Bearer '+unseal(process.env.MASTER_KEY,row.encrypted_api_key),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({model:'gpt-image-2'}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const bytes=Buffer.from(await response.arrayBuffer());let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{}
 const denied=response.status===403&&body?.error?.type==='permission_error'&&body?.error?.message==='Image generation is not enabled for this group';
 const report={stage:189,at:new Date().toISOString(),scope:'Invalid-body permission diagnostic for owner-selected gpt-image-2; mandatory prompt omitted, no valid generation request, no accounting replay',model:'gpt-image-2',upstream_status:response.status,response_sha256:hash(bytes),group_image_permission_denied:denied,...(denied?{error_type:'permission_error',message:'Image generation is not enabled for this group'}:{})};
 const file='/root/cfg/workmate/live-189-v1/image-permission-'+randomUUID()+'.sanitized.json';await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
}finally{await c.end();}
WM_IMAGE_PERMISSION_189
