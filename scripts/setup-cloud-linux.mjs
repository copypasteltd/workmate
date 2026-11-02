import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(path.join(root,'src/cloud-linux-host.py')),digest=sha(source);
for(const kind of ['program','browser']){
 const profileBytes=await readFile(path.join(root,`contracts/cloud-${kind}-runtime.linux.json`)),p=JSON.parse(profileBytes);
 assert.equal(sha(await readFile(p.bubblewrap_path)),p.bubblewrap_sha256);
 if(kind==='program'){assert.equal(process.version,p.node_version);assert.equal(sha(await readFile(process.execPath)),p.node_sha256);}
 else for(const f of p.files){const data=await readFile(path.join(p.browser_path,f.path));assert.equal(data.length,f.bytes);assert.equal(sha(data),f.sha256);}
 const folder=path.join(root,`.data/cloud-${kind}-host-linux`);await mkdir(folder,{recursive:true});
 const host=path.join(folder,'cloud-linux-host.py');await writeFile(host,source);await chmod(host,0o755);
 await writeFile(path.join(folder,'manifest.json'),JSON.stringify({kind,boundary:p.boundary,sha256:digest,source_sha256:digest,host_sha256:digest,host_source_sha256:digest,profile_sha256:sha(profileBytes),bubblewrap_path:p.bubblewrap_path,bubblewrap_sha256:p.bubblewrap_sha256},null,2)+'\n');
}
console.log('Native Linux runtime hashes verified; launch under the documented delegated service.');
