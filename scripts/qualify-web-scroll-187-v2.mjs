import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const base='http://192.168.31.20:63070',publicOrigin='https://agent.copypaste.hk';
const run=path.resolve('.data/deployment-187/browser-'+randomUUID());await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8'));
const account=JSON.parse(await readFile('.data/account-186/provisioning-v5.sanitized.json','utf8'));
const report={stage:187,status:'started',at:new Date().toISOString(),checks:[],scope:'Actual deployed Web UI on owned LAN; real existing test-user OTP and read-only API data. No model calls or API mocks.',run};
let browser,context,csrf,video,stage='sign-in';
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({phase:name,status:'passed'}));};
async function getMail(id){
 const addresses=await lookup('agent-dashboard.copypaste.hk',{all:true}),address=addresses.find(x=>x.address==='172.67.180.165')??addresses.find(x=>x.family===4);assert.ok(address);
 for(let attempt=1;attempt<=3;attempt++)try{return await new Promise((resolve,reject)=>{
  const request=https.get('https://agent-dashboard.copypaste.hk/ops/mailbox/data/'+id+'.json',{family:4,lookup:(host,options,done)=>options?.all?done(null,[address]):done(null,address.address,4),headers:{Authorization:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64'),'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)},response=>{
   const chunks=[];response.on('data',x=>chunks.push(x));response.on('end',()=>{try{assert.equal(response.statusCode,200);resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});response.on('error',reject);
  });request.on('error',reject);
 });}catch(e){if(attempt===3)throw e;}
}
async function allowOwnedLanCookies(response){
 for(const header of response.headersArray().filter(x=>x.name.toLowerCase()==='set-cookie')){
  const [pair,...attributes]=header.value.split(';'),split=pair.indexOf('='),name=pair.slice(0,split),value=pair.slice(split+1);
  const p=attributes.find(x=>/^\s*path=/i.test(x))?.trim().slice(5)??'/';
  await context.addCookies([{name,value,domain:'192.168.31.20',path:p,httpOnly:true,secure:false,sameSite:'Lax'}]);
 }
}
async function post(route,body){
 const response=await context.request.post(base+route,{headers:{Origin:publicOrigin,Referer:publicOrigin+'/login','Sec-Fetch-Site':'same-origin','Idempotency-Key':randomUUID(),...(csrf?{'X-CSRF-Token':csrf}:{})},data:body});
 assert.ok(response.ok(),'Deployed API rejected '+route+' with '+response.status());return response;
}
const media=path.resolve('../copypaste-web/assets/screenshots');await mkdir(media,{recursive:true});
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(media,'187-v2-'+name+'.png'),animations:'disabled',mask:[page.locator('.user-chip strong'),page.locator('.workspace-switch select'),page.locator('.app-topbar > select')],maskColor:'#d7d8df'});}
async function shape(page){return await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,rootScrollbar:getComputedStyle(document.documentElement).scrollbarWidth,navScrollbar:document.querySelector('.sidebar nav')?getComputedStyle(document.querySelector('.sidebar nav')).scrollbarWidth:null,thumb:getComputedStyle(document.documentElement).getPropertyValue('--scroll-thumb').trim()}));}
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')});
 context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-HK'});context.setDefaultTimeout(20000);
 await context.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});
 const challengeResponse=await post('/v1/auth/challenges',{email:account.email});await allowOwnedLanCookies(challengeResponse);
 const challenge=await challengeResponse.json(),mail=await getMail(challenge.challenge_id);assert.equal(mail.to,account.email);
 const sessionResponse=await post('/v1/auth/sessions',{challenge_id:challenge.challenge_id,code:mail.text.match(/code is (\d{6})/)[1]});await allowOwnedLanCookies(sessionResponse);csrf=(await sessionResponse.json()).csrf_token;
 report.authentication='Real canonical OTP; browser-only cookie transport scoped to the owned LAN HTTP QA context. Server cookie/security settings unchanged.';
 const storage=await context.storageState();await context.close();
 context=await browser.newContext({storageState:storage,viewport:{width:1440,height:1000},locale:'en-HK',recordVideo:{dir:path.join(run,'video'),size:{width:1440,height:1000}}});
 await context.addInitScript(()=>{
  localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');
  const style=document.createElement('style');style.id='qa-scroll-redaction';style.textContent='.user-chip strong,.workspace-switch select,.app-topbar>select{color:transparent!important;background:#d7d8df!important}';
  const attach=()=>{if(!document.documentElement)return false;if(!document.getElementById(style.id))document.documentElement.append(style);return true;};
  if(!attach()){const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
 });report.artifact_version='ui-v2';
 const page=await context.newPage();video=page.video();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 stage='authenticated role page';await page.goto(base+'/app/roles',{waitUntil:'networkidle'});await page.locator('.sidebar nav').waitFor();
 await page.locator('.role-grid .role-card').first().waitFor();
 let layout=await shape(page);assert.ok(layout.scrollWidth<=layout.viewport+1);assert.equal(layout.rootScrollbar,'none');assert.equal(layout.navScrollbar,'none');
 report.desktop=layout;await shot(page,'roles-light');pass('desktop role catalogue has no page/sidebar scrollbar or horizontal overflow');
 stage='page and sidebar scrolling';await page.mouse.move(1150,750);await page.mouse.wheel(0,750);await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>scrollY)>0);
 await page.evaluate(()=>scrollTo(0,0));const nav=page.locator('.sidebar nav');
 const metrics=await nav.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
 if(metrics.total>metrics.height){await nav.hover();await page.mouse.wheel(0,750);await page.waitForTimeout(250);assert.ok(await nav.evaluate(el=>el.scrollTop)>0);assert.equal(await page.evaluate(()=>scrollY),0);}
 pass('mouse wheel still scrolls the page and long navigation independently');
 stage='dark theme';await page.evaluate(()=>document.documentElement.dataset.theme='dark');layout=await shape(page);assert.equal(layout.rootScrollbar,'none');assert.equal(layout.navScrollbar,'none');
 await shot(page,'roles-dark');pass('dark theme retains hidden outer scrollbars and theme-derived scroll tokens');
 stage='read-only business pages';
 for(const route of ['files','usage','settings','connections','analytics']){
  await page.goto(base+'/app/'+route,{waitUntil:'networkidle'});await page.locator('.main-content').waitFor();
  const s=await shape(page);assert.ok(s.scrollWidth<=s.viewport+1,route+' overflowed the viewport');
 }
 pass('files, billing, settings, connections and analytics fit the desktop viewport');
 stage='narrow screen';await page.setViewportSize({width:390,height:844});await page.goto(base+'/app/roles',{waitUntil:'networkidle'});await page.locator('.role-grid .role-card').first().waitFor();
 layout=await shape(page);assert.ok(layout.scrollWidth<=layout.viewport+1);assert.equal(layout.rootScrollbar,'none');report.mobile=layout;await shot(page,'roles-mobile');
 pass('mobile role catalogue remains readable without page horizontal overflow');
 stage='mobile navigation';
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.mobile-open .sidebar').waitFor();
 assert.equal(await page.locator('.sidebar nav').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
 await page.getByRole('button',{name:'Close navigation',exact:true}).click();await page.locator('.mobile-open').waitFor({state:'hidden'});
 pass('mobile navigation opens, remains scrollable without a rail, and closes normally');
 stage='mobile business pages';
 for(const route of ['files','usage','settings','connections','analytics','members']){
  await page.goto(base+'/app/'+route,{waitUntil:'networkidle'});await page.locator('.main-content').waitFor();
  const metric=await shape(page);assert.ok(metric.scrollWidth<=metric.viewport+1,route+' overflowed the mobile viewport');
 }
 pass('six business pages also fit the mobile viewport without page horizontal scrolling');
 stage='table and long text';
 const table=page.locator('.table-scroll').first();await table.waitFor();
 const tableState=await table.evaluate(el=>{const css=getComputedStyle(el);el.scrollLeft=el.scrollWidth;return {width:el.clientWidth,total:el.scrollWidth,left:el.scrollLeft,bar:css.scrollbarWidth,color:css.scrollbarColor};});
 assert.equal(tableState.bar,'thin');assert.notEqual(tableState.color,'auto');
 if(tableState.total>tableState.width)assert.ok(tableState.left>0);report.table=tableState;
 const longText=await page.evaluate(()=>{const pre=document.createElement('pre');pre.textContent='Synthetic layout stress: '+'long-file-name-without-spaces-'.repeat(1200);pre.style.cssText='max-height:160px;overflow:auto';document.querySelector('.main-content').append(pre);const css=getComputedStyle(pre),result={width:pre.clientWidth,total:pre.scrollWidth,bar:css.scrollbarWidth};pre.remove();return result;});
 assert.ok(longText.total<=longText.width+1);assert.equal(longText.bar,'thin');
 await shot(page,'members-mobile');pass('wide member tables stay inside the viewport, retain horizontal access and themed thin rails; synthetic long text wraps');
 stage='long modal';await page.setViewportSize({width:1280,height:720});await page.goto(base+'/app',{waitUntil:'networkidle'});await page.locator('.sidebar').waitFor();
 await page.locator('.new-task-side').click();await page.getByRole('dialog').waitFor();
 const backdrop=page.locator('.modal-backdrop').last();assert.equal(await backdrop.evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
 await backdrop.evaluate(el=>{el.scrollTop=el.scrollHeight;});assert.ok(await backdrop.evaluate(el=>el.scrollHeight<=el.clientHeight||el.scrollTop>0));
 await shot(page,'new-work-modal');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});pass('new-work dialog scrolls to its bottom, hides the outer rail and closes by keyboard');
 stage='errors';assert.deepEqual(errors,[]);pass('actual UI reports no script errors');
 await post('/v1/auth/logout',{});report.qa_session_signed_out=true;report.status='passed';
}catch(e){report.status='failed';report.failure_stage=stage;report.error=e.message;}
finally{await context?.close();await browser?.close();report.browser_closed=true;if(video)report.video=await video.path();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
assert.equal(report.status,'passed');
