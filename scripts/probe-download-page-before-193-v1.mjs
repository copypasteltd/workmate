import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const out=path.resolve('.data/acceptance-193/before-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:193,at:new Date().toISOString(),checks:[]};let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 for(const target of ['https://agent.copypaste.hk/','https://agent.copypaste.hk/downloads','https://agent.copypaste.hk/downloads/']){
  try{const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:25000});report.checks.push({url:target,status:response.status(),final_url:page.url(),download_links:await page.getByRole('link').evaluateAll(links=>links.map(a=>({text:a.textContent,href:a.getAttribute('href')})).filter(a=>/download|下載|desktop|extension/i.test(a.text??'')||/download|\.exe|\.zip/i.test(a.href??'')))});}catch(e){report.checks.push({url:target,error:e.message.split('\n')[0]});}
 }
 await context.close();
}finally{await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));}
