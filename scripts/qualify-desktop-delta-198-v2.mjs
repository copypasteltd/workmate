import {chromium,_electron} from 'playwright';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {existingOwner} from './live-read-only-owner-198-v1.mjs';
import {ok} from './live-client-189-v2.mjs';
import {WorkmateRecording} from './record-workmate-media.ts';
const desktop=path.resolve('../copypaste-desktop'),require=createRequire(path.join(desktop,'package.json')),asar=require('@electron/asar');
const old=path.join(desktop,'.data/deployment-198-v1/release/win-unpacked'),packed=path.join(desktop,'.data/deployment-198-v2/release/win-unpacked');
const out=path.resolve('.data/acceptance-198/desktop-delta-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:198,status:'running',desktop_version:'0.7.10',at:new Date().toISOString(),scope:'Final packaged0.7.10: exact main-process/native-runtime equivalence to the actual0.7.9 local paid journey, fresh native PKCE, read-only original cloud task summary (Desktop cloud details retain their existing summary layout), and neutral recorded-usage directory wording. No new local/model task or charge.',checks:[],screenshots:[],javascript_errors:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
const pass=(name,details)=>{report.checks.push({name,status:'passed',...(details?{details}:{})});console.log(JSON.stringify({name,status:'passed'}));};
async function until(read,predicate){const end=Date.now()+90000;while(Date.now()<end){const v=await read();if(predicate(v))return v;await new Promise(r=>setTimeout(r,500));}throw Error('Owned Desktop condition timed out');}
let browser,user,app,page,recording;
try{
 const a=path.join(old,'resources/app.asar'),b=path.join(packed,'resources/app.asar');
 const names=p=>asar.listPackage(p).map(x=>x.replaceAll('\\','/').replace(/^\//,'')).filter(x=>x.startsWith('dist/')&&x.endsWith('.js')).sort();
 const files=names(a);assert.ok(files.length>20);assert.deepEqual(names(b),files);report.unchanged_main_process=[];
 for(const file of files){const first=asar.extractFile(a,file),final=asar.extractFile(b,file);assert.deepEqual(final,first,'Unexpected native implementation change: '+file);report.unchanged_main_process.push({path:file,bytes:final.length,sha256:hash(final)});}
 const manifest=JSON.parse(await readFile(path.join(packed,'resources/local-codex/runtime-manifest.json'),'utf8'));assert.equal(manifest.runtime,'0.163.0-alpha.11');report.runtime=manifest.runtime;report.runtime_files=[];
 for(const [file,spec] of Object.entries(manifest.files)){const first=await readFile(path.join(old,'resources/local-codex',file)),final=await readFile(path.join(packed,'resources/local-codex',file));assert.deepEqual(final,first);assert.equal(final.length,spec.bytes);assert.equal(hash(final),spec.sha256);report.runtime_files.push({path:file,bytes:final.length,sha256:hash(final)});}
 assert.equal(JSON.parse(asar.extractFile(b,'package.json').toString()).version,'0.7.10');report.app_asar_sha256=hash(await readFile(b));
 pass('every final packaged native implementation file and pinned runtime matches the actual0.7.9 Codex journey',{main_process_files:files.length,runtime_files:report.runtime_files.length});
 const original=JSON.parse(await readFile('.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json','utf8'));
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});user=await existingOwner(browser);
 const projects=await ok(user.page,'/v1/tenants/'+original.tenant_id+'/projects'),project=projects.items[0];assert.ok(project);
 app=await _electron.launch({executablePath:path.join(packed,'CopyPaste.exe'),args:['--disable-gpu'],env:{...process.env,COPYPASTE_USER_DATA:path.join(out,'desktop-private')},timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(90000);page.on('pageerror',e=>report.javascript_errors.push(e.name));await page.waitForLoadState('domcontentloaded');
 await page.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});await page.reload({waitUntil:'domcontentloaded'});
 const shell=await app.evaluate(({BrowserWindow,Menu,shell})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:40,y:40,width:1320,height:950});globalThis.__qaAuthorize=null;shell.openExternal=async url=>{const u=new URL(url);if(u.origin!=='https://agent.copypaste.hk'||u.pathname!=='/authorize')throw Error('Unexpected native auth target');globalThis.__qaAuthorize=url;};return{no_menu:Menu.getApplicationMenu()===null,menu_visible:w.isMenuBarVisible(),bounds:w.getBounds(),content:w.getContentBounds()};});assert.ok(shell.no_menu&&!shell.menu_visible);assert.deepEqual(shell.bounds,shell.content);
 await page.getByRole('button',{name:'Sign in securely in your browser',exact:true}).click({noWaitAfter:true});const authorize=await until(()=>app.evaluate(()=>globalThis.__qaAuthorize),Boolean);assert.equal(new URL(authorize).searchParams.get('code_challenge_method'),'S256');
 // Authorization is a single actual navigation, never replayed by safe GET recovery.
 await user.page.goto(authorize,{waitUntil:'domcontentloaded',timeout:60000});await user.page.getByRole('link',{name:'Authorize & return',exact:true}).click();assert.equal(new URL(user.page.url()).hostname,'127.0.0.1');await page.getByLabel('Local specialist',{exact:true}).waitFor();
 const identity=await page.evaluate(()=>window.copyPasteBridge.request('/v1/session/context'));assert.equal(identity.status,200);assert.equal(identity.body.user.id,user.identity.user.id);
 if(await page.getByLabel('Switch workspace',{exact:true}).inputValue()!==original.tenant_id)await page.getByLabel('Switch workspace',{exact:true}).selectOption(original.tenant_id);await page.getByLabel('Current project',{exact:true}).selectOption(project.id);
 pass('final0.7.10 is frameless without menus and completes real native PKCE');
 await page.getByRole('link',{name:'All tasks',exact:true}).click();await page.locator('.task-directory-row').first().waitFor();
 const labels=await page.locator('.task-directory-usage > .muted').allTextContents();assert.ok(labels.length>0&&labels.every(s=>s==='Recorded usage'));
 recording=new WorkmateRecording('desktop','desktop-directory','198-v3',()=>page.screenshot({type:'jpeg',quality:74,mask:[page.locator('.user-chip strong')]}),'Final0.7.10 actual task directory, original task usage and retained return context');await recording.start();
 const png=path.join(desktop,'assets/screenshots/198-v3-desktop-directory.png');await page.screenshot({path:png,animations:'disabled',mask:[page.locator('.user-chip strong')]});report.screenshots.push({path:'copypaste-desktop/assets/screenshots/198-v3-desktop-directory.png',sha256:hash(await readFile(png))});
 const row=page.locator('[data-task-id="'+original.task_id+'"]');await row.waitFor();await row.locator('.task-directory-title').click();await page.getByRole('heading',{name:'Task details',exact:true}).waitFor();await page.getByText('Settled usage',{exact:true}).waitFor();await page.getByRole('link',{name:'Back to tasks',exact:true}).click();await page.locator('.task-directory-row').first().waitFor();
 const rails=await page.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth,rootScrollbar:getComputedStyle(document.querySelector('#root')).scrollbarWidth}));assert.ok(rails.content<=rails.width);assert.equal(rails.rootScrollbar,'none');pass('final directory uses neutral recorded usage and returns from the original task without horizontal or root rails',rails);
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+String(e.message).split('\n')[0];report.error_locator=String(e.message).split('\n').find(s=>s.includes('getByRole')||s.includes('locator('));if(page)await page.screenshot({path:path.join(out,'failure.private.png')}).catch(()=>{});}
finally{if(recording)report.recording=await recording.stop().catch(e=>({status:'failed',error:e.message.split('\n')[0]}));if(page)await page.evaluate(()=>window.copyPasteBridge.signOut()).catch(()=>{});await app?.close().catch(()=>{});await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_windows_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
