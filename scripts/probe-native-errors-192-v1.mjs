import {launch,authenticate,ok} from './live-client-189-v2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID}from'node:crypto';import path from'node:path';
const out=path.resolve('.data/acceptance-192/error-observation-'+randomUUID());await mkdir(out,{recursive:true});
const report={stage:192,at:new Date().toISOString(),scope:'Read-only actual customer/admin error metadata; no task dispatch, fee edit or report rewrite',checks:[]};let browser,user,admin;
try{
 browser=await launch();user=await authenticate(browser,'realqa','qa-live-188@workmate.local');
 const task=await ok(user.page,'/v1/tenants/dfd0a03e-5648-4b7a-a687-fce8aacd658e/projects/30eb572b-52c1-4b99-966d-e3d2239a8b1d/tasks/dddcb494-42f4-4d29-80bd-9c4bd4141176');
 report.customer_task={id:task.id,status:task.status,error_code:task.error_code,client_error_code:task.client_error_code??null,original_error_metadata_exposed:'client_error_code'in task};
 admin=await authenticate(browser,'admin');const listing=await ok(admin.page,'/v1/admin/execution?tenant_id=dfd0a03e-5648-4b7a-a687-fce8aacd658e&limit=100');
 const row=listing.items.find(x=>x.id===task.id);report.admin_task=row?{id:row.id,status:row.status,error_code:row.error_code,client_error_code:row.client_error_code??null,original_error_metadata_exposed:'client_error_code'in row}:null;
 report.status='observed';
}catch(e){report.status='failed';report.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close();await admin?.context.close();await browser?.close();report.owned_browser_closed=true;await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));}
