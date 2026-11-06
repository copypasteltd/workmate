import {chromium,_electron} from 'playwright';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {authenticateOwner197,navigate} from './live-owner-197-v2.mjs';
import {ok} from './live-client-189-v2.mjs';
import {WorkmateRecording} from './record-workmate-media.ts';

const desktop=path.resolve('../copypaste-desktop'),require=createRequire(path.join(desktop,'package.json')),asar=require('@electron/asar');
const old=path.join(desktop,'.data/deployment-197-v2/release/win-unpacked'),packed=path.join(desktop,'.data/deployment-197-v3/release/win-unpacked');
const run=path.resolve('.data/acceptance-197/desktop-delta-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:197,status:'running',at:new Date().toISOString(),desktop_version:'0.7.8',checks:[],screenshots:[],javascript_errors:[],scope:'Actual final0.7.8 package: byte-for-byte main-process/native-runtime equivalence with fully qualified0.7.7; fresh company PKCE, existing owned cloud task and corrected timing UI. No new model or local command task is generated.'};
const hash=b=>createHash('sha256').update(b).digest('hex');
const pass=(name,details)=>{report.checks.push({name,status:'passed',...(details?{details}:{})});console.log(JSON.stringify({name,status:'passed'}));};
async function until(read,predicate,ms=90000){const end=Date.now()+ms;while(Date.now()<end){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,500));}throw Error('Owned Desktop condition timed out');}
let app,browser,user,page,recording;
try{
 const oldAsar=path.join(old,'resources/app.asar'),newAsar=path.join(packed,'resources/app.asar');
 const list=p=>asar.listPackage(p).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('dist/')&&n.endsWith('.js')).sort();
 const oldFiles=list(oldAsar),newFiles=list(newAsar);assert.ok(oldFiles.length>20);assert.deepEqual(newFiles,oldFiles);
 report.unchanged_main_process=[];
 for(const file of newFiles){const a=asar.extractFile(oldAsar,file),b=asar.extractFile(newAsar,file);assert.deepEqual(a,b,'Unexpected main-process change: '+file);report.unchanged_main_process.push({path:file,bytes:b.length,sha256:hash(b)});}
 const manifest=JSON.parse(await readFile(path.join(packed,'resources/local-codex/runtime-manifest.json'),'utf8'));assert.equal(manifest.runtime,'0.163.0-alpha.11');report.runtime=manifest.runtime;report.runtime_files=[];
 for(const [file,spec] of Object.entries(manifest.files)){const a=await readFile(path.join(old,'resources/local-codex',file)),b=await readFile(path.join(packed,'resources/local-codex',file));assert.deepEqual(a,b);assert.equal(b.length,spec.bytes);assert.equal(hash(b),spec.sha256);report.runtime_files.push({path:file,bytes:b.length,sha256:hash(b)});}
 const pkg=JSON.parse(asar.extractFile(newAsar,'package.json').toString());assert.equal(pkg.version,'0.7.8');report.app_asar_sha256=hash(await readFile(newAsar));
 pass('every packaged main-process JavaScript file and pinned native helper matches the actual0.7.7 native journey', {main_process_files:newFiles.length,runtime_files:report.runtime_files.length});
 const owned=JSON.parse(await readFile('.data/acceptance-195/ui-277118df-29ac-4fc5-afb0-1fc0b48f3bd9/receipt.json','utf8'));
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});user=await authenticateOwner197(browser);
 const projects=await ok(user.page,'/v1/tenants/'+owned.tenant_id+'/projects'),project=projects.items[0],base=`/v1/tenants/${owned.tenant_id}/projects/${project.id}`;
 const task=await ok(user.page,base+'/tasks/'+owned.task_id);assert.equal(task.status,'succeeded');report.task_id=task.id;
 const checks=await ok(user.page,base+'/tasks/'+task.id+'/software-checks?limit=10&view=terminal');assert.ok(checks.items.some(c=>Number.isSafeInteger(c.elapsed_ms)&&c.elapsed_ms>=0));
 report.actual_elapsed_ms=checks.items.map(c=>c.elapsed_ms??null);
 app=await _electron.launch({executablePath:path.join(packed,'CopyPaste.exe'),args:['--disable-gpu'],env:{...process.env,COPYPASTE_USER_DATA:path.join(run,'desktop-private')},timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(90000);page.on('pageerror',e=>report.javascript_errors.push(e.name));await page.waitForLoadState('domcontentloaded');
 await page.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','dark');});await page.reload({waitUntil:'domcontentloaded'});
 const shell=await app.evaluate(({BrowserWindow,Menu,shell})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:40,y:40,width:1320,height:950});globalThis.__qaAuthorizeURL=null;shell.openExternal=async u=>{const v=new URL(u);if(v.origin!=='https://agent.copypaste.hk'||v.pathname!=='/authorize')throw Error('Unexpected external target');globalThis.__qaAuthorizeURL=u;};return {no_menu:Menu.getApplicationMenu()===null,menu_visible:w.isMenuBarVisible(),bounds:w.getBounds(),content:w.getContentBounds()};});assert.ok(shell.no_menu);assert.equal(shell.menu_visible,false);assert.deepEqual(shell.bounds,shell.content);
 await page.getByRole('button',{name:'Sign in securely in your browser',exact:true}).click({noWaitAfter:true});const authorize=await until(()=>app.evaluate(()=>globalThis.__qaAuthorizeURL),Boolean);assert.equal(new URL(authorize).searchParams.get('code_challenge_method'),'S256');await navigate(user.page,authorize);await user.page.getByRole('link',{name:'Authorize & return',exact:true}).click();assert.equal(new URL(user.page.url()).hostname,'127.0.0.1');await page.getByLabel('Local specialist',{exact:true}).waitFor();
 const identity=await page.evaluate(()=>window.copyPasteBridge.request('/v1/session/context'));assert.equal(identity.status,200);assert.equal(identity.body.user.id,user.identity.user.id);
 if(await page.getByLabel('Switch workspace',{exact:true}).inputValue()!==owned.tenant_id)await page.getByLabel('Switch workspace',{exact:true}).selectOption(owned.tenant_id);await page.getByLabel('Current project',{exact:true}).selectOption(project.id);pass('final0.7.8 opens frameless without menus and completes fresh real company PKCE');
 await page.evaluate(id=>{location.hash='/app/tasks/'+id;},task.id);await page.locator('.software-checks .software-check').first().waitFor();recording=new WorkmateRecording('desktop','desktop-review','197-v4',()=>page.screenshot({type:'jpeg',quality:74,mask:[page.locator('.user-chip strong')]}),'Final0.7.8 actual Desktop task review and corrected canonical execution timing');await recording.start();await page.locator('.software-checks').waitFor();await page.locator('.software-checks details').first().waitFor();assert.doesNotMatch(await page.locator('.software-checks').innerText(),/NaNs|undefined ms|Infinity/);
 await page.locator('.software-checks').evaluate(el=>el.scrollIntoView({block:'start'}));const image=path.join(desktop,'assets/screenshots/197-v4-desktop-review.png');await page.screenshot({path:image,animations:'disabled',mask:[page.locator('.user-chip strong')]});report.screenshots.push({path:'copypaste-desktop/assets/screenshots/197-v4-desktop-review.png',sha256:hash(await readFile(image))});
 const rails=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,rootScrollbar:getComputedStyle(document.querySelector('#root')).scrollbarWidth}));assert.ok(rails.document<=rails.width);assert.equal(rails.rootScrollbar,'none');await page.locator('.software-checks details').first().locator('summary').click();await page.locator('.software-checks details').first().locator('summary').click();pass('actual server timing is finite and final task review has no invalid duration or horizontal/root rails',rails);assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.name+': '+String(e.message).split('\n')[0];}
finally{if(recording)report.recording=await recording.stop().catch(()=>({status:'failed'}));if(page)await page.evaluate(()=>window.copyPasteBridge.signOut()).catch(()=>{});await app?.close().catch(()=>{});await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});report.owned_windows_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));}
assert.equal(report.status,'passed');
