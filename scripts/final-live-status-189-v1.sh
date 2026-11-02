#!/usr/bin/env bash
set -euo pipefail
test "$(systemctl show workmate-api.service --property=WorkingDirectory --value)" = /opt/workmate/overlays/real-services-189-v5/backend
cd /opt/workmate/overlays/real-services-189-v5/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_FINAL_IMAGE_189'
import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const report={stage:189,at:new Date().toISOString(),scope:'Read-only final origin, model publication and owned image-task facts. No new model request or financial adjustment.',origins:[]};
for(const [name,port,route] of [['web',63070,'/'],['admin',63071,'/'],['api',63072,'/health/ready'],['application',63073,'/health/ready']]){
 const response=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(10000)});
 report.origins.push({name,port,status:response.status});await response.body?.cancel();
}
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try {
 await db.query('BEGIN READ ONLY');
 report.schema_version=(await db.query('SELECT max(version)::int version FROM schema_migrations')).rows[0].version;
 report.per_model_configuration={global_url_present:Boolean(process.env.AI_BASE_URL),global_key_present:Boolean(process.env.AI_API_KEY)};
 report.heads=(await db.query("SELECT h.profile_key,r.id release_id,r.definition->>'model_alias' model_alias FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id WHERE h.data_mode='configured_services' ORDER BY h.profile_key")).rows;
 report.owned_image_tasks=(await db.query("SELECT id,status,error_code,charged_micros,data_mode FROM tasks WHERE tenant_id='e8a85531-0660-472e-a501-488d6f51455c' ORDER BY created_at")).rows;
 report.owned_image_requests=(await db.query("SELECT g.id,g.task_id,g.operation,g.state,g.http_status,g.usage_known,g.outcome_code FROM ai_gateway_requests g JOIN tasks t ON t.id=g.task_id WHERE t.tenant_id='e8a85531-0660-472e-a501-488d6f51455c' ORDER BY g.created_at")).rows;
 await db.query('ROLLBACK');
} finally {await db.end();}
report.candidate_stopped=!['active','activating'].includes((await import('node:child_process')).execFileSync('systemctl',['show','workmate-candidate-189-v5.service','--property=ActiveState','--value'],{encoding:'utf8'}).trim());
report.status=report.origins.every(v=>v.status===200)&&report.candidate_stopped?'origin_healthy_with_open_acceptance_gaps':'failed';
const suffix=randomUUID(),folder='/root/cfg/workmate/live-189-v5/',receipt=folder+'final-status-'+suffix+'.sanitized.json';
await writeFile(receipt,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
await writeFile(folder+'deployment-note-'+suffix+'.txt',`Workmate stage189 / current code overlay real-services-189-v5\nWeb: https://agent.copypaste.hk -> 63070\nAdmin: https://agent-dashboard.copypaste.hk -> 63071\nAPI: https://ai-api.copypaste.hk -> 63072; application loopback 63073\nDatabase schema161 / existing database and credentials unchanged. Existing plaintext configuration stays in /root/cfg/workmate/app.env and migration.env. Do not copy secrets into Git.\nPublished image model: gpt-image-2; same per-model upstream/key as published text. Real generate and edit validation a6be2e00-fb44-4915-b5bb-2145454421d4 passed.\nLarger square PNGs are fully decoded, normalized to 1024, and exact upstream originals are kept as separate authorized project artifacts. One image charge only.\nOwned image QA: qa-image-189-e3e12abe@workmate.local; OTP-only, no password created. Protected test mailbox retained. User619eddc1-778f-46a3-a414-6922461fa3cb; workspace e8a85531-0660-472e-a501-488d6f51455c; project da4ccb95-7b7d-4538-bc47-1f300642a5a9.\nQA credit allowance HK$10 is not payment. Manual Pro a7964471-792d-456e-b4a2-de3a32c89e72 expires2026-11-03T17:02:45.625Z, no auto-renewal. Historical uncertain costs and holds remain.\nDesktop real-supplier completion, public-edge stability, video/audio/OAuth/SMTP and Linux native-worker qualification are still open; this is not a full-product acceptance certificate.\nRollback: restore previous189-v4 service override only after active tasks stop; do not roll back user data, billing facts, image model configuration, keys or original files.\nReceipt: ${receipt}\n`,{flag:'wx',mode:0o600});
console.log(JSON.stringify({...report,receipt}));
WM_FINAL_IMAGE_189
