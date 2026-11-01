#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/model-tool-contract-181-v3/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'JS'
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const query=async sql=>(await c.query(sql)).rows;
 const result={schema:await query('SELECT max(version)::int AS version FROM schema_migrations'),highest:await query("SELECT p.id,p.status,p.enrollment_state,b.scope_kind,b.expires_at,r.builtin FROM admin_principals p JOIN admin_bindings b ON b.principal_id=p.id JOIN admin_roles r ON r.key=b.role_key WHERE b.role_key='super_admin' AND b.effect='allow' AND b.scope_kind='global'"),pending:await query("SELECT a.id,a.operation_id,a.requester_id,a.expires_at,a.state,o.action,o.payload->>'release_id' AS release_id,o.payload->>'target_id' AS target_id FROM admin_approval_requests a JOIN admin_operations o ON o.id=a.operation_id WHERE a.state='pending' ORDER BY a.created_at DESC LIMIT 30"),models:await query("SELECT id,profile_key,version,definition->>'model_alias' AS alias FROM capability_releases WHERE definition->>'model_alias'='gpt-6-luna'"),active:await query("SELECT count(*)::int AS tasks FROM tasks WHERE status IN ('queued','running','reconciling')"),validations:await query("SELECT count(*)::int AS n FROM capability_validations WHERE state='running'")};console.log(JSON.stringify(result));
}finally{await c.end();}
JS
