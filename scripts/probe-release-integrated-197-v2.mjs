import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const out=path.resolve('.data/deployment-197/public-release-v2.sanitized.json');
const expected=JSON.parse(await readFile('.data/deployment-197/package-receipt.private.json','utf8'));
const catalog=JSON.parse(await readFile('../copypaste-web/contracts/product-downloads.json','utf8'));
const result={stage:197,status:'running',at:new Date().toISOString(),scope:'Actual browser fetch transport; public HEAD/range and complete streamed response-body SHA-256. Download events are not used as a substitute for verifying bytes. All current artifacts are downloaded in full in this run.',health:[],downloads:[]};
let browser,context,active;
const digests=new Map();
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),downloadsPath:path.resolve('.data/deployment-197/browser-downloads-v2'),args:['--disable-quic']});
 context=await browser.newContext({acceptDownloads:true});await context.exposeBinding('__qaReleaseChunk',async(_source,id,base64)=>{assert.equal(id,active);const state=digests.get(id),part=Buffer.from(base64,'base64');state.bytes+=part.length;assert.ok(state.bytes<=state.limit);state.hash.update(part);});const page=await context.newPage();await page.goto('https://agent.copypaste.hk/downloads',{waitUntil:'domcontentloaded'});
 for(const domain of ['agent','agent-dashboard','ai-api']){
  const p=await context.newPage(),url=`https://${domain}.copypaste.hk/health/ready`;
  await p.goto(url,{waitUntil:'domcontentloaded'});const body=JSON.parse(await p.locator('body').innerText());assert.equal(body.kernel,'codex');assert.equal(body.data_mode,'configured_services');assert.equal(body.ai_ready,true);result.health.push({url,body});await p.close();
 }
 for(const spec of expected.public_files){
  const url='https://agent.copypaste.hk/downloads/releases/197/'+spec.name;
  const transport=await page.evaluate(async url=>{
   const h=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(60000)}),r=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(60000)});
   return {head:h.status,length:h.headers.get('content-length'),range:r.status,rangeBytes:(await r.arrayBuffer()).byteLength};
  },url);assert.equal(transport.head,200);assert.equal(transport.range,206);assert.equal(transport.rangeBytes,16);if(transport.length!==null)assert.equal(Number(transport.length),spec.bytes);
  active=spec.name;const state={bytes:0,limit:spec.bytes,hash:createHash('sha256')};digests.set(active,state);
  const full=await page.evaluate(async({url,id})=>{const r=await fetch(url,{signal:AbortSignal.timeout(300000)});if(r.status!==200)throw Error('Public full-body status '+r.status);const reader=r.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;for(let i=0;i<value.length;i+=32768){const part=value.subarray(i,i+32768);await window.__qaReleaseChunk(id,btoa(String.fromCharCode(...part)));}}}finally{reader.releaseLock();}return r.status;},{url,id:active});
  assert.equal(full,200);const bytes=state.bytes,sha256=state.hash.digest('hex');digests.delete(active);active=null;
  assert.equal(bytes,spec.bytes);assert.equal(sha256,spec.sha256);result.downloads.push({name:spec.name,url,bytes,sha256,...transport,full:200});console.log(JSON.stringify({name:spec.name,verified:true,bytes}));
 }
 result.catalog=catalog;result.status='passed';
}catch(e){result.status='failed';result.error=e.name+': '+e.message.split('\n')[0];}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});result.owned_browser_closed=true;result.finished_at=new Date().toISOString();await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,receipt:out,error:result.error}));}
assert.equal(result.status,'passed');
