#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v3/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'WM_ACTIVITY'
import pg from 'pg';const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{console.log(JSON.stringify({role:(await c.query('SELECT current_user,rolsuper FROM pg_roles WHERE rolname=current_user')).rows,activity:(await c.query(`SELECT pid,usename,state,wait_event_type,wait_event,extract(epoch from(clock_timestamp()-xact_start)) duration,pg_blocking_pids(pid) blockers,left(query,170) query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY xact_start NULLS LAST LIMIT 30`)).rows}));}finally{await c.end();}
WM_ACTIVITY
