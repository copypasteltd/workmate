#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/live-188-v3/candidate.env --input-type=module <<'PROBE'
import pg from 'pg';import{unseal}from'./dist/src/lib.js';import{writeFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const row=(await c.query('SELECT * FROM capability_model_connections WHERE release_id=$1',['786d90e0-8d36-4f8a-a7d7-93e9b7176015'])).rows[0];
 const key=unseal(process.env.MASTER_KEY,row.encrypted_api_key);
 const response=await fetch(row.base_url+'/responses/input_tokens',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-6-luna',input:[{role:'user',content:'Verify real token counting protocol.'}],tools:[]}),signal:AbortSignal.timeout(30000)});
 let body;try{body=await response.json();}catch{}
 const report={stage:188,status:response.ok&&Number.isSafeInteger(body?.input_tokens)?'count_protocol_verified':'count_protocol_failed',http_status:response.status,counted_input_tokens:Number.isSafeInteger(body?.input_tokens)?body.input_tokens:null,response_keys:body&&typeof body==='object'?Object.keys(body):[],provider_error_code:typeof body?.error?.code==='string'?body.error.code.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80):null,at:new Date().toISOString()};
 report.requests=(await c.query("SELECT id,validation_id,operation,state,usage_known,http_status,outcome_code,image_units,input_tokens,output_tokens,known_charge_micros FROM ai_gateway_requests WHERE validation_id IN (SELECT id FROM capability_validations WHERE release_id=ANY($1::uuid[])) ORDER BY created_at",[['fc7d039b-a7b2-4649-8f4e-eaeefe1261a1','5f31cfbd-7e34-4f87-8e12-23b23be7f399']])).rows;
 const file='/root/cfg/workmate/protocol-probe-188-'+randomUUID()+'.sanitized.json';await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
}finally{await c.end();}
PROBE
