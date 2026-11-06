import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const expected=JSON.parse(await readFile('.data/deployment-205-v1/package-receipt.private.json','utf8'));
const output=path.resolve('.data/deployment-205-v1/public-download-v1.sanitized.json'),folder=path.resolve('.data/deployment-205-v1/public-browser-files-v1');
await assert.rejects(readFile(output),e=>e.code==='ENOENT');await mkdir(folder,{recursive:false});
const report={stage:205,status:'running',scope:'Actual anonymous Downloads links and ordinary browser-managed full-file downloads, exact saved sizes and streamed whole-file SHA. This observes the product download flow without per-megabyte range round trips. Fresh public health is checked on all three current domains; the original failed/partial/default-DNS/protocol observations remain unchanged. QA-only verified original TLS uses HTTP/1.1 and current-DNS address order; no server network/configuration change, TLS bypass, reply substitution or installation/normal-egress claim.',health:[],downloads:[]};
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,context,page;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),downloadsPath:folder,proxy:{server:process.env.WORKMATE_QA_PROXY,bypass:'127.0.0.1,localhost'},args:['--disable-quic','--disable-http2']});
 context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000},locale:'en-HK'});page=await context.newPage();
 for(let attempt=0;;attempt++){
  try{const r=await page.goto('https://agent.copypaste.hk/downloads',{waitUntil:'domcontentloaded',timeout:60000});assert.ok(r?.ok());break;}
  catch(e){report.navigation_failures??=[];report.navigation_failures.push({attempt:attempt+1,error:e.name+': '+e.message.split('\n')[0]});await persist();if(attempt===1)throw e;}
 }
 for(const artifact of [...expected.catalog.desktop.artifacts,expected.catalog.extension.artifact])await page.locator('a[href="'+artifact.url+'"]').first().waitFor({state:'visible',timeout:30000});
 report.anonymous_download_links=true;
 for(const host of ['agent','agent-dashboard','ai-api']){
  const result=await page.evaluate(async host=>{const r=await fetch('https://'+host+'.copypaste.hk/health/ready',{signal:AbortSignal.timeout(45000)});return {status:r.status,body:await r.json()};},host);
  assert.equal(result.status,200);assert.equal(result.body.kernel,'codex');assert.equal(result.body.ai_ready,true);assert.equal(result.body.data_mode,'configured_services');report.health.push({host,status:'passed',body:result.body});await persist();
 }

 for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){
  const url='https://agent.copypaste.hk/downloads/releases/20501/'+spec.name,row={name:spec.name,url,expected_bytes:spec.bytes,expected_sha256:spec.sha256,status:'running',bytes:0},started=Date.now();report.downloads.push(row);await persist();let download;
  try{
   const before=new Set(await readdir(folder)),event=page.waitForEvent('download',{timeout:60000});event.catch(()=>{});
   const link=page.locator('a[href="/downloads/releases/20501/'+spec.name+'"]').first();
   if(await link.count())await link.click({timeout:60000,noWaitAfter:true});
   else await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.download='';document.body.append(a);a.click();a.remove();},url);
   download=await event;assert.equal(download.url(),url);row.suggested_filename=download.suggestedFilename();
   let done=false,result;const completion=download.path().then(p=>{done=true;result={path:p};},e=>{done=true;result={error:e.name+': '+e.message.split('\n')[0]};});
   let announced=0;
   while(!done){
    await sleep(1000);let received=0;
    for(const name of await readdir(folder)){if(before.has(name))continue;const s=await stat(path.join(folder,name)).catch(()=>null);if(s?.isFile())received=Math.max(received,s.size);}
    row.observed_in_progress_bytes=received;
    if(received-announced>=16*1024*1024){announced=received;await persist();console.log(JSON.stringify({name:spec.name,received,total:spec.bytes}));}
    if(Date.now()-started>180000){row.observation_timeout=true;await download.cancel();break;}
   }
   await completion;assert.ok(!result.error&&!row.observation_timeout,result.error??'Bounded actual browser download timed out');assert.ok(result.path);assert.equal(await download.failure(),null);
   const actual=await stat(result.path);assert.equal(actual.size,spec.bytes);const hash=createHash('sha256');
   for await(const bytes of createReadStream(result.path))hash.update(bytes);
   row.bytes=actual.size;row.sha256=hash.digest('hex');assert.equal(row.sha256,spec.sha256);row.status='complete_verified';row.transfer='Actual browser-managed complete file from the current download link; streamed whole-file size and SHA verified';
  }catch(e){row.status='incomplete';row.error=e.name+': '+e.message.split('\n')[0];await download?.cancel().catch(()=>{});}
  row.seconds=Number(((Date.now()-started)/1000).toFixed(2));await persist();console.log(JSON.stringify({name:row.name,status:row.status,bytes:row.bytes,expected_bytes:row.expected_bytes,error:row.error}));
 }
 report.status=report.downloads.length===4&&report.downloads.every(r=>r.status==='complete_verified')?'passed':'partial';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_browser_closed=true;report.finished_at=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,receipt:output}));}
if(report.status!=='passed')process.exitCode=1;
