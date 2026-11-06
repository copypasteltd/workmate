import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch} from './live-client-189-v2.mjs';
import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';

const expected=JSON.parse(await readFile('.data/deployment-201-v1/package-receipt.private.json','utf8'));
const out='.data/deployment-201-v1/public-stream-v1.sanitized.json';
const report={stage:201,status:'running',scope:'Actual download page links, three public health URLs, HEAD/range and bounded full-body fetch of all four public release files using original company TLS through owned authenticated SSH egress. Streaming checks bytes; it does not claim OS installation, Store publishing or direct development-machine connectivity.',health:[],downloads:[]};
let browser,user,active;
async function persist(){await writeFile(out,JSON.stringify(report,null,2)+'\n');}
try{
 browser=await launch();user=await existingOwner(browser);await navigate(user.page,'https://agent.copypaste.hk/downloads');
 for(const spec of [...expected.catalog.desktop.artifacts,expected.catalog.extension.artifact])assert.ok(await user.page.locator('a[href="'+spec.url+'"]').count()>0,'Actual current download link '+spec.name);
 for(const host of ['agent','agent-dashboard','ai-api']){const p=await user.context.newPage();try{const r=await p.goto('https://'+host+'.copypaste.hk/health/ready',{waitUntil:'domcontentloaded',timeout:30000});assert.ok(r?.ok());const body=JSON.parse(await p.locator('body').innerText());assert.equal(body.kernel,'codex');assert.equal(body.ai_ready,true);assert.equal(body.data_mode,'configured_services');report.health.push({host,status:'passed',body});}finally{await p.close();}}
 await user.page.exposeFunction('acceptReleaseChunk200',async base64=>{
  assert.ok(active);const bytes=Buffer.from(base64,'base64');active.hash.update(bytes);active.row.bytes+=bytes.length;
  if(active.row.bytes-active.lastProgress>=10*1024*1024){active.lastProgress=active.row.bytes;await persist();console.log(JSON.stringify({name:active.row.name,bytes:active.row.bytes}));}
 });
 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/20101/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running',bytes:0},started=Date.now();
  report.downloads.push(row);active={row,hash:createHash('sha256'),lastProgress:0};await persist();
  try{
   row.metadata=await user.page.evaluate(async url=>{const h=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)}),r=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(30000)});return {head:h.status,bytes:Number(h.headers.get('content-length')),range:r.status,range_bytes:(await r.arrayBuffer()).byteLength};},url);assert.equal(row.metadata.head,200);assert.equal(row.metadata.bytes,spec.bytes);assert.equal(row.metadata.range,206);assert.equal(row.metadata.range_bytes,16);
   const metadata=await user.page.evaluate(async url=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort('Full public transfer exceeded120 seconds'),120000);
    let reader;
    try{
     const response=await fetch(url,{signal:controller.signal});
     if(response.status!==200)throw Error('Full response status '+response.status);
     if(!response.body)throw Error('Full response has no body');
     reader=response.body.getReader();let pending=[],size=0;
     const flush=async()=>{
      if(!size)return;const blob=new Blob(pending),base64=await new Promise((resolve,reject)=>{const f=new FileReader();f.onerror=()=>reject(Error('Chunk encoding failed'));f.onload=()=>resolve(String(f.result).split(',')[1]);f.readAsDataURL(blob);});
      await window.acceptReleaseChunk200(base64);pending=[];size=0;
     };
     for(;;){const next=await reader.read();if(next.done)break;pending.push(next.value);size+=next.value.byteLength;if(size>=2*1024*1024)await flush();}
     await flush();return{http:response.status,content_length:response.headers.get('content-length')};
    }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
   },url);
   const digest=active.hash.digest('hex');assert.equal(row.bytes,spec.bytes);assert.equal(digest,spec.sha256);
   Object.assign(row,{status:'complete_verified',sha256:digest,...metadata});
  }catch(e){Object.assign(row,{status:'incomplete',error:e.name+': '+e.message.split('\n')[0]});}
  finally{row.seconds=Number(((Date.now()-started)/1000).toFixed(2));active=null;await persist();console.log(JSON.stringify(row));}
 }
 report.status=report.health.length===3&&report.downloads.length===4&&report.downloads.every(x=>x.status==='complete_verified')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:out}));}
if(report.status!=='passed')process.exitCode=1;
