import {launch} from './live-client-189-v2.mjs';
import {existingOwner} from './live-read-only-owner-198-v1.mjs';
import {ok} from './live-client-189-v2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
let browser,user;
try{
 browser=await launch();user=await existingOwner(browser);
 const tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0',projects=await ok(user.page,`/v1/tenants/${tenant}/projects`),result=[];
 for(const p of projects.items){const base=`/v1/tenants/${tenant}/projects/${p.id}`,sources=await ok(user.page,base+'/editable-projects/sources'),current=await ok(user.page,base+'/editable-projects');result.push({project_id:p.id,sources:sources.items,projects:current.items});}
 await mkdir('.data/acceptance-199',{recursive:true});await writeFile('.data/acceptance-199/design-sources.private.json',JSON.stringify({tenant,items:result},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({projects:result.map(p=>({id:p.project_id,sources:p.sources.length,editable:p.projects.length}))}));
}finally{await user?.context.close();await browser?.close();}
