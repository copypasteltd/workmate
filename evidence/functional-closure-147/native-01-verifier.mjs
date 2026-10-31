import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const attempt=process.argv[2];assert.match(attempt??'',/^\d{2}$/);
const repo=path.resolve('../copypaste-desktop'),base='evidence/functional-closure-147',prefix=base+'/native-'+attempt,sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(base,{recursive:true});for(const suffix of['.json','.tap','-sources.json','-verifier.mjs'])await assert.rejects(readFile(prefix+suffix),e=>e.code==='ENOENT');
async function snapshot(archive){const files={};const paths=execFileSync('git',['-C',repo,'ls-files','--cached','--others','--exclude-standard','-z','--','src','tests','contracts'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
  for(const name of [...new Set(paths)].sort()){const b=await readFile(path.join(repo,name)),digest=sha(b),object=base+'/objects/'+digest+'.blob';if(archive){try{await writeFile(object,b,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),b);}}files[name]={sha256:digest,...(archive?{path:object}:{})};}return files;}
await mkdir(base+'/objects',{recursive:true});const before=await snapshot(true);await writeFile(prefix+'-sources.json',JSON.stringify(before,null,2)+'\n',{flag:'wx'});await writeFile(prefix+'-verifier.mjs',await readFile(import.meta.filename),{flag:'wx'});
const args=['--import','tsx','--test','--test-concurrency=1','tests/local-workflow-contracts-147-v1.test.ts','tests/local-workflow.test.ts','tests/local-workflow-handoff-145-v2.test.ts','tests/local-agent.test.ts'];
const result=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});const chunks=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));child.once('close',code=>resolve({code,raw:Buffer.concat(chunks)}));child.once('error',e=>resolve({code:1,raw:Buffer.from(String(e))}));});
await writeFile(prefix+'.tap',result.raw,{flag:'wx'});const after=await snapshot(false),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([name,v])=>v.sha256===after[name]?.sha256);
const report={at:new Date().toISOString(),status:result.code===0&&unchanged?'passed':'failed',exit_code:result.code,source_unchanged:unchanged,
  arguments:args,source_manifest:{path:prefix+'-sources.json',sha256:sha(await readFile(prefix+'-sources.json'))},raw_report:{path:prefix+'.tap',sha256:sha(result.raw)},verifier:{path:prefix+'-verifier.mjs',sha256:sha(await readFile(import.meta.filename))},
  scope:'Trusted native sequencer and controller regression: fixed input review pagination, refusal, withdrawal, tampering and local startup/reconciliation. Controlled IO; actual OS/model execution is qualified separately.'};
await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,report:prefix+'.json'}));assert.equal(report.status,'passed');
