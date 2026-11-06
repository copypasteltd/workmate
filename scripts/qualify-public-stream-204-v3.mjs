import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launch} from './live-client-203-v1.mjs';
import {existingOwner,navigate} from './live-owner-204-v1.mjs';
const expected=JSON.parse(await readFile('.data/deployment-204-v1/package-receipt.private.json','utf8'));
const output='.data/deployment-204-v1/public-stream-v3.sanitized.json',chunks=path.resolve('.data/deployment-204-v1/public-chunks-v3');await mkdir(chunks,{recursive:true});
const report={stage:204,status:'running',scope:'Actual current download links and all three original-TLS health URLs. Full release content is fetched as exact bounded HTTP206 ranges, reassembled in order and independently checked against total bytes and whole-file SHA. This proves all public content, separately from inner full200 download checks. Original TLS over QA HTTP/1.1 and a QA-only current-DNS address order; the failed ascending first-address observation is retained. Normal public DNS failover is not certified; default HTTP/2 observations are separately retained as stalled. No server protocol/network change. No OS installation or direct development-machine connectivity claim.',health:[],downloads:[]};
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
let browser,user;
try{
 browser=await launch();user=await existingOwner(browser);await navigate(user.page,'https://agent.copypaste.hk/downloads');
 for(const spec of [...expected.catalog.desktop.artifacts,expected.catalog.extension.artifact])assert.ok(await user.page.locator('a[href="'+spec.url+'"]').count()>0,'Current actual download link '+spec.name);
 for(const host of ['agent','agent-dashboard','ai-api']){const p=await user.context.newPage();try{const r=await p.goto('https://'+host+'.copypaste.hk/health/ready',{waitUntil:'domcontentloaded',timeout:30000});assert.ok(r?.ok());const body=JSON.parse(await p.locator('body').innerText());assert.equal(body.kernel,'codex');assert.equal(body.ai_ready,true);assert.equal(body.data_mode,'configured_services');report.health.push({host,status:'passed',body});}finally{await p.close();}}
 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/20401/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running',bytes:0,ranges:0},started=Date.now();report.downloads.push(row);await persist();
  try{
   row.metadata=await user.page.evaluate(async url=>{const h=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)}),r=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(30000)});const length=h.headers.get('content-length');return{head:h.status,bytes:length===null?null:Number(length),range:r.status,range_bytes:(await r.arrayBuffer()).byteLength};},url);
   assert.equal(row.metadata.head,200);if(row.metadata.bytes!==null)assert.equal(row.metadata.bytes,spec.bytes);assert.equal(row.metadata.range,206);assert.equal(row.metadata.range_bytes,16);
   const hash=createHash('sha256'),chunkSize=2*1024*1024;
   for(let first=0;first<spec.bytes;first+=4*chunkSize){
    const tasks=[];for(let start=first;start<Math.min(first+4*chunkSize,spec.bytes);start+=chunkSize)tasks.push({start,end:Math.min(start+chunkSize,spec.bytes)-1});
    const results=await Promise.allSettled(tasks.map(async range=>{
     const result=await user.page.evaluate(async({url,start,end,total})=>{const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(90000)});if(r.status!==206||r.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)throw Error('Exact range response required');const blob=await r.blob();if(blob.size!==end-start+1)throw Error('Truncated public range');const data=await new Promise((resolve,reject)=>{const f=new FileReader();f.onerror=()=>reject(Error('Range encoding failed'));f.onload=()=>resolve(String(f.result).split(',')[1]);f.readAsDataURL(blob);});return data;},{url,...range,total:spec.bytes});
     const b=Buffer.from(result,'base64');assert.equal(b.length,range.end-range.start+1);return b;
    }));
    for(let i=0;i<results.length;i++){const r=results[i];if(r.status!=='fulfilled')throw r.reason;hash.update(r.value);row.bytes+=r.value.length;row.ranges++;}
    await persist();console.log(JSON.stringify({name:spec.name,bytes:row.bytes,total:spec.bytes}));
   }
   const digest=hash.digest('hex');assert.equal(row.bytes,spec.bytes);assert.equal(digest,spec.sha256);Object.assign(row,{status:'complete_verified',sha256:digest,transfer:'exact public206 ranges, whole-file SHA and byte count'});
  }catch(e){row.status='incomplete';row.error=e.name+': '+e.message.split('\n')[0];}
  row.seconds=Number(((Date.now()-started)/1000).toFixed(2));await persist();console.log(JSON.stringify(row));
 }
 report.status=report.health.length===3&&report.downloads.length===4&&report.downloads.every(x=>x.status==='complete_verified')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:output}));}
if(report.status!=='passed')process.exitCode=1;
