import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-204-v5');await mkdir(out,{recursive:false});
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-204/implementation-batch-v3.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of [...batch.production_source_files,...batch.migration_files])assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const previous=JSON.parse(await readFile('.data/integrated-204-v3/verification.json','utf8'));
const earlierBatch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-204/implementation-batch-v2.json'),'utf8'));
for(const row of earlierBatch.production_source_files.filter(row=>!/copypaste-platform\//.test(row.path)))assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const retained=[...previous.retained_checks,...previous.checks.filter(c=>c.component!=='platform')];assert.equal(retained.length,6);
for(const c of retained){assert.equal(c.exit_code,0);assert.equal(sha(await readFile(c.log)),c.sha256);}
const pin=JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8'));
const native=path.resolve('../copypaste-desktop/.data/runtime/windows-x64/codex.exe');assert.equal(sha(await readFile(native)),pin.windows_x64_sha256);
const report={stage:204,status:'running',state:'running',checks:[],retained_checks:retained,explicit_native_pin:{version:pin.runtime_version,sha256:pin.windows_x64_sha256},scope:'Full related Backend19 suites including all original181 passes/17 failures and two new real PostgreSQL race cases. Retain unchanged source-qualified Web70/Desktop320/Delivery16 and three client build/type checks. Admin/Extension remain separately source-qualified; not complete original102/professional/production acceptance.'};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??''),COPYPASTE_LOCAL_CODEX_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_SHA256:pin.windows_x64_sha256,COPYPASTE_RUNTIME_STARTUP_TEST_VERSION:pin.runtime_version};
async function run(phase,args){
 const log='platform-'+phase+'.log',handle=await open(path.join(out,log),'wx');let output='',writes=Promise.resolve();
 const p=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-platform'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of[p.stdout,p.stderr])stream.on('data',buffer=>{output+=buffer.toString();writes=writes.then(()=>handle.write(buffer));});
 const code=await new Promise(resolve=>{p.once('error',e=>{output+=e.name;resolve(1);});p.once('close',c=>resolve(c??1));});await writes;await handle.close();
 report.checks.push({component:'platform',phase,exit_code:code,log:'.data/integrated-204-v5/'+log,sha256:sha(await readFile(path.join(out,log)))});
 await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase,exit_code:code}));
}
await run('build',[npm,'run','build']);
if(report.checks.every(c=>c.exit_code===0)){
 const files=['runtime-tool-feedback-204-v1','runtime-feedback-native-204-v1','runtime-image-failure-189-v1','cloud-task-lease-204-v2','provider-request-control','paid-task-inputs','execution-capacity','task-pause-154-v3','schema-compatibility','audio-production','audio-authorization-upgrade-189-v2','audio-accounting-188-v1','generated-video-jobs-188-v1','cloud-workflows','analysis-role-tools','analysis-role-delivery','analysis-calculation','analysis-review-202-v3','desktop-executions-139-v3'];
 report.test_files=files.map(name=>'tests/'+name+'.test.ts');
 await run('test',['--env-file=.env','scripts/run-tests-owned.mjs',...report.test_files]);
}
report.state=report.status=report.checks.length===2&&report.checks.every(c=>c.exit_code===0)?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,receipt:path.join(out,'verification.json')}));if(report.status!=='passed')process.exitCode=1;
