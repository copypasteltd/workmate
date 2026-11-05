import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('.data/assessment-194');await mkdir(out,{recursive:true});
const report={stage:194,at:new Date().toISOString(),scope:'Public origin and authenticated role availability GETs only; no paid calls, task mutation, OTP creation or UI qualification.',origins:[],cleanup:{owned_browser_closed:false}};
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});
 const saved=JSON.parse(await readFile('.data/acceptance-189/realowner-state.private.json','utf8'));
 const context=await browser.newContext({storageState:saved,viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 for(const url of ['https://agent.copypaste.hk/downloads','https://agent-dashboard.copypaste.hk/','https://ai-api.copypaste.hk/health/ready']){
  try{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});report.origins.push({url,status:r.status()});}catch(e){report.origins.push({url,error_class:e.name});}
 }
 await page.goto('https://agent.copypaste.hk/downloads',{waitUntil:'domcontentloaded',timeout:30000});
 report.roles=await page.evaluate(async()=>{
  const session=await fetch('/v1/session/context',{credentials:'include'});
  if(!session.ok)return {status:session.status,note:'Saved session unavailable; no new login created.'};
  const identity=await session.json();
  const tenant=identity.memberships?.find(m=>m.id==='f5b06ebd-ec59-414c-ad1a-04224d202fc0')?.id??identity.memberships?.[0]?.id;
  if(!tenant)return {status:session.status,note:'No authorized workspace in saved session.'};
  const r=await fetch('/v1/agent-templates?limit=100',{credentials:'include',headers:{'X-Tenant-ID':tenant}});
  if(!r.ok){const data=await r.json();return {status:r.status,error_code:data.error?.code};}
  const data=await r.json();return {status:r.status,items:data.items.map(v=>({role_key:v.role_key,available:v.available,availability_reason:v.availability_reason,qualification_state:v.qualification_state}))};
 });
 await context.close();
}catch(e){report.error_class=e.name;report.error_code=e.code??null;process.exitCode=1;}
finally{if(browser){await browser.close();report.cleanup.owned_browser_closed=true;}await writeFile(path.join(out,'public-role-probe-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify(report));
