from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';W=R/'dev/copypaste-web';N=R/'dev/copypaste-desktop';L=R/'dev/copypaste-delivery'
lease=(P/'tests/cloud-task-lease-204-v3.test.ts').read_text('utf-8').split("test('durable tool outcomes stay")[0]
(P/'tests/cloud-task-lease-204-v4.test.ts').write_text(lease+'\n// Legacy tool-name outcome cases remain in v3; stronger call-scoped SQL/worker cases are tool-outcome-persistence-205-v1.\n','utf-8')
image=(P/'tests/runtime-image-failure-189-v1.test.ts').read_text('utf-8').replace('a later successful image call in the same native turn clears that tool failure without discarding actual usage','a duplicate unknown image operation is blocked before re-execution and keeps actual measured usage')
image=image.replace("assert.equal(calls,2);assert.equal(result.status,'completed');assert.equal(result.errorCode,undefined);","assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.errorCode,'IMAGE_TOOL_FAILED');assert.ok(!f.events.some(e=>e.kind==='runtime.tool.recovered'));")
(P/'tests/runtime-image-failure-189-v2.test.ts').write_text(image,'utf-8')
selector=(P/'scripts/run-current-tests-owned-v15.mjs').read_text('utf-8').replace("const supersededBase = new Set([","const supersededBase = new Set([\n  // Round205 exact-call recovery replaces historical tool-name recovery. Original files and failed evidence remain.\n  'runtime-feedback-native-204-v1.test.ts', 'runtime-feedback-native-204-v2.test.ts',")
(P/'scripts/run-current-tests-owned-v16.mjs').write_text(selector,'utf-8')
for name in ['package.json','package-lock.json']:
 p=P/name;s=p.read_text('utf-8').replace('scripts/run-current-tests-owned-v15.mjs','scripts/run-current-tests-owned-v16.mjs');p.write_text(s,'utf-8')
