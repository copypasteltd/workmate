#!/usr/bin/env bash
set -euo pipefail
backend=$(systemctl show workmate-api.service --property=WorkingDirectory --value)
test "$backend" = /opt/workmate/overlays/real-services-189-v5/backend
cd "$backend"
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_SYSTEM_190'
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {cloudProgramAvailable} from './dist/src/cloud-program-executor.js';
import {cloudBrowserAvailable} from './dist/src/cloud-browser-runtime.js';
const report={stage:190,at:new Date().toISOString(),scope:'Read-only current origins, configuration flags, approved runtime availability, published capabilities and owned QA task states. No model invocation, service restart or financial mutation.',origins:[],environment:{}};
// The shell working directory is validated before this process starts.
report.backend=process.cwd();
for(const [name,port,route] of [['web',63070,'/health/ready'],['admin',63071,'/health/ready'],['api',63072,'/health/ready'],['application',63073,'/health/ready']]){
 try{const r=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(10000)});const b=await r.json();report.origins.push({name,port,status:r.status,kernel:b.kernel,data_mode:b.data_mode});}
 catch(e){report.origins.push({name,port,error_class:e.name});}
}
for(const key of ['NODE_ENV','DEMO_MODE','DEV_MAILBOX'])report.environment[key]=process.env[key]??null;
for(const key of ['SMTP_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','META_APP_ID','META_APP_SECRET','META_PUBLICATION_APP_ID','META_PUBLICATION_APP_SECRET'])report.environment[key+'_configured']=Boolean(process.env[key]);
const program=JSON.parse(await readFile('contracts/cloud-program-runtime.json','utf8')),browser=JSON.parse(await readFile('contracts/cloud-browser-runtime.json','utf8'));
report.native_runtime={host_platform:process.platform,host_node:process.version,approved_program_platform:program.platform,approved_browser_platform:browser.platform,program_available:await cloudProgramAvailable(),browser_available:await cloudBrowserAvailable(),office_renderer_windows_only:true};
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 report.schema_version=(await db.query('SELECT max(version)::int version FROM schema_migrations')).rows[0].version;
 report.heads=(await db.query("SELECT h.profile_key,r.id release_id,r.definition->>'model_alias' model_alias,c.encrypted_api_key IS NOT NULL key_configured,v.state validation_state,v.finished_at validation_finished_at FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id LEFT JOIN capability_model_connections c ON c.release_id=r.id LEFT JOIN LATERAL(SELECT state,finished_at FROM capability_validations WHERE release_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1)v ON true WHERE h.data_mode='configured_services' ORDER BY h.profile_key")).rows;
 report.capacity_policy=(await db.query("SELECT agent_slots,tenant_slots,image_slots,media_slots FROM execution_capacity_policy WHERE data_mode='configured_services'")).rows[0];
 report.owned_unfinished=(await db.query("SELECT id,status,attempt,execution_location,capacity_wait_reason,error_code,extract(epoch FROM (clock_timestamp()-updated_at))::int age_since_update_seconds FROM tasks WHERE tenant_id='dfd0a03e-5648-4b7a-a687-fce8aacd658e' AND status IN ('queued','running','paused','reconciling','needs_input','awaiting_approval') ORDER BY created_at")).rows;
 report.owned_desktop_failure=(await db.query("SELECT t.id,t.status,t.error_code,t.charged_micros::text,d.state execution_state,d.client_report->>'status' client_status,d.client_report->>'error_code' client_error FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id='a69a69d3-626a-4743-8bd2-f41066154d17'")).rows;
 report.owned_image_task=(await db.query("SELECT id,status,error_code,charged_micros::text FROM tasks WHERE id='76ee4703-63d0-4524-8269-ab55d3192970' AND tenant_id='e8a85531-0660-472e-a501-488d6f51455c'")).rows[0];
 report.owned_unknown_requests=(await db.query("SELECT g.state,g.released_at IS NOT NULL capacity_released,count(*)::int count FROM ai_gateway_requests g JOIN tasks t ON t.id=g.task_id WHERE t.tenant_id IN ('dfd0a03e-5648-4b7a-a687-fce8aacd658e','e8a85531-0660-472e-a501-488d6f51455c','f5b06ebd-ec59-414c-ad1a-04224d202fc0') AND g.state='unknown' GROUP BY g.state,g.released_at IS NOT NULL")).rows;
 await db.query('ROLLBACK');
}finally{await db.end();}
report.status='collected';console.log(JSON.stringify(report));
WM_SYSTEM_190
