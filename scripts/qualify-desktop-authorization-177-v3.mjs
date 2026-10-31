import {_electron,chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('..'),base=path.resolve('.data/deployment-177'),run=path.join(base,'desktop-auth-'+randomUUID());
await mkdir(run,{recursive:true});
const prior=path.join(base,'browser-1d8d400d-1f2c-43e4-818c-753e0ac05622');
const state=JSON.parse(await readFile(path.join(prior,'pre-credit-state.private.json'),'utf8'));
const report={stage:177,at:new Date().toISOString(),checks:[]};let app,browser,context;
try{
 app=await _electron.launch({executablePath:path.join(root,'copypaste-desktop/.data/deployment-177/release/win-unpacked/CopyPaste.exe'),args:['--disable-gpu'],env:{...process.env,COPYPASTE_USER_DATA:path.join(base,'desktop-auth-76b55c10-c070-49f0-ba16-f5490e147cb4/desktop')},timeout:30000});
 const page=await app.firstWindow();await page.waitForURL(/file:.*index\.html/);await page.waitForLoadState('domcontentloaded');
 await page.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});await page.reload();
 await page.evaluate(()=>window.copyPasteBridge.signOut());await page.getByRole('button',{name:'Sign in securely in your browser'}).waitFor();
 await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.__domainAuthURL=url;};});
 await page.getByRole('button',{name:'Sign in securely in your browser'}).click({noWaitAfter:true});
 const until=Date.now()+20000;let url;
 while(Date.now()<until){url=await app.evaluate(()=>globalThis.__domainAuthURL);if(url)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(new URL(url).origin,'https://agent.copypaste.hk');
 const q=new URL(url).searchParams;assert.equal(q.get('client_id'),'desktop');assert.equal(q.get('code_challenge_method'),'S256');assert.equal(new URL(q.get('redirect_uri')).hostname,'127.0.0.1');
 browser=await chromium.launch({executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),headless:true});context=await browser.newContext({storageState:state});const auth=await context.newPage();
 await auth.addInitScript(()=>localStorage.setItem('cp_locale','en'));await auth.goto(url);
 await auth.getByRole('link',{name:/Authorize & return/}).click();
 await page.waitForURL('**#/app',{timeout:30000});await page.locator('.sidebar').waitFor();
 const response=await page.evaluate(()=>window.copyPasteBridge.request('/v1/session/context'));
 assert.equal(response.status,200);assert.ok(response.body.memberships.length>0);
 report.checks.push({name:'packaged Desktop completes actual public Web S256 PKCE and loopback callback, exchanges the code through public API and opens the native workspace',status:'passed'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:60,y:40,width:1440,height:980}));
 await page.getByLabel('Local specialist',{exact:true}).locator('option').first().waitFor({state:'attached',timeout:30000});await page.getByRole('button',{name:'Choose folder to start',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Choose folder to start',exact:true}).isEnabled(),true);report.checks.push({name:'local role catalog loads and the explicit workspace-folder action is available',status:'passed',roles:await page.getByLabel('Local specialist',{exact:true}).locator('option').count()});await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(root,'copypaste-desktop/assets/screenshots/177c-domain-workspace.png'),animations:'disabled'});
 const layout=await page.evaluate(()=>({scrollbar:getComputedStyle(document.querySelector('.sidebar')).scrollbarWidth,width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(layout.scrollbar,'none');assert.ok(layout.scroll<=layout.width);
 report.checks.push({name:'signed-in native workspace keeps its sidebar scroll rails hidden and has no document horizontal overflow',status:'passed',detail:layout});
 // Revoke the task-owned native session through the real service before closing.
 const signout=await page.evaluate(()=>window.copyPasteBridge.signOut());assert.ok(signout.remote_revoked);
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{if(app){try{const p=await app.firstWindow();await p.evaluate(()=>window.copyPasteBridge.signOut());}catch{}}await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await app?.close().catch(()=>{});report.owned_windows_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({run,status:report.status,checks:report.checks.length,error:report.error}));}
