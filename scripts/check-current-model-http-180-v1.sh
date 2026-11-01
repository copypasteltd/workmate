#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import subprocess,json
js=r'''import pg from 'pg';import {unseal} from './dist/src/lib.js';import {modelConnectionFetch} from './dist/src/model-connection-http.js';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const rows=(await c.query(`SELECT r.id,r.definition->>'model_alias' AS model_alias,m.base_url,m.allow_private_network,m.encrypted_api_key FROM capability_model_entries e JOIN capability_releases r ON r.id=e.current_release_id JOIN capability_model_connections m ON m.release_id=r.id WHERE e.deleted_at IS NULL AND r.definition->>'model_alias'=$1`,['gpt-6-luna'])).rows;
 if(rows.length!==1)throw new Error('Expected exactly one current model');const row=rows[0];
 const response=await modelConnectionFetch(new URL(row.base_url+'/models'),{method:'GET',headers:{Authorization:'Bearer '+unseal(process.env.MASTER_KEY,row.encrypted_api_key),Accept:'application/json'},allowPrivate:row.allow_private_network,test:false,signal:AbortSignal.timeout(12000)});
 let count=null,available=null;
 if(response.ok){const data=await response.json();if(Array.isArray(data.data)){count=data.data.length;available=data.data.some(x=>x.id===row.model_alias);}}else await response.body?.cancel();
 console.log(JSON.stringify({stage:180,at:new Date().toISOString(),release_id:row.id,model_alias:row.model_alias,base_url:row.base_url,http_status:response.status,model_available:available,models_count:count,used_saved_key:true,configuration_unchanged:true}));
}finally{await c.end();}'''
p=subprocess.run(['/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node','--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',js],cwd='/opt/workmate/overlays/model-http-180/backend',capture_output=True,text=True,timeout=25)
if p.returncode:raise RuntimeError('Read-only model connection diagnostic failed; no key was printed')
result=json.loads(p.stdout)
with Path('/root/cfg/workmate/model-http-180-livecheck.sanitized.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
PY
