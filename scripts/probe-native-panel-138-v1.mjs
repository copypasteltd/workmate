import {chromium} from "playwright";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import path from "node:path";
const root=process.cwd(),extension=path.resolve("../copypaste-extension"),id=(await readFile(path.join(extension,"extension-id.txt"),"utf8")).trim();
const own=path.join(root,".data/delivery-revision-138","panel-discovery-"+randomUUID());await mkdir(own,{recursive:true});let context,cdp;const observations=[];let error=null;
try{
 context=await chromium.launchPersistentContext(own,{executablePath:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),headless:false,viewport:null,args:["--disable-gpu","--window-size=1480,980","--enable-unsafe-extension-debugging","--disable-extensions-except="+path.join(extension,"dist"),"--load-extension="+path.join(extension,"dist")]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker");cdp=await context.browser().newBrowserCDPSession();const target=(await cdp.send("Target.getTargets",{filter:[{}]})).targetInfos.find(t=>t.type==="tab");
 await cdp.send("Extensions.triggerAction",{id,targetId:target.targetId});
 for(let i=0;i<12;i++){const contexts=await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}));const targets=(await cdp.send("Target.getTargets",{filter:[{}]})).targetInfos.map(t=>({type:t.type,url:t.url}));observations.push({contexts,targets});await new Promise(r=>setTimeout(r,250));}
}catch(e){error=String(e)}finally{await cdp?.detach().catch(()=>{});await context?.close();}
const report={error,observations,owned_browser_closed:true};await writeFile("evidence/delivery-revision-138/panel-discovery-01.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report));
