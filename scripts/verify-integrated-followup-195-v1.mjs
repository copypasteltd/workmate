import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out=path.resolve('.data/integrated-195-followup-v1');await mkdir(out,{recursive:true});
const report={stage:195,scope:'Recheck the cancelled Windows Office suite after installer compression exits; validate the newly generated download catalog and Web bundle. The original complete batch remains preserved.',checks:[]};
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
async function run(component,label,args){let text='';const child=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-'+component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of [child.stdout,child.stderr])s.on('data',b=>text+=b.toString());const code=await new Promise(r=>{child.once('error',e=>{text+=e.message;r(1);});child.once('close',c=>r(c??1));});const file=path.join(out,label+'.log');await writeFile(file,text);const check={component,label,code,sha256:createHash('sha256').update(text).digest('hex'),finished_at:new Date().toISOString()};report.checks.push(check);await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(check));return code;}
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(await run('web','web-download-build',[npm,'run','build']))process.exitCode=1;
else {await Promise.all([run('platform','windows-office-repeat',['--env-file=.env','scripts/run-tests-owned.mjs','tests/document-preview-146-v2.test.ts']),run('web','web-download-tests',[npm,'run','test'])]);if(report.checks.some(c=>c.code!==0))process.exitCode=1;}
