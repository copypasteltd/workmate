import {chromium} from 'playwright';
import {authenticateOwner197} from './live-owner-197-v1.mjs';
import {ok,WEB,screenshot} from './live-client-189-v2.mjs';
import {WorkmateRecording} from './record-workmate-media.ts';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=path.resolve('.data/acceptance-197/web-review-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:197,status:'running',at:new Date().toISOString(),checks:[],screenshots:[],javascript_errors:[],scope:'Actual deployed HTTPS task review, one software check area, keyboard, viewport and theme checks. Read-only review of an existing owned task; no model or business write is generated.'};
const pass=(name,details)=>{report.checks.push({name,status:'passed',details});console.log(JSON.stringify({name,status:'passed'}));};
let browser,user,recording;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 user=await authenticateOwner197(browser);const p=user.page;p.on('pageerror',e=>report.javascript_errors.push(e.message));p.setDefaultTimeout(45000);
 const owned=JSON.parse(await readFile('.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json','utf8'));
 await p.goto(WEB+'/app/tasks/'+owned.task_id,{waitUntil:'domcontentloaded'});const tabs=p.getByRole('tablist',{name:'Result views'});await tabs.waitFor();
 assert.equal(await tabs.getByRole('tab').count(),7);assert.equal(await p.locator('.software-checks').count(),0);
 await tabs.getByRole('tab',{name:'Results',exact:true}).focus();await p.keyboard.press('End');assert.equal(await tabs.getByRole('tab',{name:'Usage',exact:true}).getAttribute('aria-selected'),'true');await p.keyboard.press('Home');assert.equal(await tabs.getByRole('tab',{name:'Results',exact:true}).getAttribute('aria-selected'),'true');pass('seven task views retain keyboard navigation and the legacy duplicate area is absent');
 recording=new WorkmateRecording('web','task-review','197-v3',()=>p.screenshot({type:'jpeg',quality:72,mask:[p.locator('.user-chip strong')]}),'Actual HTTPS task review with one execution area and responsive views');await recording.start();
 await tabs.getByRole('tab',{name:'Execution',exact:true}).click();await p.locator('.software-checks').waitFor();assert.doesNotMatch(await p.locator('.software-checks').innerText(),/NaNs|undefined ms|Infinity/);assert.equal(await p.locator('.software-checks').count(),1);pass('the software execution checks appear exactly once inside the task workbench');
 for(const width of [375,768,1024,1440]){await p.setViewportSize({width,height:950});const size=await p.evaluate(()=>({inner:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(size.document<=size.inner);report.checks.push({name:'Responsive review '+width,status:'passed',details:size});}
 for(let n=0;n<3&&await p.evaluate(()=>document.documentElement.dataset.theme)!=='dark';n++)await p.getByTitle('Theme: light / dark / system',{exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');await p.getByRole('tab',{name:'Execution',exact:true}).click();await p.locator('.software-checks').waitFor();await p.locator('.task-workbench').evaluate(el=>el.scrollIntoView({block:'start'}));assert.ok(await p.getByRole('tab',{name:'Execution',exact:true}).isVisible());
 const file=path.resolve('../copypaste-web/assets/screenshots/197-v3-task-review.png');await mkdir(path.dirname(file),{recursive:true});await screenshot(p,file);report.screenshots.push({path:path.relative(path.resolve('..'),file).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});pass('dark review remains usable without horizontal overflow');
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+String(e.message).split('\n')[0];}
finally{if(recording)report.recording=await recording.stop().catch(()=>({status:'failed'}));await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
