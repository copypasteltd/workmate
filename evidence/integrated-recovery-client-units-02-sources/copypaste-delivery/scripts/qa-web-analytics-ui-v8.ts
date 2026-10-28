import assert from "node:assert/strict";
import { _electron, chromium, type ElectronApplication, type Browser, type Page } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2]; assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,"evidence/web-analytics-ui-"+attempt),owned=path.resolve(".data/web-analytics-ui",randomUUID());
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],exports:any[]=[],layouts:any[]=[];
let isolated:any,system:any,electron:ElectronApplication|undefined,browser:Browser|undefined,recording:WorkmateRecording|undefined;
let diagnosticPage:Page|undefined;
let electronClosed=false,browserClosed=false,apiClosed=false,fixtureClosed=false,modelCalls=0;
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function readableMetrics(page:Page,label:string){
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 const observed=await page.evaluate(()=>({width:innerWidth,height:innerHeight,
  values:Array.from(document.querySelectorAll<HTMLElement>(".web-analysis-metric strong")).map(element=>{
   const range=document.createRange();range.selectNodeContents(element);
   const rects=Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0);
   return {text:element.textContent,lines:rects.length,available:element.clientWidth,
    text_width:Math.max(0,...rects.map(rect=>rect.width)),font_size:getComputedStyle(element).fontSize};
  }),
  horizontal_overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll(".modal,.web-analysis,.web-analysis-metric")).some(element=>element.scrollWidth>element.clientWidth+1)}));
 layouts.push({label,...observed});
 assert.ok(observed.values.length>=4,label+": missing actual metric cards");
 assert.equal(observed.horizontal_overflow,false,label+": horizontal overflow");
 for(const value of observed.values){assert.equal(value.lines,1,label+": wrapped metric "+value.text);assert.ok(value.text_width<=value.available+1,label+": clipped metric "+value.text);}
 pass(label);
}
async function until(read:()=>Promise<any>,accept:(v:any)=>boolean,label:string,ms=60000):Promise<any>{const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,250));}throw new Error("Timed out: "+label);}
const load=(f:string)=>import(pathToFileURL(path.join(platform,f)).href);
await mkdir(owned,{recursive:true});
try {
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{advanceConnectors}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/connectors.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"true"}),{worker:false});
 system.app.addHook("onRequest",async(req:any)=>{if(req.url.includes("/v1/responses"))modelCalls++;});
 await system.app.listen({host:"127.0.0.1",port:4310});
 electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(owned,"user-data")}});
 const desktop=await electron.firstWindow();desktop.setDefaultTimeout(25000);desktop.on("pageerror",e=>errors.push(e.message));
 await desktop.waitForURL(/^file:/);await desktop.waitForFunction(()=>!!(window as any).copyPasteBridge);
 await desktop.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await desktop.reload();
 await electron.evaluate(({shell,dialog},folder)=>{
  const state=globalThis as any;state.__externalURLs=[];state.__downloadPaths=[];
  shell.openExternal=async(url:string)=>{state.__authURL=url;state.__externalURLs.push(url);};
  dialog.showSaveDialog=async(options:any)=>{const filePath=folder+"/"+(state.__downloadPrefix??"native-")+options.defaultPath;state.__downloadPaths.push(filePath);return {canceled:false,filePath};};
 },owned);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN!,headless:true});const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 await desktop.getByRole("button",{name:"Sign in securely in your browser"}).click();
 const authURL=await until(()=>electron!.evaluate(()=>(globalThis as any).__authURL??""),Boolean,"native authorization URL");
 const web=await context.newPage();diagnosticPage=web;web.setDefaultTimeout(25000);web.on("pageerror",e=>errors.push(e.message));await web.goto(authURL);
 await web.locator('input[name="email"]').fill("web-analysis-"+randomUUID()+"@example.invalid");
 const [challenge]=await Promise.all([web.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),web.locator('form button[type="submit"]').click()]);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
 await web.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await web.locator('form button[type="submit"]').click();
 await web.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
 await until(()=>desktop.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).status),v=>v===200,"native PKCE return");
 await desktop.locator('input[name="name"]').fill("Hong Kong website studio");await desktop.locator('input[name="project_name"]').fill("Website performance");
 await desktop.getByRole("button",{name:"Create workspace & continue",exact:true}).click();
 const current=await until(()=>desktop.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).body),v=>v.memberships?.length===1,"actual onboarding");
 const tenant=current.memberships[0].id;
 const request=async(url:string,method="GET",body?:any)=>desktop.evaluate(async a=>{const r=await (window as any).copyPasteBridge.request(a.url,{method:a.method,tenantId:a.tenant,idempotencyKey:crypto.randomUUID(),...(a.body===undefined?{}:{body:a.body})});if(r.status<200||r.status>=300)throw new Error(JSON.stringify(r));return r.body;},{url,method,body,tenant});
 const project=(await request("/v1/tenants/"+tenant+"/projects")).items[0].id,base="/v1/tenants/"+tenant+"/projects/"+project;
 pass("Actual email login, browser consent, native PKCE return and customer onboarding");
 async function drain(connection:string){return until(async()=>{await advanceConnectors(system.db,system.storage);return request("/v1/connections/"+connection+"/detail");},d=>!d.jobs.some((j:any)=>["queued","running"].includes(j.status)),"captured connector jobs");}
 async function connect(provider:"ga4"|"search_console"){
  await web.goto(new URL("/app/connections",authURL).href);
  const card=web.locator(".connection-card").filter({hasText:provider==="ga4"?"Website traffic, landing pages":"Search queries, pages and impressions"});
  await card.getByRole("button",{name:"Connect account"}).click();await web.getByRole("button",{name:/Allow simulated read/}).click();
  await web.waitForURL(url=>url.port==="4317"&&url.searchParams.has("connected"));const connection=new URL(web.url()).searchParams.get("connected")!;
  await drain(connection);
  const account = provider === "search_console" ? web.locator(".connector-account").filter({hasText:"https://example.hk/"}).locator("input") : web.locator(".connector-account input:not(:disabled)").first();await account.check();
  await web.getByRole("button",{name:"Confirm accounts & projects",exact:true}).click();
  await until(()=>request("/v1/connections/"+connection+"/detail"),d=>d.connection.account_ids.length===1,"explicit account binding");
  const sync=web.locator("section.card").filter({has:web.getByRole("heading",{name:"Sync data",exact:true})});
  await sync.getByLabel("From",{exact:true}).fill("2026-10-01");await sync.getByLabel("To",{exact:true}).fill("2026-10-07");
  if(provider==="ga4")system.connectorFixture.setFaults("ga4",["negative_revenue"]);
  const [response]=await Promise.all([web.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith("/syncs")),sync.getByRole("button",{name:"Create snapshot",exact:true}).click()]);
  assert.equal(response.status(),202);const job=await response.json();await drain(connection);
  const captured=await request("/v1/syncs/"+job.id);assert.equal(captured.state,"complete");
  await web.getByRole("button",{name:"Inspect facts & limits",exact:true}).first().waitFor();
  return {id:captured.snapshot_id,connection};
 }
 const ga4=await connect("ga4");
 pass("Actual GA4 OAuth fixture consent, explicit account selection and dated snapshot form");
 async function openReport(page:Page,connection:string){
  if(page===desktop){
   const dialog=page.getByRole("dialog");if(await dialog.count())await dialog.getByRole("button",{name:/Close|關閉/,exact:true}).click();
   await page.evaluate(id=>{location.hash="/app/connections?connected="+id;},connection);
   await page.locator(".connector-directory-item").filter({hasText:connection.slice(0,8)}).click();
  } else await page.goto(new URL("/app/connections?connected="+connection,authURL).href);
  await page.getByRole("button",{name:/Inspect facts & limits|檢查數據與限制/,exact:true}).first().click();
  await page.getByRole("button",{name:/Website analysis & report|網站分析與報告/,exact:true}).click();return page.locator(".web-analysis");
 }
 async function shot(client:string,name:string,page:Page,description:string){await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});screenshots.push(await saveWorkmateScreenshot(client,"web-analysis-"+attempt,name,await page.screenshot({caret:"hide"}),description,delivery));}
 let panel=await openReport(web,ga4.connection);
 recording=new WorkmateRecording("web","website-analysis",attempt,()=>web.screenshot({type:"jpeg",quality:80}),"Actual signed-in Web website reports; synthetic OAuth source accounts",delivery);await recording.start();
 await panel.getByRole("checkbox",{name:"Channel",exact:true}).check();await panel.getByRole("button",{name:"View analysis",exact:true}).click();
 await panel.getByText("-199.5",{exact:true}).first().waitFor();await panel.getByText("Users can overlap across rows and cannot be summed.",{exact:true}).first().waitFor();
 const params="profile=ga4_traffic&account_id=201&date_from=2026-10-01&date_to=2026-10-07&group_by=channel";
 const ga4Report=await request(base+"/connector-snapshots/"+ga4.id+"/web-analysis?"+params);assert.equal(ga4Report.summary.metrics.sessions.value,"360");
 await panel.locator(".web-analysis-results").evaluate(e=>e.scrollIntoView({block:"start"}));
 await shot("web","ga4-en",web,"Actual website traffic and signed refund revenue; unknown distinct users are explained");
 for(const format of ["html","csv","json"]){const label=format==="html"?"Full report HTML":format==="csv"?"Metrics CSV":"Verifiable JSON";
  const [download]=await Promise.all([web.waitForEvent("download"),panel.getByRole("button",{name:label,exact:true}).click()]);const file=path.join(owned,"web-report."+format);await download.saveAs(file);
  const bytes=await readFile(file);assert.ok(bytes.toString().includes(ga4Report.calculation_sha256));if(format==="json")assert.equal(JSON.parse(bytes.toString()).groups.length,3);
  exports.push({client:"web",format,bytes:bytes.length,sha256:sha(bytes),calculation_sha256:ga4Report.calculation_sha256});}
 pass("Web calculates exact captured metrics and downloads complete HTML, CSV and JSON with identical report evidence");
 await panel.getByLabel("From",{exact:true}).fill("2026-10-07");await panel.getByRole("status").getByText(/Filters have changed/).waitFor();
 await panel.getByText("-199.5",{exact:true}).first().waitFor();await panel.getByRole("button",{name:"View analysis",exact:true}).click();
 await panel.getByText("No rows were returned for this scope; this is not zero.",{exact:true}).first().waitFor();
 await shot("web","unknown-date-en",web,"Dirty filters require explicit recalculation; dates without records remain unknown, not zero");
 recordings.push(await recording.stop());recording=undefined;
 pass("Changed filters preserve the displayed scope until submission; empty dates return unknown values");
 await web.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
 const gsc=await connect("search_console");panel=await openReport(web,gsc.connection);
 await panel.getByRole("checkbox",{name:"Search query",exact:true}).check();await panel.getByRole("button",{name:"View analysis",exact:true}).click();
 await panel.getByText("10.447761%",{exact:true}).first().waitFor();await panel.getByText(/America\/Los_Angeles/).first().waitFor();
 await panel.getByText("Source, coverage and calculation",{exact:true}).click();await shot("web","search-en",web,"Actual Search Console report retains Pacific dates, impression-weighted ranking and query coverage limits");
 pass("Search Console report keeps Pacific dates, aggregate CTR, weighted position and provider coverage limits");
 await readableMetrics(web,"Web 1440px search metrics remain complete on one line");
 await web.setViewportSize({width:375,height:812});await panel.locator(".web-analysis-results").evaluate(element=>element.scrollIntoView({block:"start"}));
 await readableMetrics(web,"Web 375px search metrics fit intrinsic cards without horizontal overflow");
 await shot("web","search-mobile-en",web,"Actual 375px website report keeps complete CTR and ranking on one line with no horizontal overflow");
 await web.setViewportSize({width:1440,height:1000});

 const calls=system.connectorFixture.calls.length;
 const before=(await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::int tasks,(SELECT count(*) FROM ledger)::int ledger")).rows[0];
 panel=await openReport(desktop,ga4.connection);
 recording=new WorkmateRecording("desktop","website-analysis",attempt,async()=>Buffer.from(await electron!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")),"base64"),"Actual unsigned packaged frameless Desktop website report, authenticated native bridge, synthetic source accounts",delivery);await recording.start();
 await panel.getByRole("checkbox",{name:"Channel",exact:true}).check();await panel.getByRole("button",{name:"View analysis",exact:true}).click();await panel.getByText("-199.5",{exact:true}).first().waitFor();
 await panel.locator(".web-analysis-results").evaluate(e=>e.scrollIntoView({block:"start"}));
 await shot("desktop","ga4-en",desktop,"Actual unsigned packaged Desktop displays the same source-bound website report using native authorization");
 for(const format of ["html","csv","json"]){const label=format==="html"?"Full report HTML":format==="csv"?"Metrics CSV":"Verifiable JSON";await panel.getByRole("button",{name:label,exact:true}).click();const file=path.join(owned,"native-workmate-web-analysis."+format);
  const bytes=await until(()=>readFile(file).catch(()=>Buffer.alloc(0)),b=>b.length>0,"native authorized report save");assert.ok(bytes.toString().includes(ga4Report.calculation_sha256));exports.push({client:"desktop",format,bytes:bytes.length,sha256:sha(bytes),calculation_sha256:ga4Report.calculation_sha256});}
 pass("Packaged Desktop uses the native authenticated download bridge for all three complete report files");
 panel=await openReport(desktop,gsc.connection);await panel.getByRole("checkbox",{name:"Search query",exact:true}).check();await panel.getByRole("button",{name:"View analysis",exact:true}).click();
 await panel.getByText("10.447761%",{exact:true}).first().waitFor();await panel.getByText(/America\/Los_Angeles/).first().waitFor();
 await readableMetrics(desktop,"Desktop full-width search metrics remain complete on one line");
 await panel.locator(".web-analysis-results").evaluate(e=>e.scrollIntoView({block:"start"}));await shot("desktop","search-en",desktop,"Native Desktop supports an encoded Search Console URL property and displays exact search metrics");
 await electron.evaluate(()=>(globalThis as any).__downloadPrefix="native-search-");await panel.getByRole("button",{name:"Verifiable JSON",exact:true}).click();
 const searchBytes=await until(()=>readFile(path.join(owned,"native-search-workmate-web-analysis.json")).catch(()=>Buffer.alloc(0)),b=>b.length>0,"native URL-property report download");
 const search=JSON.parse(searchBytes.toString());assert.equal(search.source.account_id,"https://example.hk/");assert.equal(search.summary.metrics.ctr.value,"0.10447761");
 exports.push({client:"desktop",profile:"search_performance",format:"json",bytes:searchBytes.length,sha256:sha(searchBytes),calculation_sha256:search.calculation_sha256});
 pass("Native Search Console URL properties pass the guarded company bridge and download a complete authorized report");
 await request("/v1/connections/"+ga4.connection,"DELETE");assert.equal((await request(base+"/connector-snapshots/"+ga4.id+"/web-analysis?"+params)).calculation_sha256,ga4Report.calculation_sha256);
 pass("OAuth disconnect stops future reads while the original captured report retains its evidence");
 await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,600));
 await until(()=>desktop.evaluate(()=>[innerWidth,innerHeight]),v=>v[0]===800&&v[1]===600,"compact native window");
 await readableMetrics(desktop,"Desktop 800px search metrics keep full precision without wrapping");
 await panel.locator(".web-analysis-results").evaluate(element=>element.scrollIntoView({block:"start"}));
 await shot("desktop","search-compact-en",desktop,"Actual 800x600 native report keeps complete CTR and weighted ranking on one line");

 await desktop.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});await desktop.reload();panel=await openReport(desktop,ga4.connection);
 await panel.getByRole("checkbox",{name:"流量渠道",exact:true}).check();await panel.getByRole("button",{name:"查看分析",exact:true}).click();await panel.getByText("-199.5",{exact:true}).first().waitFor();
 const modal=desktop.locator(".modal").last();await panel.getByRole("heading",{name:"已觀察資料摘要",exact:true}).scrollIntoViewIfNeeded();
 await shot("desktop","compact-zh-dark",desktop,"Actual 800x600 Chinese dark Desktop website report without visible scrollbars or horizontal overflow");
 await readableMetrics(desktop,"Desktop 800px Chinese dark report keeps readable exact metrics");
 const layout=await desktop.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll("#root,.modal,.web-analysis,.web-analysis-metric")).some(e=>e.scrollWidth>e.clientWidth+2),rails:Array.from(document.querySelectorAll("#root,.sidebar,.modal")).every(e=>getComputedStyle(e).scrollbarWidth==="none")}));assert.equal(layout.overflow,false);assert.equal(layout.rails,true);
 const scroller=desktop.locator(".modal-backdrop");const box=await scroller.boundingBox();assert.ok(box);await desktop.mouse.move(box.x+box.width/2,box.y+box.height/2);await desktop.mouse.wheel(0,500);
 const appearance=await electron.evaluate(({BrowserWindow,Menu})=>({menu:Menu.getApplicationMenu()===null,menuBar:BrowserWindow.getAllWindows()[0].isMenuBarVisible()}));assert.equal(appearance.menu,true);assert.equal(appearance.menuBar,false);
 pass("Compact Chinese dark Desktop report keeps a menu-free frameless layout, hidden rails and no horizontal overflow");
 const asset=(await system.db.control.query("SELECT asset_id FROM connector_snapshots WHERE id=$1",[ga4.id])).rows[0].asset_id;
 // Reopen the same source in Web so both already-visible reports must withdraw.
 panel=await openReport(web,ga4.connection);await panel.getByRole("button",{name:"View analysis",exact:true}).click();await panel.getByText("-199.5",{exact:true}).first().waitFor();
 await system.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[asset]);
 await until(()=>Promise.all([web.locator(".web-analysis-results").count(),desktop.locator(".web-analysis-results").count()]),v=>v[0]===0&&v[1]===0,"both open reports withdraw revoked data",25000);
 assert.equal(await web.getByRole("button",{name:"Full report HTML",exact:true}).count(),0);assert.equal(await desktop.getByRole("button",{name:"完整報告 HTML",exact:true}).count(),0);
 await shot("desktop","source-withdrawn-zh",desktop,"Already-open native report clears private metrics and download controls after actual source quarantine");
 recordings.push(await recording.stop());recording=undefined;
 pass("Actual source quarantine removes metrics and download actions from both already-open client reports");
 assert.equal(system.connectorFixture.calls.length,calls);assert.equal(modelCalls,0);
 const after=(await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::int tasks,(SELECT count(*) FROM ledger)::int ledger")).rows[0];assert.deepEqual(after,before);
 pass("Report reads and downloads create no provider request, model call, task or ledger charge");
} catch(e){errors.push(String(e));console.error(e);
 if(electron)try{await writeFile(prefix+"-failure-geometry.json",JSON.stringify(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map((w:any)=>({bounds:w.getBounds(),content:w.getContentSize(),zoom:w.webContents.getZoomFactor()}))),null,2),{flag:"wx"});}catch{}
 if(diagnosticPage)try{await writeFile(prefix+"-failure-body.txt",await diagnosticPage.locator("body").innerText(),{flag:"wx"});await writeFile(prefix+"-failure.png",await diagnosticPage.screenshot(),{flag:"wx"});}catch{}
}
finally {
 if(recording)try{recordings.push(await recording.stop());}catch(e){errors.push(String(e));}
 if(electron)await electron.close().then(()=>{electronClosed=true;}).catch(e=>errors.push(String(e)));
 if(browser)await browser.close().then(()=>{browserClosed=true;}).catch(e=>errors.push(String(e)));
 if(system)await system.app.close().then(()=>{apiClosed=true;}).catch((e:any)=>errors.push(String(e)));
 if(isolated)await isolated.cleanup().then(()=>{fixtureClosed=true;}).catch((e:any)=>errors.push(String(e)));
 const report={at:new Date().toISOString(),status:errors.length?"failed":"passed",checks,errors,screenshots,recordings,exports,layouts,model_calls:modelCalls,electron_closed:electronClosed,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,not_validated:["human_native_save_dialog_clicks","live_company_model","real_provider_accounts","real_payment","signed_production_installer","entire_product_acceptance"]};
 await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(errors.length,0,errors.join("\n"));
}
