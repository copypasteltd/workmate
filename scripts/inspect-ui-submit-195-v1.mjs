import {chromium} from 'playwright';
import {authenticate,ok} from './live-client-189-v2.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const prior=JSON.parse(await readFile('.data/acceptance-195/ui-707e11cf-89d4-470e-aa81-b03089559c2f/receipt.json','utf8'));
let browser,user;
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),args:['--disable-quic']});user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
 const projects=await ok(user.page,'/v1/tenants/'+prior.tenant_id+'/projects'),base=`/v1/tenants/${prior.tenant_id}/projects/${projects.items[0].id}`;
 const current=await ok(user.page,base+'/conversations/'+prior.conversation_id);
 await writeFile('.data/acceptance-195/submit-inspection-v1.private.json',JSON.stringify(current,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({id:current.id,version:current.version,tasks:current.tasks?.map(t=>({id:t.id,status:t.status,error_code:t.error_code})),messages:current.messages?.map(m=>({id:m.id,kind:m.kind,task_id:m.task_id,client_message_id:m.client_message_id}))}));
}finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});}
