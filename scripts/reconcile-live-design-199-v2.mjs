// Reconcile completed UI writes without repeating creation, save or model calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launch,ok} from './live-client-189-v2.mjs';
import {existingOwner} from './live-read-only-owner-198-v1.mjs';
const prior='.data/acceptance-199/live-design-4c76859e-a3d9-4019-9756-2643626853f4/receipt.json';
const report=JSON.parse(await readFile(prior,'utf8'));
assert.equal(report.status,'failed');assert.equal(report.error,'Error: page.evaluate: TypeError: Failed to fetch');
assert.equal(report.checks.length,8);assert.equal(report.recordings.length,2);assert.deepEqual(report.javascript_errors,[]);
for(const screenshot of report.screenshots){const bytes=await readFile(path.resolve('..',screenshot.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),screenshot.sha256);}
const out=path.resolve('.data/acceptance-199/live-design-reconciled-v2');await mkdir(out,{recursive:false});
report.driver_failure={receipt:prior,error:report.error,cause:'After the completed native save/recording and rail assertions, the driver attempted a relative final read from its already-consumed127.0.0.1 PKCE callback page. Reconcile with a fresh actual company Web page; never repeat business writes.'};delete report.error;delete report.error_details;report.status='running';report.reconciliation_has_no_business_writes=true;
let browser,user;
try{
 browser=await launch();user=await existingOwner(browser);assert.equal(new URL(user.page.url()).origin,'https://agent.copypaste.hk');
 const source=JSON.parse(await readFile('.data/acceptance-199/live-source-v3/receipt.json','utf8')),base=`/v1/tenants/${source.tenant_id}/projects/${source.project_id}`;
 const current=await ok(user.page,base+'/editable-projects/'+report.editable_id);assert.equal(current.current_version,3);assert.ok(current.input.scene.layers.some(l=>l.kind==='text'&&l.text==='Make room for\na chapter together.'));
 const task=await ok(user.page,base+'/tasks/'+report.original_task_id);assert.equal(task.charged_micros,report.original_task_charge_micros);
 report.final_project={id:current.id,current_version:current.current_version};report.native_rail_assertions_completed_before_driver_failure=true;report.checks.push({name:'Read the exact completed native version3 from a fresh production Web context and reconcile the original unchanged single model charge; no business write repeated',status:'passed'});report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_windows_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
