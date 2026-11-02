import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
export const WEB='https://agent.copypaste.hk',ADMIN='https://agent-dashboard.copypaste.hk',API='https://ai-api.copypaste.hk';
export const root=path.resolve('../..'),privateRoot=path.resolve('.data/acceptance-189');
await mkdir(privateRoot,{recursive:true});
const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8'));
export function totp(){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret.admin_totp_secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join(''),key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),offset=h[19]&15;return ((h.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');}
export async function launch(){return chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),proxy:{server:process.env.WORKMATE_QA_PROXY??'http://127.0.0.1:11236',bypass:'127.0.0.1,localhost'},args:['--disable-quic']});}
export async function context(browser,options={}){const c=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-HK',...options});c.setDefaultTimeout(30000);await c.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});return c;}
export async function mail(c,id){const r=await c.request.get(ADMIN+'/ops/mailbox/data/'+id+'.json',{headers:{Authorization:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64')}});assert.equal(r.status(),200,'Protected real mailbox read');return r.json();}
export async function call(page,url,body,headers={},method){return page.evaluate(async({url,body,headers,method})=>{const r=await fetch(url,{method:method??(body===undefined?'GET':'POST'),credentials:'include',headers:{...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:r.status===204?null:await r.json()};},{url,body,headers,method});}
export async function ok(page,url,body,headers={},method){const r=await call(page,url,body,headers,method);assert.ok(r.status>=200&&r.status<300,url+': '+r.status+' '+(r.data?.error?.code??''));return r.data;}
export async function authenticate(browser,kind,email){
 const file=path.join(privateRoot,kind+'-state.private.json');
 let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(kind==='admin')saved=null;const c=await context(browser,saved?{storageState:saved}:{}),page=await c.newPage();
 const origin=kind==='admin'?ADMIN:WEB;for(let attempt=0;;attempt++){try{await page.goto(origin+(kind==='admin'?'/':'/login'),{waitUntil:'domcontentloaded',timeout:45000});break;}catch(e){if(attempt===2)throw e;}}
 const route=kind==='admin'?'/v1/admin/me':'/v1/session/context';
 if(saved){const r=await call(page,route);if(r.status===200)return {context:c,page,identity:r.data,csrf:r.data.csrf_token};}
 if(kind==='admin'){
  await page.getByLabel('Administrator email',{exact:true}).fill(secret.admin_email);
  const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/admin/auth/challenge'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send admin sign-in code',exact:true}).click()]);assert.equal(r.status(),200);
  const challenge=await r.json(),message=await mail(c,challenge.challenge_id);assert.equal(message.to,secret.admin_email);
  await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());
  await page.getByRole('button',{name:'Verify & open dashboard',exact:true}).click();await page.getByRole('button',{name:'Sign out admin',exact:true}).waitFor();
 }else{
  await page.getByLabel('Work email',{exact:true}).fill(email);
  const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/auth/challenges'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send sign-in code',exact:true}).click()]);assert.equal(r.status(),202);
  const challenge=await r.json(),message=await mail(c,challenge.challenge_id);assert.equal(message.to,email);
  await page.getByLabel('6-digit sign-in code',{exact:true}).fill(message.text.match(/code is (\d{6})/)[1]);
  const [session]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/auth/sessions'&&r.request().method()==='POST'),page.getByRole('button',{name:'Verify & continue',exact:true}).click()]);assert.equal(session.status(),201);
 }
 const identity=await ok(page,route);await writeFile(file,JSON.stringify(await c.storageState()),{mode:0o600});
 return {context:c,page,identity,csrf:identity.csrf_token};
}
export async function screenshot(page,target){await page.screenshot({path:target,animations:'disabled',mask:[page.locator('.user-chip strong'),page.locator('.workspace-switch select'),page.locator('.app-topbar>select')],maskColor:'#d7d8df'});}
