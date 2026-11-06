"""Observe original native response bytes without changing the response or integrity guard."""
from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts';s=(scripts/'qualify-live-marketing-review-202-v4.mjs').read_text('utf8')
s=s.replace('202-v4-marketing-review-live.png','202-v5-marketing-review-live.png').replace("'marketing-review-live','202-v4'","'marketing-review-live','202-v5'")
s=s.replace("report.downloads.push({component:'web',format,bytes:bytes.length,sha256:hash(bytes)});","await writeFile(path.join(out,'web-'+format+'.private.bin'),bytes,{flag:'wx'});report.downloads.push({component:'web',format,bytes:bytes.length,sha256:hash(bytes)});")
needle="const network=session.fromPartition('copypaste-company-api-v1',{cache:false});"
new="""const network=session.fromPartition('copypaste-company-api-v1',{cache:false});globalThis.__qaNativeResponses=[];const originalFetch=network.fetch.bind(network);network.fetch=async(...args)=>{const r=await originalFetch(...args);if(String(args[0]).includes('/preview/export')){const body=Buffer.from(await r.clone().arrayBuffer());if(body.length>8*1024*1024)throw Error('QA response bound exceeded');const crypto=await import('node:crypto');globalThis.__qaNativeResponses.push({format:JSON.parse(args[1].body).format,status:r.status,bytes:body.length,actual_sha256:crypto.createHash('sha256').update(body).digest('hex'),headers:Object.fromEntries(['content-type','content-length','content-encoding','x-content-sha256','cf-ray','server','cache-control'].map(k=>[k,r.headers.get(k)])),base64:body.toString('base64')});}return r;};"""
assert needle in s;s=s.replace(needle,new)
start=s.index(" for(const format of ['html','csv','json']){await pass('Native actual")
end=s.index(' await native.review.scrollIntoViewIfNeeded()',start)
s=s[:start]+""" for(const format of ['html','csv','json']){
  await pass('Native actual '+format+' export starting');const destination=path.join(out,'native-review.'+format),errorBefore=await app.evaluate(()=>globalThis.__qaDownloadErrors.length);await app.evaluate(({dialog},destination)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});},destination);await native.review.getByRole('button',{name:'Download review '+format.toUpperCase(),exact:true}).click();
  try{await untilMotion(async()=>{const errors=await app.evaluate(()=>globalThis.__qaDownloadErrors);if(errors.length>errorBefore)throw Error('Actual native export: '+errors.at(-1).message);try{return await readFile(destination);}catch{return null;}},Boolean,45000);const bytes=await readFile(destination),expected=report.downloads.find(d=>d.component==='web'&&d.format===format);assert.equal(hash(bytes),expected.sha256);assert.equal(bytes.length,expected.bytes);report.downloads.push({component:'desktop',format,bytes:bytes.length,sha256:hash(bytes)});}catch(e){report.native_export_failures??=[];report.native_export_failures.push({format,error:e.message});}
 }
"""+s[end:]
needle="assert.deepEqual(report.javascript_errors,[]);report.status='passed';"
s=s.replace(needle,"assert.deepEqual(report.javascript_errors,[]);assert.equal(report.native_export_failures?.length??0,0,'Native integrity failures remain');report.status='passed';")
s=s.replace('finally{if(app)report.native_diagnostics=',"finally{if(app){const responses=await app.evaluate(()=>globalThis.__qaNativeResponses??[]).catch(()=>[]);report.native_response_diagnostics=[];for(const {base64,...row}of responses){const bytes=Buffer.from(base64,'base64');await writeFile(path.join(out,'native-'+row.format+'.response.private.bin'),bytes,{flag:'wx'});report.native_response_diagnostics.push(row);}}if(app)report.native_diagnostics=")
(scripts/'qualify-live-marketing-review-202-v5.mjs').write_text(s,encoding='utf8',newline='\n')
print('All three original responses will be observed; native integrity failures remain failures.')
