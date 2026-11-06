#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-202-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module - <<'JS'
import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from './node_modules/pg/lib/index.js';
const pid=execFileSync('systemctl',['show','workmate-api.service','-p','MainPID','--value'],{encoding:'utf8'}).trim(),environment=(await readFile('/proc/'+pid+'/environ','utf8')).split('\0'),data=environment.find(v=>v.startsWith('DATA_DIR='))?.slice(9)??'.data';
const id='7a213b4b-acaa-4501-84f8-ea53dcd908a9',tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0',base=path.resolve(data,'runs',tenant,id),payloads=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(p.endsWith('.jsonl')){for(const line of (await readFile(p,'utf8')).split('\n')){let value;try{value=JSON.parse(line);}catch{continue;}if(value.payload&&['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(value.payload.type))payloads.push(value.payload);}}}}
await walk(base);const calls=payloads.filter(p=>p.name==='chart_render');const callIds=new Set(calls.map(c=>c.call_id));const outputs=payloads.filter(p=>callIds.has(p.call_id)&&p.type.endsWith('_output'));
const client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');const receipts=(await client.query('SELECT tool_name,input_hash,result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 ORDER BY created_at',[id])).rows;const task=(await client.query('SELECT id,status,error_code,charged_micros,accrued_micros FROM tasks WHERE id=$1',[id])).rows[0];await client.query('ROLLBACK');console.log(JSON.stringify({stage:203,status:'read_original_marketing_failure',task,calls,outputs,receipts,server_network_writes:false,scope:'Original failed task only; read-only transaction and stored native runtime. No model replay or mutation.'}));}finally{await client.end();}
JS
