#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_REJECTION_189'
import {readFile} from 'node:fs/promises';
import {unseal} from './dist/src/lib.js';
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 const row=(await db.query('SELECT encrypted_api_key FROM capability_model_connections WHERE release_id=$1',['a2dfd382-bc5c-492f-97d1-c93afbb25450'])).rows[0];
 const key=unseal(process.env.MASTER_KEY,row.encrypted_api_key);
 const body=JSON.parse(await readFile('/root/cfg/workmate/live-189-v1/image-invalid-edff8bca-33f8-4041-8eac-1f73f07fd5f9.private.txt','utf8'));
 assertNoSecret(body);
 function assertNoSecret(value){const text=JSON.stringify(value);if(text.includes(key)||/Bearer\s+\S+|sk-[a-zA-Z0-9_-]{16,}/i.test(text))throw Error('Private upstream response cannot be printed');}
 console.log(JSON.stringify({stage:189,upstream_status:403,error_type:body?.error?.type,message:String(body?.error?.message??'').slice(0,320)}));
}finally{await db.end();}
WM_REJECTION_189