header=(N/'tests/integration/local-codex.native.test.ts').read_text('utf-8').split('test("actual customer-local Codex startup')[0]
native='''
for(const tool of ['audio_produce','generated_video_create'])test(`actual native ${tool} does not report a resolved blocked media job as completed`,{timeout:120000},async()=>{
 const f=await fixture();let calls=0;
 try{const b={...f.binding,companyTools:[{name:tool,description:'Controlled unavailable delivery fixture.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 const native=f.make(f.profile,b,async()=>{calls++;return {id:randomUUID(),task_id:randomUUID(),state:'completed',delivery_state:'blocked',usage_state:tool==='audio_produce'?'confirmed_company_tariff':'confirmed',kind:'speech',assets:[]};});await f.start(native);f.actions.push({company:{tool,arguments:{}}});
 await assert.rejects(native.turn('Inspect this original controlled media result.'),/LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN/);assert.equal(calls,1);assert.ok(f.events.some(e=>e.kind==='local.company-tool.failed'&&e.value.code==='LOCAL_COMPANY_TOOL_DELIVERY_UNCONFIRMED'));assert.ok(!f.events.some(e=>e.kind==='local.company-tool.completed'));
 }finally{await f.clean();}
});
'''
(N/'tests/integration/company-media-205-v1.test.ts').write_text(header+native,'utf-8')
unit='''import {test} from 'node:test';import assert from 'node:assert/strict';import {companyMediaDelivered} from '../src/company-tool-delivery.js';
test('native company media confirms actual available files and usage, never failed, blocked or unknown metadata',()=>{for(const tool of ['audio_produce','generated_video_create']){const ready={kind:'speech',state:'completed',delivery_state:'available',usage_state:tool==='audio_produce'?'confirmed_company_tariff':'confirmed',assets:[{kind:'audio'}]};assert.equal(companyMediaDelivered(tool,ready),true);for(const p of [{state:'failed'},{state:'cancelled'},{delivery_state:'blocked'},{usage_state:'awaiting_confirmation'},{assets:[]}])assert.equal(companyMediaDelivered(tool,{...ready,...p}),false);}assert.equal(companyMediaDelivered('font_catalog',{}),true);});
'''
(N/'tests/company-tool-delivery-205-v1.test.ts').write_text(unit,'utf-8')
# Prepare a complete build/test launcher, with all relevant product files frozen first.
verify='''import {spawn,execFileSync} from 'node:child_process';import {mkdir,readFile,writeFile,open} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-205-v1');await mkdir(out,{recursive:false});const sha=b=>createHash('sha256').update(b).digest('hex');
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-205/implementation-batch-v1.json'),'utf8'));
for(const r of [...batch.production_source_files,...batch.migration_files])assert.equal(sha(await readFile(path.join(root,r.path))),r.sha256,r.path);
const pin=JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8')),native=path.resolve('../copypaste-desktop/.data/runtime/windows-x64/codex.exe');assert.equal(sha(await readFile(native)),pin.windows_x64_sha256);assert.equal(execFileSync(native,['--version'],{windowsHide:true,encoding:'utf8'}).trim().replace(/^codex-cli\\s+/,''),pin.runtime_version);
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??''),COPYPASTE_LOCAL_CODEX_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_BIN:native,COPYPASTE_RUNTIME_STARTUP_TEST_SHA256:pin.windows_x64_sha256,COPYPASTE_RUNTIME_STARTUP_TEST_VERSION:pin.runtime_version};delete env.CODEX_VERSION;
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),report={stage:205,status:'running',checks:[],retained_checks:[],native_pin:{version:pin.runtime_version,sha256:pin.windows_x64_sha256},full_original_goal_accepted:false};
async function run(component,phase,args){const cwd=path.resolve('../copypaste-'+(component==='platform'?'platform':component)),log=path.join(out,component+'-'+phase+'.log'),h=await open(log,'wx');let writes=Promise.resolve();const p=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[p.stdout,p.stderr])s.on('data',b=>{writes=writes.then(()=>h.write(b));});const code=await new Promise(r=>{p.once('error',()=>r(1));p.once('close',c=>r(c??1));});await writes;await h.close();const bytes=await readFile(log),row={component,phase,exit_code:code,log:path.relative(process.cwd(),log).replaceAll('\\\\','/'),sha256:sha(bytes)};if(phase.startsWith('test'))row.counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,Number([...bytes.toString().matchAll(new RegExp('^# '+k+' (\\\\d+)','gm'))].at(-1)?.[1]??NaN)]));report.checks.push(row);await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\\n');console.log(JSON.stringify({component,phase,exit_code:code,counts:row.counts}));}
await Promise.all(['platform','web','desktop','delivery'].map(c=>run(c,'build',[npm,'run','build'])));
await Promise.all(['platform','web','desktop','delivery'].map(c=>run(c,'types',[npm,'run','typecheck'])));
if(report.checks.every(c=>c.exit_code===0)){
 const files=['tool-outcome-ledger-205-v1','tool-outcome-persistence-205-v1','runtime-feedback-native-205-v1','runtime-tool-feedback-204-v1','runtime-image-failure-189-v2','cloud-task-lease-204-v4','provider-request-control','paid-task-inputs','execution-capacity','task-pause-154-v3','schema-compatibility','audio-production','audio-authorization-upgrade-189-v2','audio-accounting-188-v2','generated-video-jobs-188-v1','cloud-workflows','analysis-role-tools','analysis-role-delivery','analysis-calculation','analysis-review-202-v3','desktop-executions-139-v3'].map(n=>'tests/'+n+'.test.ts');
 report.platform_test_files=await Promise.all(files.map(async f=>({path:f,sha256:sha(await readFile(path.resolve('../copypaste-platform',f)))})));
 await Promise.all([run('platform','test-a',['--env-file=.env','scripts/run-tests-owned.mjs',...files.filter((_,i)=>i%2===0)]),run('platform','test-b',['--env-file=.env','scripts/run-tests-owned.mjs',...files.filter((_,i)=>i%2===1)]),run('web','test',[npm,'test']),run('desktop','test',[npm,'test']),run('delivery','test',['--test','tests/native-surface-integrity.test.mjs','tests/host-transport.test.mjs'])]);
 await run('desktop','test-native',['--import','tsx','--test','--test-concurrency=1','tests/integration/company-media-205-v1.test.ts']);
}
const ts=report.checks.filter(c=>c.phase.startsWith('test'));report.passed_cases=ts.reduce((n,c)=>n+(c.counts?.pass??0),0);report.failed_cases=ts.reduce((n,c)=>n+(c.counts?.fail??0),0);report.status=report.checks.length===14&&report.checks.every(c=>c.exit_code===0)&&ts.every(c=>c.counts.tests===c.counts.pass&&['fail','cancelled','skipped','todo'].every(k=>c.counts[k]===0))?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\\n');console.log(JSON.stringify({status:report.status,passed:report.passed_cases,failed:report.failed_cases}));if(report.status!=='passed')process.exitCode=1;
'''
(L/'scripts/verify-integrated-round-205-v1.mjs').write_text(verify,'utf-8')
# Fresh packaging and app-only archive scripts. Activation is a separately reviewed script.
package=(N/'scripts/package-integrated-204-v2.mjs').read_text('utf-8').replace('deployment-204-v2','deployment-205-v1').replace('stage:204','stage:205').replace('integrated-204-v6','integrated-205-v1')
(N/'scripts/package-integrated-205-v1.mjs').write_text(package,'utf-8')
bundle=(L/'scripts/bundle-integrated-204-v3.py').read_text('utf-8').replace('deployment-204-v1','deployment-205-v1').replace('integrated-204-v3','integrated-205-v1').replace('candidate-manifest-v3','candidate-manifest-v1').replace("'stage':204","'stage':205").replace("'schema_version':165","'schema_version':166")
bundle=bundle.replace("assert json.loads((out/'release-metadata-validation.json').read_text())['status']=='passed'","assert json.loads((L/'.data/integrated-205-v1/verification.json').read_text())['status']=='passed'")
(L/'scripts/bundle-integrated-205-v1.py').write_text(bundle,'utf-8')
upload=(L/'scripts/upload-integrated-204-v3.py').read_text('utf-8').replace('deployment-204-v1','deployment-205-v1').replace('204-v3','205-v1')
upload=upload.replace("assert json.loads((source/'release-metadata-validation.json').read_text())['status']=='passed'","assert json.loads((root/'.data/integrated-205-v1/verification.json').read_text())['status']=='passed'")
(L/'scripts/upload-integrated-205-v1.py').write_text(upload,'utf-8')
stage=(L/'scripts/stage-integrated-204-v2.sh').read_text('utf-8').replace("previous=Path('/opt/workmate/overlays/integrated-202-v2/backend')","previous=Path('/opt/workmate/overlays/integrated-204-v2/backend')").replace("=='/opt/workmate/overlays/integrated-204-v1/rollback-compatible-backend-v2'","==str(previous)").replace('integrated-204-v2','integrated-205-v1').replace("previous=Path('/opt/workmate/overlays/integrated-205-v1/backend')","previous=Path('/opt/workmate/overlays/integrated-204-v2/backend')").replace('204-v3','205-v1').replace("m['stage']==204 and m['schema_version']==165","m['stage']==205 and m['schema_version']==166")
(L/'scripts/stage-integrated-205-v1.sh').write_text(stage,'utf-8')
print('Complete verification, current-suite replacements, native tests, packaging and staging package prepared.')
