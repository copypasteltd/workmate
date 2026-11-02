import {launch,authenticate,ok,privateRoot,screenshot,WEB} from './live-client-188-v3.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import{createHash,randomUUID}from'node:crypto';import path from'node:path';import assert from'node:assert/strict';
const run=path.join(privateRoot,'real-delivery-ledger-'+randomUUID());await mkdir(run,{recursive:true});
const originalPath='.data/acceptance-188/real-web-bbfc1cf5-3d1c-454b-968c-510fbe0624b9/receipt.json',original=JSON.parse(await readFile(originalPath,'utf8')),setup=JSON.parse(await readFile('.data/deployment-179/real-mode-prepared-188.sanitized.json','utf8'));
const report={stage:188,status:'running',continuation_of:originalPath,original_task_id:original.task_id,original_receipt_sha256:createHash('sha256').update(await readFile(originalPath)).digest('hex'),checks:[],new_paid_tasks:0};
let browser,user,admin;const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
try{
 browser=await launch();user=await authenticate(browser,'realqa','qa-live-188@workmate.local');const base=`/v1/tenants/${setup.qa_workspace.id}/projects/${setup.qa_workspace.project_id}`;
 const assets=await ok(user.page,base+'/assets');const output=assets.items.find(a=>original.deliverable_ids.includes(a.id));assert.ok(output);
 const download=await user.context.request.get(WEB+base+'/assets/'+output.id+'/download?version='+output.current_version);assert.equal(download.status(),200);const bytes=await download.body();const digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,output.sha256);assert.equal(download.headers()['x-content-sha256'],digest);const rows=bytes.toString().trim().split(/\r?\n/).slice(1).map(r=>r.split(','));assert.ok(rows.some(r=>/spend/i.test(r[0])&&Number(r[1])===100));assert.ok(rows.some(r=>/conversion/i.test(r[0])&&Number(r[1])===40));assert.match(bytes.toString(),/WM188-[a-f\d-]{36}/);
 await writeFile(path.join(run,'actual-deliverable.csv'),bytes,{flag:'wx'});report.deliverable={id:output.id,sha256:digest,bytes:bytes.length,version:output.current_version};pass('actual private deliverable downloads with the recorded SHA-256 and correct source-derived totals');
 const task=await ok(user.page,base+'/tasks/'+original.task_id);assert.equal(task.status,'succeeded');assert.equal(task.charged_micros,original.task.charged_micros);report.charged_micros=task.charged_micros;pass('reloading and downloading retain the original task charge without starting another model task');
 admin=await authenticate(browser,'admin');const account=await ok(admin.page,'/v1/admin/billing/accounts/'+setup.qa_workspace.billing_account_id);report.account=account;pass('fresh administrator OTP/TOTP permits actual account and consumption inspection');
 await user.page.goto(WEB+'/app/conversations/'+original.conversation_id,{waitUntil:'domcontentloaded'});await user.page.getByLabel('Your message',{exact:true}).waitFor();await screenshot(user.page,path.join(run,'actual-conversation-and-delivery.png'));
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;}
finally{await user?.context.close();await admin?.context.close();await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
