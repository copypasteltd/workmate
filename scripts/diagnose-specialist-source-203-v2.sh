#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-202-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module - <<'JS'
import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from './node_modules/pg/lib/index.js';
const pid=execFileSync('systemctl',['show','workmate-api.service','-p','MainPID','--value'],{encoding:'utf8'}).trim(),environ=(await readFile('/proc/'+pid+'/environ','utf8')).split('\0'),actualData=environ.find(v=>v.startsWith('DATA_DIR='))?.slice(9)??'.data';
const id='24238674-b8ed-47a0-8927-0e6adba946a1',tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0',base=path.resolve(actualData,'runs',tenant,id),rows=[],files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else{files.push(path.relative(base,p));if(p.endsWith('.jsonl')){const text=await readFile(p,'utf8');for(const line of text.split('\n')){let v;try{v=JSON.parse(line);}catch{continue;}const payload=v.payload;if(payload&&['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(payload.type)){if(payload.name?.includes('browser')||payload.output?.includes('Tool execution failed'))rows.push(payload);}}}}}}
try{await walk(base);}catch(e){rows.push({read_error:e.code,base});}const client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');const tools=(await client.query('SELECT tool_name,input_hash,result,output_version_ids FROM task_tool_receipts WHERE task_id=$1',[id])).rows;console.log(JSON.stringify({stage:203,status:'read_original_runtime',files,tool_calls:rows,completed_transactional_tools:tools}));await client.query('ROLLBACK');}finally{await client.end();}
JS
