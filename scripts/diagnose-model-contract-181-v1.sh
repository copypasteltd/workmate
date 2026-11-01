#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/model-http-180/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_DIAGNOSTIC_JS'
import pg from 'pg';import {unseal} from './dist/src/lib.js';import {loadConfig} from './dist/src/config.js';import {pathToFileURL} from 'node:url';import path from 'node:path';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();let workspace,codeDir;globalThis.__wmDiagnosticItems=[];globalThis.__wmDiagnosticRequests=[];
try {
const row=(await c.query("SELECT r.id,r.definition,m.base_url,m.allow_private_network,m.encrypted_api_key FROM capability_model_entries e JOIN capability_releases r ON r.id=e.current_release_id JOIN capability_model_connections m ON m.release_id=r.id WHERE e.deleted_at IS NULL AND r.definition->>'model_alias'=$1",['gpt-6-luna'])).rows[0];
const key=unseal(process.env.MASTER_KEY,row.encrypted_api_key),base=loadConfig(),events=[];let calls=0;
workspace=await mkdtemp('/var/lib/workmate/state/diagnostic-model-');
codeDir=await mkdtemp('/var/lib/workmate/state/diagnostic-code-');
const original=path.resolve('dist/src'),absoluteImports=s=>s.replace(/from\s+["'](\.\/[^"']+)["']/g,(_a,part)=>'from '+JSON.stringify(pathToFileURL(path.resolve(original,part)).href));
let gateway=await readFile(path.join(original,'internal-ai-gateway.js'),'utf8');
const mark='const inspectItem = (item) => {';if(!gateway.includes(mark))throw new Error('Diagnostic marker missing');
gateway=gateway.replace(mark,mark+" if(item && globalThis.__wmDiagnosticItems.length<20)globalThis.__wmDiagnosticItems.push({type:item.type,name:item.name,namespace:item.namespace,input:typeof item.input==='string'?item.input.slice(0,500):undefined,allowed_tools:options.tools}); ");
const normalize='const body = request.operation === "responses"';
if(!gateway.includes(normalize))throw new Error('Request marker missing');
gateway=gateway.replace(normalize,"if(request.operation==='responses')globalThis.__wmDiagnosticRequests.push({tool_choice:request.body.tool_choice,tools:request.body.tools?.map(t=>({type:t.type,name:t.name})),additional_tools:request.body.input?.filter(i=>i.type==='additional_tools').map(i=>({keys:Object.keys(i),tools:i.tools?.map(t=>({type:t.type,name:t.name,tools:t.tools?.map(n=>({type:n.type,name:n.name,keys:Object.keys(n),format:n.format,description_length:n.description?.length,declares_probe:n.description?.includes('capability_probe'),declares_shell:n.description?.includes('exec_command')}))}))}))});"+normalize);
const before=gateway;
gateway=gateway.replace('(options.nativeDesktop && item.type === "custom_tool_call" && desktopCustomTool(item.name))', '((options.nativeDesktop && item.type === "custom_tool_call" && desktopCustomTool(item.name)) || (!options.nativeDesktop && item.type === "custom_tool_call" && item.name === "exec" && !item.namespace))');
gateway=gateway.replace('options.tools.includes(options.nativeDesktop', '["exec", ...options.tools].includes(options.nativeDesktop');
gateway=gateway.replace('!(options.nativeDesktop && event.type.startsWith("response.custom_tool_call_input.")', '!((options.nativeDesktop || true) && event.type.startsWith("response.custom_tool_call_input.")');
if(gateway===before)throw new Error('No prototype match');
const gatewayPath=path.join(codeDir,'gateway.mjs');await writeFile(gatewayPath,absoluteImports(gateway));
let runtime=absoluteImports(await readFile(path.join(original,'runtime.js'),'utf8'));runtime=runtime.replace(JSON.stringify(pathToFileURL(path.join(original,'internal-ai-gateway.js')).href),JSON.stringify(pathToFileURL(gatewayPath).href));
const runtimePath=path.join(codeDir,'runtime.mjs');await writeFile(runtimePath,runtime);const {CodexRuntimeAdapter}=await import(pathToFileURL(runtimePath).href);
const cfg={...base,AI_BASE_URL:row.base_url,AI_API_KEY:key,AI_ALLOWED_HOSTS:new URL(row.base_url).hostname,AI_MODEL:row.definition.model_alias,AI_REASONING_EFFORT:row.definition.reasoning_effort,AI_VERIFIED:true,MODEL_CONNECTION_RESOLVER:async identity=>{if(identity.model!==row.definition.model_alias)throw new Error('Diagnostic model mismatch');return {id:row.id,baseURL:row.base_url,apiKey:key,allowPrivateNetwork:row.allow_private_network};}};
try {
const r=await new CodexRuntimeAdapter(cfg).start({taskId:'diagnostic-model-20261101',workspace,prompt:'Call capability_probe once with nonce diagnostic-20261101, then summarize its returned result in one sentence. This is an internal protocol verification.',skills:[],signal:AbortSignal.timeout(30000),onEvent:async(kind,body)=>{if(kind==='gateway.request_rejected'||kind==='runtime.phase'||kind==='runtime.rpc.failed')events.push({kind,...body});},tools:[{name:'capability_probe',description:'Return a fixed protocol-verification receipt. Call exactly once.',inputSchema:{type:'object',properties:{nonce:{type:'string',enum:['diagnostic-20261101']}},required:['nonce'],additionalProperties:false},run:async()=>{calls++;return {nonce:'diagnostic-20261101',result:5};}}]});
console.log(JSON.stringify({diagnostic:'same native Codex and scoped inference gateway, isolated fixed probe',status:r.status,accepted:r.accepted,usage_known:r.usageKnown,input_tokens:r.inputTokens,output_tokens:r.outputTokens,tool_calls:calls,output_present:Boolean(r.text.trim()),inspected_items:globalThis.__wmDiagnosticItems,requests:globalThis.__wmDiagnosticRequests,events}));
}catch(error){console.log(JSON.stringify({diagnostic:'native Codex',error:error.code??error.name,accepted:error.accepted,usage_known:error.usageKnown,tool_calls:calls,inspected_items:globalThis.__wmDiagnosticItems,requests:globalThis.__wmDiagnosticRequests,events}));}
}finally{await c.end();if(workspace)await rm(workspace,{recursive:true,force:false});if(codeDir)await rm(codeDir,{recursive:true,force:false});}
WM_DIAGNOSTIC_JS

