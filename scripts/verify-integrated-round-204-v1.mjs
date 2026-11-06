import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-204-v1');await mkdir(out,{recursive:true});
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-204/implementation-batch.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of batch.production_source_files)assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const report={stage:204,status:'running',state:'running',checks:[],scope:'Unified changed Backend/Web/Desktop builds and related current tests; unchanged Admin/Extension are source-qualified carry-forwards. Actual native PostgreSQL and pinned Codex fixture tests; not full historical or professional/production acceptance.'};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
async function run(component,phase,args){let output='';const p=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-'+component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[p.stdout,p.stderr])s.on('data',b=>output+=b.toString());const code=await new Promise(r=>{p.once('error',e=>{output+=e.name;r(1);});p.once('close',c=>r(c??1));});const log=component+'-'+phase+'.log';await writeFile(path.join(out,log),output,{flag:'wx'});report.checks.push({component,phase,exit_code:code,log:'.data/integrated-204-v1/'+log,sha256:sha(output)});await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({component,phase,exit_code:code}));}
await Promise.all(['platform','web','desktop'].map(c=>run(c,'build',[npm,'run','build'])));
await run('desktop','types',[npm,'run','typecheck']);
if(report.checks.every(c=>c.exit_code===0)){
 await Promise.all([run('web','test',[npm,'run','test']),run('delivery','test',[npm,'run','test'])]);
 await run('desktop','test',['scripts/run-current-tests-203-v1.mjs']);
 const files=['runtime-tool-feedback-204-v1','runtime-feedback-native-204-v1','runtime-image-failure-189-v1','cloud-task-lease-204-v1','provider-request-control','paid-task-inputs','execution-capacity','task-pause-154-v3','schema-compatibility','audio-production','audio-authorization-upgrade-189-v1','audio-accounting-188-v1','generated-video-jobs-188-v1','cloud-workflows','analysis-role-tools','analysis-role-delivery','analysis-calculation','analysis-review-202-v3','desktop-executions-139-v3'];
 await run('platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...files.map(v=>'tests/'+v+'.test.ts')]);
}
report.state=report.status=report.checks.length===8&&report.checks.every(c=>c.exit_code===0)?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,receipt:path.join(out,'verification.json')}));if(report.status!=='passed')process.exitCode=1;
