import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const output=path.resolve('.data/deployment-197-v3'),report={stage:197,status:'running',at:new Date().toISOString(),checks:[]};await mkdir(output,{recursive:true});
assert.equal(JSON.parse(await readFile('../copypaste-delivery/.data/integrated-197-v2/verification.json','utf8')).state,'passed');
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??''),CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_COMPRESSION_LEVEL:'5',COPYPASTE_LOCAL_CODEX_BIN:path.resolve('.data/runtime/windows-x64/codex.exe')};
for(const [phase,args] of [['pinned-runtime',['scripts/prepare-local-codex.mjs']],['windows-packages',['node_modules/electron-builder/out/cli/cli.js','--win','portable','nsis','--x64','--config.directories.output=.data/deployment-197-v3/release']]]){
 let text='';const child=spawn(process.execPath,args,{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{text+=bytes.toString();});
 const code=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('close',code=>resolve(code??1));});const log=phase+'.log';await writeFile(path.join(output,log),text,{flag:'wx'});report.checks.push({phase,exit_code:code,log,sha256:createHash('sha256').update(text).digest('hex')});assert.equal(code,0,phase);console.log(JSON.stringify({phase,status:'passed'}));
}
report.status='passed';report.finished_at=new Date().toISOString();await writeFile(path.join(output,'packaging-receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
