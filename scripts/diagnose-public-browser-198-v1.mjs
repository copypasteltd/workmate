import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const report={stage:198,at:new Date().toISOString(),scope:'Unauthenticated company public GET diagnostics only. No cookies, headers, credentials, model requests, alternate origins or response replacement.',transports:[]};
for(const [name,extra] of [['default_http',[]],['http1_diagnostic',['--disable-http2']]]){
 let browser,c;
 const row={name,attempts:[],failures:[]};
 try{
  browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic',...extra]});c=await browser.newContext();
  for(const url of ['https://agent.copypaste.hk/app','https://agent.copypaste.hk/downloads']){
   const p=await c.newPage(),cdp=await c.newCDPSession(p);await cdp.send('Network.enable');cdp.on('Network.loadingFailed',e=>row.failures.push({error:e.errorText,type:e.type,canceled:e.canceled}));const start=Date.now();
   try{const r=await p.goto(url,{waitUntil:'domcontentloaded',timeout:25000});row.attempts.push({url,status:r.status(),protocol:(await cdp.send('Performance.getMetrics')).metrics.length>=0?'browser_native':'unknown',ms:Date.now()-start});}
   catch(e){row.attempts.push({url,error:e.name+': '+e.message.split('\n')[0],browser_error_code:await p.locator('.error-code').innerText({timeout:1000}).catch(()=>null),ms:Date.now()-start});}
   await p.close();
  }
 }finally{await c?.close().catch(()=>{});await browser?.close().catch(()=>{});row.owned_browser_closed=true;report.transports.push(row);console.log(JSON.stringify(row));}
}
report.finished_at=new Date().toISOString();await mkdir('.data/deployment-198-v2',{recursive:true});await writeFile('.data/deployment-198-v2/browser-transport-diagnostic-v1.sanitized.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
