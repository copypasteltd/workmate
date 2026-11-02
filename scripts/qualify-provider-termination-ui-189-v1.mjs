import {launch,authenticate,context,ok,screenshot,privateRoot,ADMIN} from './live-client-189-v2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const run=path.join(privateRoot,'termination-ui-'+randomUUID());await mkdir(run,{recursive:true});
const report={stage:189,status:'running',at:new Date().toISOString(),scope:'Actual public Admin read-only evidence form on the owned image validation request. No evidence is submitted and no new model call is made.',checks:[]};
let browser,auth,recorded,page,video;
const pass=name=>{report.checks.push({name,status:'passed'});console.log(JSON.stringify({name,status:'passed'}));};
try{
 browser=await launch();auth=await authenticate(browser,'admin');assert.equal(auth.identity.highest_admin,true);
 recorded=await context(browser,{storageState:await auth.context.storageState(),recordVideo:{dir:run,size:{width:1440,height:1000}}});
 await auth.context.close();auth=null;
 page=await recorded.newPage();video=page.video();
 await page.goto(ADMIN+'/provider-control?view=requests',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'Provider controls',exact:true}).waitFor();
 await page.addStyleTag({content:'.user-chip strong{filter:blur(8px)}'});
 const target=page.locator('tr').filter({hasText:'gpt-image-2'}).first();
 await target.getByRole('button',{name:'View request',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 const summary=dialog.locator('summary').filter({hasText:'Register provider usage or termination evidence'});await summary.click();
 const scope=dialog.getByLabel('Evidence scope',{exact:true});await scope.waitFor();
 assert.equal(await scope.inputValue(),'cost_and_termination');
 await dialog.locator('input[name="invoice"]').waitFor();await dialog.locator('input[name="images"]').waitFor();
 pass('existing usage and invoice fields remain available for actual cost evidence');
 await scope.selectOption('termination_only');
 assert.equal(await dialog.locator('input[name="invoice"]').count(),0);assert.equal(await dialog.locator('input[name="images"]').count(),0);
 await dialog.getByRole('status').filter({hasText:'unknown cost and the original budget remain reserved'}).waitFor();
 pass('termination-only selection removes invented invoice and quantity inputs and explains the retained financial hold');
 await scope.scrollIntoViewIfNeeded();await screenshot(page,path.join(run,'01-termination-only.png'));
 await scope.selectOption('cost_and_termination');await dialog.locator('input[name="invoice"]').waitFor();
 await scope.selectOption('termination_only');await screenshot(page,path.join(run,'02-termination-selected.png'));
 pass('changing evidence scope restores the actual invoice fields and consistently returns to unknown financial facts');
 const current=await ok(page,'/v1/admin/ai/requests/generation/b29c076a-1fdd-497a-a5c3-71090cdcb56c');
 assert.equal(current.state,'unknown');assert.equal(current.capacity_held,false);assert.equal(current.cost.state,'unknown');assert.equal(current.cost.amount_micros,null);
 pass('public Admin reads the actual released capacity with the original unknown outcome and unknown cost retained');
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error.message);}
finally{
 if(page)await ok(page,'/v1/admin/auth/logout',{}).catch(()=>{});
 await auth?.context.close();await recorded?.close();await browser?.close();report.owned_browser_closed=true;
 if(video)report.video=await video.path();report.finished_at=new Date().toISOString();
 await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));
}
assert.equal(report.status,'passed');
