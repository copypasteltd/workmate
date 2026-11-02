#!/usr/bin/env bash
set -euo pipefail
backend=$(systemctl show workmate-api.service --property=WorkingDirectory --value)
test "$backend" = /opt/workmate/overlays/real-services-188-v8/backend
cd "$backend"
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_READINESS_189'
import pg from 'pg';
import { unseal } from './dist/src/lib.js';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const db = new pg.Client({connectionString: process.env.CONTROL_DATABASE_URL});
const report = {stage:189, at:new Date().toISOString(), scope:'Read-only service configuration and unpaid upstream model-list checks', environment:{}, models:[], heads:[], upstream:[]};
await db.connect();
try {
 for (const key of ['NODE_ENV','DEMO_MODE','DEV_MAILBOX','WEB_ORIGIN','ADMIN_ORIGIN','API_ORIGIN','CODEX_VERSION']) report.environment[key]=process.env[key]??null;
 for (const key of ['SMTP_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','META_APP_ID','META_APP_SECRET','META_PUBLICATION_APP_ID','META_PUBLICATION_APP_SECRET']) report.environment[key+'_configured']=Boolean(process.env[key]);
 await db.query('BEGIN READ ONLY');
 report.schema=(await db.query('SELECT max(version)::int AS version FROM schema_migrations')).rows[0];
 report.models=(await db.query(`SELECT r.id,r.profile_key,r.data_mode,r.definition->>'model_alias' AS model_alias,r.version,c.base_url,(c.encrypted_api_key IS NOT NULL) AS key_configured,v.state AS latest_validation,v.result->>'error_code' AS validation_error,v.finished_at
 FROM capability_releases r LEFT JOIN capability_model_connections c ON c.release_id=r.id
 LEFT JOIN LATERAL (SELECT state,result,finished_at FROM capability_validations WHERE release_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true ORDER BY r.created_at DESC LIMIT 15`)).rows;
 report.heads=(await db.query(`SELECT h.profile_key,h.data_mode,p.release_id,r.definition->>'model_alias' AS model_alias,c.base_url FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id LEFT JOIN capability_model_connections c ON c.release_id=r.id ORDER BY h.data_mode,h.profile_key`)).rows;
 const connections=(await db.query(`SELECT DISTINCT ON (c.base_url,c.encrypted_api_key) c.base_url,c.encrypted_api_key FROM capability_model_connections c JOIN capability_releases r ON r.id=c.release_id WHERE r.data_mode='configured_services' ORDER BY c.base_url,c.encrypted_api_key LIMIT 4`)).rows;
 await db.query('ROLLBACK');
 for(const connection of connections){
  const url=new URL('models',connection.base_url.replace(/\/$/,'')+'/');
  const entry={base_url:connection.base_url,path:url.pathname};
  try{
   const response=await fetch(url,{headers:{Authorization:'Bearer '+unseal(process.env.MASTER_KEY,connection.encrypted_api_key)},signal:AbortSignal.timeout(30000),redirect:'error'});
   entry.status=response.status;
   const body=await response.json();
   if(Array.isArray(body?.data))entry.model_ids=body.data.map(row=>row.id).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9._:/+ -]{1,180}$/.test(id)).slice(0,100);
   const code=body?.error?.code;if(typeof code==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(code))entry.error_code=code;
  }catch(error){entry.error_class=error.name;}
  report.upstream.push(entry);
 }
 report.status='collected';
}finally{await db.end();}
const file='/root/cfg/workmate/readiness-189-'+randomUUID()+'.sanitized.json';
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({...report,receipt:file}));
WM_READINESS_189
