import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const out=path.resolve('.data/acceptance-193/click-probe-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:193,events:[]};let browser,context;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
 page.on('response',r=>{if(r.url().includes('/downloads/releases/193/')){const h=r.headers();const event={at:Date.now(),event:'response',url:r.url(),status:r.status(),headers:{type:h['content-type'],disposition:h['content-disposition'],length:h['content-length'],range:h['content-range'],cache:h['cf-cache-status']}};report.events.push(event);console.log(JSON.stringify(event));}});
 page.on('requestfailed',r=>{report.events.push({event:'requestfailed',url:r.url(),failure:r.failure()});console.log(JSON.stringify(report.events.at(-1)));});
 page.on('download',d=>{report.events.push({event:'download',filename:d.suggestedFilename()});console.log(JSON.stringify(report.events.at(-1)));});
 await page.goto('https://agent.copypaste.hk/downloads',{waitUntil:'domcontentloaded'});
 for(const kind of ['extension','desktop-setup']){
  try{const [d]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.locator(`[data-download="${kind}"]`).click()]);await d.saveAs(path.join(out,d.suggestedFilename()));report.events.push({event:'saved',kind,failure:await d.failure()});}catch(e){report.events.push({event:'error',kind,message:e.message});}
 }
 report.page_url=page.url();report.links=await page.locator('[data-download]').evaluateAll(as=>as.map(a=>({href:a.href,download:a.download})));
}finally{await context?.close();await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({receipt:path.join(out,'receipt.json')}));}
