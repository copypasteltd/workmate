#!/usr/bin/env bash
set -euo pipefail
backend=$(systemctl show workmate-api.service --property=WorkingDirectory --value)
test "$backend" = /opt/workmate/overlays/native-recheck-192-v1/backend
cd "$backend"
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_ASSESS_194'
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {cloudProgramAvailable} from './dist/src/cloud-program-executor.js';
import {cloudBrowserAvailable} from './dist/src/cloud-browser-runtime.js';
const report={stage:194,at:new Date().toISOString(),scope:'Read-only source-host health, configuration presence, model publications, runtime availability and original QA unknown-cost counts. No model call, financial change, service reload or task mutation.',backend:process.cwd(),origins:[],environment:{}};
for(const [name,port] of [['web',63070],['admin',63071],['api',63072],['application',63073]]){
 try{const r=await fetch(`http://127.0.0.1:${port}/health/ready`,{signal:AbortSignal.timeout(8000)});report.origins.push({name,port,status:r.status,health:await r.json()});}catch(e){report.origins.push({name,port,error_class:e.name});}
}
report.public_config=await(await fetch('http://127.0.0.1:63073/v1/public/config',{signal:AbortSignal.timeout(8000)})).json();
delete report.public_config.device_command_public_key;
for(const key of ['NODE_ENV','DEMO_MODE','DEV_MAILBOX'])report.environment[key]=process.env[key]??null;
for(const key of ['SMTP_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','META_APP_ID','META_APP_SECRET','META_PUBLICATION_APP_ID','META_PUBLICATION_APP_SECRET','S3_BUCKET'])report.environment[key+'_configured']=Boolean(process.env[key]);
const program=JSON.parse(await readFile('contracts/cloud-program-runtime.json','utf8')),browser=JSON.parse(await readFile('contracts/cloud-browser-runtime.json','utf8'));
report.native_runtime={host_platform:process.platform,host_node:process.version,approved_program_platform:program.platform,approved_browser_platform:browser.platform,program_available:await cloudProgramAvailable(),browser_available:await cloudBrowserAvailable()};
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 report.schema_version=(await db.query('SELECT max(version)::int version FROM schema_migrations')).rows[0].version;
 report.models=(await db.query("SELECT h.profile_key,r.definition->>'model_alias' model_alias,c.encrypted_api_key IS NOT NULL key_configured,v.state validation_state,v.finished_at validation_finished_at FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id LEFT JOIN capability_model_connections c ON c.release_id=r.id LEFT JOIN LATERAL(SELECT state,finished_at FROM capability_validations WHERE release_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1)v ON true WHERE h.data_mode='configured_services' ORDER BY h.profile_key")).rows;
 report.capacity_policy=(await db.query("SELECT agent_slots,tenant_slots,image_slots,media_slots FROM execution_capacity_policy WHERE data_mode='configured_services'")).rows[0];
 report.owned_unknown_requests=(await db.query("SELECT g.state,g.released_at IS NOT NULL capacity_released,count(*)::int count FROM ai_gateway_requests g JOIN tasks t ON t.id=g.task_id WHERE t.tenant_id IN ('dfd0a03e-5648-4b7a-a687-fce8aacd658e','e8a85531-0660-472e-a501-488d6f51455c','f5b06ebd-ec59-414c-ad1a-04224d202fc0') AND g.state='unknown' GROUP BY g.state,g.released_at IS NOT NULL")).rows;
 await db.query('ROLLBACK');
}finally{await db.end();}
report.status='collected';console.log(JSON.stringify(report));
WM_ASSESS_194
