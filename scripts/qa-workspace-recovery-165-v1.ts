import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const f=JSON.parse(await readFile(process.argv[2],"utf8")), root=process.cwd();
const pg=createRequire(path.resolve("../copypaste-platform/package.json"))("pg"),sql=new pg.Client({connectionString:f.database_url});
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[];
let browser:Browser|undefined,recording:WorkmateRecording|undefined,closed=false;
const source="Actual Web OTP, original SQL creation commit with deliberately dropped HTTP reply, page reload and live receipt recovery; synthetic workspace names, no external provider or native UI claim.";
const count=async()=> (await sql.query("SELECT count(*) AS n FROM memberships WHERE user_id=$1 AND role='owner'",[f.user.id])).rows[0].n;
try{
 await sql.connect(); assert.equal(await count(),"0");
 browser=await chromium.launch({executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on("pageerror",e=>errors.push(e.message));
 const shot=async(name:string)=>screenshots.push(await saveWorkmateScreenshot("web","functional-closure-165-01",name,await page.screenshot(),source,root));
 await page.goto("http://localhost:4317/login");await page.locator('input[name="email"]').fill(f.user.email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.getByRole("button",{name:"Send sign-in code",exact:true}).click()]);assert.equal(challenge.status(),202);
 const mail=JSON.parse(await readFile(path.join(f.mailbox,(await challenge.json()).challenge_id+".json"),"utf8"));await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.getByRole("button",{name:"Verify & continue",exact:true}).click();await page.waitForURL("**/welcome");
 checks.push("Fresh real email OTP reaches the initial workspace form with no existing workspace");
 let posted=0,key="";await page.route("**/v1/tenants",async route=>{
  if(route.request().method()!=="POST")return route.continue();posted++;key=route.request().headers()["idempotency-key"];
  const response=await route.fetch();assert.equal(response.status(),200);assert.equal(await count(),"1");await route.abort("failed");
 });
 await page.locator('input[name="name"]').fill("Harbour Recovery Studio");await page.locator('input[name="project_name"]').fill("Original autumn campaign");
 recording=new WorkmateRecording("web","recover-original-workspace","functional-closure-165-01",()=>page.screenshot({type:"jpeg",quality:72}),source,root);await recording.start();
 await page.getByRole("button",{name:"Create workspace & continue",exact:true}).click();await page.getByRole("alert").waitFor();assert.equal(posted,1);assert.ok(key);
 assert.equal(await page.locator('input[name="name"]').getAttribute("readonly"),"");await shot("creation-reply-lost");
 await page.reload();await page.getByRole("button",{name:"Check & continue",exact:true}).waitFor();assert.equal(await page.locator('input[name="name"]').inputValue(),"Harbour Recovery Studio");
 const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/workspace-creation-requests/"+key);
 await page.getByRole("button",{name:"Check & continue",exact:true}).click();assert.equal((await receipt).status(),200);await page.locator(".app-shell").waitFor();
 assert.equal(await count(),"1");assert.equal(posted,1);await shot("original-workspace-recovered");
 if(recording){recordings.push(await recording.stop());recording=undefined;}
 const facts=(await sql.query("SELECT (SELECT count(*) FROM projects WHERE tenant_id IN(SELECT tenant_id FROM memberships WHERE user_id=$1)) AS projects,(SELECT count(*) FROM wallets WHERE tenant_id IN(SELECT tenant_id FROM memberships WHERE user_id=$1)) AS wallets,(SELECT count(*) FROM request_replays WHERE actor_id=$1 AND action='tenant.create') AS receipts",[f.user.id])).rows[0];assert.deepEqual(facts,{projects:"1",wallets:"1",receipts:"1"});
 checks.push("A real committed creation with its HTTP reply dropped survives reload and recovers the same workspace, first project and wallet without another POST");
 await page.goto("http://localhost:4317/welcome");await page.getByRole("button",{name:"Create workspace & continue",exact:true}).waitFor();assert.equal(await page.locator('input[name="name"]').inputValue(),"");assert.equal(await count(),"1");
 checks.push("After confirmed completion, intentional Create workspace remains available without automatically repeating the original operation");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await context.close();
}catch(e){errors.push(String(e));}finally{
 try{if(recording)recordings.push(await recording.stop());}catch(e){errors.push(String(e));}
 if(browser){try{await browser.close();closed=true;}catch(e){errors.push(String(e));}}await sql.end();await mkdir("evidence/functional-closure-165",{recursive:true});
 const status=!errors.length&&checks.length===3&&closed?"passed":"failed";
 await writeFile("evidence/functional-closure-165/workspace-ui-01.json",JSON.stringify({at:new Date().toISOString(),status,checks,errors,screenshots,recordings,browser_closed:closed,verifier_sha256:createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),scope:source},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
