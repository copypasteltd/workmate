import {chromium} from 'playwright';
import {authenticateOwner196} from './live-owner-196-v1.mjs';
import {WEB,screenshot} from './live-client-189-v2.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/acceptance-196/role-guide-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:196,status:'running',scope:'Actual deployed role guidance and explicit example selection; does not submit work or invoke a model. Completes the role-guide selector step following the retained workspace v3 journey.',checks:[],screenshots:[]};
let browser,user;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 user=await authenticateOwner196(browser);const p=user.page;await p.goto(WEB+'/app',{waitUntil:'domcontentloaded'});
 await p.locator('.new-task-side').click();const modal=p.getByRole('dialog');await modal.waitFor();
 if(await modal.getByRole('button',{name:'Start another task',exact:true}).count())await modal.getByRole('button',{name:'Start another task',exact:true}).click();
 await modal.locator('.work-intake-options summary').click();await modal.getByLabel('Specialist',{exact:true}).selectOption('fullstack');
 const guide=modal.getByRole('region',{name:'Selected specialist and delivery'});await guide.waitFor();
 const button=guide.getByRole('button',{name:'Use this example',exact:true});await button.waitFor();await button.click();assert.ok((await modal.getByLabel('What would you like to make?',{exact:true}).inputValue()).length>5);
 await guide.getByText("This template's deliverables",{exact:true}).waitFor();
 assert.ok((await guide.locator('li').count())>0);assert.ok((await guide.innerText()).includes('you review the professional result')||(await guide.innerText()).includes('dependencies are not ready'));
 const file=path.resolve('../copypaste-web/assets/screenshots/196-role-guidance.png');await mkdir(path.dirname(file),{recursive:true});await screenshot(p,file);report.screenshots.push({path:'copypaste-web/assets/screenshots/196-role-guidance.png',sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
 report.checks.push({name:'Selected specialist displays its actual deliverables, service availability and professional-review boundary; an explicitly selected example fills the brief without submitting work',status:'passed'});report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
