import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve(".."), privateDir=path.resolve(".data/deployment-179"), id=randomUUID(), run=path.join(privateDir,"browser-"+id);
await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile(".data/deployment-179/qa-login-context.json","utf8"));
const ADMIN="https://agent-dashboard.copypaste.hk",API="https://ai-api.copypaste.hk",contexts=[],checks=[],media=[];
let browser,failure,stage="health";
const receipt={stage:179,at:new Date().toISOString(),run:path.basename(run),checks,media};
function totp(){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.admin_totp_secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",key).update(counter).digest(),offset=digest[19]&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");}
async function context(options={}){const c=await browser.newContext({viewport:{width:1440,height:1100},locale:"en-HK",...options});contexts.push(c);c.setDefaultTimeout(20000);await c.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});return c;}
async function safeGet(url,options={}){
 for(let attempt=1;attempt<=4;attempt++){
  try{return await fetch(url,{...options,signal:AbortSignal.timeout(18000)});}
  catch(e){console.log(JSON.stringify({get_attempt:attempt,url,error:e.message}));if(attempt===4)throw e;}
 }
}
async function navigate(page,url){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});}
  catch(e){console.log(JSON.stringify({navigation_attempt:attempt,url,error:e.message.split("\n")[0]}));if(attempt===3)throw e;}
 }
}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);const relative="assets/screenshots/179-"+name+"-"+id+".png",dest=path.join(root,"copypaste-admin",relative);await mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,animations:"disabled"});media.push({client:"admin",path:relative});}
const pass=name=>checks.push({name,status:"passed"});
try{
 const health=await safeGet(API+"/health/ready",{headers:{"User-Agent":"Mozilla/5.0"}});assert.equal(health.status,200);assert.equal((await health.json()).model_management,"editable");pass("public API serves the per-model connection release");
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
 stage="seed disposable model";await navigate(page,ADMIN+"/catalog?view=capabilities");
 await page.getByRole("button",{name:"Create configuration",exact:true}).click();
 let dialog=page.getByRole("dialog"),alias="workmate-edit-delete-179-"+id.slice(0,8);
 await dialog.locator('input[name="model"]').fill(alias);
 await dialog.getByLabel("API Base URL",{exact:true}).fill("https://model-before.example/v1");
 await dialog.getByLabel("API Key",{exact:true}).fill("fixture-only-before-"+id);
 await dialog.locator('input[name="input_rate"]').fill("0");await dialog.locator('input[name="output_rate"]').fill("0");
 await dialog.locator('textarea[name="reason"]').fill("Deployment179 disposable verification model. No real key, no publication and no inference.");
 const [seeded]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname=== "/v1/admin/capability-releases/drafts"&&r.request().method()==="POST"),dialog.getByRole("button",{name:"Save configuration",exact:true}).click()]);
 assert.equal(seeded.status(),202);const seed=await seeded.json(),oldId=seed.result_ids[0];receipt.original_fixture_release=oldId;
 await page.getByRole("button",{name:"Test this model connection",exact:true}).waitFor();
 const before=await (await page.request.get(ADMIN+"/v1/admin/capability-releases/"+oldId)).json();
 await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
 stage="edit existing model";
 await page.locator('[data-release-id="'+oldId+'"]').getByRole("button",{name:"Edit model",exact:true}).click();dialog=page.getByRole("dialog");
 assert.equal(await dialog.getByLabel("API Base URL",{exact:true}).inputValue(),"https://model-before.example/v1");
 assert.equal(await dialog.getByLabel("API Key",{exact:true}).isEnabled(),true);
 assert.equal(await dialog.getByLabel("API Key",{exact:true}).getAttribute("type"),"password");
 const changedKey="fixture-only-after-"+id;
 await dialog.getByLabel("API Base URL",{exact:true}).fill("https://model-after.example/v1");
 await dialog.getByLabel("API Key",{exact:true}).fill(changedKey);
 await dialog.locator('textarea[name="reason"]').fill("Deployment179 verification edits this disposable model's URL and key. No real supplier or customer configuration.");
 await dialog.getByLabel("API Base URL",{exact:true}).scrollIntoViewIfNeeded();await shot(page,"edit-model");
 pass("existing model has a direct Edit model action and an enabled masked key field");
 stage="save model changes";
 const [edited]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/edits")&&r.request().method()==="POST"),dialog.getByRole("button",{name:"Save changes",exact:true}).click()]);
 assert.equal(edited.status(),202);const changed=await edited.json(),newId=changed.result_ids[0];receipt.edited_fixture_release=newId;
 await page.getByRole("button",{name:"Test this model connection",exact:true}).waitFor();
 const result=await page.request.get(ADMIN+"/v1/admin/capability-releases/"+newId),raw=await result.text(),after=JSON.parse(raw);
 assert.equal(result.status(),200);assert.equal(after.model_id,before.model_id);assert.equal(after.document.upstream.base_url,"https://model-after.example/v1");assert.equal(after.management_revision,2);assert.ok(!raw.includes(changedKey));
 const original=await(await page.request.get(ADMIN+"/v1/admin/capability-releases/"+oldId)).json();assert.equal(original.document.upstream.base_url,"https://model-before.example/v1");assert.equal(original.is_current,false);
 await shot(page,"saved-edit");await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
 await page.locator('[data-release-id="'+newId+'"]').waitFor();assert.equal(await page.locator('[data-release-id="'+oldId+'"]').count(),0);
 pass("save changes replaces the current list entry; original configuration and encrypted key history stay separate");
 stage="delete model";
 await page.locator('[data-release-id="'+newId+'"]').getByRole("button",{name:"Delete model",exact:true}).click();dialog=page.getByRole("dialog");
 await dialog.getByLabel("Confirm deletion of this model",{exact:true}).check();
 const [removed]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/deletions")&&r.request().method()==="POST"),dialog.getByRole("button",{name:"Confirm deletion",exact:true}).click()]);
 assert.equal(removed.status(),202);await page.locator('[data-release-id="'+newId+'"]').waitFor({state:"detached"});
 pass("confirmed deletion removes the model from the current list");
 await page.getByLabel("Model list view",{exact:true}).selectOption("deleted");const card=page.locator('[data-release-id="'+newId+'"]');await card.waitFor();
 assert.equal(await card.getByRole("button",{name:"Edit model",exact:true}).count(),0);assert.equal(await card.getByRole("button",{name:"Delete model",exact:true}).count(),0);
 for(const modelId of [oldId,newId]){const deleted=await(await page.request.get(ADMIN+"/v1/admin/capability-releases/"+modelId)).json();assert.equal(deleted.state,"deleted");}
 await shot(page,"deleted-model");pass("deleted model history remains read-only; the entire model family is marked deleted");
 receipt.video=await page.video().path();await c.close();receipt.status="passed";
}catch(e){failure=e;receipt.status="failed";receipt.failed_stage=stage;receipt.error=String(e.message);}
finally{for(const c of contexts)await c.close().catch(()=>{});await browser?.close();receipt.browser_closed=true;receipt.finished_at=new Date().toISOString();await writeFile(path.join(run,"receipt.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:receipt.status,stage,checks:checks.length,run,error:receipt.error}));}
if(failure)throw failure;
