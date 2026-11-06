from pathlib import Path

root=Path('D:/dev/copypasted/自有agent/dev')
backend=root/'copypaste-platform'
source=(backend/'tests/integrated-workspace-195-v5.test.ts').read_text(encoding='utf-8')
head=source[:source.index('async function operator(')]
head=head.replace('import { zipSync, strToU8 } from "fflate";', 'import {workspaceDocument,editedWorkspaceBytes,workspaceDiff,workspaceTextLimit} from "../src/workspace-text.js";')
tests=r'''
async function opened(){const f=await fixture(),q=await completed(f,1),url=f.base+'/tasks/'+q.task_id+'/workspace';const w=await ok(f.owner,'GET',url),file=w.files[0];return {...f,q,url,file};}
const editBody=(file:any,e:any,text:string)=>({asset_version_id:file.version_id,expected_task_version:e.task_version,expected_delivery_hash:e.delivery_hash,expected_sha256:e.file.sha256,text});
async function money(f:any){return (await s.db.control.query('SELECT (SELECT count(*)::int FROM ledger WHERE tenant_id=$1) AS ledger,(SELECT count(*)::int FROM tasks WHERE project_id=$2) AS tasks,(SELECT charged_micros FROM tasks WHERE id=$3) AS charged',[f.tenant,f.project,f.q.task_id])).rows[0];}

test('manual edits create immutable versions, retain exact original bytes, invalidate reviews and never start model work or fees',async()=>{
 const f=await opened(),e=await ok(f.owner,'GET',f.url+'/editor?asset_version_id='+f.file.version_id),before=await money(f);
 const accepted=await review(f,f.q);assert.equal(accepted.status,200,JSON.stringify(accepted.data));
 const latest=await ok(f.owner,'GET',f.url+'/editor?asset_version_id='+f.file.version_id),body=editBody(f.file,latest,'人工核对后的交付\nRevenue: HK$100\n'),key=randomUUID();
 const r=await call(f.owner,'POST',f.url+'/edit',body,key);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.changed,true);assert.equal(r.data.file.version,f.file.version+1);
 assert.deepEqual((await call(f.owner,'POST',f.url+'/edit',body,key)).data,r.data);
 assert.deepEqual(await money(f),before);
 const versions=await ok(f.owner,'GET',f.url+'/versions?asset_version_id='+r.data.file.asset_version_id);
 assert.equal(versions.items[0].asset_version_id,f.file.version_id);
 const diff=await ok(f.owner,'GET',f.url+'/compare?'+new URLSearchParams({asset_version_id:r.data.file.asset_version_id,against_version_id:f.file.version_id}));
 assert.equal(diff.state,'ready');assert.ok(diff.added>0);assert.ok(diff.removed>0);assert.match(JSON.stringify(diff.lines),/人工核对/);
 const old=(await s.db.control.query('SELECT storage_key,sha256 FROM asset_versions WHERE id=$1',[f.file.version_id])).rows[0];
 assert.equal(hash(await s.storage.get(old.storage_key)),f.file.sha256);
 const quality=await ok(f.owner,'GET',f.base+'/tasks/'+f.q.task_id+'/quality');assert.notEqual(quality.customer_status,'accepted');
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='task.workspace.edit' AND target=$1",[f.q.task_id])).rows[0].n,1);
 assert.equal(e.can_edit,true);assert.match(r.raw.headers['cache-control'] as string,/no-store/);
});
test('simultaneous edits admit one writer and preserve the losing draft without an extra version or charge',async()=>{
 const f=await opened(),e=await ok(f.owner,'GET',f.url+'/editor?asset_version_id='+f.file.version_id),before=await money(f);
 const results=await Promise.all(['Writer A','Writer B'].map(text=>call(f.owner,'POST',f.url+'/edit',editBody(f.file,e,text))));
 assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results.map(r=>({status:r.status,data:r.data}))));
 assert.ok(results.some(r=>[404,409].includes(r.status)));
 const n=(await s.db.control.query('SELECT count(*)::int AS n FROM asset_versions WHERE asset_id=$1',[f.file.id])).rows[0].n;assert.equal(n,2);assert.deepEqual(await money(f),before);
});
test('unchanged saves are no-ops; cross-project versions, outsiders, damaged hashes and revoked replay cannot bypass access',async()=>{
 const f=await opened(),other=await opened(),e=await ok(f.owner,'GET',f.url+'/editor?asset_version_id='+f.file.version_id),body=editBody(f.file,e,e.text),key=randomUUID();
 assert.equal((await call(f.owner,'POST',f.url+'/edit',body,key)).data.changed,false);
 assert.equal((await s.db.control.query('SELECT count(*)::int AS n FROM asset_versions WHERE asset_id=$1',[f.file.id])).rows[0].n,1);
 assert.equal((await call(other.owner,'POST',f.url+'/edit',body)).status,404);
 assert.equal((await call(f.owner,'GET',f.url+'/compare?asset_version_id='+f.file.version_id+'&against_version_id='+other.file.version_id)).status,404);
 assert.equal((await call(f.owner,'POST',f.url+'/edit',{...body,text:'changed',expected_sha256:'0'.repeat(64)})).status,409);
 await s.db.control.query("UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.owner.id]);
 assert.ok([403,404].includes((await call(f.owner,'POST',f.url+'/edit',body,key)).status));
});
test('moderation removes editor and history access rather than leaking an earlier private version',async()=>{
 const f=await opened();await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[f.file.id]);
 for(const path of ['/editor?asset_version_id=','/versions?asset_version_id='])assert.equal((await call(f.owner,'GET',f.url+path+f.file.version_id)).status,404);
});
test('UTF-8 editing preserves original BOM and CRLF and refuses destructive binary, mixed-format, size or Unicode conversion',()=>{
 const original=Buffer.from('\ufeff繁體中文\r\n原稿\r\n'),doc=workspaceDocument(original);
 assert.equal(doc.text,'繁體中文\n原稿\n');assert.deepEqual(editedWorkspaceBytes(doc,doc.text),original);
 assert.deepEqual(editedWorkspaceBytes(doc,'繁體中文\n修訂\n'),Buffer.from('\ufeff繁體中文\r\n修訂\r\n'));
 assert.throws(()=>workspaceDocument(Buffer.from([0xc3,0x28])),/UTF-8/);
 assert.throws(()=>workspaceDocument(Buffer.from('a\0b')),/Binary/);
 assert.throws(()=>editedWorkspaceBytes(workspaceDocument(Buffer.from('a\r\nb\nc')),'fix'),/mixed/);
 assert.throws(()=>editedWorkspaceBytes(doc,'\ud800'),/Unicode/);
 assert.throws(()=>editedWorkspaceBytes(doc,'中'.repeat(workspaceTextLimit)),/256 KiB/);
 assert.equal(workspaceDiff('a\n'.repeat(20001),'b').state,'summary_only');
 assert.equal(workspaceDiff(Array.from({length:1100},(_,i)=>'a'+i).join('\n'),Array.from({length:1100},(_,i)=>'b'+i).join('\n')).state,'summary_only');
});
test('bounded diff reconstructs actual requested output with correct line positions for insertions, deletions, repeats and empty lines',()=>{
 const values=['','a','a\na','a\nb\na','繁體\n中文\n','one\ntwo\nthree','same\n'.repeat(30)];
 for(const before of values)for(const after of values){
  const result=workspaceDiff(before,after);assert.equal(result.state,'ready');if(result.state!=='ready')continue;
  const original=before.split('\n'),rebuilt:string[]=[];let cursor=0,removed=0,added=0;
  for(const line of result.lines){
   if(line.kind==='skip'){assert.equal(line.old_line,cursor+1);rebuilt.push(...original.slice(cursor,cursor+line.count!));cursor+=line.count!;}
   else if(line.kind==='context'){assert.equal(line.old_line,cursor+1);assert.equal(line.text,original[cursor++]);rebuilt.push(line.text!);}
   else if(line.kind==='remove'){assert.equal(line.old_line,cursor+1);assert.equal(line.text,original[cursor++]);++removed;}
   else{rebuilt.push(line.text!);++added;}
  }
  assert.equal(cursor,original.length);assert.equal(rebuilt.join('\n'),after);assert.equal(result.added,added);assert.equal(result.removed,removed);
 }
});
'''
(backend/'tests/workspace-completion-196-v1.test.ts').write_text(head+tests,encoding='utf-8',newline='\n')
cloud=(backend/'tests/cloud-program-tools.test.ts').read_text(encoding='utf-8')
cloudhead=cloud[:cloud.index('test("private software sources')]
cloudtest=r'''
test('browser and terminal pagination filter on the server before applying cursors and never mix execution types',async()=>{
 const f=await fixture();
 const task=await run(f,async ctx=>{
  await tool(ctx,'code_write')({path:'index.html',content:'<!doctype html><h1>Real browser record</h1>'});
  await tool(ctx,'code_write')({path:'simple.cjs',content:'console.log("actual terminal record");'});
  for(let i=0;i<3;i++)await tool(ctx,'process_run_allowed')({program:'node',entry:'simple.cjs'});
  for(let i=0;i<2;i++)await tool(ctx,'browser_preview')({entry:'index.html',checks:[{name:'actual heading',selector:'h1',expect:{text:'Real browser record'}}]});
 });
 const base=f.base+`/tasks/${task.id}/software-checks`;
 const a=(await call(f.c,'GET',base+'?view=terminal&limit=2')).data;
 assert.equal(a.items.length,2);assert.ok(a.items.every((r:any)=>r.program!=='browser_preview'));assert.ok(a.next_cursor);
 const b=(await call(f.c,'GET',base+'?view=terminal&limit=2&before='+a.next_cursor)).data;
 assert.equal(b.items.length,1);assert.equal(b.next_cursor,null);
 const c=(await call(f.c,'GET',base+'?view=browser&limit=1')).data;
 assert.equal(c.items.length,1);assert.equal(c.items[0].program,'browser_preview');assert.ok(c.next_cursor);
 const d=(await call(f.c,'GET',base+'?view=browser&limit=1&before='+c.next_cursor)).data;
 assert.equal(d.items.length,1);assert.equal(d.items[0].program,'browser_preview');assert.equal(d.next_cursor,null);
 const foreignCursor=(await call(f.c,'GET',base+'?view=browser&before='+a.next_cursor)).data;assert.equal(foreignCursor.items.length,0);
 assert.equal((await call(f.c,'GET',base+'?view=all')).data.items.length,5);
});
'''
(backend/'tests/workspace-execution-196-v1.test.ts').write_text(cloudhead+cloudtest,encoding='utf-8',newline='\n')
verifier=(root/'copypaste-delivery/scripts/verify-integrated-round-195-v8.mjs').read_text(encoding='utf-8')
verifier=verifier.replace('integrated-195-v8','integrated-196-v1').replace('195-integrated-development-round.md','196-workspace-completion-round.md')
verifier=verifier.replace('integrated-workspace-195|business-quality', 'workspace-completion-196|workspace-execution-196|cloud-program-tools\\.|integrated-workspace-195|business-quality')
verifier=verifier.replace("name.includes('integrated-workspace-195')", "name.includes('workspace-completion-196')")
(root/'copypaste-delivery/scripts/verify-integrated-round-196-v1.mjs').write_text(verifier,encoding='utf-8',newline='\n')
print('New versioned integration and boundary tests prepared; no test has run.')
