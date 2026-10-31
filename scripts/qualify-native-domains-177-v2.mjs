import { _electron, chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve('..'), run=path.resolve('.data/deployment-177/native-'+randomUUID());
await mkdir(run,{recursive:true});
const desktop=path.join(root,'copypaste-desktop'), extension=path.join(root,'copypaste-extension');
const packed=path.join(desktop,'.data/deployment-177/release/win-unpacked');
const receipt={stage:177,at:new Date().toISOString(),checks:[],errors:[]};
let app,context,cdp,panelSession;
const pass=(name,detail)=>receipt.checks.push({name,status:'passed',detail});
async function until(read,ok){const end=Date.now()+20000;while(Date.now()<end){const v=await read();if(ok(v))return v;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out waiting for native UI');}
try{
 const manifest=JSON.parse(await readFile(path.join(packed,'resources/local-codex/runtime-manifest.json'),'utf8'));
 for(const [file,spec] of Object.entries(manifest.files)){const raw=await readFile(path.join(packed,'resources/local-codex',file));assert.equal(raw.length,spec.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),spec.sha256);}
 assert.equal(manifest.runtime,'0.163.0-alpha.11');pass('packaged local Codex and all native helpers match their pinned hashes',{runtime:manifest.runtime,files:Object.keys(manifest.files).length});
 const asar=await readFile(path.join(packed,'resources/app.asar'));
 assert.ok(asar.includes(Buffer.from('https://ai-api.copypaste.hk')));assert.ok(asar.includes(Buffer.from('https://agent.copypaste.hk')));
 receipt.asar_sha256=createHash('sha256').update(asar).digest('hex');
 app=await _electron.launch({executablePath:path.join(packed,'CopyPaste.exe'),args:['--disable-gpu'],env:{...process.env,COPYPASTE_USER_DATA:path.join(run,'desktop')},timeout:30000});
 const page=await app.firstWindow();await page.waitForURL(/file:.*index\.html/);await page.waitForLoadState('domcontentloaded');page.setDefaultTimeout(20000);page.on('pageerror',e=>receipt.errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});await page.reload();
 await page.getByRole('button',{name:'Minimize window',exact:true}).waitFor();
 const shell=await app.evaluate(({BrowserWindow,Menu})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:60,y:40,width:1280,height:900});return {no_menu:Menu.getApplicationMenu()===null,menu_visible:w.isMenuBarVisible(),bounds:w.getBounds(),content:w.getContentBounds()};});
 assert.ok(shell.no_menu);assert.equal(shell.menu_visible,false);assert.deepEqual(shell.bounds,shell.content);
 const rails=await page.evaluate(()=>({scrollbar:getComputedStyle(document.querySelector('#root')).scrollbarWidth,overflowX:getComputedStyle(document.querySelector('#root')).overflowX,documentWidth:document.documentElement.scrollWidth,width:innerWidth}));
 assert.equal(rails.scrollbar,'none');assert.ok(rails.documentWidth<=rails.width);pass('packaged Desktop retains frameless shell, no Electron menu and hidden scroll rails',{shell,rails});
 const config=await page.evaluate(()=>window.copyPasteBridge.request('/v1/public/config'));
 assert.equal(config.status,200,'Packaged Desktop must reach the real public API');
 pass('packaged Desktop reaches real HTTPS API through its native request bridge',{status:config.status});
 await page.getByRole('button',{name:'Sign in securely in your browser'}).waitFor();
 await page.screenshot({path:path.join(desktop,'assets/screenshots/177-domain-signin.png'),animations:'disabled'});
 await app.close();app=undefined;

 const id=(await readFile(path.join(extension,'extension-id.txt'),'utf8')).trim();
 const em=JSON.parse(await readFile(path.join(extension,'dist/manifest.json'),'utf8'));
 assert.equal(em.version,'0.5.3');assert.deepEqual(em.host_permissions,['https://ai-api.copypaste.hk/*']);assert.equal(em.action.default_popup,undefined);
 context=await chromium.launchPersistentContext(path.join(run,'chrome'),{executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),headless:false,viewport:null,args:['--disable-gpu','--window-size=1480,980','--enable-unsafe-extension-debugging','--disable-extensions-except='+path.join(extension,'dist'),'--load-extension='+path.join(extension,'dist')]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 await until(()=>worker.evaluate(()=>chrome.sidePanel.getPanelBehavior()),b=>b.openPanelOnActionClick);
 const main=context.pages()[0];await main.goto('https://agent.copypaste.hk');const width=await main.evaluate(()=>innerWidth),tabs=context.pages().length;
 cdp=await context.browser().newBrowserCDPSession();const target=(await cdp.send('Target.getTargets',{filter:[{}]})).targetInfos.find(t=>t.type==='tab'&&t.url.startsWith('https://agent.copypaste.hk'));
 assert.ok(target);await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
 const native=await until(()=>worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})),items=>items.length===1);
 assert.equal((await worker.evaluate(()=>chrome.sidePanel.getLayout())).side,'right');assert.equal(context.pages().length,tabs);
 const shrunk=await until(()=>main.evaluate(()=>innerWidth),w=>w<width-250);
 const panelTarget=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{}]})).targetInfos.find(t=>t.type==='page'&&t.url===native[0].documentUrl),Boolean);
 const attached=await cdp.send('Target.attachToTarget',{targetId:panelTarget.targetId,flatten:false});panelSession=attached.sessionId;
 let sequence=0;
 async function send(method,params={}){const n=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',receive);reject(new Error('Panel CDP timeout'));},15000);function receive(e){if(e.sessionId!==panelSession)return;const m=JSON.parse(e.message);if(m.id!==n)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',receive);if(m.error)reject(new Error(m.error.message));else resolve(m.result);}cdp.on('Target.receivedMessageFromTarget',receive);cdp.send('Target.sendMessageToTarget',{sessionId:panelSession,message:JSON.stringify({id:n,method,params})}).catch(reject);});}
 const panel=await until(async()=>(await send('Runtime.evaluate',{expression:'({ready:document.readyState,width:innerWidth,scroll:document.documentElement.scrollWidth,login:!!document.querySelector("#sign-in")})',returnByValue:true})).result.value,v=>v?.ready==='complete'&&v.width>250);
 assert.ok(panel.login);assert.ok(panel.scroll<=panel.width);
 const api=await worker.evaluate(async()=>{const r=await fetch('https://ai-api.copypaste.hk/health/ready');return {status:r.status,body:await r.json()};});
 assert.equal(api.status,200);assert.equal(api.body.kernel,'codex');
 const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile(path.join(extension,'assets/screenshots/177-domain-sidepanel.png'),Buffer.from(capture.data,'base64'),{flag:'wx'});
 pass('real toolbar action opens a right native Side Panel beside the public Web app, with public API connectivity',{id,native_type:native[0].contextType,before_width:width,after_width:shrunk,panel,api_status:api.status});
 await cdp.send('Target.detachFromTarget',{sessionId:panelSession});panelSession=undefined;
 await cdp.detach();cdp=undefined;await context.close();context=undefined;
 assert.deepEqual(receipt.errors,[]);receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=String(e.stack??e);process.exitCode=1;}
finally{if(panelSession&&cdp)await cdp.send('Target.detachFromTarget',{sessionId:panelSession}).catch(()=>{});await cdp?.detach().catch(()=>{});await context?.close().catch(()=>{});await app?.close().catch(()=>{});receipt.owned_windows_closed=true;receipt.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({run,status:receipt.status,checks:receipt.checks.length,error:receipt.error}));}
