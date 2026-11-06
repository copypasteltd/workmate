import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/integrated-198-v4');await mkdir(out,{recursive:true});
assert.equal(JSON.parse(await readFile('.data/integrated-198-v3/verification.json','utf8')).state,'passed');
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
const report={stage:198,state:'running',scope:'Post-visual correction: final Web/Desktop builds, both Desktop type checks and all343 current Web/Desktop tests. Backend/Admin/Extension product source is unchanged from the six-build555-test batch. No native database is required by this presentation correction.',checks:[],at:new Date().toISOString()};
for(const [component,phase,args] of [
 ['web','build',[npm,'run','build']],['desktop','build',[npm,'run','build']],['desktop','typecheck',[npm,'run','typecheck']],
 ['web','test',[npm,'run','test']],['desktop','test',['scripts/run-current-tests-v1.mjs']]]){
 const folder=path.resolve('../copypaste-'+component),started_at=new Date().toISOString();let output='';
 const p=spawn(process.execPath,args,{cwd:folder,env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of [p.stdout,p.stderr])s.on('data',b=>output+=b.toString());
 const exit_code=await new Promise(resolve=>{p.once('error',()=>resolve(1));p.once('close',c=>resolve(c??1));});const log=component+'-'+phase+'.log';await writeFile(path.join(out,log),output,{flag:'wx'});
 report.checks.push({component,phase,started_at,finished_at:new Date().toISOString(),exit_code,log:path.relative(process.cwd(),path.join(out,log)),sha256:createHash('sha256').update(output).digest('hex')});console.log(JSON.stringify({component,phase,exit_code}));
}
report.state=report.checks.every(c=>c.exit_code===0)?'passed':'failed';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});assert.equal(report.state,'passed');
