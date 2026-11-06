import {chromium} from 'playwright';
import {authenticateAdmin196v2} from './live-admin-196-v2.mjs';
import {ok,call} from './live-client-189-v2.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const file='.data/deployment-196/owned-native-tasks-v2.sanitized.json',bytes=await readFile(file),audit=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),task='79b3fe90-269a-4c23-b4cd-cfbbee18bdb4';
assert.equal(audit.status,'inspected');assert.equal(audit.receipts.find(r=>r.task_id===task).requests,0);assert.equal(audit.receipts.find(r=>r.task_id===task).uncertain,false);assert.equal(audit.receipts.find(r=>r.task_id===task).knownChargeMicros,0);assert.equal(audit.requests.filter(r=>r.task_id===task).length,0);
const out='.data/deployment-196/owned-startup-reconciliation-v2.sanitized.json',result={stage:196,status:'running',task_id:task,scope:'Only the owned abandoned startup qualification; server-observed zero model requests and zero cost. Existing highest-admin preview/commit, permission checks and audit are retained. No customer task, balance grant or unknown provider request is changed.',basis:{receipt:file,sha256:createHash('sha256').update(bytes).digest('hex')}};
let browser,admin;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});admin=await authenticateAdmin196v2(browser);assert.ok(admin.csrf);const headers={'X-CSRF-Token':admin.csrf,'X-Tenant-Id':'dfd0a03e-5648-4b7a-a687-fce8aacd658e'};
 const command={action:'billing.reconcile',tenant_id:'dfd0a03e-5648-4b7a-a687-fce8aacd658e',task_id:task,actual_micros:0,reason:'Round196 owned QA startup was abandoned before any model admission. Server receipt confirms zero requests and zero usage; audit basis SHA256 '+result.basis.sha256};
 const preview=await ok(admin.page,'/v1/admin/operations/preview',command,headers);assert.equal(preview.approval,false);
 const key=randomUUID(),committed=await call(admin.page,'/v1/admin/operations/commit',{preview_id:preview.id,payload_hash:preview.payload_hash},{...headers,'Idempotency-Key':key});assert.equal(committed.status,200,committed.data?.error?.code??'commit');assert.equal(committed.data.state,'succeeded');assert.equal(committed.data.result.task_id,task);assert.equal(committed.data.result.actual_micros,0);result.operation={id:committed.data.id,state:committed.data.state,result:committed.data.result};result.status='committed_pending_readback';
}catch(e){result.status='failed';result.error=e.name+': '+e.message.split('\n')[0];}
finally{if(admin)await call(admin.page,'/v1/admin/auth/logout',{}, {'X-CSRF-Token':admin.csrf}).catch(()=>{});await admin?.context.close().catch(()=>{});await browser?.close().catch(()=>{});result.owned_browser_closed=true;result.finished_at=new Date().toISOString();await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,receipt:out,error:result.error}));}
assert.equal(result.status,'committed_pending_readback');
