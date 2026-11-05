// Set PLAYWRIGHT_BROWSERS_PATH in the launcher before Playwright imports its registry.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { authenticate } from './live-client-189-v2.mjs';

const WEB='https://agent.copypaste.hk';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.data/browsers');
const out=path.resolve('.data/acceptance-193/public-'+randomUUID());
await mkdir(path.join(out,'downloads'),{recursive:true});
const catalog=JSON.parse(await readFile('../copypaste-web/contracts/product-downloads.json','utf8'));
const report={stage:193,status:'running',scope:'Actual anonymous public navigation, responsive downloads page, file download/hash verification and authenticated entry points. No paid AI tasks.',checks:[],downloads:[],javascript_errors:[]};
const artifacts=[...catalog.desktop.artifacts,catalog.extension.artifact];
let browser,context,user,video;
function pass(name,details={}) { report.checks.push({name,status:'passed',...details});console.log(JSON.stringify({phase:'passed',name})); }
async function layout(page,name) {
  const overflow=await page.evaluate(()=>({root:document.documentElement.scrollWidth>innerWidth+1,body:document.body.scrollWidth>innerWidth+1}));
  assert.deepEqual(overflow,{root:false,body:false});pass(name,{overflow});
}
async function publicFetch(page,url,method='GET',headers={},body='none') {
  return page.evaluate(async({url,method,headers,body})=>{const r=await fetch(url,{method,headers});return {status:r.status,headers:Object.fromEntries(r.headers),...(body==='bytes'?{bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}:body==='text'?{text:await r.text()}:{})};},{url,method,headers,body});
}
async function hash(filename){const h=createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return h.digest('hex');}
try {
  browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:1000}}});
  await context.addInitScript(()=>{if(!localStorage.getItem('cp_locale'))localStorage.setItem('cp_locale','en');if(!localStorage.getItem('cp_theme'))localStorage.setItem('cp_theme','light');});
  const page=await context.newPage();video=page.video();page.on('pageerror',e=>report.javascript_errors.push(e.message));
  await page.goto(WEB+'/',{waitUntil:'domcontentloaded'});
  await page.locator('.site-header a[href="/downloads"]').click();
  await page.getByRole('heading',{name:'Your workspace, closer to hand.'}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/downloads');
  pass('Anonymous homepage navigation reaches the public download page');
  await page.screenshot({path:path.join(out,'downloads-desktop-en.png'),fullPage:true,animations:'disabled'});
  await layout(page,'1440px English layout');
  await page.getByRole('link',{name:'View installation steps',exact:true}).click();
  await page.getByRole('heading',{name:'Load it in Chrome',exact:true}).waitFor();
  assert.match(await page.locator('.download-install-steps').innerText(),/chrome:\/\/extensions/);
  pass('Extension guide opens manual unpacked installation and native side-panel instructions');
  await page.getByRole('button',{name:'Desktop',exact:true}).click();
  await page.getByRole('heading',{name:'Choose a folder and permissions',exact:true}).waitFor();
  await page.locator('.download-details summary').click();
  for(const a of artifacts)assert.ok(await page.getByText(a.sha256,{exact:true}).isVisible());
  assert.match(await page.locator('.download-details').innerText(),/macOS and Linux installers are not currently available/);
  pass('Actual published versions, SHA-256, manual installation and platform limits are visible');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Your workspace, closer to hand.'}).waitFor();
  const slash=await page.goto(WEB+'/downloads/',{waitUntil:'domcontentloaded'});
  assert.equal(slash.status(),200);assert.equal(new URL(page.url()).pathname,'/downloads');
  pass('Direct navigation, refresh and trailing-slash canonical redirect work');
  for(const a of [...artifacts,{name:'SHA256SUMS.txt',url:catalog.checksums_url}]){
    const response=await publicFetch(page,WEB+a.url,'HEAD');assert.equal(response.status,200,a.name);
    assert.match(response.headers['content-disposition']??'',/attachment/);
    if(a.bytes)assert.equal(Number(response.headers['content-length']),a.bytes);
    const range=await publicFetch(page,WEB+a.url,'GET',{Range:'bytes=0-31'},'bytes');
    assert.equal(range.status,206,a.name+' resumable range');assert.equal(range.bytes.length,32);
    report.downloads.push({name:a.name,head_status:200,range_status:206,content_disposition:response.headers['content-disposition']});
  }
  pass('All public client files and checksums return attachment headers and support resume');
  for(const route of ['/downloads/releases/193/missing.exe','/downloads/releases/193/.env'])assert.equal((await publicFetch(page,WEB+route)).status,404);
  assert.equal((await publicFetch(page,WEB+'/downloads/releases/193/')).status,403);
  pass('Missing files return 404 and directory listing is disabled');
  const saves=[];
  for(const [selector,a] of [['desktop-setup',artifacts.find(a=>a.kind==='setup')],['desktop-portable',artifacts.find(a=>a.kind==='portable')],['extension',catalog.extension.artifact]]){
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:45000}),page.locator(`[data-download="${selector}"]`).click()]);
    assert.equal(download.suggestedFilename(),a.name);
    console.log(JSON.stringify({phase:'downloading',name:a.name}));
    saves.push((async()=>{const target=path.join(out,'downloads',a.name);await download.saveAs(target);assert.equal(await download.failure(),null);assert.equal((await stat(target)).size,a.bytes);assert.equal(await hash(target),a.sha256);const record=report.downloads.find(r=>r.name===a.name);Object.assign(record,{full_browser_download:true,bytes:a.bytes,sha256:a.sha256});console.log(JSON.stringify({phase:'download_verified',name:a.name}));})());
  }
  await Promise.all(saves);pass('Real download-button clicks retrieve all three complete files with exact SHA-256');
  const sums=await publicFetch(page,WEB+catalog.checksums_url,'GET',{},'text');const sumsText=sums.text;for(const a of artifacts)assert.ok(sumsText.includes(a.sha256+'  '+a.name));
  await page.setViewportSize({width:390,height:844});await page.goto(WEB+'/',{waitUntil:'domcontentloaded'});
  assert.ok(await page.locator('.site-header a[href="/downloads"]').isVisible());await layout(page,'390px homepage keeps download navigation visible');
  await page.locator('.site-header a[href="/downloads"]').click();await layout(page,'390px English downloads layout');
  await page.getByTitle('切換至繁體中文',{exact:true}).click();
  await page.getByRole('heading',{name:'把工作空間，帶到手邊。'}).waitFor();
  await page.screenshot({path:path.join(out,'downloads-mobile-zh.png'),fullPage:true,animations:'disabled'});
  await page.getByTitle('Theme: light / dark / system',{exact:true}).click();
  await page.screenshot({path:path.join(out,'downloads-mobile-dark.png'),fullPage:true,animations:'disabled'});await layout(page,'390px Traditional Chinese dark layout');
  await page.setViewportSize({width:320,height:760});await page.reload({waitUntil:'domcontentloaded'});await layout(page,'320px downloads layout, language and theme survive refresh');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.title(),'下載 · CopyPaste');
  await page.goto(WEB+'/login',{waitUntil:'domcontentloaded'});assert.ok(await page.locator('.downloads-entry[href="/downloads"]').isVisible());pass('Sign-in page provides a public download link');
  user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
  await user.page.goto(WEB+'/app/devices',{waitUntil:'domcontentloaded'});
  await user.page.getByRole('link',{name:'Download apps',exact:true}).waitFor();
  await user.page.getByRole('link',{name:'Download Desktop or the Chrome extension to connect your device',exact:true}).click();
  await user.page.getByRole('heading',{name:'Your workspace, closer to hand.'}).waitFor();
  assert.equal(await user.page.getByRole('link',{name:'Open workspace',exact:true}).getAttribute('href'),'/app');
  pass('Authenticated sidebar and Devices page lead to downloads and return to the workspace');
  assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.message;}
finally {
  await user?.context.close();await context?.close();await browser?.close();report.owned_browser_closed=true;
  if(video)report.actual_video=await video.path();report.finished_at=new Date().toISOString();
  await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));
}
assert.equal(report.status,'passed');
