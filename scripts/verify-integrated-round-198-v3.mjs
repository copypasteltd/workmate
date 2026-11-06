import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const delivery=fileURLToPath(new URL('../',import.meta.url)),root=path.dirname(delivery),out=path.join(delivery,'.data/integrated-198-v3');
await mkdir(out,{recursive:true});
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
const components=['copypaste-platform','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension','copypaste-delivery'];
const result={schema:1,started_at:new Date().toISOString(),workflow:'Complete the implementation batch, build all clients, then run the integrated validation batch.',checks:[]};
async function run(component,phase,args){
 const cwd=path.join(root,component),started_at=new Date().toISOString(),file=path.join(out,component+'-'+phase+'.log');let output='';const streamLog=createWriteStream(file,{flags:'wx'});
 const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output+=bytes.toString();streamLog.write(bytes);});
 const exit_code=await new Promise(resolve=>{child.once('error',error=>{output+=error.message;resolve(1);});child.once('close',code=>resolve(code??1));});
 await new Promise(resolve=>streamLog.end(resolve));const check={component,phase,started_at,finished_at:new Date().toISOString(),exit_code,log:path.relative(delivery,file),sha256:createHash('sha256').update(output).digest('hex')};
 result.checks.push(check);await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(check));return check;
}
async function batch(jobs,workers=2){let next=0;await Promise.all(Array.from({length:workers},async()=>{while(next<jobs.length){const job=jobs[next++];await run(...job);}}));}
// The native source database is started explicitly before this versioned run.
await writeFile(path.join(out,'code-batch-complete.json'),JSON.stringify({at:new Date().toISOString(),implementation_scripts:['docs/tools/implement-integrated-round-198-v1.py','docs/tools/implement-integrated-round-198-v2.py','docs/tools/implement-integrated-round-198-v3.py','docs/tools/implement-integrated-round-198-v4.py'],components,plan:'docs/requirements/198-task-directory-and-context-round.md',tests_started_after_implementation:true},null,2)+'\n');
await batch(components.map(component=>[component,'build',[npm,'run','build']]));
await run('copypaste-desktop','renderer-types',[npm,'run','typecheck']);
if(result.checks.some(check=>check.exit_code!==0)){result.state='build_failures_for_integrated_debugging';await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');process.exitCode=1;}
else{
 const backend=path.join(root,'copypaste-platform'),names=(await readdir(path.join(backend,'tests'))).filter(name=>name.endsWith('.test.ts'));
 const latest=new Map();for(const name of names){const match=/^(.+)-v(\d+)\.test\.ts$/.exec(name);if(match&&(!latest.has(match[1])||latest.get(match[1]).version<Number(match[2])))latest.set(match[1],{name,version:Number(match[2])});}
 const current=names.filter(name=>{const match=/^(.+)-v(\d+)\.test\.ts$/.exec(name);return !match||latest.get(match[1]).name===name;});
 const selected=current.filter(name=>/^(task-directory-198|conversation-directory-156|execution-timing-197|desktop-unstarted-settlement-197|desktop-startup-recovery\.|desktop-executions\.|provider-budgets\.|workspace-completion-196|workspace-execution-196|business-quality\.)/.test(name)).map(name=>'tests/'+name).sort();
 if(!selected.some(name=>name.includes('task-directory-198')))throw new Error('The new integrated suite must be included');
 await writeFile(path.join(out,'backend-test-selection.json'),JSON.stringify({scope:'Round198 task-directory authority/pagination, conversation-directory, native startup/billing and workspace/execution regressions. This is selected regression, not the full historical backend matrix.',files:selected},null,2)+'\n');
 await batch([
  ['copypaste-platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...selected]],
  ...components.filter(c=>c!=='copypaste-platform'&&c!=='copypaste-desktop').map(c=>[c,'test',[npm,'run','test']]),
  ['copypaste-desktop','test',['scripts/run-current-tests-v1.mjs']]
 ]);
 result.state=result.checks.every(check=>check.exit_code===0)?'passed':'failures_for_integrated_debugging';
 result.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');
 if(result.state!=='passed')process.exitCode=1;
}
