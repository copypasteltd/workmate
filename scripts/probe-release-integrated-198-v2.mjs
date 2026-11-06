import {navigate} from './live-owner-197-v2.mjs';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const out=path.resolve('.data/deployment-198-v1/public-release-v2.sanitized.json');
const expected=JSON.parse(await readFile('.data/deployment-198-v1/package-receipt.private.json','utf8'));
const catalog=JSON.parse(await readFile('../copypaste-web/contracts/product-downloads.json','utf8'));
const result={stage:198,status:'running',at:new Date().toISOString(),scope:'Actual browser transport; current public HEAD/range and complete package SHA-256. All current artifacts are downloaded in full in this run.',health:[],downloads:[]};
let browser,context;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),downloadsPath:path.resolve('.data/deployment-198-v1/browser-downloads-v2'),args:['--disable-quic']});
 context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();await navigate(page,'https://agent.copypaste.hk/downloads');
 for(const domain of ['agent','agent-dashboard','ai-api']){
  const p=await context.newPage(),url=`https://${domain}.copypaste.hk/health/ready`;
  await p.goto(url,{waitUntil:'domcontentloaded'});const body=JSON.parse(await p.locator('body').innerText());assert.equal(body.kernel,'codex');assert.equal(body.data_mode,'configured_services');assert.equal(body.ai_ready,true);result.health.push({url,body});await p.close();
 }
 for(const spec of expected.public_files){
  const url='https://agent.copypaste.hk/downloads/releases/198/'+spec.name;
  const transport=await page.evaluate(async url=>{
   const h=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(60000)}),r=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(60000)});
   return {head:h.status,length:h.headers.get('content-length'),range:r.status,rangeBytes:(await r.arrayBuffer()).byteLength};
  },url);assert.equal(transport.head,200);assert.equal(transport.range,206);assert.equal(transport.rangeBytes,16);if(transport.length!==null)assert.equal(Number(transport.length),spec.bytes);
  let bytes=0,sha256;
  if(spec.name.endsWith('.txt')){
   const body=await page.evaluate(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(r.status!==200)throw Error('Public checksum status '+r.status);return [...new Uint8Array(await r.arrayBuffer())];},url);
   const buffer=Buffer.from(body);bytes=buffer.length;sha256=createHash('sha256').update(buffer).digest('hex');
  }else{
   const anchor=page.locator('a[href="/downloads/releases/198/'+spec.name+'"]');assert.ok(await anchor.count()>0);
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:300000}),anchor.first().click()]);
   const file=await download.path();assert.ok(file,'Browser download completed');const hash=createHash('sha256');for await(const part of createReadStream(file)){hash.update(part);bytes+=part.byteLength;}sha256=hash.digest('hex');await download.delete();
  }
  assert.equal(bytes,spec.bytes);assert.equal(sha256,spec.sha256);result.downloads.push({name:spec.name,url,bytes,sha256,...transport,full:200});console.log(JSON.stringify({name:spec.name,verified:true,bytes}));
 }
 result.catalog=catalog;result.status='passed';
}catch(e){result.status='failed';result.error=e.name+': '+e.message.split('\n')[0];}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});result.owned_browser_closed=true;result.finished_at=new Date().toISOString();await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,receipt:out,error:result.error}));}
assert.equal(result.status,'passed');
