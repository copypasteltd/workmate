import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve('../..'),platform=path.resolve('../copypaste-platform'),out=path.resolve('.data/integrated-204-v11');
await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const batch=await load(path.join(root,'docs/quality/integrated-round-204/implementation-batch-v6.json'));
for(const row of [...batch.production_source_files,...batch.migration_files])
 assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const previousFile='.data/integrated-204-v10/verification.json',previousBytes=await readFile(previousFile),previous=JSON.parse(previousBytes);
assert.equal(previous.qualified_backend_case_count,183);assert.equal(previous.backend_failed_cases,21);
for(const file of previous.test_file_sha256)assert.equal(sha(await readFile(path.join(platform,file.path))),file.sha256,file.path);
const retained=[...previous.retained_checks,previous.checks.find(c=>c.phase==='build')];
for(const c of retained){assert.equal(c.exit_code,0);assert.equal(sha(await readFile(c.log)),c.sha256);}
const originalCases=[];
for(const c of previous.checks.filter(c=>c.phase.startsWith('test'))){
 const bytes=await readFile(c.log);assert.equal(sha(bytes),c.sha256);
 const rows=[...bytes.toString().matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)].map(m=>({name:m[3],passed:m[1]==='ok',log:c.log,log_sha256:c.sha256,tap_header:m[0]}));
 assert.equal(rows.length,c.counts.tests);assert.equal(rows.filter(r=>r.passed).length,c.counts.pass);originalCases.push(...rows);
}
assert.equal(originalCases.length,204);assert.equal(new Set(originalCases.map(r=>r.name)).size,204);
const pin=await load('../copypaste-desktop/contracts/local-codex-runtime.json'),native=path.resolve('../copypaste-desktop/.data/runtime/windows-x64/codex.exe');
assert.equal(sha(await readFile(native)),pin.windows_x64_sha256);
const actual=execFileSync(native,['--version'],{windowsHide:true,encoding:'utf8',timeout:10000}).trim().replace(/^codex-cli\s+/,'');
assert.equal(actual,pin.runtime_version);
let defaultVersion='unavailable';
try{defaultVersion=execFileSync('codex',['--version'],{windowsHide:true,encoding:'utf8',timeout:10000}).trim().slice(0,100);}catch{}
const envFileVersion=(await readFile(path.join(platform,'.env'),'utf8')).match(/^CODEX_VERSION=([^\r\n]*)/m)?.[1];
const files=['tests/analysis-role-tools.test.ts','tests/cloud-workflows.test.ts','tests/paid-task-inputs.test.ts'];
const report={stage:204,status:'running',state:'running',checks:[],retained_checks:retained,backend_groups:3,
 explicit_native_pin:{binary:native,version:actual,sha256:pin.windows_x64_sha256},
 default_cli_observation:{binary:'codex',actual:defaultVersion,inherited_version:process.env.CODEX_VERSION,env_file_version:envFileVersion},
 original_failed_whole:{path:previousFile,sha256:sha(previousBytes),status:previous.status,tests:204,passed:183,failed:21},
 test_files:files,test_file_sha256:previous.test_file_sha256,
 scope:'Final product source and all19 entry test files match whole204-v10 exactly. Rerun the complete37 cases in the three affected files with both absolute Codex executable and matching version/hash pinned. Retain167 distinct passed cases outside those files by exact source/test/log SHA and unique TAP identity. The original204-case whole attempt remains failed with all21 failures. No changed product assertions, production version bypass, server network changes or full-product acceptance claim.'};
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??''),CODEX_BIN:native,CODEX_VERSION:pin.runtime_version,
 COPYPASTE_LOCAL_CODEX_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_SHA256:pin.windows_x64_sha256,COPYPASTE_RUNTIME_STARTUP_TEST_VERSION:pin.runtime_version};
async function run(file,i){
 const phase='test-'+['a','b','c'][i],log='platform-'+phase+'.log',handle=await open(path.join(out,log),'wx');let writes=Promise.resolve();
 const child=spawn(process.execPath,['--env-file=.env','scripts/run-tests-owned.mjs',file],{cwd:platform,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of[child.stdout,child.stderr])stream.on('data',bytes=>{writes=writes.then(()=>handle.write(bytes));});
 const code=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('close',c=>resolve(c??1));});await writes;await handle.close();
 const bytes=await readFile(path.join(out,log)),text=bytes.toString();
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,Number([...text.matchAll(new RegExp('^# '+k+' (\\d+)','gm'))].at(-1)?.[1]??NaN)]));
 const cases=[...text.matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)].map(m=>({name:m[3],passed:m[1]==='ok',file,tap_header:m[0]}));
 report.checks.push({component:'platform',phase,exit_code:code,file,log:'.data/integrated-204-v11/'+log,sha256:sha(bytes),counts,cases});
 await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase,exit_code:code,counts}));
}
await Promise.all(files.map(run));
const current=report.checks.flatMap(c=>c.cases),names=new Set(current.map(c=>c.name)),originalNames=new Set(originalCases.map(c=>c.name));
assert.equal(current.length,37);assert.equal(names.size,37);assert.ok(current.every(c=>originalNames.has(c.name)));
assert.ok(originalCases.filter(c=>!c.passed).every(c=>names.has(c.name)),'Every original failure must be exercised again');
report.retained_backend_cases=originalCases.filter(c=>!names.has(c.name));assert.equal(report.retained_backend_cases.length,167);assert.ok(report.retained_backend_cases.every(c=>c.passed));
report.current_backend_cases=current;report.qualified_backend_case_count=167+current.filter(c=>c.passed).length;report.backend_failed_cases=current.filter(c=>!c.passed).length;
const passed=report.checks.length===3&&report.checks.every(c=>c.exit_code===0&&c.counts.tests===c.counts.pass&&['fail','cancelled','skipped','todo'].every(k=>c.counts[k]===0))&&report.qualified_backend_case_count===204;
report.status=report.state=passed?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();
await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,current_cases:37,retained_cases:167,qualified:report.qualified_backend_case_count,receipt:path.join(out,'verification.json')}));
if(!passed)process.exitCode=1;
