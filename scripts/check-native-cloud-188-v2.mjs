import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,open} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ROOT=path.resolve('..','..'),DEV=path.join(ROOT,'dev'),P=path.resolve('.data/acceptance-188/regression-'+randomUUID());
await mkdir(P,{recursive:true});
const platform=path.join(DEV,'copypaste-platform'),require=createRequire(path.join(platform,'package.json')),pg=require('pg');
const pin=JSON.parse(await readFile(path.join(DEV,'copypaste-desktop/contracts/local-codex-runtime.json'),'utf8'));
const binary=path.join(DEV,'copypaste-desktop/.data/runtime/windows-x64/codex.exe');
assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),pin.windows_x64_sha256);
const net=createServer();await new Promise(r=>net.listen(0,'127.0.0.1',r));const port=net.address().port;await new Promise(r=>net.close(r));
const env={...process.env,NODE_ENV:'development',MASTER_KEY:randomBytes(32).toString('hex'),
 CODEX_BIN:binary,CODEX_VERSION:pin.runtime_version,COPYPASTE_LOCAL_CODEX_BIN:binary,COPYPASTE_LOCAL_CODEX_TEST_BIN:binary,
 COPYPASTE_NATIVE_DATABASE_DIR:'.data/native-qa/'+randomUUID(),
 GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false',GIT_CONFIG_KEY_1:'core.untrackedCache',GIT_CONFIG_VALUE_1:'false'};
for(const [key,user] of [['DATABASE_URL','cp_app'],['CONTROL_DATABASE_URL','cp_control'],['QUEUE_DATABASE_URL','cp_queue'],['OWNER_DATABASE_URL','cp_owner']])env[key]=`postgresql://${user}:${randomBytes(24).toString('hex')}@127.0.0.1:${port}/copypaste`;
await writeFile(path.join(P,'native-test.private.env'),Object.entries(env).filter(([k])=>k.endsWith('DATABASE_URL')||k==='MASTER_KEY').map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600});
const report={stage:188,status:'running',at:new Date().toISOString(),run:P,native_port:port,native_database_directory:env.COPYPASTE_NATIVE_DATABASE_DIR,checks:[],scope:'Current backend integration inventory and independent clients: native isolated PostgreSQL, builds and unit tests. Real online supplier/UI checks are recorded separately.'};
let database;
async function run(component,label,args){
 const cwd=path.join(DEV,'copypaste-'+component),log=await open(path.join(P,component+'-'+label+'.log'),'wx');
 console.log(JSON.stringify({phase:'started',component,label}));
 const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log.write(b));child.stderr.on('data',b=>log.write(b));
 const exit=await new Promise(resolve=>{child.once('error',e=>resolve({exit_code:null,error:e.message}));child.once('close',(code,signal)=>resolve({exit_code:code,signal}));});await log.close();
 const bytes=await readFile(path.join(P,component+'-'+label+'.log'));
 const counts=Object.fromEntries([...bytes.toString().matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
 const result={component,label,...exit,counts,log_sha256:createHash('sha256').update(bytes).digest('hex')};report.checks.push(result);console.log(JSON.stringify(result));
 return result;
}
try{
 const dbLog=await open(path.join(P,'native-postgres.log'),'wx');
 database=spawn(process.execPath,['scripts/native-db-launch.mjs'],{cwd:platform,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 database.stdout.on('data',b=>dbLog.write(b));database.stderr.on('data',b=>dbLog.write(b));database.once('close',()=>dbLog.close());
 let ready=false;
 for(let i=0;i<600;i++){
  if(database.exitCode!==null)throw new Error('Owned native PostgreSQL exited during startup; log retained');
  const c=new pg.Client({connectionString:env.OWNER_DATABASE_URL,connectionTimeoutMillis:1000});
  try{await c.connect();const r=await c.query("SELECT to_regclass('public.schema_migrations') AS t");ready=Boolean(r.rows[0].t);}catch{}finally{await c.end().catch(()=>{});}
  if(ready)break;await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(ready,'Owned native PostgreSQL did not become ready');
 await run('platform','remaining-targets',['scripts/run-tests-owned.mjs','tests/cloud-workflows.test.ts','tests/model-tool-contract-181-v5.test.ts','tests/project-configuration-188-v2.test.ts']);
 await run('platform','build',[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build']);
 report.status=report.checks.every(c=>c.exit_code===0)?'passed':'failed';
}catch(e){report.status='failed';report.error=e.message;}
finally{
 if(database?.connected)database.send({action:'shutdown'});
 if(database&&database.exitCode===null)await new Promise(resolve=>database.once('close',resolve));
 report.native_database_closed=true;report.finished_at=new Date().toISOString();
 await writeFile(path.join(P,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(P,'receipt.json')}));
}
assert.equal(report.status,'passed');
