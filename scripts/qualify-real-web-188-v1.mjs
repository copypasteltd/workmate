import {launch,authenticate,call,ok,WEB,privateRoot,screenshot} from './live-client-188-v2.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=path.join(privateRoot,'real-web-'+randomUUID());await mkdir(run,{recursive:true});
const setup=JSON.parse(await readFile('.data/deployment-179/real-mode-prepared-188.sanitized.json','utf8'));
const report={stage:188,status:'running',at:new Date().toISOString(),checks:[],javascript_errors:[],transport:'Canonical public HTTPS through owned CONNECT proxy; valid browser TLS, no origin/cookie/response rewrites.'};
const pass=(name,details)=>{report.checks.push({name,status:'passed',details});console.log(JSON.stringify({name,status:'passed'}));};
let browser,user,admin;
try{
 browser=await launch();user=await authenticate(browser,'realqa','qa-live-188@workmate.local');const p=user.page;
 p.on('pageerror',e=>report.javascript_errors.push(e.message));
 assert.equal(user.identity.user.id,setup.qa_user_id);assert.deepEqual(user.identity.memberships.map(m=>m.tenant_id),[setup.qa_workspace.id]);pass('real user signs in through public OTP flow and receives only the active real-mode workspace');
 const base=`/v1/tenants/${setup.qa_workspace.id}/projects/${setup.qa_workspace.project_id}`;const headers={'X-CSRF-Token':user.csrf,'X-Tenant-ID':setup.qa_workspace.id};
 const config=await ok(p,'/v1/public/config');assert.equal(config.data_mode,'configured_services');assert.equal(config.services.text,true);report.services=config.services;
 await p.goto(WEB+'/app/roles',{waitUntil:'domcontentloaded'});await p.locator('.role-card').first().waitFor();assert.equal(await p.locator('.demo-notice').count(),0);pass('public Web shows real-service mode and removes the simulated-data banner');
 const roles=await ok(p,'/v1/catalog/roles');assert.ok(roles.items.length>=12);report.roles=roles.items.map(r=>({key:r.role_key,available:r.available,missing:r.missing}));
 const negative=await call(p,`/v1/tenants/${setup.owner_workspace.id}/projects/${setup.owner_workspace.project_id}/tasks`);assert.ok([403,404].includes(negative.status));
 const noCSRF=await call(p,base+'/conversations',{name:'Must not be created without CSRF'});assert.equal(noCSRF.status,403);pass('unrelated customer workspace and writes without CSRF are denied');
 const marker='WM188-'+randomUUID();const filename='real-campaign-'+randomUUID().slice(0,8)+'.csv';
 const source=Buffer.from('campaign,spend_hkd,conversions,verification_marker\nHarbour,37.25,14,'+marker+'\nPeak,62.75,26,'+marker+'\n');report.source={filename,sha256:createHash('sha256').update(source).digest('hex')};
 await p.goto(WEB+'/app/files',{waitUntil:'domcontentloaded'});await p.getByRole('button',{name:'Upload file',exact:true}).click();await p.locator('input[type="file"]').setInputFiles({name:filename,mimeType:'text/csv',buffer:source});
 const [uploaded]=await Promise.all([p.waitForResponse(r=>/\/uploads\/[^/]+\/complete$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST',{timeout:60000}),p.getByRole('button',{name:'Upload or resume',exact:true}).click()]);
 assert.ok(uploaded.ok());const asset=await uploaded.json();assert.equal(asset.version.sha256,report.source.sha256);report.source.asset_id=asset.id;report.source.version_id=asset.version.id;pass('actual browser-selected CSV uploads with matching immutable SHA-256');
 await p.goto(WEB+'/app/conversations',{waitUntil:'domcontentloaded'});await p.getByRole('button',{name:'Start conversation',exact:true}).click();await p.getByLabel('Conversation name',{exact:true}).fill('Actual model acceptance 188');
 const [created]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===base+'/conversations'&&r.request().method()==='POST'),p.getByRole('button',{name:'Create conversation',exact:true}).click()]);assert.ok(created.ok());const conversation=await created.json();report.conversation_id=conversation.id;
 await p.getByLabel('Your message',{exact:true}).fill(`Read the actual uploaded CSV asset version ${asset.version.id} (${filename}) using the available asset tool. Calculate total spend HKD and total conversions from the two rows. Include the exact verification_marker found in the file in your final response. Save a small CSV report named acceptance-188-result.csv using the asset write tool with the totals and the exact marker. Work only inside this project. Do not use sample figures, browse websites, or call paid image/video APIs.`);
 await p.getByLabel('Task budget limit (HKD)',{exact:true}).fill('2');
 const [accepted]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===base+'/conversations/'+conversation.id+'/messages'&&r.request().method()==='POST',{timeout:45000}),p.getByRole('button',{name:'Delegate task',exact:true}).click()]);assert.ok(accepted.ok());const submitted=await accepted.json();assert.ok(submitted.task?.id);report.task_id=submitted.task.id;pass('user delegates an actual Codex task from the conversation UI with a bounded HK$2 budget');
 await screenshot(p,path.join(run,'01-actual-codex-running.png'));
 let task;const end=Date.now()+240000;let last;
 while(Date.now()<end){task=await ok(p,base+'/tasks/'+report.task_id);if(task.status!==last){console.log(JSON.stringify({task_id:task.id,status:task.status}));last=task.status;}if(!['queued','running','paused','needs_input','awaiting_approval'].includes(task.status))break;await new Promise(r=>setTimeout(r,1500));}
 report.task={id:task.id,status:task.status,error_code:task.error_code,charged_micros:task.charged_micros,input_tokens:task.input_tokens,output_tokens:task.output_tokens,data_mode:task.data_mode};
 assert.equal(task.status,'succeeded',JSON.stringify(report.task));assert.equal(task.data_mode,'configured_services');assert.ok(BigInt(task.charged_micros)>0n&&BigInt(task.charged_micros)<=2000000n);assert.ok(Number(task.input_tokens)>0&&Number(task.output_tokens)>0);assert.ok(task.output.includes(marker));assert.match(task.output,/100(?:\.00)?/);assert.match(task.output,/40/);
 const events=await ok(p,base+'/tasks/'+task.id+'/events?after=0');report.event_kinds=[...new Set(events.items.map(e=>e.kind))];await writeFile(path.join(run,'task-events.private.json'),JSON.stringify(events,null,2)+'\n',{flag:'wx',mode:0o600});
 pass('real Codex reads the actual source marker, computes HK$100 and 40 conversions, completes with measured paid usage',report.task);
 await p.reload({waitUntil:'domcontentloaded'});await p.getByText(marker,{exact:false}).first().waitFor({timeout:30000});await screenshot(p,path.join(run,'02-actual-codex-result.png'));
 const assets=await ok(p,base+'/assets');await writeFile(path.join(run,'assets.private.json'),JSON.stringify(assets,null,2)+'\n',{flag:'wx',mode:0o600});
 const outputs=assets.items.filter(a=>a.name==='acceptance-188-result.csv'||a.filename==='acceptance-188-result.csv');assert.ok(outputs.length>0,'Actual model must save its promised deliverable');report.deliverable_ids=outputs.map(a=>a.id);pass('real model produces the requested persisted CSV deliverable');
 admin=await authenticate(browser,'admin');const account=await ok(admin.page,'/v1/admin/billing/accounts/'+setup.qa_workspace.billing_account_id);report.wallet={version:account.version,state:account.state,credit_limit_micros:account.credit_limit_micros};pass('administrator can inspect the actual charged QA account after completion');
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.message;}
finally{await user?.context.close();await admin?.context.close();await browser?.close();report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
