import {runCloudBrowserPreview} from '../src/cloud-browser-preview.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const root=path.resolve('.data/browser-deadline-189',randomUUID());
await mkdir(root,{recursive:true});
const started=Date.now();
try{
 const result=await runCloudBrowserPreview(root,{entry:'index.html',timeout_ms:5000,checks:[{name:'Blocked renderer must never pass',selector:'h1',expect:{text:'Never returns'}}]},[{path:'index.html',bytes:Buffer.from("<h1>Blocked script</h1><script>console.log('entered blocked script');for(;;){}</script>")}]);
 const report={stage:189,status:'observed',elapsed_ms:Date.now()-started,receipt:result.receipt};
 await writeFile(path.join(root,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({elapsed_ms:report.elapsed_ms,stop_reason:result.receipt.stop_reason,check:result.receipt.check_result,host:result.receipt.host,receipt:path.join(root,'receipt.json')}));
}catch(error){
 const report={stage:189,status:'failed',elapsed_ms:Date.now()-started,error_class:error instanceof Error?error.name:'Unknown',code:error&&typeof error==='object'&&'code' in error?error.code:null};
 await writeFile(path.join(root,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({...report,receipt:path.join(root,'receipt.json')}));throw error;
}
