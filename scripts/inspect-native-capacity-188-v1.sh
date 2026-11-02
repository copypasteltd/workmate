#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v5/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'NODE'
import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});try{await c.connect();console.log(JSON.stringify({execution_policy:(await c.query('SELECT * FROM execution_capacity_policy')).rows,held_tasks:(await c.query("SELECT data_mode,status,count(*)::int AS count FROM tasks WHERE status IN('running','reconciling') AND attempt>0 GROUP BY data_mode,status")).rows}));}finally{await c.end();}
NODE
