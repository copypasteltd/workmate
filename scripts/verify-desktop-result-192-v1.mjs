import { launch, authenticate, ok } from './live-client-189-v2.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const source=path.resolve('.data/acceptance-192/real-desktop-f62d3a5c-b76b-49e6-88cf-3a6772bb2ff6');
const out=path.resolve('.data/acceptance-192/desktop-result-verification-'+randomUUID());await mkdir(out,{recursive:true});
const digest=b=>createHash('sha256').update(b).digest('hex');
const report={stage:192,status:'running',scope:'Read-only verification of the original completed post-deployment Desktop task. Accept a leading UTF-8 BOM from Windows PowerShell; do not rewrite the file, repeat inference, replay commands, edit billing or turn the failed wrapper receipt into a pass.',checks:[]};let browser,user;
try{
 const previousRaw=await readFile(path.join(source,'receipt.json')),previous=JSON.parse(previousRaw);
 assert.equal(previous.status,'failed');assert.match(previous.error,/Unexpected token/);assert.equal(previous.task.status,'succeeded');
 report.original_wrapper_receipt_sha256=digest(previousRaw);report.original_wrapper_status='failed';report.original_wrapper_error=previous.error;
 const bytes=await readFile(path.join(source,'owned-workspace/result.json'));assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);
 const actual=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),input=JSON.parse(await readFile(path.join(source,'owned-workspace/source.json'),'utf8'));
 assert.equal(actual.marker,input.marker);assert.equal(Number(actual.total_spend),input.campaigns.reduce((n,c)=>n+c.spend,0));assert.equal(Number(actual.total_conversions),input.campaigns.reduce((n,c)=>n+c.conversions,0));
 report.result={sha256:digest(bytes),utf8_bom_present:true,total_spend:Number(actual.total_spend),total_conversions:Number(actual.total_conversions)};
 const session=JSON.parse(await readFile(path.join(source,'native-session.private.json'),'utf8'));assert.equal(session.task.task_id,previous.task.task_id);assert.equal(session.busy,false);assert.equal(session.task.status,'succeeded');
 report.event_kinds=[...new Set(session.events.map(e=>e.kind))];assert.ok(report.event_kinds.includes('item/commandExecution/outputDelta'));assert.ok(report.event_kinds.includes('turn/completed'));
 report.checks.push({name:'Original local command events and exact source marker/totals verified from unchanged BOM-bearing output',status:'passed'});
 browser=await launch();user=await authenticate(browser,'realqa','qa-live-188@workmate.local');
 const task=await ok(user.page,'/v1/tenants/dfd0a03e-5648-4b7a-a687-fce8aacd658e/projects/30eb572b-52c1-4b99-966d-e3d2239a8b1d/tasks/'+previous.task.task_id);
 assert.equal(task.status,'succeeded');assert.equal(task.execution_location,'desktop');assert.equal(task.data_mode,'configured_services');assert.equal(task.charged_micros,previous.task.charged_micros);assert.ok(BigInt(task.charged_micros)>0n);assert.ok('client_error_code'in task);assert.equal(task.client_error_code,null);
 report.task={id:task.id,status:task.status,execution_location:task.execution_location,data_mode:task.data_mode,charged_micros:task.charged_micros,client_error_code:task.client_error_code};
 report.checks.push({name:'Post-deployment native success and measured charge persist on the actual updated company API',status:'passed'});report.original_owned_windows_closed=previous.owned_windows_closed;
 assert.equal(digest(await readFile(path.join(source,'owned-workspace/result.json'))),report.result.sha256);report.no_paid_replay=true;report.status='passed';
}catch(error){report.status='failed';report.error=error.message;}
finally{await user?.context.close();await browser?.close();report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));}
assert.equal(report.status,'passed');
