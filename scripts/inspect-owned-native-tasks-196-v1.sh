#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-196-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_OWNED_NATIVE_196'
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.CONTROL_DATABASE_URL,max:1});
const ids=['79b3fe90-269a-4c23-b4cd-cfbbee18bdb4','4b34b469-dcfd-4683-9897-8dcba36acd80'];
try{
 const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');
  await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",['dfd0a03e-5648-4b7a-a687-fce8aacd658e','76e77daa-6e41-41fa-b2ea-6c889eb9acd2']);
  const tasks=(await c.query('SELECT id,status,execution_location,data_mode,charged_micros FROM tasks WHERE tenant_id=$1 AND project_id=$2 AND id=ANY($3::uuid[]) ORDER BY id',['dfd0a03e-5648-4b7a-a687-fce8aacd658e','30eb572b-52c1-4b99-966d-e3d2239a8b1d',ids])).rows;
  const reservations=(await c.query('SELECT task_id,status,amount_micros FROM reservations WHERE tenant_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY task_id',['dfd0a03e-5648-4b7a-a687-fce8aacd658e',ids])).rows;
  await c.query('COMMIT');console.log(JSON.stringify({stage:196,status:'inspected',scope:'Read-only review of the two explicitly owned Desktop qualification tasks; no settlement or task state is changed.',tasks,reservations}));
 }finally{c.release();}
}catch(e){console.log(JSON.stringify({stage:196,status:'failed',error:e.code??e.name}));process.exitCode=1;}finally{await pool.end();}
WM_OWNED_NATIVE_196
