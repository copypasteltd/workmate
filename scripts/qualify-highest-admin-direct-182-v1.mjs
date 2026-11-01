import https from "node:https";
import {lookup} from "node:dns/promises";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve(".."), privateDir=path.resolve(".data/deployment-182"), id=randomUUID(), run=path.join(privateDir,"browser-"+id);
await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile(".data/deployment-179/qa-login-context.json","utf8"));
const ADMIN="https://agent-dashboard.copypaste.hk",API="https://ai-api.copypaste.hk",contexts=[],checks=[],media=[];
let browser,failure,stage="health";
const receipt={stage:182,at:new Date().toISOString(),run:path.basename(run),checks,media};
function totp(){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.admin_totp_secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",key).update(counter).digest(),offset=digest[19]&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");}
async function context(options={}){const c=await browser.newContext({viewport:{width:1440,height:1100},locale:"en-HK",...options});contexts.push(c);c.setDefaultTimeout(20000);await c.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});return c;}
async function safeGet(url,options={}){
 for(let attempt=1;attempt<=4;attempt++){
  try{const response=await pinnedRead(url,options);const body=await response.arrayBuffer();return new Response(body,{status:response.status,headers:response.headers});}
  catch(e){console.log(JSON.stringify({get_attempt:attempt,url,error:e.message}));if(attempt===4)throw e;}
 }
}
async function navigate(page,url){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});}
  catch(e){console.log(JSON.stringify({navigation_attempt:attempt,url,error:e.message.split("\n")[0]}));if(attempt===3)throw e;}
 }
}
async function uiGet(page, url) {
 for(let attempt=1;attempt<=3;attempt++) {
  const result=await page.evaluate(async url=>{
   try {const r=await fetch(url,{credentials:"include",signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};}
   catch(e){return {error:e.message};}
  },url);
  if(!result.error)return {status:()=>result.status,json:async()=>result.data};
  console.log(JSON.stringify({browser_read_attempt:attempt,error:result.error}));
  if(attempt===3)throw new Error("Browser read failed after three bounded attempts");
 }
}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);const relative="assets/screenshots/182-"+name+"-"+id+".png",dest=path.join(root,"copypaste-admin",relative);await mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,animations:"disabled"});media.push({client:"admin",path:relative});}
const PUBLIC_ADDRESS="172.67.180.165";
const dnsAddresses=await lookup(new URL(ADMIN).hostname,{all:true});
assert.ok(dnsAddresses.some(r=>r.address===PUBLIC_ADDRESS),"Selected address must be in the current public DNS answer");
receipt.network={public_host:new URL(ADMIN).hostname,selected_dns_address:PUBLIC_ADDRESS,reason:"Other advertised IPv4 route timed out from this workstation",tls_verification:true,api_responses_mocked:false};
async function pinnedRead(url,options={}) {
 return await new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:options.headers,family:4,lookup:(host,settings,done)=>{
   assert.equal(host,new URL(ADMIN).hostname);
   if(settings?.all)done(null,[{address:PUBLIC_ADDRESS,family:4}]);else done(null,PUBLIC_ADDRESS,4);
  },signal:AbortSignal.timeout(18000)},response=>{
   const chunks=[];let bytes=0;
   response.on("data",chunk=>{bytes+=chunk.length;if(bytes>2000000)request.destroy(new Error("Bounded public read exceeded"));else chunks.push(chunk);});
   response.on("end",()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));response.on("error",reject);
  });request.on("error",reject);
 });
}
const pass=name=>checks.push({name,status:"passed"});
try{
 const health=await safeGet(ADMIN+"/health/ready",{headers:{"User-Agent":"Mozilla/5.0"}});assert.equal(health.status,200);assert.equal((await health.json()).codex_tool_contract,"scoped_code_mode_v1");pass("public administrator proxy serves editable model management");
 browser=await chromium.launch({executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:true,args:["--disable-quic","--no-proxy-server","--host-resolver-rules=MAP agent-dashboard.copypaste.hk "+PUBLIC_ADDRESS]});
 let c=await context(),page=await c.newPage();stage="highest administrator MFA";await navigate(page,ADMIN);
 await page.getByLabel("Administrator email").fill(secret.admin_email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"&&r.request().method()==="POST"),page.getByRole("button",{name:"Send admin sign-in code",exact:true}).click()]);
 assert.equal(challenge.status(),200);const body=await challenge.json();
 const mail=await safeGet(ADMIN+"/ops/mailbox/data/"+body.challenge_id+".json",{headers:{Authorization:"Basic "+Buffer.from(secret.operator_username+":"+secret.operator_password).toString("base64"),"User-Agent":"Mozilla/5.0"}});assert.equal(mail.status,200);
 const message=await mail.json();assert.equal(message.to,secret.admin_email);
 await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());
 await page.getByRole("button",{name:"Verify & open dashboard",exact:true}).click();await page.getByRole("button",{name:"Sign out admin",exact:true}).waitFor();
 const state=await c.storageState();await c.close();
 c=await context({storageState:state,recordVideo:{dir:path.join(run,"video"),size:{width:1440,height:1100}}});page=await c.newPage();

 stage="highest role identity";
 const me=await(await uiGet(page,ADMIN+"/v1/admin/me")).json();assert.equal(me.highest_admin,true);receipt.admin_id=me.user.id;
 pass("current administrator is recognized as an active global built-in super administrator");
 await navigate(page,ADMIN+"/catalog?view=capabilities");
 const listing=await(await uiGet(page,ADMIN+"/v1/admin/capability-releases?view=active&limit=100")).json();
 const current=listing.items.filter(x=>x.document.model_alias==="gpt-6-luna");assert.equal(current.length,1);
 const model=current[0];receipt.release_id=model.id;receipt.model_before={id:model.id,state:model.state,version:model.version,management_revision:model.management_revision,validation_id:model.validation_id,definition_hash:model.definition_hash};
 assert.equal(model.state,"validated","The current model must retain its original qualified unpublished configuration");
 stage="publication preview";
 await page.locator('[data-release-id="'+model.id+'"]').getByRole("button",{name:"Preview publication",exact:true}).click();
 await page.getByLabel("Operation reason",{exact:true}).fill("Stage182: publish the existing qualified gpt-6-luna as the highest administrator, retaining audit.");
 const [previewed]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/publications-previews")&&r.request().method()==="POST"),page.getByRole("button",{name:"Compare configurations",exact:true}).click()]);
 assert.equal(previewed.status(),200);const preview=await previewed.json();receipt.preview=preview;assert.equal(preview.decision,"super_admin_direct");
 await page.getByRole("button",{name:"Confirm direct execution",exact:true}).waitFor();
 pass("real production publication preview offers highest-administrator direct execution");
 await shot(page,"direct-preview");
 stage="direct publication";
 await page.getByRole("checkbox").check();
 const [published]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/publications")&&r.request().method()==="POST"),page.getByRole("button",{name:"Confirm direct execution",exact:true}).click()]);
 assert.equal(published.status(),202);const op=await published.json();receipt.operation=op;assert.equal(op.state,"succeeded");
 await page.getByRole("heading",{name:"Configuration applied and audited",exact:true}).waitFor();await shot(page,"direct-published");
 pass("highest administrator publishes the original saved qualified model immediately without pending approval");
 const detail=await(await uiGet(page,ADMIN+"/v1/admin/capability-releases/"+model.id)).json();
 assert.equal(detail.state,"published");assert.equal(detail.version,model.version);assert.equal(detail.definition_hash,model.definition_hash);assert.equal(detail.validation_id,model.validation_id);
 pass("publication retains the exact original model version, API configuration and validation");
 stage="immutable audit";
 const audit=await(await uiGet(page,ADMIN+"/v1/admin/audit?limit=100&search="+encodeURIComponent(op.id))).json();
 const fact=audit.items.find(x=>x.action==="admin.execution.direct"&&x.target===op.id);assert.ok(fact);assert.equal(fact.principal_id,me.user.id);assert.equal(fact.detail.execution_mode,"super_admin_direct");
 receipt.audit={id:fact.id,principal_id:fact.principal_id,action:fact.action,target:fact.target,outcome:fact.outcome,detail:fact.detail,created_at:fact.created_at};
 pass("production immutable audit identifies the actual highest administrator, original command, reason and result");
 await page.getByRole("link",{name:"View audit",exact:true}).click();await page.getByText("admin.execution.direct",{exact:true}).first().waitFor();await shot(page,"direct-audit");
 receipt.video=await page.video().path();
}catch(e){failure=e;receipt.failure={stage,type:e.name,message:e.message.split("\n")[0]};}
finally{
 for(const c of contexts.reverse())await c.close().catch(()=>{});
 if(browser)await browser.close().catch(()=>{});
 receipt.browser_closed=true;receipt.status=failure?"failed":"passed";receipt.finished_at=new Date().toISOString();
 await writeFile(path.join(run,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
 console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,"receipt.json"),failure:receipt.failure}));
}
if(failure)process.exitCode=1;
