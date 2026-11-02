import {launch,authenticate,ok,privateRoot} from './live-client-189-v2.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const setup=JSON.parse(await readFile(path.join(privateRoot,'image-web-isolated-setup-189-v1.private.json'),'utf8'));
let browser,auth;
try {
 browser=await launch();auth=await authenticate(browser,'imageqa',setup.email);
 const base=`/v1/tenants/${setup.qa_workspace.id}/projects/${setup.qa_workspace.project_id}`;
 const task=await ok(auth.page,base+'/tasks/7f7e4447-bae5-4148-a78a-811043c7b67b');
 const assets=await ok(auth.page,base+'/assets');
 const file=path.join(privateRoot,'real-image-delivery-inspection-189-v1.private.json');
 await writeFile(file,JSON.stringify({task,assets},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({file,task,assets},null,2));
} finally {await auth?.context.close();await browser?.close();}
