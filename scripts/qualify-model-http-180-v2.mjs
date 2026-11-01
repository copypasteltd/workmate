import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve(".."), privateDir=path.resolve(".data/deployment-180"), id=randomUUID(), run=path.join(privateDir,"browser-"+id);
await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile(".data/deployment-179/qa-login-context.json","utf8"));
const ADMIN="https://agent-dashboard.copypaste.hk",API="https://ai-api.copypaste.hk",contexts=[],checks=[],media=[];
let browser,failure,stage="health";
const receipt={stage:180,at:new Date().toISOString(),run:path.basename(run),checks,media};
function totp(){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.admin_totp_secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",key).update(counter).digest(),offset=digest[19]&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");}
async function context(options={}){const c=await browser.newContext({viewport:{width:1440,height:1100},locale:"en-HK",...options});contexts.push(c);c.setDefaultTimeout(20000);await c.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});return c;}
async function safeGet(url,options={}){
 for(let attempt=1;attempt<=4;attempt++){
  try{const response=await fetch(url,{...options,signal:AbortSignal.timeout(18000)});const body=await response.arrayBuffer();return new Response(body,{status:response.status,headers:response.headers});}
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
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);const relative="assets/screenshots/180-"+name+"-"+id+".png",dest=path.join(root,"copypaste-admin",relative);await mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,animations:"disabled"});media.push({client:"admin",path:relative});}
const pass=name=>checks.push({name,status:"passed"});
try{
 const health=await safeGet(ADMIN+"/health/ready",{headers:{"User-Agent":"Mozilla/5.0"}});assert.equal(health.status,200);assert.equal((await health.json()).model_transport,"http_and_https");pass("public administrator proxy serves editable model management");
 browser=await chromium.launch({executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:true,args:["--disable-quic","--no-proxy-server"]});
 let c=await context(),page=await c.newPage();stage="independent administrator MFA";await navigate(page,ADMIN);
 await page.getByLabel("Administrator email").fill(secret.admin_email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"&&r.request().method()==="POST"),page.getByRole("button",{name:"Send admin sign-in code",exact:true}).click()]);
 assert.equal(challenge.status(),200);const body=await challenge.json();
 const mail=await safeGet(ADMIN+"/ops/mailbox/data/"+body.challenge_id+".json",{headers:{Authorization:"Basic "+Buffer.from(secret.operator_username+":"+secret.operator_password).toString("base64"),"User-Agent":"Mozilla/5.0"}});assert.equal(mail.status,200);
 const message=await mail.json();assert.equal(message.to,secret.admin_email);
 await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());
 await page.getByRole("button",{name:"Verify & open dashboard",exact:true}).click();await page.getByRole("button",{name:"Sign out admin",exact:true}).waitFor();
 const state=await c.storageState();await c.close();
 c=await context({storageState:state,recordVideo:{dir:path.join(run,"video"),size:{width:1440,height:1100}}});page=await c.newPage();
 stage="check current gpt-6-luna";
 await navigate(page,ADMIN+"/catalog?view=capabilities");
 const listed=await uiGet(page,ADMIN+"/v1/admin/capability-releases?view=active&limit=100");
 assert.equal(listed.status(),200);const listing=await listed.json();
 const current=listing.items.filter(x=>x.document.model_alias==="gpt-6-luna");
 assert.equal(current.length,1,"Expected one current gpt-6-luna entry");
 const model=current[0];receipt.release_id=model.id;receipt.model_alias=model.document.model_alias;
 receipt.base_url=model.document.upstream.base_url;
 assert.ok(receipt.base_url.startsWith("http:"));
 await page.locator('[data-release-id="'+model.id+'"]').getByRole("button",{name:"Configuration & validation",exact:true}).click();
 await page.getByRole("button",{name:"Test this model connection",exact:true}).waitFor();
 await shot(page,"http-model-before-check");
 const [checked]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/connection-test")&&r.request().method()==="POST"),page.getByRole("button",{name:"Test this model connection",exact:true}).click()]);
 assert.equal(checked.status(),200);const result=await checked.json();receipt.connection_result=result;
 assert.equal(result.reachable,true);assert.equal(result.model_available,true);
 pass("current gpt-6-luna public HTTP connection authenticates and lists the requested model");
 await page.getByText("Connection and key work; the model is listed.",{exact:true}).waitFor();
 await shot(page,"http-model-connected");
 const detail=await(await uiGet(page,ADMIN+"/v1/admin/capability-releases/"+model.id)).json();
 assert.equal(detail.version,model.version);assert.equal(detail.management_revision,model.management_revision);
 assert.equal(detail.document.upstream.base_url,receipt.base_url);
 pass("connection test preserves the current configuration, key binding and publication state");
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
