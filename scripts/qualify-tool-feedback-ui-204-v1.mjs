import {chromium} from 'playwright';import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
import {WorkmateRecording} from './record-workmate-media.ts';
const web=path.resolve('../copypaste-web'),desktop=path.resolve('../copypaste-desktop'),out=path.resolve('.data/acceptance-204/feedback-ui-v1');await mkdir(out,{recursive:true});
const req=createRequire(path.join(web,'package.json')),{createServer}=await import(req.resolve('vite'));
const server=await createServer({root:web,configFile:false,server:{host:'127.0.0.1',port:0},appType:'custom'});
server.middlewares.use('/__qa/tool-feedback',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__qa/tool-feedback','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/tool-feedback-harness-204-v1.tsx"></script></body></html>'));});
let browser,recording;const report={stage:204,status:'running',scope:'Controlled browser fault scenario using exact production feedback/UI/CSS modules. No customer task, real model or full native execution claim. Actual live packaged Web/Desktop review is separate.',checks:[],screenshots:[],recordings:[],errors:[]};
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 for(const file of ['task-tool-state.ts','task-tool-feedback.tsx','task-tool-feedback.css'])assert.equal(sha(await readFile(path.join(web,'src',file))),sha(await readFile(path.join(desktop,'renderer/src',file))));
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')});
 const context=await browser.newContext({viewport:{width:1280,height:960}});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(`http://127.0.0.1:${port}/__qa/tool-feedback`);await page.getByRole('heading',{name:'交付狀態與恢復'}).waitFor();
 recording=new WorkmateRecording('web','tool-feedback-controlled','204-v1',()=>page.screenshot({type:'jpeg',quality:74}),'Controlled fault scenario using production UI components; no live task/model claim',process.cwd());await recording.start();
 await page.getByRole('button',{name:'加入長回覆',exact:true}).click();await page.getByRole('status',{name:'交付狀態'}).waitFor();report.checks.push('Current failure retained after eight hundred later progress events');
 await page.getByRole('button',{name:'工作結束',exact:true}).click();await page.getByText('此項工作尚未完整交付',{exact:true}).waitFor();
 await page.getByText('支援記錄',{exact:true}).click();await page.getByText('TOOL_INPUT_INVALID · 204a204b204c204d',{exact:true}).waitFor();
 await page.getByRole('button',{name:'記錄成功修正',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.waitForTimeout(800);report.recordings.push(await recording.stop());recording=null;
 for(const [theme,locale,width] of [['light','zh-HK',1280],['dark','zh-HK',1280],['dark','en',390],['light','en',390]]){
  await page.evaluate(({theme,locale})=>{localStorage.setItem('cp_theme',theme);localStorage.setItem('cp_locale',locale);},{theme,locale});await page.reload();await page.getByRole('heading').first().waitFor();await page.setViewportSize({width,height:960});
  await page.getByRole('button',{name:locale==='en'?'Finish task':'工作結束',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const filename=`204-v1-tool-feedback-controlled-${theme}-${locale}-${width}.png`,file=path.join(web,'assets/screenshots',filename);await page.screenshot({path:file,animations:'disabled'});report.screenshots.push({path:'copypaste-web/assets/screenshots/'+filename,sha256:sha(await readFile(file))});
 }
 await page.getByRole('button',{name:'Record a successful correction',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.getByText('The corrected step is complete. Its recorded usage is retained.',{exact:true}).waitFor();report.checks.push('Actual success event removes unresolved delivery feedback; bilingual dual themes have no horizontal overflow');
 assert.deepEqual(report.errors,[]);report.status='passed';
}finally{if(recording)report.recordings.push(await recording.stop());await browser?.close();await server.close();report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,receipt:path.join(out,'receipt.json')}));
