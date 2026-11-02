import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import https from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin='http://192.168.31.20:63071';
const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8'));
const addresses=await lookup(new URL(origin).hostname,{all:true});
const address=addresses.find(x=>x.address==='172.67.180.165')??addresses.find(x=>x.family===4);
assert.ok(address);
const out=path.resolve('.data/deployment-185');await mkdir(out,{recursive:true});
const report={stage:185,operation:'read_only_mailbox_diagnosis',at:new Date().toISOString(),tls_verification:false,network_scope:'owned_LAN_HTTP'};
let browser,context;
async function read(url){
 return await new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{Authorization:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64'),'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache'},lookup:(host,options,done)=>options?.all?done(null,[address]):done(null,address.address,address.family),signal:AbortSignal.timeout(20000)},response=>{
   const chunks=[];let bytes=0;
   response.on('data',x=>{bytes+=x.length;if(bytes>4000000)request.destroy(Error('Bounded mailbox read exceeded'));else chunks.push(x);});
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));response.on('error',reject);
  });request.on('error',reject);
 });
}
try{
 const listing=await read(origin+'/ops/mailbox/data/');assert.equal(listing.status,200);
 const files=JSON.parse(listing.body).filter(x=>x.type==='file'&&/^[A-Za-z0-9-]+\.json$/.test(x.name));
 const lexical=[...files].sort((a,b)=>b.mtime.localeCompare(a.mtime));
 const numeric=[...files].sort((a,b)=>Date.parse(b.mtime)-Date.parse(a.mtime));
 report.total_messages=files.length;
 report.listing_cache_control=listing.headers['cache-control'];
 report.old_first_five=lexical.slice(0,5).map(({name,mtime})=>({name,mtime}));
 report.latest_first_five=numeric.slice(0,5).map(({name,mtime})=>({name,mtime,old_rank:lexical.findIndex(x=>x.name===name)+1}));
 const latest=numeric[0];assert.ok(latest);
 const message=await read(origin+'/ops/mailbox/data/'+latest.name);assert.equal(message.status,200);
 const mail=JSON.parse(message.body);
 report.latest_message={id:latest.name.replace(/\.json$/,''),at:mail.at,body_has_otp:/code is \d{6}/.test(mail.text),recipient_matches_admin:mail.to===secret.admin_email};
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic','--no-proxy-server','--host-resolver-rules=MAP agent-dashboard.copypaste.hk '+address.address]});
 context=await browser.newContext({httpCredentials:{username:secret.operator_username,password:secret.operator_password,origin},viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});
 await page.goto(origin+'/ops/mailbox/',{waitUntil:'networkidle',timeout:30000});
 await page.locator('article').first().waitFor({timeout:15000});
 report.visible_messages=await page.locator('article').count();
 report.latest_visible=await page.locator('article').filter({hasText:mail.at}).count()>0;
 report.browser_errors=errors;
 report.status=report.latest_visible?'latest_visible':'latest_hidden_by_incorrect_order';
}catch(e){report.status='inspection_failed';report.error=e.message;}
finally{await context?.close();await browser?.close();report.browser_closed=true;await writeFile(path.join(out,'operator-mailbox-before-v2.sanitized.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
assert.notEqual(report.status,'inspection_failed');
