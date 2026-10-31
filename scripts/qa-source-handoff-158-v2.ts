import assert from "node:assert/strict";
import {chromium,type Browser} from "playwright";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";
const [fresh,attempt]=process.argv.slice(2);assert.ok(path.isAbsolute(fresh));assert.match(attempt,/^\d{2}$/);
const delivery=process.cwd(),base="evidence/source-handoff-158/ui-"+attempt;await mkdir("evidence/source-handoff-158",{recursive:true});
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[];let stage="login",browser:Browser|undefined,recording:WorkmateRecording|undefined,browserClosed=false,taskId:string|null=null,download:any=null;
const pass=(s:string)=>{checks.push(s);console.log("PASS "+s);};
async function stopRecording(){if(recording){const r=recording;recording=undefined;recordings.push(await r.stop());}}
try{
 browser=await chromium.launch({executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});const page=await context.newPage();page.setDefaultTimeout(25000);page.on("pageerror",e=>errors.push(e.message));
 const get=async(url:string)=>page.evaluate(async u=>{const r=await fetch(u);if(!r.ok)throw new Error(u+": "+r.status);return r.json();},url);
 const shot=async(name:string)=>screenshots.push(await saveWorkmateScreenshot("web","source-handoff-158-"+attempt,name,await page.screenshot(),"Actual unpacked source startup, fresh email OTP, simulated workspace and real pinned Codex using synthetic model data",delivery));
 await page.goto("http://localhost:4317/login");const email="source158-"+randomUUID()+"@example.invalid";await page.locator('input[name="email"]').fill(email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.locator('form button[type="submit"]').click()]);assert.equal(challenge.status(),202);
 const id=(await challenge.json()).challenge_id;const mail=JSON.parse(await readFile(path.join(fresh,"dev/copypaste-platform/.data/mailbox",id+".json"),"utf8"));assert.equal(mail.to,email);await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('form button[type="submit"]').click();await page.waitForURL("**/welcome");
 await page.locator('input[name="name"]').fill("Source158 simulated studio");await page.locator('input[name="project_name"]').fill("First source delivery");await page.locator('form button[type="submit"]').click();await page.waitForURL("**/app");
 await page.getByRole("button",{name:"Add one-time demo credit",exact:true}).click();await page.getByRole("button",{name:"Demo credit added",exact:true}).waitFor();await shot("first-workspace");pass("Fresh source customer completes actual OTP, isolated simulated workspace/project and one-time synthetic credit");
 const me=await get("/v1/session/context"),tenant=me.memberships[0].id,project=(await get(`/v1/tenants/${tenant}/projects`)).items[0].id,scope=`/v1/tenants/${tenant}/projects/${project}`;
 stage="first real Codex task";await page.getByRole("button",{name:"Create campaign visuals",exact:false}).click();const modal=page.getByRole("dialog");await modal.waitFor();await modal.locator('select[name="role"]').selectOption("assistant");assert.equal(await modal.locator('select[name="role"]').inputValue(),"assistant");await modal.getByLabel("Task name",{exact:true}).fill("First source campaign plan");await modal.getByLabel("What would you like to make?",{exact:true}).fill("Prepare a written campaign plan from explicitly simulated product facts. Deliver an editable Markdown file.");await modal.getByLabel("Task budget limit (HKD)",{exact:true}).fill("1");await shot("first-task-brief");
 recording=new WorkmateRecording("web","first-source-task","source-handoff-158-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual first source task: real pinned Codex and synthetic company-gateway substitute; no live model request",delivery);await recording.start();
 const [accepted]=await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith("/delegations")),modal.getByRole("button",{name:"Start task",exact:true}).click()]);assert.equal(accepted.status(),200,await accepted.text());const first=await accepted.json();taskId=first.task.id;await page.waitForURL("**/app/conversations/"+first.conversation.id);
 const deadline=Date.now()+120000;let task:any;while(Date.now()<deadline){task=await get(scope+"/tasks/"+taskId);if(["succeeded","failed","cancelled","reconciling"].includes(task.status))break;await new Promise(r=>setTimeout(r,300));}
 assert.equal(task?.status,"succeeded",JSON.stringify({status:task?.status,error:task?.error_code}));assert.equal(task.private_owner,me.user.id);assert.equal(task.role_key,"assistant");pass("Real pinned native Codex executes the first cloud task using only loopback synthetic model data");
 stage="private file download";const assets=(await get(scope+"/assets")).items,file=assets.find((f:any)=>f.name==="demo-report.md");assert.ok(file);const text=await page.evaluate(async u=>{const r=await fetch(u);if(!r.ok)throw new Error("Download "+r.status);return r.text();},scope+"/assets/"+file.id+"/download");assert.match(text,/Simulated deliverable/);download={name:file.name,bytes:Buffer.byteLength(text),sha256:createHash("sha256").update(text).digest("hex")};
 await page.getByRole("heading",{name:"First source campaign plan",exact:true}).waitFor();await page.locator(".message-assistant").filter({hasText:"Simulated data"}).waitFor();await shot("first-task-delivered");await stopRecording();pass("The actual private Markdown delivery is visible and downloadable with matching synthetic labeling");
 const tasks=(await get(scope+"/tasks")).items;assert.equal(tasks.length,1);assert.equal(tasks[0].status,"succeeded");pass("The fresh workspace contains exactly the one completed task submitted by this user");
}catch(e){errors.push(stage+": "+String(e));}
finally{
 try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("close: "+String(e));}
 const status=errors.length===0&&checks.length===4&&browserClosed?"passed":"failed";
 await writeFile(base+".json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,browser_closed:browserClosed,task_id:taskId,download,scope:"Actual first-use browser on independently unpacked source with npm-ci dependencies, native database, real Codex and synthetic dependencies. No live model/media/ads/payment or new installed Desktop/Extension acceptance. Broad historical regression skipped under fast-release instruction."},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
