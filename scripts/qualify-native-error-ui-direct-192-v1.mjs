import { chromium } from "playwright";
import { launch, authenticate, context, ok, WEB, ADMIN } from './live-client-189-v2.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const out=path.resolve('.data/acceptance-192/direct-error-ui-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:192,status:'running',scope:'Actual saved native failure on public customer and administrator pages. Direct Chromium without QA proxy. Read-only existing authorized sessions; no task replay, settlement or credential edits.',checks:[],javascript_errors:[]};
let browser,user,admin;
async function verify(page,label){
 const notice=page.locator('[data-client-error-code="LOCAL_CODEX_TURN_FAILED"]').first();
 await notice.waitFor({timeout:30000});assert.match(await notice.innerText(),/Reported local cause/);
 assert.ok(await page.getByText('USAGE_RECONCILIATION_REQUIRED',{exact:true}).first().isVisible());
 await notice.screenshot({path:path.join(out,label+'-local-cause.png'),animations:'disabled'});
 const overflow=await page.evaluate(()=>({root_horizontal:document.documentElement.scrollWidth>innerWidth+1,body_horizontal:document.body.scrollWidth>innerWidth+1}));
 assert.deepEqual(overflow,{root_horizontal:false,body_horizontal:false});
 report.checks.push({name:label+': separate original native failure and unchanged reconciliation reason; no horizontal overflow',status:'passed',overflow});
}
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
 user.page.on('pageerror',e=>report.javascript_errors.push(e.message));
 await user.page.goto(WEB+'/app/tasks/dddcb494-42f4-4d29-80bd-9c4bd4141176',{waitUntil:'domcontentloaded'});
 const workspace=user.page.getByLabel('Switch workspace',{exact:true});await workspace.waitFor();
 if(await workspace.inputValue()!=='f5b06ebd-ec59-414c-ad1a-04224d202fc0')await workspace.selectOption('f5b06ebd-ec59-414c-ad1a-04224d202fc0');
 const project=user.page.getByLabel('Current project',{exact:true});if(await project.inputValue()!=='f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a')await project.selectOption('f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a');
 await verify(user.page,'web');
 const state=JSON.parse(await readFile('.data/acceptance-189/admin-state.private.json','utf8'));admin=await context(browser,{storageState:state});const page=await admin.newPage();page.on('pageerror',e=>report.javascript_errors.push(e.message));
 await page.goto(ADMIN+'/execution?search=dddcb494-42f4-4d29-80bd-9c4bd4141176',{waitUntil:'domcontentloaded'});
 await ok(page,'/v1/admin/me');await verify(page,'admin');
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.message;}
finally{await user?.context.close();await admin?.close();await browser?.close();report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
