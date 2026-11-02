import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const out=path.resolve('.data/acceptance-192/direct-browser-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:192,at:new Date().toISOString(),scope:'Canonical public HTTPS in ordinary Chromium without the QA proxy, origin bypass, response changes or relaxed certificates',checks:[]};let browser,context;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});context=await browser.newContext();
 const settled=await Promise.allSettled([['web','https://agent.copypaste.hk/'],['admin','https://agent-dashboard.copypaste.hk/'],['api','https://ai-api.copypaste.hk/health/ready']].map(async([name,url])=>{
  const page=await context.newPage();try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});return{name,url,status:response.status(),server:response.headers()['server']??null,title:await page.title()};}catch(e){return{name,url,status:'unavailable',error:e.message.split('\n')[0]};}finally{await page.close();}
 }));report.checks=settled.map(r=>r.status==='fulfilled'?r.value:{status:'tool_failed',error:String(r.reason)});report.all_direct_reads_ok=report.checks.every(r=>r.status===200);
}finally{await context?.close();await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));}
