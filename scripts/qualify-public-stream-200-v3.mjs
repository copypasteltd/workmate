import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch} from './live-client-189-v2.mjs';
import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';

const expected=JSON.parse(await readFile('.data/deployment-200-v2/package-receipt.private.json','utf8'));
const out='.data/deployment-200-v2/public-stream-v3.sanitized.json';
const report={stage:200,status:'running',scope:'Independent bounded full-body fetch of the two public HTTPS desktop packages, using original company certificates over the owned authenticated SSH egress. Streaming bytes are hashed without keeping the whole package in memory. Earlier actual-link download-event timeouts remain; this checks byte transport, not browser download UI or direct development-machine connectivity.',downloads:[]};
let browser,user,active;
async function persist(){await writeFile(out,JSON.stringify(report,null,2)+'\n');}
try{
 browser=await launch();user=await existingOwner(browser);await navigate(user.page,'https://agent.copypaste.hk/downloads');
 await user.page.exposeFunction('acceptReleaseChunk200',async base64=>{
  assert.ok(active);const bytes=Buffer.from(base64,'base64');active.hash.update(bytes);active.row.bytes+=bytes.length;
  if(active.row.bytes-active.lastProgress>=10*1024*1024){active.lastProgress=active.row.bytes;await persist();console.log(JSON.stringify({name:active.row.name,bytes:active.row.bytes}));}
 });
 for(const spec of expected.public_files.filter(x=>x.bytes>1024*1024)){
  const url='https://agent.copypaste.hk/downloads/releases/20002/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running',bytes:0},started=Date.now();
  report.downloads.push(row);active={row,hash:createHash('sha256'),lastProgress:0};await persist();
  try{
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
 report.status=report.downloads.length===2&&report.downloads.every(x=>x.status==='complete_verified')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:out}));}
if(report.status!=='passed')process.exitCode=1;
