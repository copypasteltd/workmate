import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Page, ElectronApplication } from "playwright";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";

/** Only source preparation uses a fixture API. Candidate creation, explicit
 * confirmations, report creation, withdrawal, themes and navigation use real UI. */
export async function exerciseCreativeFeedback({page,repo,delivery,attempt,system,pass,screenshots,resize,electron,captureSurface}: {
  page:Page; repo:"web"|"desktop"; delivery:string; attempt:string; system:any; pass:(s:string)=>void; screenshots:any[];
  resize:(w:number,h:number,label:string)=>Promise<any>; electron?:ElectronApplication;
  captureSurface?:()=>Promise<Buffer>;
}) {
  const surface=captureSurface??(()=>page.screenshot());
  const before = await page.evaluate(()=>({url:location.href,tenant:localStorage.getItem("cp_tenant"),project:localStorage.getItem("cp_project")}));
  assert.ok(before.tenant && before.project);
  const base=`/v1/tenants/${before.tenant}/projects/${before.project}`, root=base+"/creative-feedback";
  const api = (method:string,url:string,body?:unknown) => page.evaluate(async ({method,url,body})=>{
    const bridge=(window as any).copyPasteBridge;
    if(bridge) return bridge.request(url,{method,...(body?{body}:{}),idempotencyKey:crypto.randomUUID(),tenantId:localStorage.getItem("cp_tenant")??undefined});
    const session=await(await fetch("/v1/session/context")).json();
    const r=await fetch(url,{method,headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrf_token,"Idempotency-Key":crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  },{method,url,body});
  const me=await api("GET","/v1/session/context"); assert.equal(me.status,200);
  const platform=path.resolve(delivery,"../copypaste-platform");
  const {saveAsset}=await import(pathToFileURL(path.join(platform,"src/storage.ts")).href);
  const asset=await system.db.tx(async(tx:any)=>saveAsset(tx,system.storage,{tenant:before.tenant,project:before.project,user:me.body.user.id,
    name:"Harbour poster · shared.png",mime:"image/png",bytes:await readFile(path.resolve(delivery,"../copypaste-web/public/brand-mark.png"))}),before.tenant,true);
  const sources=[];
  for(const [account,spend,conversion] of [["harbour-north","30.000001",""],["harbour-south","8","3"]]) {
    const csv=`date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Harbour launch,ad-1,1000,50,${spend},${conversion},60,HKD`;
    const r=await api("POST",base+"/analytics/import",{name:"Harbour ad snapshot / "+account,csv,source:"meta_ads",currency:"HKD",timezone:"Asia/Hong_Kong",account_id:account,entity_level:"ad",attribution_definition:"7-day-click",conversion_definition:"purchases"});
    assert.equal(r.status,200,JSON.stringify(r.body)); sources.push(r.body.id);
  }
  const go = async()=>{
    if(repo==="desktop") await page.evaluate(()=>{location.hash="/app/analytics?view=creative-feedback";});
    else await page.goto("http://localhost:4317/app/analytics?view=creative-feedback");
    await page.getByRole("heading",{name:"Creative feedback",exact:true}).waitFor();
  };
  const capture=async(name:string)=>{
    if(repo==="desktop") await assertDesktopLayout(page);
    screenshots.push(await saveWorkmateScreenshot(repo,"feedback-"+attempt,name,await surface(),"Actual confirmed creative feedback UI. Asset bytes and API/database operations are real; ad identities, campaign facts and their single-creative attestations are explicit synthetic user fixtures.",delivery));
  };
  const recording=new WorkmateRecording(repo,"creative-feedback","feedback-"+attempt,surface,"Actual version selection, independent account confirmations, exact feedback, withdrawal and bilingual layout; synthetic ad facts only",delivery);
  let media:any;
  try {
    await go(); await recording.start();
    for(let i=0;i<2;i++) {
      await page.getByRole("button",{name:"New candidate",exact:true}).click();
      const modal=page.getByRole("dialog");
      await modal.getByLabel("Candidate name",{exact:true}).fill("Harbour poster / "+(i?"south":"north"));
      await modal.getByLabel("Ad-level data source",{exact:true}).selectOption(sources[i]);
      await modal.getByLabel("Exact ad",{exact:true}).selectOption({label:"ad-1 · meta · Harbour launch"});
      await modal.getByLabel("Shared creative asset",{exact:true}).selectOption(asset.id);
      await modal.getByLabel("Pinned asset version",{exact:true}).selectOption(asset.version.id);
      await modal.getByLabel("Creative ID",{exact:true}).fill("creative-harbour");
      await modal.getByLabel("Candidate basis",{exact:true}).selectOption("name_candidate");
      await modal.getByLabel("Identity review note",{exact:true}).fill("Synthetic fixture: identical display names do not establish identity; exact account and ad checked separately.");
      if(!i) await capture("candidate-en");
      await modal.getByRole("button",{name:"Save candidate for review",exact:true}).click();
      const card=page.locator(".feedback-mapping").filter({has:page.getByRole("heading",{name:"Harbour poster / "+(i?"south":"north"),exact:true})});
      await card.getByText("Candidate — review required",{exact:true}).waitFor();
      if(!i) assert.equal(await page.getByRole("button",{name:"Create feedback",exact:true}).isDisabled(),true);
      await card.getByRole("button",{name:"Review & confirm",exact:true}).click();
      const confirm=page.getByRole("dialog"), check=confirm.getByRole("checkbox");
      assert.equal(await check.isChecked(),false);
      await confirm.getByLabel("Decision reason",{exact:true}).fill("Checked the synthetic platform account, ad ID, creative ID and exact asset version for the full period.");
      await confirm.getByRole("button",{name:"Confirm identity",exact:true}).click();
      assert.equal(await confirm.isVisible(),true,"A required unselected attestation must stop form submission");
      await check.check(); if(!i) await capture("confirmation-en");
      await confirm.getByRole("button",{name:"Confirm identity",exact:true}).click();
      await card.getByText("Confirmed",{exact:true}).waitFor();
    }
    pass(repo+" requires explicit unchecked-to-checked single-creative attestation for exact versions; same-name candidates produce no metrics");
    for(const name of ["Harbour poster / north","Harbour poster / south"]) await page.getByLabel("Select feedback mapping: "+name,{exact:true}).check();
    await page.getByRole("button",{name:"Create feedback (2)",exact:true}).click();
    const modal=page.getByRole("dialog");
    await modal.getByLabel("Feedback name",{exact:true}).fill("Harbour creative evidence");
    await modal.getByRole("button",{name:"Calculate & save feedback",exact:true}).click();
    const report=page.locator(".feedback-report").filter({has:page.getByRole("heading",{name:"Harbour creative evidence",exact:true})});
    await report.waitFor(); assert.equal(await report.locator(".feedback-scope").count(),2);
    await report.locator(".feedback-metrics dd").filter({hasText:/^30\.000001HKD$/}).waitFor(); await report.getByText("Unknown",{exact:true}).waitFor();
    await report.getByText("meta_ads / harbour-north",{exact:true}).waitFor(); await report.getByText("meta_ads / harbour-south",{exact:true}).waitFor();
    const saved=await api("GET",root+"/reports"); assert.equal(saved.status,200); const r=saved.body.items.find((v:any)=>v.name==="Harbour creative evidence");
    assert.equal(r.body.groups.length,2); assert.equal(r.body.mapping_versions.length,2);
    if(repo==="web") {
      const downloaded=page.waitForEvent("download"); await report.getByRole("button",{name:"Download evidence JSON",exact:true}).click();
      const file=await downloaded, filePath=await file.path(); assert.ok(filePath); assert.deepEqual(JSON.parse(await readFile(filePath,"utf8")),r.body);
    } else if(electron) {
      const target=path.resolve(delivery,".data/creative-feedback-download-"+randomUUID()+".json");
      await electron.evaluate(({dialog},target)=>{(globalThis as any).__feedbackSaveDialog=dialog.showSaveDialog; dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
      try {
        await report.getByRole("button",{name:"Download evidence JSON",exact:true}).click();
        await page.waitForFunction(()=>!(document.querySelector('[role="alert"]')));
        const end=Date.now()+15000; let bytes:Buffer|undefined;
        while(Date.now()<end&&!bytes){bytes=await readFile(target).catch(()=>undefined);if(!bytes)await new Promise(r=>setTimeout(r,100));}
        assert.ok(bytes); assert.deepEqual(JSON.parse(bytes.toString()),r.body);
      } finally { await electron.evaluate(({dialog})=>{dialog.showSaveDialog=(globalThis as any).__feedbackSaveDialog;delete(globalThis as any).__feedbackSaveDialog;}); }
    }
    await capture("report-en");
    pass(repo+" keeps same-name account scopes separate, displays exact 30.000001 and unknown conversions, and downloads the frozen JSON through its real client transport");
    await resize(800,600,"compact creative feedback");
    await page.getByTitle("切換至繁體中文",{exact:true}).click();
    for(let i=0;i<4&&await page.evaluate(()=>document.documentElement.dataset.theme)!=="dark";i++) await page.getByTitle("Theme: light / dark / system",{exact:true}).click();
    await report.scrollIntoViewIfNeeded();
    await capture("report-zh-dark-compact");
    if(repo==="desktop") {
      const rootEl=page.locator("#root"); await rootEl.evaluate((e:HTMLElement)=>{e.scrollTop=0;});
      await page.locator(".creative-feedback h1").click(); await page.mouse.wheel(0,520);
      await page.waitForFunction(()=>document.getElementById("root")!.scrollTop>20);
      await page.keyboard.press("End"); await page.waitForFunction(()=>{const r=document.getElementById("root")!;return r.scrollTop+r.clientHeight>=r.scrollHeight-3;});
      await page.keyboard.press("Home"); await page.waitForFunction(()=>document.getElementById("root")!.scrollTop<3);
      await assertDesktopLayout(page);
    } else assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.getByTitle("Switch to English",{exact:true}).click();
    for(let i=0;i<4&&await page.evaluate(()=>document.documentElement.dataset.theme)!=="light";i++) await page.getByTitle("Theme: light / dark / system",{exact:true}).click();
    await resize(1440,980,"restore full creative feedback");
    pass(repo+" reflows actual compact Chinese/dark feedback; Desktop assertions additionally require no rails, no horizontal overflow and real wheel/Home/End access");
    const north=page.locator(".feedback-mapping").filter({has:page.getByRole("heading",{name:"Harbour poster / north",exact:true})});
    await north.getByRole("button",{name:"Withdraw mapping",exact:true}).click();
    await page.getByRole("dialog").getByLabel("Decision reason",{exact:true}).fill("Synthetic identity correction; retain the original confirmation and stop managed reuse.");
    await page.getByRole("dialog").getByRole("button",{name:"Withdraw mapping",exact:true}).click();
    await north.getByText("Withdrawn",{exact:true}).first().waitFor(); await report.waitFor({state:"detached"});
    const download=await system.app.inject({method:"GET",url:`${base}/assets/${r.asset_id}/download?version=1`});
    assert.equal(download.statusCode,401,"Unauthenticated callers never gain a download");
    const available=await system.db.control.query("SELECT task_asset_version_sources_available($1) AS ok",[r.asset_version_id]); assert.equal(available.rows[0].ok,false);
    assert.equal((await api("GET",root+"/reports")).body.items.some((v:any)=>v.id===r.id),false);
    await capture("withdrawn-en");
    pass(repo+" withdrawal preserves confirmation history, removes managed feedback and denies further source reuse");
    media=await recording.stop(); assert.equal(media.skipped_capture_errors,0);
    return media;
  } finally {
    if(!media) await recording.stop().catch(()=>{});
    if(repo==="desktop") await page.evaluate(url=>{location.href=url;},before.url); else await page.goto(before.url);
  }
}
