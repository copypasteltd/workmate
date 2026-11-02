import {launch,authenticate,ok} from './live-client-189-v2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID}from'node:crypto';import path from'node:path';
const out=path.resolve('.data/acceptance-192/error-observation-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:192,at:new Date().toISOString(),scope:'Read-only actual customer/admin error metadata; no task dispatch, fee edit or report rewrite',checks:[]};let browser,user,admin;
try{
 browser=await launch();user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local');
 const task=await ok(user.page,'/v1/tenants/f5b06ebd-ec59-414c-ad1a-04224d202fc0/projects/f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a/tasks/dddcb494-42f4-4d29-80bd-9c4bd4141176');
 report.customer_task={id:task.id,status:task.status,error_code:task.error_code,client_error_code:task.client_error_code??null,original_error_metadata_exposed:'client_error_code'in task};
 admin=await authenticate(browser,'admin');const listing=await ok(admin.page,'/v1/admin/execution?tenant_id=f5b06ebd-ec59-414c-ad1a-04224d202fc0&page_size=100');
 const row=listing.items.find(x=>x.id===task.id);report.admin_task=row?{id:row.id,status:row.status,error_code:row.error_code,client_error_code:row.client_error_code??null,original_error_metadata_exposed:'client_error_code'in row}:null;
 report.status='observed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close();await admin?.context.close();await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));}
