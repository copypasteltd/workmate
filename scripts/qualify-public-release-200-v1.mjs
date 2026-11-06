import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch} from './live-client-189-v2.mjs';
import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';

const expected=JSON.parse(await readFile('.data/deployment-200-v1/package-receipt.private.json','utf8'));
const out='.data/deployment-200-v1/public-release-v1.sanitized.json';
const report={stage:200,status:'running',scope:'Actual public company HTTPS/certificates over owned authenticated SSH egress; current three public health URLs, four HEAD/range checks and full bytes/hash. Each transfer is bounded and cancelled on timeout. This does not claim direct development-machine egress.',health:[],downloads:[]};
let browser,user;
async function persist(){await writeFile(out,JSON.stringify(report,null,2)+'\n');}
try{
 browser=await launch();user=await existingOwner(browser);await navigate(user.page,'https://agent.copypaste.hk/downloads');
 const catalog=expected.catalog;for(const row of [...catalog.desktop.artifacts,catalog.extension.artifact])assert.ok(await user.page.locator('a[href="'+row.url+'"]').count()>0,'Current download link '+row.name);
 await persist();
 for(const domain of ['agent','agent-dashboard','ai-api']){
  const page=await user.context.newPage(),url=`https://${domain}.copypaste.hk/health/ready`;
  try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});assert.ok(response?.ok());const body=JSON.parse(await page.locator('body').innerText());assert.equal(body.kernel,'codex');assert.equal(body.data_mode,'configured_services');assert.equal(body.ai_ready,true);report.health.push({url,status:'passed',body});}
  catch(e){report.health.push({url,status:'failed',error:e.name+': '+e.message.split('\n')[0]});}finally{await page.close();await persist();}
 }
 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/200/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running'},started=Date.now();report.downloads.push(row);await persist();let download;
  try{
   const metadata=await user.page.evaluate(async url=>{const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(20000)}),r=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(20000)});return{head:head.status,length:head.headers.get('content-length'),range:r.status,range_bytes:(await r.arrayBuffer()).byteLength};},url);
   assert.equal(metadata.head,200);assert.equal(metadata.range,206);assert.equal(metadata.range_bytes,16);if(metadata.length!==null)assert.equal(Number(metadata.length),spec.bytes);Object.assign(row,metadata);await persist();
   let bytes=0,digest;
   if(spec.bytes<1024*1024){
    const raw=await user.page.evaluate(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(r.status!==200)throw Error('Full download status '+r.status);return [...new Uint8Array(await r.arrayBuffer())];},url);const b=Buffer.from(raw);bytes=b.length;digest=createHash('sha256').update(b).digest('hex');
   }else{
    const [file]=await Promise.all([user.page.waitForEvent('download',{timeout:20000}),user.page.locator('a[href="/downloads/releases/200/'+spec.name+'"]').first().click({timeout:20000})]);download=file;
    let timer;const completed=await Promise.race([download.path(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Public full download exceeded90 seconds')),90000);})]).finally(()=>clearTimeout(timer));assert.ok(completed);
    const hash=createHash('sha256');for await(const b of createReadStream(completed)){bytes+=b.byteLength;hash.update(b);}digest=hash.digest('hex');
   }
   assert.equal(bytes,spec.bytes);assert.equal(digest,spec.sha256);Object.assign(row,{status:'passed',bytes,sha256:digest,full:200});
  }catch(e){Object.assign(row,{status:'failed',error:e.name+': '+e.message.split('\n')[0]});if(download)await download.cancel().catch(()=>{});}
  finally{if(download)await download.delete().catch(()=>{});row.seconds=Number(((Date.now()-started)/1000).toFixed(2));await persist();console.log(JSON.stringify({name:row.name,status:row.status,error:row.error}));}
 }
 report.status=report.health.every(r=>r.status==='passed')&&report.downloads.every(r=>r.status==='passed')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:out,error:report.error}));}
if(report.status!=='passed')process.exitCode=1;
