import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

export async function runDesktopBrowserJourney(j:any){
  const {page,electron,model}=j;
  const windows=()=>electron.evaluate(({BrowserWindow}:any)=>BrowserWindow.getAllWindows().filter((win:any)=>win.webContents.getURL().includes("/assets/browser-shell.html")).map((win:any)=>({id:win.id,url:win.webContents.getURL()})));
  const surface=async(png=false)=>Buffer.from(await electron.evaluate(async({BrowserWindow,desktopCapturer}:any,png:boolean)=>{
    const win=BrowserWindow.getAllWindows().find((win:any)=>win.webContents.getURL().includes("/assets/browser-shell.html"));if(!win)throw new Error("Owned browser window missing");
    const [width,height]=win.getSize();const sources=await desktopCapturer.getSources({types:["window"],thumbnailSize:{width,height},fetchWindowIcons:false});
    const source=sources.find((item:any)=>item.id===win.getMediaSourceId());if(!source||source.thumbnail.isEmpty())throw new Error("Native browser OS capture missing");
    return (png?source.thumbnail.toPNG():source.thumbnail.toJPEG(82)).toString("base64");
  },png),"base64");
  const capture=async(name:string)=>j.screenshots.push(await saveWorkmateScreenshot("desktop","local-"+j.attempt,name,await surface(true),"Actual OS window capture of the packaged frameless browser; real Codex, local HTTP campaign actions, exact files and company receipts; only model/content/dialog choices are fixtures",j.delivery));
  const create=async(mode:"read-only"|"full-access")=>{
    await page.getByLabel("Local specialist",{exact:true}).selectOption("fullstack");const previous=(await j.list())?.id;
    await page.getByRole("button",{name:"Choose folder to start",exact:true}).click();await j.until(j.list,(s:any)=>s.id!==previous,"new browser session");
    await page.getByLabel("Local permission",{exact:true}).selectOption(mode);await page.getByRole("button",{name:"Set permission",exact:true}).click();await j.until(j.list,(s:any)=>s.permission===mode,"browser permission");
  };
  const send=async(text:string)=>{await page.getByLabel("Local task",{exact:true}).fill(text);await page.getByRole("button",{name:"Start work",exact:true}).click();};
  const answer=async()=>{const form=page.getByRole("form",{name:"Answer task questions",exact:true});await form.getByRole("radio").first().check();await form.getByRole("button",{name:"Answer and continue",exact:true}).click();};
  await create("full-access");model.begin("execute");const before=j.providerCalls();
  await send("Open the local campaign desk, prepare the campaign with my actual reference file, save it and download its brief. Ask before continuing and before closing the page.");
  await j.until(j.list,(s:any)=>s.busy&&s.inputs?.some((q:any)=>q.questions[0]?.id==="question_before"),"native browser open and real customer question",90000);
  assert.equal((await windows()).length,1);await capture("browser-open-en");
  let recording:any=new WorkmateRecording("desktop","native-browser","local-"+j.attempt,()=>surface(),"Actual OS-captured packaged browser; real customer-device Codex and company gateway; explicit synthetic Responses and local campaign content",j.delivery),media;
  try{
    await recording.start();await answer();
    const review=await j.until(j.list,(s:any)=>s.busy&&s.inputs?.some((q:any)=>q.questions[0]?.id==="question_after"),"actual browser save, screenshot and download",90000);
    assert.equal(model.saves.length,1);assert.equal(model.saves[0].attachment.text,"Actual native browser reference bytes");assert.equal(model.screenshotObserved,true);
    assert.deepEqual(await readFile(model.download.path),model.bytes);await capture("browser-saved-en");
    await electron.evaluate(({BrowserWindow}:any)=>{const win=BrowserWindow.getAllWindows().find((win:any)=>win.webContents.getURL().includes("/assets/browser-shell.html"));win.setSize(800,600);});
    await new Promise(resolve=>setTimeout(resolve,250));await capture("browser-compact-en");
    await electron.evaluate(({BrowserWindow}:any)=>{const win=BrowserWindow.getAllWindows().find((win:any)=>win.webContents.getURL().includes("/assets/browser-shell.html"));win.setSize(1180,820);});
    media=await recording.stop();recording=undefined;await answer();
    const done=await j.until(j.list,(s:any)=>!s.busy&&s.task?.task_id===review.task.task_id&&s.task.status==="succeeded","native browser final result",90000);
    assert.equal((await windows()).length,0);
    const task=(await j.system.db.control.query("SELECT * FROM tasks WHERE id=$1",[done.task.task_id])).rows[0];
    assert.equal(task.execution_location,"desktop");assert.equal(Number(task.charged_micros),(j.providerCalls()-before)*30);
    assert.equal((await j.system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",[task.id])).rows[0].n,1);
    j.screenshots.push(await saveWorkmateScreenshot("desktop","local-"+j.attempt,"browser-completed-en",await j.captureSurface(),"Actual native browser completion, one company reservation and receipt; the task-owned browser has closed",j.delivery));
    j.pass("Packaged Desktop's real Codex uses registered local browser tools for exact form/upload/screenshot/download results, customer answers and one company receipt, then closes its page");
  }finally{if(recording)await recording.stop();}
  await create("read-only");model.begin("denied");await send("Open the campaign browser with this read-only session.");
  await j.until(j.list,(s:any)=>!s.busy&&s.task?.status==="succeeded","actual native browser full-access denial",90000);assert.equal((await windows()).length,0);
  j.pass("A real native read-only session returns BROWSER_FULL_ACCESS_REQUIRED and never creates a browser window");
  for(const mode of ["stop","revoke"] as const){
    await create("full-access");model.begin(mode);await send("Open the owned campaign browser and wait so I can "+mode+" this task.");
    const running=await j.until(j.list,(s:any)=>s.busy&&s.events.some((e:any)=>e.kind==="local.browser-tool.started"&&e.value.tool==="wait"),"pending actual browser wait before "+mode,90000);
    assert.equal((await windows()).length,1);const called=j.providerCalls();await new Promise(resolve=>setTimeout(resolve,120));
    await (mode==="stop"?page.locator(".local-agent-composer").getByRole("button",{name:"Stop",exact:true}):page.getByRole("button",{name:"Revoke local permission",exact:true})).click();
    await j.until(windows,(items:any[])=>items.length===0,"immediate owned browser cleanup on "+mode,5000);
    const done=await j.until(j.list,(s:any)=>!s.busy&&s.task?.task_id===running.task.task_id,"actual native process stopped by "+mode,30000);
    for(const e of done.events.filter((e:any)=>e.kind==="local.runtime.ready"))assert.throws(()=>process.kill(Number(e.value.pid),0));
    assert.equal(j.providerCalls(),called);assert.notEqual(done.task.status,"succeeded");if(mode==="revoke")assert.equal(done.permission,null);model.end();
    j.pass((mode==="stop"?"Stop":"Revocation")+" during a real native browser wait closes task-owned pages and the Codex process, makes no further model request and preserves the actual company cancellation/reconciliation state");
  }
  return media;
}
