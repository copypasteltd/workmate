import {chromium} from 'playwright';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
import {WorkmateRecording} from './record-workmate-media.ts';
const web=path.resolve('../copypaste-web'),desktop=path.resolve('../copypaste-desktop'),out=path.resolve('.data/acceptance-205/feedback-ui-v2');await mkdir(out,{recursive:true});
const req=createRequire(path.join(web,'package.json')),{createServer}=await import(pathToFileURL(req.resolve('vite')).href);
const server=await createServer({root:web,configFile:false,server:{host:'127.0.0.1',port:0},appType:'custom'});
server.middlewares.use('/__qa/tool-feedback',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__qa/tool-feedback','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/tool-feedback-harness-205-v1.tsx"></script></body></html>'));});
let browser,recording;const report={stage:205,status:'running',scope:'Controlled browser fault scenario using exact production feedback/UI/CSS modules. No customer task, real model or full native execution claim. Actual live packaged Web/Desktop review is separate.',checks:[],screenshots:[],recordings:[],errors:[]};
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 for(const file of ['task-tool-state.ts','task-tool-feedback.tsx','task-tool-feedback.css'])assert.equal(sha(await readFile(path.join(web,'src',file))),sha(await readFile(path.join(desktop,'renderer/src',file))));
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')});
 const context=await browser.newContext({viewport:{width:1280,height:960}});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(`http://127.0.0.1:${port}/__qa/tool-feedback`);await page.getByRole('heading',{name:'逐項交付與修正'}).waitFor();
 recording=new WorkmateRecording('web','tool-feedback-controlled','205-v2',()=>page.screenshot({type:'jpeg',quality:74}),'Controlled fault scenario using production UI components; no live task/model claim',process.cwd());await recording.start();await page.waitForTimeout(800);
 await page.getByRole('button',{name:'完成另一份成果',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback details').count(),2);
 await page.getByRole('button',{name:'加入長回覆',exact:true}).click();await page.getByRole('status',{name:'交付狀態'}).waitFor();report.checks.push('Current failure retained after eight hundred later progress events');await page.waitForTimeout(800);
 await page.getByRole('button',{name:'工作結束',exact:true}).click();await page.getByText('此項工作尚未完整交付',{exact:true}).waitFor();await page.waitForTimeout(800);
 await page.getByText('支援記錄',{exact:true}).first().click();await page.getByText('TOOL_INPUT_INVALID · 205b205b205b205b',{exact:true}).waitFor();await page.waitForTimeout(800);
 await page.getByRole('button',{name:'修正第一項',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback details').count(),1);await page.waitForTimeout(800);await page.getByRole('button',{name:'修正第二項',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.waitForTimeout(800);report.recordings.push(await recording.stop());recording=null;
 for(const [theme,locale,width] of [['light','zh-HK',1280],['dark','zh-HK',1280],['dark','en',390],['light','en',390]]){
  await page.evaluate(({theme,locale})=>{localStorage.setItem('cp_theme',theme);localStorage.setItem('cp_locale',locale);},{theme,locale});await page.reload();await page.getByRole('heading').first().waitFor();await page.setViewportSize({width,height:960});
  await page.getByRole('button',{name:locale==='en'?'Finish task':'工作結束',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const readable=await page.locator('.task-tool-feedback').evaluate(panel=>{const r=panel.getBoundingClientRect(),h=panel.querySelector('strong').getBoundingClientRect(),p=panel.querySelector('p').getBoundingClientRect();return{panel:r.width,heading:h.width,headingBottom:h.bottom,paragraphTop:p.top};});
  assert.ok(readable.heading>readable.panel*.8,'Full-width readable message heading');assert.ok(readable.paragraphTop>=readable.headingBottom-.5,'Message body follows heading vertically');
  const filename=`205-v2-tool-feedback-controlled-${theme}-${locale}-${width}.png`,file=path.join(web,'assets/screenshots',filename);await page.screenshot({path:file,animations:'disabled'});report.screenshots.push({path:'copypaste-web/assets/screenshots/'+filename,sha256:sha(await readFile(file))});
 }
 await page.getByRole('button',{name:'Correct the first output',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback details').count(),1);await page.getByRole('button',{name:'Correct the second output',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.getByText('Both corrections are confirmed. Original recorded usage remains.',{exact:true}).waitFor();report.checks.push('Only both exact corrections clear both pending outputs; bilingual dual themes use readable vertical message blocks with no horizontal overflow');assert.ok(report.recordings[0].distinct_frames>=4,'Interaction recording retains distinct issue, finish, reference and recovery states');
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.errors.push(error.message);throw error;
}finally{try{if(recording)report.recordings.push(await recording.stop());}catch(error){report.errors.push('Owned recording cleanup: '+error.message);report.status='failed';}finally{await browser?.close();report.owned_browser_closed=true;await server.close();report.owned_local_server_closed=true;report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}}
console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json')}));
