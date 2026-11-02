#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'WM_CAPACITY_189'
import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});
const report={stage:189,scope:'Read-only owned acceptance capacity; no holds, limits or billing modified',at:new Date().toISOString()};
try{
 await c.connect();await c.query('BEGIN READ ONLY');
 report.tasks=(await c.query(`SELECT id,tenant_id,project_id,created_by,status,execution_location,error_code,accrued_micros::text,version FROM tasks WHERE created_by='d81349e4-77fc-4321-a9ba-24dca9714376' AND status IN ('queued','running','paused','awaiting_approval','reconciling','needs_input') ORDER BY created_at DESC LIMIT 30`)).rows;
 report.requests=(await c.query(`SELECT id,task_id,validation_id,actor_id,state,http_status,outcome_code,usage_known,input_tokens,output_tokens,released_at FROM ai_gateway_requests WHERE released_at IS NULL AND data_mode='configured_services' ORDER BY created_at DESC LIMIT 30`)).rows;
 report.columns=(await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ai_gateway_requests' AND column_name LIKE '%response%' ORDER BY ordinal_position`)).rows;
 await c.query('ROLLBACK');report.status='collected';
}finally{await c.end();}
const file='/root/cfg/workmate/live-189-v1/acceptance-capacity-'+randomUUID()+'.sanitized.json';
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({...report,receipt:file}));
WM_CAPACITY_189
