#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'WM_DB_CONTEXT'
import pg from 'pg';
for(const k of ['OWNER_DATABASE_URL','CONTROL_DATABASE_URL']){const c=new pg.Client({connectionString:process.env[k]});await c.connect();try{console.log(JSON.stringify({key:k,context:(await c.query('SELECT current_database() db,current_user,inet_server_port() port')).rows[0],view_owner:(await c.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='current_ai_provider_requests'::regclass")).rows,confirmations:(await c.query('SELECT id,provider_request_id,created_at FROM ai_provider_termination_confirmations ORDER BY created_at DESC LIMIT 8')).rows,schema:(await c.query('SELECT max(version) version FROM schema_migrations')).rows}));}finally{await c.end();}}
WM_DB_CONTEXT
