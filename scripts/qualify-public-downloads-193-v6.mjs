// Final remaining UI checks reuse already completed, unchanged download proofs from V5.
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {authenticate} from './live-client-189-v2.mjs';
const priorPath=path.resolve('.data/acceptance-193/public-b54006f1-9156-425f-bd65-f0810c08807a/receipt.json');
const original=await readFile(priorPath);const prior=JSON.parse(original);
assert.equal(prior.status,'failed');assert.match(prior.error,/把工作空間/);
assert.equal(prior.downloads.filter(d=>d.full_browser_download).length,3);
const WEB='https://agent.copypaste.hk';const out=path.resolve('.data/acceptance-193/public-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:193,status:'running',scope:'Completed V5 public navigation/full-download/hash/protocol checks plus remaining responsive/language/theme/authentication checks against the unchanged live build. Original V5 selector timeout retained.',prior_attempt:{path:priorPath,sha256:createHash('sha256').update(original).digest('hex')},checks:[...prior.checks],downloads:prior.downloads,javascript_errors:[]};
let browser,context,user,video;
function pass(name,details={}){report.checks.push({name,status:'passed',...details});console.log(JSON.stringify({phase:'passed',name}));}
async function layout(page,name){const overflow=await page.evaluate(()=>({root:document.documentElement.scrollWidth>innerWidth+1,body:document.body.scrollWidth>innerWidth+1}));assert.deepEqual(overflow,{root:false,body:false});pass(name,{overflow});}
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:1000}}});
 await context.addInitScript(()=>{if(!localStorage.getItem('cp_locale'))localStorage.setItem('cp_locale','en');if(!localStorage.getItem('cp_theme'))localStorage.setItem('cp_theme','light');});
 const page=await context.newPage();video=page.video();page.on('pageerror',e=>report.javascript_errors.push(e.message));
 const response=await page.goto(WEB+'/downloads',{waitUntil:'domcontentloaded'});
 assert.equal(await response.text(),await readFile('../copypaste-web/dist/index.html','utf8'));pass('Live entry still matches the build used for completed download checks');
 await page.locator('#download-heading').waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(out,'downloads-desktop-en.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('link',{name:'View installation steps',exact:true}).click();await page.getByRole('heading',{name:'Load it in Chrome',exact:true}).waitFor();
 await page.getByRole('button',{name:'Desktop',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.goto(WEB+'/downloads',{waitUntil:'domcontentloaded'});
 await page.getByTitle('切換至繁體中文',{exact:true}).click();await page.getByRole('heading',{name:/把工作空間，\s*帶到手邊。/}).waitFor();
 await page.screenshot({path:path.join(out,'downloads-mobile-zh.png'),fullPage:true,animations:'disabled'});await layout(page,'390px Traditional Chinese download layout');
 await page.getByTitle('Theme: light / dark / system',{exact:true}).click();
 await page.screenshot({path:path.join(out,'downloads-mobile-dark.png'),fullPage:true,animations:'disabled'});await layout(page,'390px dark download layout');
 await page.setViewportSize({width:320,height:760});await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/把工作空間，\s*帶到手邊。/}).waitFor();
 await layout(page,'320px downloads layout and language persistence');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.title(),'下載 · CopyPaste');pass('Theme, language and localized page title survive refresh');
 await page.goto(WEB+'/login',{waitUntil:'domcontentloaded'});await page.locator('.downloads-entry[href="/downloads"]').waitFor();pass('Sign-in page exposes the download entry');
 user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
 await user.page.goto(WEB+'/app/devices',{waitUntil:'domcontentloaded'});await user.page.getByRole('link',{name:'Download apps',exact:true}).waitFor();
 await user.page.getByRole('link',{name:'Download Desktop or the Chrome extension to connect your device',exact:true}).click();await user.page.locator('#download-heading').waitFor();
 assert.equal(await user.page.getByRole('link',{name:'Open workspace',exact:true}).getAttribute('href'),'/app');pass('Authenticated sidebar and device entry reach downloads and preserve workspace return');
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.message;}
finally{await user?.context.close();await context?.close();await browser?.close();report.owned_browser_closed=true;if(video)report.actual_video=await video.path();report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
