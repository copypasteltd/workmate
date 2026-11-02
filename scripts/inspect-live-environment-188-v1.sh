#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_LIVE_INSPECT'
import pg from 'pg';
import {readdir,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
const report={stage:188,at:new Date().toISOString(),status:'read_only_inventory',environment:{},configuration_files:[],models:[],heads:[],counts:{}};
try{
 for(const key of ['NODE_ENV','HOST','PORT','DEMO_MODE','DEV_MAILBOX','WEB_ORIGIN','ADMIN_ORIGIN','API_ORIGIN','CODEX_BIN','CODEX_VERSION','WORKER_ENABLED','WORKER_CONCURRENCY','DATA_DIR'])report.environment[key]=process.env[key]??null;
 for(const key of ['MASTER_KEY','SMTP_URL','AI_BASE_URL','AI_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','META_APP_ID','META_APP_SECRET','META_PUBLICATION_APP_ID','META_PUBLICATION_APP_SECRET','S3_BUCKET'])report.environment[key+'_configured']=Boolean(process.env[key]);
 for(const name of await readdir('/root/cfg/workmate')){
  const s=await stat('/root/cfg/workmate/'+name);report.configuration_files.push({name,kind:s.isDirectory()?'directory':'file',mode:(s.mode&0o777).toString(8)});
 }
 await c.query('BEGIN READ ONLY');
 report.models=(await c.query(`SELECT r.id,r.profile_key,r.data_mode,r.definition->>'model_alias' AS model_alias,r.definition->>'reasoning_effort' AS reasoning_effort,r.was_published,r.version,r.retired_at,r.deleted_at,c.base_url,(c.encrypted_api_key IS NOT NULL) AS key_configured,v.state AS latest_validation,v.result->>'error_code' AS validation_error,v.finished_at
 FROM capability_releases r LEFT JOIN capability_model_connections c ON c.release_id=r.id
 LEFT JOIN LATERAL (SELECT state,result,finished_at FROM capability_validations WHERE release_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true ORDER BY r.created_at DESC LIMIT 25`)).rows;
 report.heads=(await c.query(`SELECT h.profile_key,h.data_mode,h.release_id,h.capability_version_id,r.definition->>'model_alias' AS model_alias,c.base_url FROM capability_heads h JOIN capability_releases r ON r.id=h.release_id LEFT JOIN capability_model_connections c ON c.release_id=r.id ORDER BY h.data_mode,h.profile_key`)).rows;
 report.counts.tenants=(await c.query('SELECT data_mode,status,count(*)::int AS count FROM tenants GROUP BY data_mode,status')).rows;
 report.counts.tasks=(await c.query('SELECT data_mode,state,count(*)::int AS count FROM tasks GROUP BY data_mode,state ORDER BY data_mode,state')).rows;
 report.counts.wallets=(await c.query('SELECT data_mode,count(*)::int AS count FROM wallets GROUP BY data_mode')).rows;
 report.schema=(await c.query('SELECT max(version)::int AS version FROM schema_migrations')).rows[0];
 await c.query('ROLLBACK');
 report.codex_version=execFileSync(process.env.CODEX_BIN,['--version'],{encoding:'utf8'}).trim();
 report.services=execFileSync('systemctl',['show','workmate-api.service','workmate-db.service','workmate-lan-proxy.service','--property=Id,ActiveState,MainPID,ExecMainStartTimestamp'],{encoding:'utf8'}).trim();
 report.status='inventory_collected';
}catch(e){report.status='inventory_failed';report.error={code:e.code??null,message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted DSN]')};}
finally{await c.end();}
await writeFile('/root/cfg/workmate/live-environment-188-v1.sanitized.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
if(report.status!=='inventory_collected')process.exitCode=1;
WM_LIVE_INSPECT
