import {chromium} from 'playwright';
import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';
import {WorkmateRecording} from './record-workmate-media.ts';
import {authenticate,context,totp,ok,WEB,ADMIN} from './live-client-189-v2.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/acceptance-198/final-smoke-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:198,status:'running',at:new Date().toISOString(),scope:'Final deployed candidate198 v2, numeric immutable release19802. Read existing paid task/results; no new model request, customer task or acceptance evidence. Web reuses a still-authorized owned QA session, verified against live session identity; fresh Admin sign-in uses the retained test mailbox and TOTP. No credentials or responses are replaced.',checks:[],screenshots:[],recordings:[],javascript_errors:[]};
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
let browser,user,admin,recording;
async function authenticateAdmin(browser){
 const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8'));
 const c=await context(browser),page=await c.newPage();await navigate(page,ADMIN+'/');
 await page.getByLabel('Administrator email',{exact:true}).fill(secret.admin_email);
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/admin/auth/challenge'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send admin sign-in code',exact:true}).click()]);assert.equal(response.status(),200);
 const challenge=await response.json();
 const message=await page.evaluate(async({id,auth})=>{const r=await fetch('/ops/mailbox/data/'+id+'.json',{headers:{Authorization:auth}});if(!r.ok)throw Error('Protected mailbox status '+r.status);return r.json();},{id:challenge.challenge_id,auth:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64')});
 assert.equal(message.to,secret.admin_email);await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());
 await page.getByRole('button',{name:'Verify & open dashboard',exact:true}).click();await page.getByRole('button',{name:'Sign out admin',exact:true}).waitFor();return {context:c,page};
}

try{
 const host=JSON.parse(await readFile('.data/deployment-198-v2/host-final-v2.sanitized.json','utf8'));assert.equal(host.deployment.status,'deployed');assert.ok(host.deployment.backend_root.endsWith('integrated-198-v2/backend'));
 const source='.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json',bytes=await readFile(source),original=JSON.parse(bytes);assert.equal(original.status,'passed');report.original_journey={receipt:source,sha256:createHash('sha256').update(bytes).digest('hex')};
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 user=await existingOwner(browser);const p=user.page;p.on('pageerror',e=>report.javascript_errors.push({client:'web',message:e.message}));
 const projects=await ok(p,'/v1/tenants/'+original.tenant_id+'/projects'),base=`/v1/tenants/${original.tenant_id}/projects/${projects.items[0].id}`,task=await ok(p,base+'/tasks/'+original.task_id);assert.equal(task.status,'succeeded');assert.equal(task.data_mode,'configured_services');
 const workspace=await ok(p,base+'/tasks/'+task.id+'/workspace');assert.ok(workspace.files.length>0);report.task={id:task.id,status:task.status,charged_micros:task.charged_micros,files:workspace.files.length};
 await navigate(p,WEB+'/app/tasks/'+task.id);await p.getByRole('tab',{name:'Results',exact:true}).waitFor();await p.getByRole('tab',{name:/^Files/}).click();await p.locator('.workbench-file').first().waitFor();await p.getByRole('tab',{name:'Usage',exact:true}).click();await p.locator('.workbench-usage').waitFor();pass('existing real cloud task and authorized deliverable/usage UI remain usable after final deployment');
 await navigate(p,WEB+'/downloads');const links=await p.locator('a[href*="/downloads/releases/19802/"]').evaluateAll(nodes=>nodes.map(n=>n.href));assert.ok(links.some(u=>u.includes('Setup')));assert.ok(links.some(u=>u.includes('Portable')));assert.ok(links.some(u=>u.endsWith('/CopyPaste-Extension-0.5.7.zip')));pass('public download page links to the three current immutable client packages');
 admin=await authenticateAdmin(browser);const a=admin.page;a.on('pageerror',e=>report.javascript_errors.push({client:'admin',message:e.message}));await navigate(a,ADMIN+'/readiness');await a.getByRole('heading',{name:'Service readiness',exact:true}).waitFor();await a.locator('.readiness-service').first().waitFor();const readiness=await ok(a,'/v1/admin/operational-readiness');assert.equal(readiness.checks.find(x=>x.key==='office_preview').state,'ready');assert.equal(readiness.checks.find(x=>x.key==='mail').state,'test_only');
 await navigate(a,ADMIN+'/role-acceptance');await a.getByRole('button',{name:'Record acceptance',exact:true}).waitFor();const records=await ok(a,'/v1/admin/role-acceptance?limit=50');const evidence=records.items.find(x=>x.id===original.controlled_evidence_id);assert.ok(evidence?.revoked_at&&evidence.proof_hash);pass('Admin readiness and the immutable withdrawn controlled evidence survive final deployment');

 recording=new WorkmateRecording('admin','service-review','198-v4',()=>a.screenshot({type:'jpeg',quality:72,mask:[a.locator('.user-chip strong')]}),'Actual deployed Admin readiness, explicit refresh and retained role-evidence review');await navigate(a,ADMIN+'/readiness');await a.locator('.readiness-service').first().waitFor();await recording.start();
 const image=path.resolve('../copypaste-admin/assets/screenshots/198-v4-service-readiness.png');await mkdir(path.dirname(image),{recursive:true});await a.screenshot({path:image,animations:'disabled',mask:[a.locator('.user-chip strong')]});report.screenshots.push({path:'copypaste-admin/assets/screenshots/198-v4-service-readiness.png',sha256:createHash('sha256').update(await readFile(image)).digest('hex')});await a.getByRole('button',{name:'Check again',exact:true}).click();await a.getByRole('button',{name:'Check again',exact:true}).waitFor();await navigate(a,ADMIN+'/role-acceptance');await a.getByRole('button',{name:'Record acceptance',exact:true}).waitFor();report.recordings.push(await recording.stop());recording=null;
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{if(recording)report.recordings.push(await recording.stop().catch(e=>({error:e.message.split('\n')[0]})));await admin?.context.close().catch(()=>{});await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
