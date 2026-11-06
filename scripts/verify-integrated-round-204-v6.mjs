import {spawn} from 'node:child_process';import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-204-v6');await mkdir(out,{recursive:false});
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-204/implementation-batch-v4.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of [...batch.production_source_files,...batch.migration_files])assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const previous=JSON.parse(await readFile('.data/integrated-204-v3/verification.json','utf8')),retained=previous.checks.filter(c=>c.component==='delivery');assert.equal(retained.length,1);
for(const c of retained){assert.equal(c.exit_code,0);assert.equal(sha(await readFile(c.log)),c.sha256);}
const pin=JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8')),native=path.resolve('../copypaste-desktop/.data/runtime/windows-x64/codex.exe');assert.equal(sha(await readFile(native)),pin.windows_x64_sha256);
const report={stage:204,status:'running',state:'running',checks:[],retained_checks:retained,explicit_native_pin:{version:pin.runtime_version,sha256:pin.windows_x64_sha256},scope:'Whole corrected batch: changed Backend/Web/Desktop builds/types, current client suites, all19 related Backend suites and two additional real lease races. Delivery16 retained by exact source/log SHA; Admin/Extension are separately source-qualified. Original failed attempts remain. Not complete historical/professional/production acceptance.'};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??''),COPYPASTE_LOCAL_CODEX_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_SHA256:pin.windows_x64_sha256,COPYPASTE_RUNTIME_STARTUP_TEST_VERSION:pin.runtime_version};
async function run(component,phase,args){
 const log=component+'-'+phase+'.log',handle=await open(path.join(out,log),'wx');let writes=Promise.resolve();
 const child=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-'+component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[child.stdout,child.stderr])s.on('data',b=>{writes=writes.then(()=>handle.write(b));});
 const code=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('close',c=>resolve(c??1));});await writes;await handle.close();
 report.checks.push({component,phase,exit_code:code,log:'.data/integrated-204-v6/'+log,sha256:sha(await readFile(path.join(out,log)))});await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({component,phase,exit_code:code}));
}
await Promise.all([run('platform','build',[npm,'run','build']),run('web','build',[npm,'run','build']),run('desktop','build',[npm,'run','build'])]);
await run('desktop','types',[npm,'run','typecheck']);
if(report.checks.every(c=>c.exit_code===0)){
 await run('web','test',[npm,'run','test']);await run('desktop','test',['scripts/run-current-tests-203-v1.mjs']);
 const files=['runtime-tool-feedback-204-v1','runtime-feedback-native-204-v1','runtime-image-failure-189-v1','cloud-task-lease-204-v2','provider-request-control','paid-task-inputs','execution-capacity','task-pause-154-v3','schema-compatibility','audio-production','audio-authorization-upgrade-189-v2','audio-accounting-188-v1','generated-video-jobs-188-v1','cloud-workflows','analysis-role-tools','analysis-role-delivery','analysis-calculation','analysis-review-202-v3','desktop-executions-139-v3'];report.test_files=files.map(v=>'tests/'+v+'.test.ts');
 await run('platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...report.test_files]);
}
report.state=report.status=report.checks.length===7&&report.checks.every(c=>c.exit_code===0)?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,receipt:path.join(out,'verification.json')}));if(report.status!=='passed')process.exitCode=1;
