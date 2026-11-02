import {launch,authenticate,context,ok,screenshot,privateRoot,WEB} from './live-client-189-v2.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(path.resolve('../copypaste-platform/package.json')),{PNG}=require('pngjs');
const run=path.join(privateRoot,'real-image-web-'+randomUUID());await mkdir(run,{recursive:true});
const previous=JSON.parse(await readFile('.data/acceptance-189/real-image-web-6dabc1cb-df87-4c86-ae0e-e10d9403fdd4/receipt.json','utf8'));
const setup=JSON.parse(await readFile('.data/acceptance-189/image-web-isolated-setup-189-v1.private.json','utf8'));
const report={stage:189,status:'running',at:new Date().toISOString(),scope:'Real public Web designer task with one requested image generation, persisted deliverables, actual download hashes and settled company usage. Maximum task budget HK$5.',checks:[],javascript_errors:[]};
const pass=(name,details)=>{report.checks.push({name,status:'passed',details});console.log(JSON.stringify({name,status:'passed'}));};
const save=()=>writeFile(path.join(run,'state.private.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let browser,auth,c,page,video;
try{
 browser=await launch();auth=await authenticate(browser,'imageqa',setup.email);
 assert.equal(auth.identity.user.id,setup.qa_user_id);
 c=await context(browser,{storageState:await auth.context.storageState(),recordVideo:{dir:run,size:{width:1440,height:1000}}});await auth.context.close();auth=null;
 page=await c.newPage();video=page.video();page.on('pageerror',error=>report.javascript_errors.push(error.message));
 await page.goto(WEB+'/app/roles',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.role-card').first().waitFor();
 await page.addStyleTag({content:'.user-chip strong{filter:blur(8px)}'});
 const config=await ok(page,'/v1/public/config');assert.equal(config.data_mode,'configured_services');assert.equal(config.services.image,true);
 const roles=await ok(page,'/v1/catalog/roles');assert.equal(roles.items.find(r=>r.role_key==='designer').available,true);
 pass('real-service Web exposes the published image model and an available designer specialist');
 const base=`/v1/tenants/${setup.qa_workspace.id}/projects/${setup.qa_workspace.project_id}`;
 const filename=previous.filename;report.filename=filename;report.task_id=previous.task_id;
 report.scope='Read-only continuation of the exact completed public Web Designer task. No new task or model request; actual asset downloads and original-byte verification.';
 report.original_generation_receipt='.data/acceptance-189/real-image-web-6dabc1cb-df87-4c86-ae0e-e10d9403fdd4/receipt.json';
 const task=await ok(page,base+'/tasks/'+report.task_id);assert.equal(task.status,'succeeded');assert.equal(task.charged_micros,previous.task.charged_micros);
 report.task=previous.task;report.new_paid_tasks=0;
 pass('the original completed designer task and exact measured charge are reused without another model call');
 const assets=await ok(page,base+'/assets?q='+encodeURIComponent(filename.slice(0,-4))),asset=assets.items.find(a=>a.name===filename);assert.ok(asset,'The model must save the actual requested PNG');
 const versions=await ok(page,base+'/assets/'+asset.id+'/versions'),version=versions.items.find(v=>v.version===asset.current_version);assert.ok(version);
 const normalization=version.metadata.image_normalization;assert.ok(normalization);report.normalization=normalization;report.asset_id=asset.id;
 await page.goto(WEB+'/app/assets',{waitUntil:'domcontentloaded'});await page.addStyleTag({content:'.user-chip strong{filter:blur(8px)}'});
 async function download(a){const card=page.locator('.asset-card').filter({has:page.getByRole('heading',{name:a.name,exact:true})});await card.waitFor();const [d]=await Promise.all([page.waitForEvent('download',{timeout:60000}),card.getByRole('button',{name:'Download',exact:true}).click()]);const target=path.join(run,a.name);await d.saveAs(target);const bytes=await readFile(target);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);return {bytes,sha256:a.sha256};}
 const output=await download(asset),decoded=PNG.sync.read(output.bytes,{checkCRC:true});assert.deepEqual([decoded.width,decoded.height],[1024,1024]);
 report.download={sha256:output.sha256,width:decoded.width,height:decoded.height};
 if(normalization.applied){const original=assets.items.find(a=>a.id===normalization.original_asset_id);assert.ok(original,'Exact original must remain a separately authorized project artifact');const source=await download(original),pixels=PNG.sync.read(source.bytes,{checkCRC:true});assert.equal(source.sha256,normalization.source.sha256);assert.deepEqual([pixels.width,pixels.height],[normalization.source.width,normalization.source.height]);report.original_download={asset_id:original.id,sha256:source.sha256,width:pixels.width,height:pixels.height};}
 else assert.equal(output.sha256,normalization.source.sha256);
 pass('Web downloads the verified 1024-square PNG and preserves the exact upstream original whenever resizing was needed');
 await screenshot(page,path.join(run,'01-real-image-delivery.png'));await page.locator('.asset-card').filter({has:page.getByRole('heading',{name:filename,exact:true})}).scrollIntoViewIfNeeded();await screenshot(page,path.join(run,'02-downloaded-image.png'));
 assert.deepEqual(report.javascript_errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error.message);}
finally{
 await save();await auth?.context.close();await c?.close();await browser?.close();report.owned_browser_closed=true;if(video)report.video=await video.path();report.finished_at=new Date().toISOString();
 await writeFile(path.join(run,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(run,'receipt.json'),error:report.error}));
}
assert.equal(report.status,'passed');
