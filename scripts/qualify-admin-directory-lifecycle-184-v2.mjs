import https from "node:https";
import {lookup} from "node:dns/promises";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve(".."), privateDir=path.resolve(".data/deployment-184"), id=randomUUID(), run=path.join(privateDir,"browser-"+id);
await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile(".data/deployment-179/qa-login-context.json","utf8"));
const ADMIN="https://agent-dashboard.copypaste.hk",API="https://ai-api.copypaste.hk",contexts=[],checks=[],media=[];
let browser,failure,stage="health";
const receipt={stage:184,at:new Date().toISOString(),run:path.basename(run),checks,media};
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
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);const relative="assets/screenshots/184-"+name+"-"+id+".png",dest=path.join(root,"copypaste-admin",relative);await mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,animations:"disabled"});media.push({client:"admin",path:relative});}
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
 const health=await safeGet(ADMIN+"/health/ready",{headers:{"User-Agent":"Mozilla/5.0"}});assert.equal(health.status,200);assert.equal((await health.json()).codex_tool_contract,"scoped_code_mode_v1");pass("public administrator proxy serves the deployed directory lifecycle");
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
 await navigate(page,ADMIN+"/users");
 const me=await(await uiGet(page,ADMIN+"/v1/admin/me")).json();assert.equal(me.highest_admin,true);
 pass("global highest role and current MFA recognized");
 const fixturePrefix="QA184-"+id.slice(0,8),users=[],tenants=[];receipt.artifact_version="ui-v2";receipt.fixture_prefix=fixturePrefix;receipt.users=users;receipt.tenants=tenants;
 async function submitPreview() {
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/directory/preview"&&r.request().method()==="POST"),page.getByRole("button",{name:"Preview impact",exact:true}).click()]);
  const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.approval,false);return body;
 }
 async function confirm() {
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/directory/commands"&&r.request().method()==="POST"),page.getByRole("button",{name:"Confirm",exact:true}).click()]);
  const body=await response.json();assert.equal(response.status(),202,JSON.stringify(body));assert.equal(body.state,"succeeded");
  receipt.operations??=[];receipt.operations.push({id:body.id,action:body.action,result:body.result});
  await page.getByRole("button",{name:"Done and refresh",exact:true}).click();return body;
 }
 stage="create two ordinary users";
 for(let i=1;i<=2;i++) {
  await page.getByRole("button",{name:"Create user",exact:true}).click();
  await page.getByLabel("Display name",{exact:true}).fill(fixturePrefix+" User "+i);
  await page.getByLabel("Email",{exact:true}).fill("qa184-"+id+"-"+i+"@example.invalid");
  await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA fixture: verify actual account lifecycle.");
  await submitPreview();if(i===1)await shot(page,"create-user-preview");
  const r=await confirm();users.push(r.result.items[0]);
 }
 const provenance=await(await uiGet(page,ADMIN+"/v1/admin/users?view=operations&limit=100&registration_source=admin&q="+encodeURIComponent(fixturePrefix))).json();assert.equal(provenance.items.length,2);
 pass("two ordinary accounts created through actual UI without invented email verification; admin-origin filter reads them");
 await page.getByRole("textbox",{name:/Search/i}).first().fill(fixturePrefix);
 await page.getByRole("checkbox",{name:"Select current page",exact:true}).check();
 await page.getByRole("button",{name:"Change statuses",exact:true}).click();
 await page.getByLabel("Target state",{exact:true}).selectOption("frozen");
 await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA: freeze the exact current-page selection.");
 const frozenPreview=await submitPreview();assert.equal(frozenPreview.command.targets.length,2);await shot(page,"users-bulk-preview");
 await confirm();
 pass("users current-page selection bulk-freezes two accounts atomically");
 await page.getByRole("checkbox",{name:"Select current page",exact:true}).check();
 await page.getByRole("button",{name:"Change statuses",exact:true}).click();
 await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA: reactivate both fixture owners.");await submitPreview();await confirm();
 pass("selected users reactivate with fresh server versions");
 stage="create two workspaces with explicit owner and project";
 await navigate(page,ADMIN+"/tenants");
 for(let i=1;i<=2;i++) {
  await page.getByRole("button",{name:"Create workspace",exact:true}).click();
  await page.getByLabel("Workspace name",{exact:true}).fill(fixturePrefix+" Workspace "+i);
  await page.getByLabel("Find owner",{exact:true}).fill(fixturePrefix+" User 1");
  await page.getByLabel("Owner",{exact:true}).selectOption(users[0].id);
  await page.getByLabel("First project name",{exact:true}).fill("QA-owned empty campaign");
  await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA fixture: verify workspace, owner, wallet and first project.");
  await submitPreview();if(i===1)await shot(page,"create-workspace-preview");
  const r=await confirm();tenants.push(r.result.items[0]);
 }
 pass("two workspaces, owner memberships, billing accounts and first projects created through actual UI");
 await page.getByRole("textbox",{name:/Search/i}).first().fill(fixturePrefix);
 await page.getByRole("checkbox",{name:"Select current page",exact:true}).check();
 await page.getByRole("button",{name:"Change statuses",exact:true}).click();
 await page.getByLabel("Target state",{exact:true}).selectOption("suspended");
 await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA: suspend both fixture workspaces.");await submitPreview();await confirm();
 pass("workspace list supports an explicit atomic bulk status change");
 stage="delete both owned workspaces";
 await page.getByRole("checkbox",{name:"Select current page",exact:true}).check();
 await page.getByRole("button",{name:"Delete selected",exact:true}).click();
 await page.getByLabel("Type DELETE 2",{exact:true}).fill("DELETE 2");
 await page.getByRole("checkbox",{name:"I checked the selection and understand permanent deletion and retention.",exact:true}).check();
 await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA cleanup: delete only the two QA-owned empty workspaces.");
 const deletionPreview=await submitPreview();assert.equal(deletionPreview.command.targets.length,2);await shot(page,"workspaces-delete-preview");
 const removed=await confirm();assert.ok(removed.result.items.every(x=>x.deletion_job_id));
 receipt.deletion_jobs=removed.result.items.map(x=>x.deletion_job_id);
 await page.getByRole("heading",{name:"No matching records yet",exact:true}).waitFor();
 pass("owned workspace bulk deletion fences admission and queues two distinct durable cleanup jobs");
 stage="delete both owned users after workspace fences";
 await navigate(page,ADMIN+"/users");await page.getByRole("textbox",{name:/Search/i}).first().fill(fixturePrefix);
 await page.getByRole("checkbox",{name:"Select current page",exact:true}).check();
 await page.getByRole("button",{name:"Delete selected",exact:true}).click();
 await page.getByLabel("Type DELETE 2",{exact:true}).fill("DELETE 2");
 await page.getByRole("checkbox",{name:"I checked the selection and understand permanent deletion and retention.",exact:true}).check();
 await page.getByLabel("Reason",{exact:true}).fill("Owned stage184 QA cleanup: delete only the two QA-created user identities.");
 await submitPreview();const deletedUsers=await confirm();assert.ok(deletedUsers.result.items.every(x=>x.state==="deleted"));
 pass("two owned user identities deleted and removed from the live directory");
 stage="server result and immutable audit readback";
 const userList=await(await uiGet(page,ADMIN+"/v1/admin/users?view=operations&limit=100&q="+encodeURIComponent(fixturePrefix))).json();assert.equal(userList.items.length,0);
 const tenantList=await(await uiGet(page,ADMIN+"/v1/admin/tenants?limit=100&q="+encodeURIComponent(fixturePrefix))).json();assert.equal(tenantList.items.length,0);
 const last=receipt.operations.at(-1);const audit=await(await uiGet(page,ADMIN+"/v1/admin/audit?limit=100&search="+last.id)).json();
 assert.ok(audit.items.some(x=>x.action==="admin.execution.direct"&&x.principal_id===me.user.id));
 pass("deleted fixtures absent from both directories and actual highest actor recorded in immutable audit");
 await navigate(page,ADMIN+"/content?cleanup_type=tenants");
 await page.getByRole("heading",{name:"Permanent deletion and cleanup",exact:true}).waitFor();await shot(page,"cleanup-journal");
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
