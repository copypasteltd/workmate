import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin='https://agent-dashboard.copypaste.hk';
const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8'));
const run=path.resolve('.data/deployment-185/live-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:185,status:'started',at:new Date().toISOString(),scope:'actual public mailbox and administrator OTP sign-in; no mocked API responses',checks:[],run};
let browser,mailboxContext,adminContext,video,stage='public health';
const addresses=await lookup(new URL(origin).hostname,{all:true});
const address=addresses.find(x=>x.address==='172.67.180.165')??addresses.find(x=>x.family===4);assert.ok(address);
const authorization='Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64');
function otp(){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const character of secret.admin_totp_secret.replace(/=+$/,''))bits+=alphabet.indexOf(character.toUpperCase()).toString(2).padStart(5,'0');
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const mac=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=mac.at(-1)&15;
 return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
async function read(suffix,authenticated=true){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await new Promise((resolve,reject)=>{
   const headers={'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache'};if(authenticated)headers.Authorization=authorization;
   const request=https.get(origin+suffix,{family:4,headers,lookup:(host,options,done)=>options?.all?done(null,[address]):done(null,address.address,address.family),signal:AbortSignal.timeout(15000)},response=>{
    const chunks=[];let bytes=0;response.on('data',x=>{bytes+=x.length;if(bytes>4000000)request.destroy(Error('Bounded read exceeded'));else chunks.push(x);});
    response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);
   });request.on('error',reject);
  });}catch(e){report.network_retries??=[];report.network_retries.push({stage,attempt,error:e.message});if(attempt===3)throw e;}
 }
}
async function navigate(page,url){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});}
  catch(e){if(attempt===3)throw e;}
 }
}
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({phase:name,status:'passed'}));};
const media=path.resolve('assets/screenshots');await mkdir(media,{recursive:true});
try{
 assert.equal((await read('/health/ready',false)).status,200);
 report.network={public_host:new URL(origin).hostname,selected_current_dns_address:address.address,tls_verification:true};
 stage='access protection';
 assert.equal((await read('/ops/mailbox/',false)).status,401);
 assert.equal((await read('/ops/mailbox/data/',false)).status,401);
 pass('public page and mail listing retain independent credentials');
 const html=await read('/ops/mailbox/');assert.equal(html.status,200);assert.ok(html.headers['cache-control'].split(',').map(x=>x.trim()).includes('no-store'));
 const expected=createHash('sha256').update(await readFile('deploy/operator-mailbox/index.html')).digest('hex');
 const normalized=html.body.toString('utf8').replace(/<script\b[^>]*src=\"https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[^\"]+\"[^>]*><\/script>\n?/g,'');assert.equal(createHash('sha256').update(normalized).digest('hex'),expected);report.source_sha256=expected;report.edge_transform='Known Cloudflare analytics beacon removed for source comparison; origin bytes match exactly';
 pass('public HTTPS serves the source-verified mailbox plus an identified edge analytics beacon, with no-store');
 const listing=JSON.parse((await read('/ops/mailbox/data/')).body);
 const files=listing.filter(f=>f.type==='file'&&/^[A-Za-z0-9-]+\.json$/.test(f.name)).sort((a,b)=>Date.parse(b.mtime)-Date.parse(a.mtime));
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic','--no-proxy-server','--host-resolver-rules=MAP agent-dashboard.copypaste.hk '+address.address]});
 mailboxContext=await browser.newContext({viewport:{width:1440,height:1000},httpCredentials:{username:secret.operator_username,password:secret.operator_password,origin},recordVideo:{dir:path.join(run,'video'),size:{width:1440,height:1000}}});
 await mailboxContext.addInitScript(()=>{
  const style=document.createElement('style');
  style.textContent='#mail article h2,#mail article pre{color:transparent!important;position:relative} #mail article h2::after,#mail article pre::after{position:absolute;top:0;left:0;color:#61616b;font:13px system-ui} #mail article h2::after{content:"收件人已遮蔽 / Recipient hidden"} #mail article pre::after{content:"郵件與驗證碼已遮蔽 / Message and code hidden"}';
  style.id='qa-mailbox-redaction'; const attach=()=>{if(!document.documentElement)return false;if(!document.getElementById(style.id))document.documentElement.append(style);return true;};if(!attach()){const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
 });
 const page=await mailboxContext.newPage();video=page.video();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 stage='latest existing mail';await navigate(page,origin+'/ops/mailbox/');await page.locator('#mail[aria-busy="false"]').waitFor({timeout:25000});
 assert.equal(await page.locator('article').first().getAttribute('data-message-id'),files[0].name);
 for(const id of ['33907857-9d65-45b6-8dd7-0d85dd1b3448.json','d4f8685f-cbb9-4b2a-a39e-5d3a6bfed398.json'])assert.equal(await page.locator('article[data-message-id="'+id+'"]').count(),1);
 pass('both previously hidden real administrator emails are visible in chronological order');
 assert.equal(await page.locator('article pre').first().evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)');await page.screenshot({path:path.join(media,'185-test-mailbox-restored.png'),animations:'disabled',mask:[page.locator('article h2'),page.locator('article pre')],maskColor:'#e4e4e8'});
 stage='fresh OTP request';adminContext=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-HK'});await adminContext.addInitScript(()=>{localStorage.setItem('cp_locale','en');localStorage.setItem('cp_theme','light');});
 const admin=await adminContext.newPage();await navigate(admin,origin);
 await admin.getByLabel('Administrator email').fill(secret.admin_email);
 const started=Date.now();
 const [challengeResponse]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==='/v1/admin/auth/challenge'&&r.request().method()==='POST'),admin.getByRole('button',{name:'Send admin sign-in code',exact:true}).click()]);
 assert.equal(challengeResponse.status(),200);const challenge=await challengeResponse.json();assert.equal(challenge.delivery,'local_mailbox');
 stage='automatic fresh delivery';
 await page.locator('article[data-message-id="'+challenge.challenge_id+'.json"]').waitFor({timeout:25000});
 assert.equal(await page.locator('article').first().getAttribute('data-message-id'),challenge.challenge_id+'.json');
 const mailResponse=await read('/ops/mailbox/data/'+challenge.challenge_id+'.json');assert.equal(mailResponse.status,200);
 const mail=JSON.parse(mailResponse.body);assert.equal(mail.to,secret.admin_email);
 const code=mail.text.match(/code is (\d{6})/)?.[1];assert.ok(code,'Fresh real email must contain an OTP');
 report.fresh_delivery={challenge_id:challenge.challenge_id,mail_at:mail.at,automatically_visible:true,elapsed_ms:Date.now()-started,code_withheld:true};
 pass('new real OTP automatically appears first without refreshing the page');
 await page.screenshot({path:path.join(media,'185-test-mailbox-fresh.png'),animations:'disabled',mask:[page.locator('article h2'),page.locator('article pre')],maskColor:'#e4e4e8'});
 stage='actual admin authentication';await admin.locator('input[name="code"]').fill(code);await admin.locator('input[name="totp"]').fill(otp());
 await admin.getByRole('button',{name:'Verify & open dashboard',exact:true}).click();
 await admin.getByRole('button',{name:'Sign out admin',exact:true}).waitFor({timeout:25000});
 pass('the received OTP and existing TOTP open the actual administrator dashboard');
 await admin.getByRole('button',{name:'Sign out admin',exact:true}).click();await admin.getByLabel('Administrator email').waitFor({timeout:15000});
 stage='manual refresh';
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/ops/mailbox/data/'),page.getByRole('button',{name:'重新整理 / Refresh',exact:true}).click()]);
 await page.locator('#mail[aria-busy="false"]').waitFor();assert.equal(await page.locator('#error').isHidden(),true);assert.deepEqual(errors,[]);
 pass('manual refresh succeeds without errors; the QA administrator session is signed out');
 report.media={screenshots:['assets/screenshots/185-test-mailbox-restored.png','assets/screenshots/185-test-mailbox-fresh.png'],redaction:'Recipient, message body and OTP text masked before first paint; administrator authentication excluded from recording'};
 report.status='passed';
}catch(e){report.status='failed';report.failure_stage=stage;report.error=e.message;}
finally{await adminContext?.close();await mailboxContext?.close();await browser?.close();report.browser_closed=true;if(video)report.video=await video.path();await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
assert.equal(report.status,'passed');
