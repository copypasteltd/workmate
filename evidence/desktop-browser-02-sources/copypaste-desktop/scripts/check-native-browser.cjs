/* Real Electron integration. No database, cloud model or simulated page actions. */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdir,readdir}=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID,createHash}=require('node:crypto');
const owned=process.env.COPYPASTE_BROWSER_CHECK_ROOT,attempt=process.env.COPYPASTE_BROWSER_CHECK_ATTEMPT;
assert.ok(path.isAbsolute(owned));assert.match(attempt,/^\d{2}$/);
app.setPath('userData',path.join(owned,'user-data'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],screenshots=[],saves=[];let pool,server,recording,media,error,sentinel;
let cookieSeen=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pass=message=>{checks.push(message);console.log('PASS '+message);};
const content=result=>JSON.parse(result.contentItems.find(item=>item.type==='inputText').text);
const until=async(fn,timeout=8000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await pause(40);}throw new Error('Browser check timed out');};
let sequence=0;
function client(session){return async(tool,args={},id)=>session.call({namespace:'copypaste_browser',tool,arguments:args,callId:id??'browser_'+(++sequence),threadId:'browser-check-thread',turnId:'browser-check-turn'},new AbortController().signal);}
async function capture(name){const window=BrowserWindow.getAllWindows().find(w=>w!==sentinel);assert.ok(window);const bytes=(await window.capturePage()).toPNG();const file=path.resolve(__dirname,'../assets/screenshots/workmate-browser-'+attempt+'-'+name+'.png');await writeFile(file,bytes,{flag:'wx'});screenshots.push({path:file,sha256:hash(bytes),edited:false,source:'Actual Electron native browser and real HTTP fixture; no simulated DOM actions or generated page images'});}
const deadline=setTimeout(()=>{console.error('Owned browser check exceeded deadline');app.exit(2);},150000);
app.whenReady().then(async()=>{
  const {NativeBrowserPool}=await import(pathToFileURL(path.resolve(__dirname,'../dist/native-browser.js')).href);
  const {WorkmateRecording}=require(process.env.COPYPASTE_BROWSER_MEDIA_HELPER);
  pool=new NativeBrowserPool();await mkdir(path.join(owned,'workspace'),{recursive:true});
  const campaign=await readFile(path.resolve(__dirname,'../tests/fixtures/browser-campaign.html'));
  const download=Buffer.from('Harbour Studio campaign brief\nAudience: Hong Kong teams\n');
  server=createServer(async(req,res)=>{
    if(req.url==='/save'){let bytes=[];for await(const b of req)bytes.push(b);const data=JSON.parse(Buffer.concat(bytes));saves.push(data);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({count:saves.length,name:data.name}));return;}
    if(req.url==='/download'){res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="campaign-brief.txt"','Content-Length':download.length}).end(download);return;}
    if(req.url==='/slow-download'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="source-archive.bin"','Content-Length':10_000_000});res.write(Buffer.alloc(1024,7));const timer=setInterval(()=>res.write(Buffer.alloc(1024,7)),100);res.once('close',()=>clearInterval(timer));return;}
    if(req.url==='/popup'){res.writeHead(200,{'Content-Type':'text/html'}).end('<title>Campaign preview</title><h1>Campaign preview</h1><p id="opener"></p><script>document.querySelector("#opener").textContent=String(!!window.opener)</script>');return;}
    if(req.url==='/next'){res.writeHead(200,{'Content-Type':'text/html'}).end('<title>Campaign checklist</title><h1>Next page checklist</h1><a href="/">Campaign desk</a>');return;}
    if(req.headers.cookie?.includes('campaign=ready'))cookieSeen=true;
    res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'campaign=ready; SameSite=Lax'}).end(campaign);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  sentinel=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await sentinel.loadURL('about:blank');
  const owner={actorId:randomUUID(),epoch:randomUUID(),tenantId:randomUUID(),projectId:randomUUID(),sessionId:randomUUID(),taskId:randomUUID(),workspace:path.join(owned,'workspace')};
  let allowed=false;const authority=async()=>{if(!allowed)throw new Error('Full local access required');};
  const session=pool.create(owner,authority),call=client(session);
  await assert.rejects(call('open',{url:origin}),/Full local access required/);assert.equal(BrowserWindow.getAllWindows().length,1);allowed=true;
  pass('A real browser page is never created before current customer full-access authority');
  console.log('PHASE open actual page');const tab=content(await call('open',{url:origin})).tab_id;console.log('PHASE opened '+tab);
  const snapshot=async()=>content(await call('snapshot',{tab_id:tab}));
  let state=await snapshot();assert.ok(state.text.includes('A clearer launch'));
  const ref=name=>{const item=state.elements.find(item=>item.name===name);assert.ok(item,'Missing actual element '+name);return item.ref;};
  const browserWindow=BrowserWindow.getAllWindows().find(w=>w!==sentinel);
  assert.equal(browserWindow.isMenuBarVisible(),false);
  const remote=browserWindow.contentView.children.find(view=>view.webContents);
  assert.ok(remote);const preferences=remote.webContents.getLastWebPreferences();assert.equal(preferences.sandbox,true);assert.equal(preferences.nodeIntegration,false);
  const isolated=content(await call('evaluate',{tab_id:tab,expression:'({node:typeof process,require:typeof require,ipc:typeof nativeBrowser,app:typeof copyPaste})'})).result;
  assert.deepEqual(isolated,{node:'undefined',require:'undefined',ipc:'undefined',app:'undefined'});
  pass('Remote page renderer is separate from trusted frameless chrome and has no Node or application IPC');
  recording=new WorkmateRecording('desktop','native-browser',attempt,async()=>{assert.ok(!browserWindow.isDestroyed());return (await browserWindow.capturePage()).toJPEG(82);},'Actual native browser interactions against an explicit local campaign fixture; no cloud or model behavior claimed',path.resolve(__dirname,'../../copypaste-delivery'));
  await recording.start();await capture('campaign-en');
  await call('interact',{tab_id:tab,action:'fill',ref:ref('Campaign name'),text:'Victoria Harbour summer'});await pause(250);
  await call('interact',{tab_id:tab,action:'select',ref:ref('Primary channel'),text:'meta'});
  await call('interact',{tab_id:tab,action:'fill',ref:ref('Creative notes'),text:'Company blue. Editable visuals for the launch.'});
  await call('interact',{tab_id:tab,action:'press',ref:ref('Creative notes'),key:'Control+A'});
  await call('interact',{tab_id:tab,action:'type',ref:ref('Creative notes'),text:'Hong Kong teams. Include a clear call to action.'});
  const upload=path.join(owned,'workspace','reference.txt');await writeFile(upload,'Customer-selected reference bytes');
  await call('interact',{tab_id:tab,action:'upload',ref:ref('Reference file'),files:[upload]});
  const submit={tab_id:tab,action:'click',ref:ref('Save campaign')};
  await call('interact',submit,'idempotent_save');await call('interact',submit,'idempotent_save');
  await call('wait',{tab_id:tab,state:'text',text:'Saved campaign 1'});
  assert.equal(saves.length,1);assert.deepEqual(saves[0],{name:'Victoria Harbour summer',channel:'meta',notes:'Hong Kong teams. Include a clear call to action.',attachment:{name:'reference.txt',text:'Customer-selected reference bytes'}});
  await assert.rejects(call('interact',{tab_id:tab,action:'click',ref:ref('Preview')},'idempotent_save'),{code:'BROWSER_CALL_ID_CONFLICT'});
  pass('Real typing, keyboard selection, form select and exact local file upload produce one HTTP save for a repeated native call ID');
  await capture('saved-en');
  const screenshot=await call('screenshot',{tab_id:tab});const png=Buffer.from(screenshot.contentItems.find(item=>item.type==='inputImage').imageUrl.split(',')[1],'base64');assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>10000);
  await writeFile(path.join(owned,'actual-page.png'),png);pass('The model screenshot is actual visible Chromium PNG content');
  await call('interact',{tab_id:tab,action:'click',ref:ref('Download brief')});
  const downloads=content(await call('wait',{tab_id:tab,state:'download'})).downloads;
  assert.equal(downloads.length,1);assert.equal(downloads[0].sha256,hash(download));assert.deepEqual(await readFile(downloads[0].path),download);
  pass('Download waits for a real local file with exact byte count and SHA-256');
  state=await snapshot();await call('interact',{tab_id:tab,action:'click',ref:ref('Confirm launch')});
  await until(async()=>content(await call('tabs')).tabs[0].dialog);await capture('confirmation-en');
  await call('dialog',{tab_id:tab,accept:true});await call('wait',{tab_id:tab,state:'text',text:'Launch confirmed'});
  state=await snapshot();await call('interact',{tab_id:tab,action:'click',ref:ref('Set reference')});
  await until(async()=>content(await call('tabs')).tabs[0].dialog);await call('dialog',{tab_id:tab,accept:true,prompt_text:'HK-2026'});
  await call('wait',{tab_id:tab,state:'text',text:'Reference: HK-2026'});pass('Real JavaScript confirm and prompt dialogs can be answered without blocking the native tool queue');
  state=await snapshot();await call('interact',{tab_id:tab,action:'click',ref:ref('Open preview')});
  const popup=await until(async()=>content(await call('tabs')).tabs.find(item=>item.tab_id!==tab));
  await call('wait',{tab_id:popup.tab_id,state:'text',text:'Campaign preview'});
  assert.equal(content(await call('evaluate',{tab_id:popup.tab_id,expression:'!!window.opener'})).result,true);await call('close',{tab_id:popup.tab_id});
  pass('Popup pages are registered to the same task, retain browser opener behavior and close independently');
  const oldRef=ref('Campaign name');await call('navigate',{tab_id:tab,url:origin+'/next'});
  await assert.rejects(call('interact',{tab_id:tab,action:'fill',ref:oldRef,text:'stale'}),{code:'BROWSER_ELEMENT_STALE'});
  await call('history',{tab_id:tab,action:'back'});await call('wait',{tab_id:tab,state:'text',text:'Campaign name'});assert.equal(cookieSeen,true);
  await call('history',{tab_id:tab,action:'forward'});await call('wait',{tab_id:tab,state:'text',text:'Next page checklist'});
  await call('navigate',{tab_id:tab,url:origin});await call('history',{tab_id:tab,action:'reload'});await call('wait',{tab_id:tab,state:'ready'});
  await assert.rejects(call('navigate',{tab_id:tab,url:'file:///C:/Windows/win.ini'}),{code:'BROWSER_URL_INVALID'});
  pass('Navigation/history use real pages and task login storage; stale document refs and privileged URLs are rejected');
  await call('interact',{tab_id:tab,action:'scroll',x:0,y:600});await pause(250);assert.ok(content(await call('evaluate',{tab_id:tab,expression:'scrollY'})).result>0);
  await call('evaluate',{tab_id:tab,expression:'document.querySelector("#bottom").scrollIntoView(); true'});state=await snapshot();
  await call('interact',{tab_id:tab,action:'drag',ref:ref('Move brief'),target_ref:ref('Drop here')});
  await call('wait',{tab_id:tab,state:'text',text:'Brief moved'});pass('Real viewport scrolling and mouse drag/drop change the actual page');
  await call('evaluate',{tab_id:tab,expression:'scrollTo(0,0); true'});browserWindow.setSize(720,600);await pause(350);await capture('compact-en');browserWindow.setSize(1180,820);await pause(250);
  await call('navigate',{tab_id:tab,url:origin});state=await snapshot();
  await capture('completed-en');media=await recording.stop();recording=undefined;
  const other=pool.create({...owner,sessionId:randomUUID(),taskId:randomUUID()},async()=>{}),otherCall=client(other);
  await assert.rejects(otherCall('snapshot',{tab_id:tab}),{code:'BROWSER_TAB_UNAVAILABLE'});await other.close();
  await call('interact',{tab_id:tab,action:'click',ref:ref('Download source archive')});
  await until(async()=>content(await call('downloads',{tab_id:tab})).downloads.some(item=>item.state==='progressing'));
  const controller=new AbortController();const waiting=session.call({namespace:'copypaste_browser',tool:'wait',arguments:{tab_id:tab,state:'text',text:'this text never arrives',timeout_ms:30000},callId:'abort_wait',threadId:'browser-check-thread',turnId:'browser-check-turn'},controller.signal);
  await pause(120);controller.abort();await assert.rejects(waiting,{code:'BROWSER_INTERRUPTED'});await session.close();
  await until(()=>BrowserWindow.getAllWindows().length===1);assert.equal(sentinel.isDestroyed(),false);
  const files=await readdir(path.join(owned,'workspace','browser-downloads'));assert.equal(files.length,1);assert.deepEqual(await readFile(downloads[0].path),download);
  pass('Abort closes every task page and pending download immediately, preserves completed files and leaves an unrelated window alive');
  console.log('CHECKS '+checks.length);
}).catch(e=>{error=String(e.stack||e);console.error(error);}).finally(async()=>{
  if(recording)try{media=await recording.stop();}catch(e){error=error||String(e);}
  await pool?.close();if(sentinel&&!sentinel.isDestroyed())sentinel.destroy();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const report={at:new Date().toISOString(),status:error?'failed':'passed',checks,screenshots,media,error,owned_windows_closed:BrowserWindow.getAllWindows().length===0,http_server_closed:!server?.listening,synthetic:'Only the local campaign content is a test fixture. Browser actions, renderer isolation and file effects are real; no model or company billing is claimed.'};
  await writeFile(path.join(owned,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});clearTimeout(deadline);app.exit(error?1:0);
});
