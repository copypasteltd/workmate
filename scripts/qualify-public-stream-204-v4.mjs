import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launch} from './live-client-203-v1.mjs';

const expected=JSON.parse(await readFile('.data/deployment-204-v1/package-receipt.private.json','utf8'));
const output=path.resolve('.data/deployment-204-v1/public-stream-v4.sanitized.json');
const folder=path.resolve('.data/deployment-204-v1/public-chunks-v4');
await assert.rejects(readFile(output),e=>e.code==='ENOENT');
await mkdir(folder,{recursive:false});
const report={stage:204,status:'running',scope:'Anonymous actual Downloads links and original verified company TLS. Sequential bounded immutable HTTP206 ranges are saved, reassembled and checked against exact whole-file size/SHA. Only safe reads may retry, at most twice, and every failed read is retained. Local QA selects HTTP/1.1 and descending current public-DNS address order; original default/first-address and parallel-transfer failures remain failed. No server network/protocol/configuration change, TLS bypass, reply replacement, OS installation or normal DNS-failover/direct-egress qualification.',health:[],downloads:[],read_failures:[]};
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
let browser,context,page;

async function safeRead(spec){
 for(let attempt=0;attempt<3;attempt++){
  let result;
  try{
   result=await page.evaluate(async spec=>{
    try{
     const headers=spec.range?{Range:`bytes=${spec.range.start}-${spec.range.end}`} : {};
     const r=await fetch(spec.url,{method:spec.method??'GET',headers,signal:AbortSignal.timeout(50000)});
     if(spec.range){
      if(r.status!==206)return {status:r.status,error:'Expected exact partial content'};
      if(r.headers.get('content-range')!==`bytes ${spec.range.start}-${spec.range.end}/${spec.total}`)return {status:r.status,error:'Content range differs'};
      const blob=await r.blob();
      if(blob.size!==spec.range.end-spec.range.start+1)return {status:r.status,error:'Partial content truncated'};
      const bytes=await new Promise((resolve,reject)=>{const f=new FileReader();f.onerror=()=>reject(Error('Range encoding failed'));f.onload=()=>resolve(String(f.result).split(',')[1]);f.readAsDataURL(blob);});
      return {status:r.status,bytes};
     }
     if(spec.method==='HEAD'){const length=r.headers.get('content-length');return {status:r.status,length:length===null?null:Number(length)};}
     return {status:r.status,text:await r.text()};
    }catch(e){return {status:0,error:e.name+': '+e.message};}
   },spec);
  }catch(e){result={status:0,error:e.name+': '+e.message.split('\n')[0]};}
  if(!result.error&&result.status>=200&&result.status<300)return result;
  report.read_failures.push({url:spec.url,method:spec.method??'GET',range:spec.range??null,attempt:attempt+1,status:result.status,error:result.error??'HTTP '+result.status});await persist();
  if(attempt===2||![0,429,502,503,504].includes(result.status))throw Error('Bounded immutable public read failed: '+(result.error??result.status));
  await new Promise(r=>setTimeout(r,500*(attempt+1)));
 }
}

try{
 browser=await launch();context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-HK'});page=await context.newPage();
 for(let attempt=0;;attempt++){
  try{const r=await page.goto('https://agent.copypaste.hk/downloads',{waitUntil:'domcontentloaded',timeout:60000});assert.ok(r?.ok());break;}
  catch(e){report.read_failures.push({url:'https://agent.copypaste.hk/downloads',method:'GET',attempt:attempt+1,error:e.name+': '+e.message.split('\n')[0]});await persist();if(attempt===1)throw e;}
 }
 for(const artifact of [...expected.catalog.desktop.artifacts,expected.catalog.extension.artifact])await page.locator('a[href="'+artifact.url+'"]').first().waitFor({state:'visible',timeout:30000});
 report.anonymous_download_links=true;
 for(const host of ['agent','agent-dashboard','ai-api']){
  const r=await safeRead({url:'https://'+host+'.copypaste.hk/health/ready'});assert.equal(r.status,200);
  const body=JSON.parse(r.text);assert.equal(body.kernel,'codex');assert.equal(body.ai_ready,true);assert.equal(body.data_mode,'configured_services');report.health.push({host,status:'passed',body});await persist();
 }
 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/20401/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running',bytes:0,ranges:0,chunks:[]},started=Date.now();report.downloads.push(row);await persist();
  try{
   const metadata=await safeRead({url,method:'HEAD'});assert.equal(metadata.status,200);if(metadata.length!==null)assert.equal(metadata.length,spec.bytes);row.metadata={head:metadata.status,bytes:metadata.length};
   const hash=createHash('sha256'),chunkSize=1024*1024;
   for(let start=0;start<spec.bytes;start+=chunkSize){
    const end=Math.min(start+chunkSize,spec.bytes)-1,r=await safeRead({url,range:{start,end},total:spec.bytes}),bytes=Buffer.from(r.bytes,'base64');assert.equal(bytes.length,end-start+1);
    const filename=spec.name+'.'+String(start).padStart(10,'0')+'.part';await writeFile(path.join(folder,filename),bytes,{flag:'wx'});
    const chunkSha=createHash('sha256').update(bytes).digest('hex');row.chunks.push({start,end,bytes:bytes.length,sha256:chunkSha,file:filename});hash.update(bytes);row.bytes+=bytes.length;row.ranges++;await persist();
    if(row.ranges%16===0||row.bytes===spec.bytes)console.log(JSON.stringify({name:spec.name,bytes:row.bytes,total:spec.bytes,retained_read_failures:report.read_failures.length}));
   }
   row.sha256=hash.digest('hex');assert.equal(row.bytes,spec.bytes);assert.equal(row.sha256,spec.sha256);
   const independent=createHash('sha256');let size=0;
   for(const chunk of row.chunks){const b=await readFile(path.join(folder,chunk.file));assert.equal(b.length,chunk.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),chunk.sha256);independent.update(b);size+=b.length;}
   assert.equal(size,spec.bytes);assert.equal(independent.digest('hex'),spec.sha256);row.status='complete_verified';row.transfer='Sequential actual public206, saved exact chunks, streamed and independent ordered whole-file SHA';
  }catch(e){row.status='incomplete';row.error=e.name+': '+e.message.split('\n')[0];}
  row.seconds=Number(((Date.now()-started)/1000).toFixed(2));await persist();console.log(JSON.stringify({name:row.name,status:row.status,bytes:row.bytes,expected_bytes:row.expected_bytes,error:row.error}));
 }
 report.status=report.health.length===3&&report.downloads.length===4&&report.downloads.every(x=>x.status==='complete_verified')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:output,read_failures:report.read_failures.length}));}
if(report.status!=='passed')process.exitCode=1;
