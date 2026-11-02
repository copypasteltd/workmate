import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const html=await readFile('deploy/operator-mailbox/index.html');
const out=path.resolve('.data/deployment-185');await mkdir(out,{recursive:true});
const report={stage:185,status:'started',scope:'native browser regression using synthetic mail; separate from live qualification',checks:[]};
let browser,context,active=0,maximum=0,listingFailure=false;
let files=Array.from({length:34},(_,i)=>({name:'sunday-'+String(i).padStart(2,'0')+'.json',type:'file',mtime:new Date(Date.UTC(2026,10,1,12,i)).toUTCString(),size:100}));
files.push({name:'monday-newest.json',type:'file',mtime:'Mon, 02 Nov 2026 00:16:13 GMT',size:100});
const server=createServer(async(req,res)=>{
 if(req.url==='/ops/mailbox/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 res.setHeader('Content-Type','application/json');
 if(req.url==='/ops/mailbox/data/'){res.writeHead(listingFailure?503:200);res.end(JSON.stringify(listingFailure?{}:files));return;}
 if(req.url?.startsWith('/ops/mailbox/data/')){
  const name=decodeURIComponent(req.url.split('/').at(-1)),file=files.find(f=>f.name===name);
  if(!file){res.writeHead(404);res.end('{}');return;}
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,25));active--;
  res.end(JSON.stringify({to:'<img src=x onerror="window.mailExecuted=true">@example.invalid',subject:'Synthetic regression',at:new Date(file.mtime).toISOString(),text:'Synthetic test only. Your CopyPaste code is 000000. <script>window.mailExecuted=true</script>'}));return;
 }
 res.writeHead(404);res.end('{}');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const pass=name=>report.checks.push({name,status:'passed'});
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')});
 context=await browser.newContext({viewport:{width:420,height:900}});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/ops/mailbox/');await page.locator('#mail[aria-busy="false"]').waitFor();
 assert.equal(await page.locator('article').count(),30);
 assert.equal(await page.locator('article').first().getAttribute('data-message-id'),'monday-newest.json');
 assert.ok(maximum<=6);pass('Monday code precedes 34 Sunday messages before the 30-message limit; reads capped at six');
 assert.equal(await page.evaluate(()=>window.mailExecuted),undefined);assert.equal(await page.locator('article img,article script').count(),0);pass('mail content renders as text without executing HTML');
 const later={name:'year-boundary.json',type:'file',mtime:'Fri, 01 Jan 2027 00:00:01 GMT',size:100};
 files.push({name:'previous-year.json',type:'file',mtime:'Thu, 31 Dec 2026 23:59:59 GMT',size:100},later);
 await page.locator('article[data-message-id="year-boundary.json"]').waitFor({timeout:15000});
 assert.equal(await page.locator('article').first().getAttribute('data-message-id'),later.name);pass('new mail appears automatically without a click and sorts correctly across the year boundary');
 const preserved=await page.locator('article').count();listingFailure=true;
 await page.getByRole('button',{name:'重新整理 / Refresh',exact:true}).click();await page.locator('#error:not([hidden])').waitFor();
 assert.equal(await page.locator('article').count(),preserved);pass('read failure displays a visible error and preserves previous messages');
 listingFailure=false;await page.getByRole('button',{name:'重新整理 / Refresh',exact:true}).click();
 await page.locator('#mail[aria-busy="false"]').waitFor();assert.equal(await page.locator('#error').isHidden(),true);pass('manual retry restores success status');
 files=[];await page.getByRole('button',{name:'重新整理 / Refresh',exact:true}).click();await page.locator('.empty').waitFor();
 assert.equal(await page.locator('article').count(),0);pass('empty mailbox has an explicit explanation');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);pass('narrow viewport has no horizontal overflow or script errors');
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;}
finally{await context?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));report.browser_closed=true;report.server_closed=true;await writeFile(path.join(out,'native-mailbox-v1.sanitized.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
assert.equal(report.status,'passed');
