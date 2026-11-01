#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/model-tool-contract-181/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_INSPECT_JS'
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try {
 const results=(await c.query("SELECT id,state,result,created_at,finished_at FROM capability_validations WHERE release_id=$1 ORDER BY created_at DESC LIMIT 4",['786d90e0-8d36-4f8a-a7d7-93e9b7176015'])).rows;
 console.log(JSON.stringify({validations:results}));
 const columns=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='current_ai_provider_requests' ORDER BY ordinal_position")).rows.map(r=>r.column_name);
 console.log(JSON.stringify({request_view_columns:columns}));
}finally{await c.end();}
WM_INSPECT_JS
