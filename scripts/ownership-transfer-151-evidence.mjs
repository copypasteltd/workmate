import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function sourceObject(bytes){
 const sha256=createHash('sha256').update(bytes).digest('hex');
 for(const base of['evidence/scope-erasure-150/objects','evidence/marketing-import-148/objects']){
  const prior=base+'/'+sha256+'.blob';try{assert.deepEqual(await readFile(prior),bytes);return{path:prior,sha256};}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const target='evidence/ownership-transfer-151/objects/'+sha256+'.blob';await mkdir(path.dirname(target),{recursive:true});
 try{await writeFile(target,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(target),bytes);}return{path:target,sha256};
}
