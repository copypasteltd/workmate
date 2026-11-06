// Bounded public metadata/ZIP checks; does not reclassify the stalled Portable.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch} from './live-client-189-v2.mjs';
import {existingOwner} from './live-read-only-owner-198-v1.mjs';
const expected=JSON.parse(await readFile('.data/deployment-199-v1/package-receipt.private.json','utf8'));
const report={stage:199,status:'running',scope:'Original public HTTPS over owned SSH egress. Four bounded HEAD/range checks and complete small Extension/checksum files. Setup full-download evidence remains in attempt4. Portable full public download remains unverified after an observed zero-byte stall; this subset never closes it.',checks:[]};
let browser,user;
try{
 browser=await launch();user=await existingOwner(browser);
 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/199/'+spec.name;
  try{
   const observed=await user.page.evaluate(async({url,small})=>{
    const h=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(20000)}),range=await fetch(url,{headers:{Range:'bytes=0-15'},signal:AbortSignal.timeout(20000)});
    const r={head:h.status,length:h.headers.get('content-length'),range:range.status,rangeBytes:(await range.arrayBuffer()).byteLength};
    if(small){const full=await fetch(url,{signal:AbortSignal.timeout(20000)});r.fullStatus=full.status;r.body=[...new Uint8Array(await full.arrayBuffer())];}return r;
   },{url,small:spec.bytes<1024*1024});
   assert.equal(observed.head,200);assert.equal(observed.range,206);assert.equal(observed.rangeBytes,16);if(observed.length!==null)assert.equal(Number(observed.length),spec.bytes);
   let full;if(observed.body){const b=Buffer.from(observed.body);assert.equal(observed.fullStatus,200);assert.equal(b.length,spec.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),spec.sha256);full={bytes:b.length,sha256:spec.sha256};}
   delete observed.body;report.checks.push({name:spec.name,status:'passed',...observed,...(full?{full}:{})});
  }catch(e){report.checks.push({name:spec.name,status:'failed',error:e.name+': '+e.message.split('\n')[0]});}
 }
 report.status=report.checks.every(r=>r.status==='passed')?'subset_passed_portable_full_open':'partial_with_transport_failures';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;await writeFile('.data/deployment-199-v1/public-metadata-v1.sanitized.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
