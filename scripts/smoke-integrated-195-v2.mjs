import {chromium} from 'playwright';
import {authenticate,ok,WEB,ADMIN} from './live-client-189-v2.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/acceptance-195/final-smoke-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:195,status:'running',at:new Date().toISOString(),scope:'Final deployed candidate v10. Read existing paid task/results; no new model request, customer task or acceptance evidence. Fresh sign-in uses the retained test mailbox.',checks:[],javascript_errors:[]};
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
let browser,user,admin;
try{
 const host=JSON.parse(await readFile('.data/deployment-195/host-final-v3.sanitized.json','utf8'));assert.equal(host.deployment.status,'deployed');assert.ok(host.deployment.backend_root.endsWith('integrated-195-v10/backend'));
 const source='.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json',bytes=await readFile(source),original=JSON.parse(bytes);assert.equal(original.status,'passed');report.original_journey={receipt:source,sha256:createHash('sha256').update(bytes).digest('hex')};
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');const p=user.page;p.on('pageerror',e=>report.javascript_errors.push({client:'web',message:e.message}));
 const projects=await ok(p,'/v1/tenants/'+original.tenant_id+'/projects'),base=`/v1/tenants/${original.tenant_id}/projects/${projects.items[0].id}`,task=await ok(p,base+'/tasks/'+original.task_id);assert.equal(task.status,'succeeded');assert.equal(task.data_mode,'configured_services');
 const workspace=await ok(p,base+'/tasks/'+task.id+'/workspace');assert.ok(workspace.files.length>0);report.task={id:task.id,status:task.status,charged_micros:task.charged_micros,files:workspace.files.length};
 await p.goto(WEB+'/app/tasks/'+task.id,{waitUntil:'domcontentloaded'});await p.getByRole('tab',{name:'Results',exact:true}).waitFor();await p.getByRole('tab',{name:/^Files/}).click();await p.locator('.workbench-file').first().waitFor();await p.getByRole('tab',{name:'Usage',exact:true}).click();await p.locator('.workbench-usage').waitFor();pass('existing real cloud task and authorized deliverable/usage UI remain usable after final deployment');
 await p.goto(WEB+'/downloads',{waitUntil:'domcontentloaded'});const links=await p.locator('a[href*="/downloads/releases/195/"]').evaluateAll(nodes=>nodes.map(n=>n.href));assert.ok(links.some(u=>u.includes('Setup')));assert.ok(links.some(u=>u.includes('Portable')));assert.ok(links.some(u=>u.endsWith('/CopyPaste-Extension-0.5.5.zip')));pass('public download page links to the three current immutable client packages');
 admin=await authenticate(browser,'admin');const a=admin.page;a.on('pageerror',e=>report.javascript_errors.push({client:'admin',message:e.message}));await a.goto(ADMIN+'/readiness',{waitUntil:'domcontentloaded'});await a.getByRole('heading',{name:'Service readiness',exact:true}).waitFor();await a.locator('.readiness-service').first().waitFor();const readiness=await ok(a,'/v1/admin/operational-readiness');assert.equal(readiness.checks.find(x=>x.key==='office_preview').state,'ready');assert.equal(readiness.checks.find(x=>x.key==='mail').state,'test_only');
 await a.goto(ADMIN+'/role-acceptance',{waitUntil:'domcontentloaded'});await a.getByRole('button',{name:'Record acceptance',exact:true}).waitFor();const records=await ok(a,'/v1/admin/role-acceptance?limit=50');const evidence=records.items.find(x=>x.id===original.controlled_evidence_id);assert.ok(evidence?.revoked_at&&evidence.proof_hash);pass('Admin readiness and the immutable withdrawn controlled evidence survive final deployment');
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message;}
finally{await admin?.context.close().catch(()=>{});await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
