import {chromium} from 'playwright';
import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';
import {ok,WEB,screenshot} from './live-client-189-v2.mjs';
import {WorkmateRecording} from './record-workmate-media.ts';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=path.resolve('.data/acceptance-198/directory-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:198,status:'running',at:new Date().toISOString(),checks:[],screenshots:[],javascript_errors:[],scope:'Actual deployed HTTPS directory, filtered return navigation, result view state, exact conversation task, scope gate, responsive themes and keyboard. Read-only existing owned tasks; no model/task/ledger writes.'};
const pass=(name,details)=>{report.checks.push({name,status:'passed',details});console.log(JSON.stringify({name,status:'passed'}));};
let browser,user,recording;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 user=await existingOwner(browser);const p=user.page;p.on('pageerror',e=>report.javascript_errors.push(e.message));p.setDefaultTimeout(45000);
 const owned=JSON.parse(await readFile('.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json','utf8'));
 const projects=await ok(p,`/v1/tenants/${owned.tenant_id}/projects`),project=projects.items.find(x=>x.id===owned.project_id)??projects.items[0];assert.ok(project);
 const tenant=owned.tenant_id,base=`/v1/tenants/${tenant}/projects/${project.id}`,directory=await ok(p,base+'/task-directory?limit=100');assert.ok(directory.items.length>0);
 const task=directory.items.find(x=>x.id===owned.task_id)??directory.items.find(x=>x.status==='succeeded')??directory.items[0];
 const scoped=path=>WEB+path+(path.includes('?')?'&':'?')+new URLSearchParams({workspace:tenant,project:project.id});
 await navigate(p,scoped('/app/tasks'));await p.getByRole('heading',{name:'All tasks',exact:true}).waitFor();await p.locator('.task-directory-row').first().waitFor();
 recording=new WorkmateRecording('web','work-directory','198-v5',()=>p.screenshot({type:'jpeg',quality:72,mask:[p.locator('.user-chip strong')]}),'Actual task search, original conversation and retained result navigation');await recording.start();
 await p.getByLabel('Task title',{exact:true}).fill(task.title);await p.getByLabel('Task status',{exact:true}).selectOption(task.status);await p.getByLabel('Execution location',{exact:true}).selectOption(task.execution_location);await p.getByLabel('Working mode',{exact:true}).selectOption(task.mode);
 await p.getByRole('button',{name:'Find tasks',exact:true}).click();const row=p.locator(`[data-task-id="${task.id}"]`);await row.waitFor();await p.getByRole('button',{name:'Find tasks',exact:true}).waitFor({state:'visible'});
 assert.equal(new URL(p.url()).searchParams.has('q'),false);assert.equal(await p.getByLabel('Task title',{exact:true}).inputValue(),task.title);report.task={id:task.id,status:task.status,execution_location:task.execution_location};
 await row.locator('.task-directory-title').click();await p.getByRole('tab',{name:'Results',exact:true}).waitFor();await p.getByRole('tab',{name:'Usage',exact:true}).click();await p.locator('.workbench-usage').waitFor();
 assert.equal(await p.locator('.workbench-detail').count(),0);await p.goBack({waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:'All tasks',exact:true}).waitFor();assert.equal(await p.getByLabel('Task title',{exact:true}).inputValue(),task.title);assert.equal(await p.getByLabel('Task status',{exact:true}).inputValue(),task.status);
 await p.goForward({waitUntil:'domcontentloaded'});await p.getByRole('tab',{name:'Usage',exact:true}).waitFor();assert.equal(await p.getByRole('tab',{name:'Usage',exact:true}).getAttribute('aria-selected'),'true');pass('filtered list and task result selection survive browser back/forward without exposing the search in the URL');
 await p.getByRole('link',{name:'Back to tasks',exact:true}).click();await p.getByRole('heading',{name:'All tasks',exact:true}).waitFor();assert.equal(await p.getByLabel('Working mode',{exact:true}).inputValue(),task.mode);assert.equal(await p.getByLabel('Execution location',{exact:true}).inputValue(),task.execution_location);pass('task return link retains the original filters and correct organization/project');
 await p.getByRole('button',{name:'Clear filters',exact:true}).click();await p.locator('.task-directory-row').first().waitFor();
 let linked=directory.items.find(t=>t.conversation_id),cursor=directory.next_cursor,walk=0;
 while(!linked&&cursor&&++walk<5){const page=await ok(p,base+'/task-directory?limit=100&cursor='+encodeURIComponent(cursor));linked=page.items.find(t=>t.conversation_id);cursor=page.next_cursor;}
 assert.ok(linked,'An existing owned task with its original conversation is required');
 await navigate(p,scoped('/app/conversations/'+linked.conversation_id+'?task='+linked.id));await p.getByLabel('Select a task to view or provide inputs',{exact:true}).waitFor();assert.equal(await p.getByLabel('Select a task to view or provide inputs',{exact:true}).inputValue(),linked.id);await p.getByRole('tab',{name:'Usage',exact:true}).click();
 await p.getByRole('link',{name:/Full task and delivery review/}).click();await p.getByRole('link',{name:'Back to conversation',exact:true}).click();await p.getByLabel('Select a task to view or provide inputs',{exact:true}).waitFor();assert.equal(await p.getByLabel('Select a task to view or provide inputs',{exact:true}).inputValue(),linked.id);assert.equal(await p.getByRole('tab',{name:'Usage',exact:true}).getAttribute('aria-selected'),'true');report.original_conversation={id:linked.conversation_id,task_id:linked.id};pass('the exact original conversation task and its result tab survive the complete review round-trip');
 const forbidden=randomUUID();await navigate(p,scoped('/app/tasks/'+task.id).replace('project='+project.id,'project='+forbidden));await p.getByRole('heading',{name:'This work location is unavailable',exact:true}).waitFor();assert.equal(await p.locator('.task-workbench').count(),0);await p.getByRole('button',{name:'Open workspace',exact:true}).click();await p.waitForURL(/\/app$/);pass('an unavailable project cannot mount the target work page or force an endless workspace switch');
 await navigate(p,scoped('/app/tasks'));await p.locator('.task-directory-row').first().waitFor();
 // Finish concurrent screenshots before changing viewport. Playwright restores
 // capture viewport state, which must not race responsive measurements.
 report.recording=await recording.stop();recording=null;
 const usageLabels=await p.locator('.task-directory-usage > .muted').allTextContents();assert.ok(usageLabels.length>0);assert.ok(usageLabels.every(s=>s==='Recorded usage'));pass('task-directory amounts are recorded usage without claiming unresolved work is settled');
 for(const width of [375,768,1024,1440]){await p.setViewportSize({width,height:950});await p.waitForFunction(w=>innerWidth===w,width);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const size=await p.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));assert.equal(size.width,width);assert.ok(size.content<=size.width+1);pass('Task directory fits '+width+'px',size);}
 for(const theme of ['light','dark']){
  for(let i=0;i<3&&await p.evaluate(()=>document.documentElement.dataset.theme)!==theme;i++)await p.getByTitle('Theme: light / dark / system',{exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme);
  const file=path.resolve('../copypaste-web/assets/screenshots/198-v5-task-directory-'+theme+'.png');await mkdir(path.dirname(file),{recursive:true});await screenshot(p,file);report.screenshots.push({path:path.relative(path.resolve('..'),file).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
 }
 await p.getByLabel('Task title',{exact:true}).focus();assert.equal(await p.getByLabel('Task title',{exact:true}).evaluate(el=>el===document.activeElement),true);pass('light/dark filters remain keyboard reachable');assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+String(e.message).split('\n')[0];report.error_locator=String(e.message).split('\n').find(line=>line.includes('locator')||line.includes('waiting for'));if(user?.page)await user.page.screenshot({path:path.join(run,'failure.private.png')}).catch(()=>{});}
finally{if(recording)report.recording=await recording.stop().catch(()=>({status:'failed'}));await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
