#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import subprocess
script='import pg from \'pg\';const ids=["c917a22d-4d28-4040-922f-73fe2f4a0ff2", "6c10c184-6df6-43be-bcfb-041830a6bffb", "2288c72d-3f11-456e-934a-06b83e471cdc", "a4950378-6dd6-4a3c-b37a-19db9f7aa614"];const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{\nconsole.log(JSON.stringify({roots:(await c.query(\'SELECT to_jsonb(d) AS job FROM deletion_jobs d WHERE d.id=ANY($1::uuid[]) ORDER BY id\',[ids])).rows,\nchildren:(await c.query(\'SELECT to_jsonb(d) AS job FROM deletion_jobs d WHERE d.tenant_id IN (SELECT tenant_id FROM deletion_jobs WHERE id=ANY($1::uuid[])) AND NOT(d.id=ANY($1::uuid[])) ORDER BY id\',[ids])).rows}));\n}finally{await c.end();}'
subprocess.run(['/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node','--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',script],cwd='/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend',check=True)
PY
