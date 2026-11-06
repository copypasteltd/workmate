import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-203-v1');await mkdir(out,{recursive:true});
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-203/implementation-batch.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of batch.production_source_files)assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const report={stage:203,status:'running',state:'running',checks:[],scope:'Complete specialist-intake and wide-review implementation batch before this unified build/types/test run. Full changed Web/Desktop suites and Delivery unit suite. Unchanged backend/Admin/Extension retain their qualified202 source/tests; this is not a full historical or production acceptance.'};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
async function run(component,phase,args){let output='';const p=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-'+component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[p.stdout,p.stderr])s.on('data',b=>output+=b.toString());const code=await new Promise(r=>{p.once('error',e=>{output+=e.message;r(1);});p.once('close',c=>r(c??1));});const log=component+'-'+phase+'.log';await writeFile(path.join(out,log),output,{flag:'wx'});report.checks.push({component,phase,exit_code:code,log:'.data/integrated-203-v1/'+log,sha256:sha(output)});await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({component,phase,exit_code:code}));}
await Promise.all(['web','desktop'].map(c=>run(c,'build',[npm,'run','build'])));
await run('desktop','types',[npm,'run','typecheck']);
if(report.checks.every(c=>c.exit_code===0))await Promise.all([run('web','test',[npm,'run','test']),run('desktop','test',['scripts/run-current-tests-v1.mjs']),run('delivery','test',[npm,'run','test'])]);
report.state=report.status=report.checks.length===6&&report.checks.every(c=>c.exit_code===0)?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,receipt:path.join(out,'verification.json')}));if(report.status!=='passed')process.exitCode=1;
