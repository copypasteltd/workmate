import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const delivery=process.cwd(),dev=path.resolve('..'),root=path.resolve('../..'),out=path.resolve('.data/integrated-202-v1');await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-202/implementation-batch.json'),'utf8'));
assert.equal(batch.status,'implementation_batch_complete_before_build_and_test');
for(const r of batch.production_source_files)assert.equal(hash(await readFile(path.join(root,r.path))),r.sha256,r.path);
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+'C:/Users/carzy/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin'+path.delimiter+(process.env.PATH??process.env.Path??'')};
const components=['platform','web','admin','desktop','extension','delivery'].map(n=>'copypaste-'+n),report={stage:202,status:'running',state:'running',started_at:new Date().toISOString(),workflow:'Entire implementation batch recorded before unified builds; test batch follows all builds; preserve failures for one collected correction batch.',checks:[]};
async function run(component,phase,args){let output='';const start=new Date().toISOString(),child=spawn(process.execPath,args,{cwd:path.join(dev,component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[child.stdout,child.stderr])s.on('data',b=>output+=b.toString());const exit_code=await new Promise(r=>{child.once('error',e=>{output+=e.message;r(1);});child.once('close',c=>r(c??1));});const log=path.join(out,component+'-'+phase+'.log');await writeFile(log,output,{flag:'wx'});const c={component,phase,started_at:start,finished_at:new Date().toISOString(),exit_code,log:path.relative(delivery,log),sha256:hash(Buffer.from(output))};report.checks.push(c);await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(c));}
async function jobs(all){let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<all.length)await run(...all[next++]);}));}
await jobs(components.map(n=>[n,'build',[npm,'run','build']]));await run('copypaste-desktop','renderer-types',[npm,'run','typecheck']);
if(report.checks.every(c=>c.exit_code===0)){
 await run('copypaste-platform','database-ready',['--env-file=.env','--input-type=module','-e',"import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL,connectionTimeoutMillis:3000});await c.connect();await c.query('SELECT 1');await c.end();console.log('Native PostgreSQL query ready');"]);
 if(report.checks.at(-1).exit_code===0){const discovered=JSON.parse(execFileSync(process.execPath,['scripts/run-current-tests-owned-v14.mjs','--list'],{cwd:path.join(dev,'copypaste-platform'),encoding:'utf8'}));
  const selected=discovered.current_test_files.filter(n=>/\/(analysis-review-202|analysis-calculation\.|analysis-reports\.|analysis-role-|analytics-|web-analytics|design-production-200|brand-production-189|dedicated-cloud-189|workspace-completion-196|business-quality\.)/.test(n));assert.ok(selected.some(n=>n.includes('analysis-review-202')));
  await writeFile(path.join(out,'backend-test-selection.json'),JSON.stringify({scope:'Marketing history, current source authority, exact analysis/reporting and immutable deliveries, native bounded downloads, unchanged design and complete route inventory. All client suites; not the entire historical backend or professional/production acceptance.',files:selected},null,2)+'\n',{flag:'wx'});
  await jobs([['copypaste-platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...selected]],...components.filter(c=>c!=='copypaste-platform'&&c!=='copypaste-desktop').map(c=>[c,'test',[npm,'run','test']]),['copypaste-desktop','test',['scripts/run-current-tests-v1.mjs']]]);
 }
}
report.state=report.checks.every(c=>c.exit_code===0)&&report.checks.some(c=>c.phase==='test')?'passed':'failures_for_integrated_debugging';report.status=report.state;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({state:report.state,receipt:path.join(out,'verification.json')}));if(report.state!=='passed')process.exitCode=1;
