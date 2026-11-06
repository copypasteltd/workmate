import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const delivery=fileURLToPath(new URL('../',import.meta.url)),root=path.dirname(delivery),out=path.join(delivery,'.data/integrated-200-v2');
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
await writeFile(path.join(out,'code-batch-complete.json'),JSON.stringify({at:new Date().toISOString(),implementation_scripts:['docs/requirements/200-design-production-round.md'],components,plan:'docs/requirements/200-design-production-round.md',tests_started_after_implementation:true},null,2)+'\n');
await run('copypaste-platform','database-ready',['--env-file=.env','--input-type=module','-e',"import pg from 'pg';let ready=false;for(let n=0;n<120;n++){const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL,connectionTimeoutMillis:1000});try{await c.connect();await c.query('SELECT 1');ready=true;break;}catch{}finally{await c.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Native test database is not ready');console.log('Native test database query readiness passed');"]);
if(result.checks.some(check=>check.exit_code!==0))throw Error('Database readiness failed before integration tests');
await batch(components.map(component=>[component,'build',[npm,'run','build']]));
await run('copypaste-desktop','renderer-types',[npm,'run','typecheck']);
if(result.checks.some(check=>check.exit_code!==0)){result.state='build_failures_for_integrated_debugging';await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');process.exitCode=1;}
else{
 const backend=path.join(root,'copypaste-platform');
 const discovered=JSON.parse(execFileSync(process.execPath,['scripts/run-current-tests-owned-v14.mjs','--list'],{cwd:backend,encoding:'utf8'}));
 const current=discovered.current_test_files.map(name=>path.basename(name));
 const selected=current.filter(name=>/^(design-production-200|analysis-|design-publication-199|editable-draft-preview-199|task-tool-protocol-199|editable-projects-143|editable-design-|creative-packages-140|brand-production|dedicated-cloud-189|task-directory-198|workspace-completion-196|workspace-execution-196|business-quality\.)/.test(name)).map(name=>'tests/'+name).sort();
 if(!selected.some(name=>name.includes('design-production-200')))throw new Error('The new integrated suite must be included');
 await writeFile(path.join(out,'backend-test-selection.json'),JSON.stringify({scope:'Round200 full design-production batch: templates, resource selection, analysis publication/calculation, shared fixed evidence, immutable design versions/packages, source and brand authority, no-charge previews, workspace/task regressions and complete route inventory. Selected risk regression, not full historical backend acceptance.',files:selected},null,2)+'\n');
 await batch([
  ['copypaste-platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...selected]],
  ...components.filter(c=>c!=='copypaste-platform'&&c!=='copypaste-desktop').map(c=>[c,'test',[npm,'run','test']]),
  ['copypaste-desktop','test',['scripts/run-current-tests-v1.mjs']]
 ]);
 result.state=result.checks.every(check=>check.exit_code===0)?'passed':'failures_for_integrated_debugging';
 result.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');
 if(result.state!=='passed')process.exitCode=1;
}
