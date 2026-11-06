// Reconcile successful original assertions with a separately verified cleanup.
// The failed launcher's exit code/log/receipt are retained verbatim, never flipped.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {removeOwnedUUIDDirectory} from '../../copypaste-platform/src/owned-directory-cleanup.ts';
import {processIsGone,validateFixtureOwner} from '../../copypaste-platform/scripts/test-fixture-ownership.ts';

const delivery=process.cwd(),root=path.resolve('../..'),platform=path.resolve('../copypaste-platform'),out=path.resolve('.data/integrated-200-v3');
await mkdir(out,{recursive:true});const hash=b=>createHash('sha256').update(b).digest('hex'),load=async p=>JSON.parse(await readFile(p,'utf8'));
const original=await load('.data/integrated-200-v2/verification.json');assert.equal(original.state,'failures_for_integrated_debugging');
const failures=original.checks.filter(c=>c.exit_code!==0);assert.equal(failures.length,1);assert.equal(failures[0].component,'copypaste-platform');assert.equal(failures[0].phase,'test');
const counts={};for(const c of original.checks){const b=await readFile(c.log);assert.equal(hash(b),c.sha256);if(c.phase==='test'){const s=b.toString('utf8');counts[c.component]=Number([...s.matchAll(/^# tests (\d+)\r?$/gm)].at(-1)[1]);for(const field of ['fail','cancelled','skipped','todo'])assert.equal(Number([...s.matchAll(new RegExp('^# '+field+' (\\d+)\\r?$','gm'))].at(-1)[1]),0,c.component+' '+field);}}
assert.equal(counts['copypaste-platform'],143);
const batch=await load(path.join(root,'docs/quality/integrated-round-200/implementation-batch.json'));for(const r of batch.production_source_files){const b=await readFile(path.join(root,r.path));assert.equal(hash(b),r.sha256,'Product source changed after unified testing: '+r.path);}
const run=path.join(platform,'.data/test-fixture-reclamation/52f84357-fb15-4f17-bb5d-b86194bc1555'),base=path.join(platform,'.data/test-runs');
const manifest=await load(path.join(run,'manifest.json')),failed=await load(path.join(run,'result.json'));assert.equal(failed.status,'failed');assert.ok(processIsGone(manifest.owner_pid));
const report={stage:200,status:'running',at:new Date().toISOString(),scope:'Recover only the exact143-pass launch owned fixtures after its launcher/workers exit. Original exit1 and failed receipt remain unchanged; assertions are not rerun or relabelled as a new test execution.',original_result_sha256:hash(await readFile(path.join(run,'result.json'))),results:[]};
try{
 for(const r of failed.results){
  const file=path.join(run,'owned',r.id+'.json');assert.ok(!(await lstat(file)).isSymbolicLink());const item=validateFixtureOwner(await load(file),manifest,base,r.id+'.json');
  const deadline=Date.now()+10000;while(!processIsGone(item.worker_pid)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,200));assert.ok(processIsGone(item.worker_pid),'Preserve a fixture whose recorded worker remains alive');
  assert.equal(path.dirname(path.resolve(item.directory)),path.resolve(base));await removeOwnedUUIDDirectory(base,item.id);await assert.rejects(lstat(path.join(base,item.id)),e=>e.code==='ENOENT');report.results.push({id:item.id,worker_exited:true,actual_directory_absent:true});
 }
 assert.equal(hash(await readFile(path.join(run,'result.json'))),report.original_result_sha256);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message;}
report.finished_at=new Date().toISOString();await writeFile(path.join(out,'owned-cleanup-recovery.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});assert.equal(report.status,'passed');
const verified={...original,state:'passed',finished_at:new Date().toISOString(),scope:'Final acceptance reconciles the unchanged original v2 build/type/client results and143 passing backend TAP assertions with the actual owned-cleanup recovery. Backend launcher exit1 remains in checks; this is a new final qualification, not a claimed test rerun.',original_state:original.state,original_verification_sha256:hash(await readFile('.data/integrated-200-v2/verification.json')),assertion_counts:counts,acceptance_gates:{all_builds_types_and_client_launchers_passed:true,all_original_backend_assertions_passed:true,original_backend_launcher_failure_retained:true,all_owned_fixtures_now_actually_absent:true,all_completed_product_sources_unchanged:true},cleanup_recovery:{path:path.relative(delivery,path.join(out,'owned-cleanup-recovery.json')),sha256:hash(await readFile(path.join(out,'owned-cleanup-recovery.json')))}};
await writeFile(path.join(out,'verification.json'),JSON.stringify(verified,null,2)+'\n',{flag:'wx'});await writeFile(path.join(out,'backend-test-selection.json'),await readFile('.data/integrated-200-v2/backend-test-selection.json'),{flag:'wx'});
console.log(JSON.stringify({status:'passed',tests:Object.values(counts).reduce((a,b)=>a+b,0),counts,reclaimed:report.results.length,original_launcher_exit_code_retained:1,receipt:path.join(out,'verification.json')}));
