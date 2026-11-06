"""Use the owned company-only TLS proxy and retain actual native IPC failures."""
from pathlib import Path
root=Path(__file__).resolve().parents[2];p=root/'dev/copypaste-delivery/scripts';s=(p/'qualify-live-marketing-review-202-v2.mjs').read_text('utf8')
s=s.replace('202-v2-marketing-review-live.png','202-v3-marketing-review-live.png').replace("'marketing-review-live','202-v2'","'marketing-review-live','202-v3'")
s=s.replace("args:['--no-sandbox']","args:['--disable-gpu','--disable-quic','--proxy-server=http://127.0.0.1:8733']")
needle="assert.ok(report.shell.no_menu&&!report.shell.menu_visible);assert.deepEqual(report.shell.bounds,report.shell.content);"
extra="""
 await app.evaluate(({ipcMain,session})=>{globalThis.__qaDownloadErrors=[];globalThis.__qaDownloadNetwork=[];const original=ipcMain._invokeHandlers.get('asset:download');if(typeof original!=='function')throw Error('Original download handler not found');ipcMain.removeHandler('asset:download');ipcMain.handle('asset:download',async(...args)=>{try{return await original(...args);}catch(e){globalThis.__qaDownloadErrors.push({name:e.name,message:String(e.message).slice(0,300)});throw e;}});const network=session.fromPartition('copypaste-company-api-v1',{cache:false});network.webRequest.onCompleted({urls:['https://ai-api.copypaste.hk/*']},d=>{if(d.url.includes('/preview/export'))globalThis.__qaDownloadNetwork.push({path:new URL(d.url).pathname,status:d.statusCode});});network.webRequest.onErrorOccurred({urls:['https://ai-api.copypaste.hk/*']},d=>{if(d.url.includes('/preview/export'))globalThis.__qaDownloadNetwork.push({path:new URL(d.url).pathname,error:d.error});});});
"""
assert needle in s;s=s.replace(needle,needle+extra)
needle="await untilMotion(async()=>{try{return await readFile(destination);}catch{return null;}},Boolean,45000);"
replace="await untilMotion(async()=>{const errors=await app.evaluate(()=>globalThis.__qaDownloadErrors);if(errors.length)throw Error('Actual native export: '+errors.at(-1).message);try{return await readFile(destination);}catch{return null;}},Boolean,45000);"
assert needle in s;s=s.replace(needle,replace)
s=s.replace('finally{if(recording)',"finally{if(app)report.native_diagnostics=await app.evaluate(()=>({errors:globalThis.__qaDownloadErrors??[],network:globalThis.__qaDownloadNetwork??[]})).catch(()=>null);if(recording)")
(p/'qualify-live-marketing-review-202-v3.mjs').write_text(s,encoding='utf8',newline='\n')
print('Separate native diagnostics ready; original handler/results and TLS bytes remain intact.')
