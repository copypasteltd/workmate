import assert from "node:assert/strict";
import {chromium,type Browser,type Page} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix="evidence/conversation-directory-156/ui-"+attempt,checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href),pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
let system:any,isolated:any,browser:Browser|undefined,recording:WorkmateRecording|undefined,stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false;
async function shot(page:Page,name:string){screenshots.push(await saveWorkmateScreenshot("web","conversation-directory-156-"+attempt,name,await page.screenshot(),"Actual Web private conversation directory beyond200 rows, pinned ordering, archives, search, original chat opening and session withdrawal. Native SQL/HTTP with synthetic business fixtures; no model execution.",delivery));}
async function stopRecording(){if(recording){const r=recording;recording=undefined;recordings.push(await r.stop());}}
try{
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{conversationDirectoryFixture,directoryOracle}]=await Promise.all([
  load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/conversation-directory-fixture-156-v1.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 await system.app.listen({host:"127.0.0.1",port:4310});const f=await conversationDirectoryFixture(system),normal=await directoryOracle(system,f),archived=await directoryOracle(system,f,true);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 stage="customer OTP";await page.goto("http://localhost:4317/login");await page.locator('input[name="email"]').fill(f.owner.email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.locator('form button[type="submit"]').click()]);assert.equal(challenge.status(),202);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('form button[type="submit"]').click();await page.waitForURL("**/app");
 await page.evaluate(({tenant,project})=>{localStorage.setItem("cp_tenant",tenant);localStorage.setItem("cp_project",project);},{tenant:f.tenant,project:f.project});pass("Customer email OTP opens the authorized private conversation project");
 await page.goto("http://localhost:4317/app/conversations");const rows=()=>page.locator(".conversation-list-item"),next=()=>page.getByRole("button",{name:"Next conversations",exact:true}),previous=()=>page.getByRole("button",{name:"Previous conversations",exact:true});
 await rows().first().waitFor();assert.equal(await rows().count(),40);await page.locator("h1").scrollIntoViewIfNeeded();
 recording=new WorkmateRecording("web","older-private-conversations","conversation-directory-156-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual private directory paging beyond200 same-name records and reopening the original empty conversation",delivery);await recording.start();await shot(page,"first-page");
 stage="browse beyond200";for(let n=2;n<=6;n++){await next().focus();await page.keyboard.press("Enter");await page.getByText("Page "+n,{exact:true}).waitFor();await rows().first().waitFor();}
 assert.equal(await rows().count(),36);await page.locator(`a[href="/app/conversations/${normal.at(-1)}"]`).waitFor();await page.locator("h1").scrollIntoViewIfNeeded();await shot(page,"last-page");
 await previous().click();await page.getByText("Page 5",{exact:true}).waitFor();await next().click();await page.getByText("Page 6",{exact:true}).waitFor();await page.locator(`a[href="/app/conversations/${normal.at(-1)}"]`).click();await page.waitForURL("**/conversations/"+normal.at(-1));await page.getByRole("heading",{level:1,name:"Campaign discussion",exact:true}).waitFor();await shot(page,"old-chat-open");await stopRecording();pass("Keyboard and previous/next paging reach all236 records and reopen an old empty same-name conversation beyond the former200-row cap");
 stage="archive and search";await page.goto("http://localhost:4317/app/conversations");await rows().first().waitFor();await page.getByLabel("Archived",{exact:true}).check();await rows().first().waitFor();
 recording=new WorkmateRecording("web","archive-search-and-withdrawal","conversation-directory-156-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual archived directory beyond200 rows, filter reset, compact Chinese view and current-session withdrawal",delivery);await recording.start();
 for(let n=2;n<=6;n++){await next().click();await page.getByText("Page "+n,{exact:true}).waitFor();await rows().first().waitFor();}
 assert.equal(await rows().count(),7);await page.locator(`a[href="/app/conversations/${archived.at(-1)}"]`).waitFor();await page.locator("h1").scrollIntoViewIfNeeded();await shot(page,"archived-last-page");
 await page.getByLabel("Archived",{exact:true}).uncheck();await page.getByPlaceholder("Search conversations…",{exact:true}).fill(f.conversation.name);await page.locator(`a[href="/app/conversations/${f.conversation.id}"]`).waitFor();await page.getByText("Page 1",{exact:true}).waitFor();assert.equal(await rows().count(),1);assert.equal(await next().isDisabled(),true);await shot(page,"search-reset");pass("All207 archived same-name records are browsable; changing search/archive resets the cursor and finds the original unique conversation");
 stage="compact Chinese directory";await page.evaluate(()=>localStorage.setItem("cp_locale","zh-HK"));await page.reload();await rows().first().waitFor();await page.setViewportSize({width:390,height:900});await page.locator("h1").scrollIntoViewIfNeeded();
 const layout=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));layouts.push(layout);assert.ok(layout.document<=layout.width&&layout.body<=layout.width);await shot(page,"compact-zh");pass("Chinese directory and pagination remain usable at390px without horizontal overflow");
 stage="current session withdrawal";await system.db.control.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND audience='user'",[f.owner.id]);await page.getByRole("button",{name:"下一頁會話",exact:true}).click();await page.waitForURL("**/login");assert.equal(await rows().count(),0);await shot(page,"withdrawn-signin");await stopRecording();pass("Revoking the current session denies the next page and clears the private directory before sign-in");
 assert.equal(checks.length,5);
}catch(e){errors.push(stage+": "+String(e));}
finally{
 try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
 if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
 if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
 if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
 process.chdir(delivery);const status=errors.length===0&&checks.length===5&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
 await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,scope:"Actual Web browser, OTP and SQL/HTTP. Synthetic private conversation fixtures. Extension actual HTTP controller is covered by backend checks; Extension and Desktop renderer builds only, no new installed/native-window acceptance. Live keyset directory, not a frozen full-list snapshot. No model execution. Frozen packages unchanged."},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
