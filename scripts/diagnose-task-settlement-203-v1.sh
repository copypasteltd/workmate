#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-202-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module - <<'JS'
import pg from './node_modules/pg/lib/index.js';import{execFileSync}from'node:child_process';import{readFile,readdir}from'node:fs/promises';import path from'node:path';
const id='5b2367dc-c80b-4743-8d28-2c2229b0a707',tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0',client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');
 const requests=(await client.query('SELECT channel,id,state,usage_known,input_tokens,output_tokens,http_status,outcome_code,cost_state,capacity_held,effective_numerator,created_at,dispatched_at,finished_at FROM current_ai_provider_requests WHERE task_id=$1 ORDER BY created_at',[id])).rows;
 const pid=execFileSync('systemctl',['show','workmate-api.service','-p','MainPID','--value'],{encoding:'utf8'}).trim(),env=(await readFile('/proc/'+pid+'/environ','utf8')).split('\0'),data=env.find(x=>x.startsWith('DATA_DIR='))?.slice(9)??'.data',base=path.resolve(data,'runs',tenant,id),files=[],records=[];
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(p.endsWith('.jsonl')){files.push(path.relative(base,p));for(const line of(await readFile(p,'utf8')).split('\n')){let r;try{r=JSON.parse(line);}catch{continue;}const q=r.payload;if(q&&(['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(q.type)||['task_complete','token_count','turn_aborted'].includes(q.type)))records.push({timestamp:r.timestamp,payload:q});}}}}
 await walk(base);console.log(JSON.stringify({stage:203,status:'read_original_settlement',requests,files,records,owned_runtime_processes:execFileSync('ps',['-eo','pid,ppid,comm'],{encoding:'utf8'}).split('\n').filter(x=>/codex|workmate|node/.test(x)).slice(-50)}));await client.query('ROLLBACK');
}finally{await client.end();}
JS
