#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v4/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_FINAL'
import pg from 'pg';import {readdir,readFile,writeFile}from'node:fs/promises';import {execFileSync}from'node:child_process';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});
try{await c.connect();await c.query('BEGIN READ ONLY');
const tenants=['dfd0a03e-5648-4b7a-a687-fce8aacd658e','f5b06ebd-ec59-414c-ad1a-04224d202fc0'];
const active=(await c.query(`SELECT t.id,t.status,t.attempt,t.lease_until,d.state desktop_state,d.finished_at,task_occupies_execution_slot(t) occupies_execution_slot FROM tasks t LEFT JOIN desktop_executions d ON d.task_id=t.id WHERE t.tenant_id=ANY($1::uuid[]) AND t.status IN ('queued','running','reconciling') ORDER BY t.created_at`,[tenants])).rows;
const held=(await c.query(`SELECT id,task_id,state,cost_state,capacity_held FROM current_ai_provider_requests WHERE tenant_id=ANY($1::uuid[]) AND capacity_held=true ORDER BY created_at`,[tenants])).rows;
const requests=(await c.query(`SELECT id,state,cost_state,usage_known,capacity_held FROM current_ai_provider_requests WHERE id=ANY($1::uuid[]) ORDER BY id`,[['ef9ea47b-b247-40ba-a502-efec956d6c1f','dff247a5-fce8-441d-ab79-4af917d57404','9e62e3a1-571d-42ec-8a92-b4dfc68e3835','893713dc-0cd8-4800-8a34-71f63733afee']])).rows;
const tasks=(await c.query(`SELECT id,status,execution_location,charged_micros::text,lease_until FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id`,[['8a979c59-d778-47a2-90eb-a44c45f981d2','f6acc29f-0a98-4150-bf8f-0a48b3e52f82']])).rows;
await c.query('ROLLBACK');
const group=execFileSync('systemctl',['show','workmate-api.service','-p','ControlGroup','--value'],{encoding:'utf8'}).trim();
const base='/sys/fs/cgroup'+group+'/executions';const jobs=(await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name);const native_procs=(await readFile(base+'/cgroup.procs','utf8')).trim();
const health=await(await fetch('http://127.0.0.1:63072/health/ready',{signal:AbortSignal.timeout(3000)})).json();
if(jobs.length||native_procs||held.length||active.some(t=>t.occupies_execution_slot)||requests.length!==4||requests.some(r=>r.capacity_held||r.cost_state!=='unknown'||r.usage_known)||tasks.length!==2||tasks.some(t=>t.status!=='succeeded')||health.ok!==true)throw Error('Final owned-state qualification failed');
const report={stage:191,at:new Date().toISOString(),scope:'Read-only final state of explicitly owned QA workspaces and named tasks; no billing or capacity mutation',active,held,requests,tasks,owned_native_jobs_remaining:jobs,owned_execution_group_has_no_processes:true,health};await writeFile('/root/cfg/workmate/native-191/final-state-v4.sanitized.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}finally{await c.end();}
WM_FINAL
