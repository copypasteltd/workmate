import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('.data/deployment-176'),s=JSON.parse(await readFile(path.join(dir,'qa-login-context.json'),'utf8'));
let browser,context;const result={stage:176,status:'started',at:new Date().toISOString()};
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')});
 context=await browser.newContext({httpCredentials:{username:s.operator_username,password:s.operator_password,origin:'http://192.168.31.20:63071'}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push('Mailbox displayed an error dialog');await d.dismiss();});
 await page.goto('http://192.168.31.20:63071/ops/mailbox/');await page.locator('article').first().waitFor();
 const count=await page.locator('article').count();assert.ok(count>0);assert.deepEqual(errors,[]);result.visible_emails=count;result.status='passed';
}catch(e){result.status='failed';result.error=e.message;}
finally{await context?.close();await browser?.close();result.browser_closed=true;await writeFile(path.join(dir,'operator-mailbox.sanitized.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
assert.equal(result.status,'passed');
