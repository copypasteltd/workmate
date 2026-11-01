import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve(".."), privateDir=path.resolve(".data/deployment-178"), id=randomUUID(), run=path.join(privateDir,"browser-"+id);
await mkdir(run,{recursive:true});
const secret=JSON.parse(await readFile(".data/deployment-178/qa-login-context.json","utf8"));
const ADMIN="https://agent-dashboard.copypaste.hk",API="https://ai-api.copypaste.hk",contexts=[],checks=[],media=[];
let browser,failure,stage="health";
const receipt={stage:178,at:new Date().toISOString(),run:path.basename(run),checks,media};
function totp(){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.admin_totp_secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",key).update(counter).digest(),offset=digest[19]&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");}
async function context(options={}){const c=await browser.newContext({viewport:{width:1440,height:1100},locale:"en-HK",...options});contexts.push(c);c.setDefaultTimeout(20000);await c.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});return c;}
async function navigate(page,url){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});}
  catch(e){console.log(JSON.stringify({navigation_attempt:attempt,url,error:e.message.split("\n")[0]}));if(attempt===3)throw e;}
 }
}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);const relative="assets/screenshots/178-"+name+"-"+id+".png",dest=path.join(root,"copypaste-admin",relative);await mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,animations:"disabled"});media.push({client:"admin",path:relative});}
const pass=name=>checks.push({name,status:"passed"});
try{
 const health=await fetch(API+"/health/ready",{headers:{"User-Agent":"Mozilla/5.0"}});assert.equal(health.status,200);assert.equal((await health.json()).model_connections,"per_model");pass("public API serves the per-model connection release");
 browser=await chromium.launch({executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:true,args:["--disable-quic","--no-proxy-server"]});
 let c=await context(),page=await c.newPage();stage="independent administrator MFA";await navigate(page,ADMIN);
 await page.getByLabel("Administrator email").fill(secret.admin_email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"&&r.request().method()==="POST"),page.getByRole("button",{name:"Send admin sign-in code",exact:true}).click()]);
 assert.equal(challenge.status(),200);const body=await challenge.json();
 const mail=await fetch(ADMIN+"/ops/mailbox/data/"+body.challenge_id+".json",{headers:{Authorization:"Basic "+Buffer.from(secret.operator_username+":"+secret.operator_password).toString("base64"),"User-Agent":"Mozilla/5.0"}});assert.equal(mail.status,200);
 const message=await mail.json();assert.equal(message.to,secret.admin_email);
 await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());
 await page.getByRole("button",{name:"Verify & open dashboard",exact:true}).click();await page.getByRole("button",{name:"Sign out admin",exact:true}).waitFor();
 const state=await c.storageState();await c.close();
 c=await context({storageState:state,recordVideo:{dir:path.join(run,"video"),size:{width:1440,height:1100}}});page=await c.newPage();
 stage="per-model form";await navigate(page,ADMIN+"/catalog?view=capabilities");await page.getByRole("button",{name:"Create configuration",exact:true}).click();
 let dialog=page.getByRole("dialog");await dialog.locator('input[name="model"]').fill("gpt-6-luna");
 await dialog.getByLabel("API Base URL",{exact:true}).fill("https://company-models.example/v1");
 await dialog.getByLabel("API Key",{exact:true}).fill("example-only-not-a-real-key");
 assert.equal(await dialog.getByLabel("API Key",{exact:true}).getAttribute("type"),"password");
 await dialog.getByLabel("API Base URL",{exact:true}).scrollIntoViewIfNeeded();await shot(page,"model-form");pass("new model form contains its own required URL and masked API Key");
 stage="save isolated unpublished configuration";
 const alias="workmate-connection-check-178-"+id.slice(0,8),fixtureKey="fixture-only-"+randomUUID();
 await dialog.locator('input[name="model"]').fill(alias);
 await dialog.getByLabel("API Base URL",{exact:true}).fill("https://workmate-connection-check.invalid/v1");
 await dialog.getByLabel("API Key",{exact:true}).fill(fixtureKey);
 await dialog.locator('input[name="input_rate"]').fill("0");await dialog.locator('input[name="output_rate"]').fill("0");
 await dialog.locator('textarea[name="reason"]').fill("Deployment178 verification: reserved invalid upstream and synthetic key; unpublished and never used by customer work.");
 const [saved]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/capability-releases/drafts"&&r.request().method()==="POST"),dialog.getByRole("button",{name:"Save configuration",exact:true}).click()]);
 assert.equal(saved.status(),202);const operation=await saved.json();receipt.unpublished_fixture_release=operation.result_ids[0];
 await page.getByRole("button",{name:"Test this model connection",exact:true}).waitFor();
 const detail=await page.request.get(ADMIN+"/v1/admin/capability-releases/"+receipt.unpublished_fixture_release),text=await detail.text();
 assert.equal(detail.status(),200);assert.ok(!text.includes(fixtureKey));const parsed=JSON.parse(text);assert.equal(parsed.document.upstream.key_configured,true);assert.equal(parsed.state,"draft");
 await shot(page,"saved-model");pass("public-domain save persists a model-bound URL and never returns its synthetic key; the fixture remains unpublished");
 stage="safe connection failure";
 const [tested]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/connection-test")&&r.request().method()==="POST"),page.getByRole("button",{name:"Test this model connection",exact:true}).click()]);
 assert.equal(tested.status(),200);const result=await tested.json();assert.equal(result.reachable,false);assert.equal(result.error_code,"MODEL_CONNECTION_FAILED");
 await page.getByText("Cannot connect to this model upstream. Check its URL, network and service status.",{exact:true}).waitFor();await shot(page,"connection-result");pass("reserved invalid upstream gives a controlled connection error without inference or default-provider fallback");
 receipt.video=await page.video().path();await c.close();receipt.status="passed";
}catch(e){failure=e;receipt.status="failed";receipt.failed_stage=stage;receipt.error=String(e.message);}
finally{for(const c of contexts)await c.close().catch(()=>{});await browser?.close();receipt.browser_closed=true;receipt.finished_at=new Date().toISOString();await writeFile(path.join(run,"receipt.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:receipt.status,stage,checks:checks.length,run,error:receipt.error}));}
if(failure)throw failure;
