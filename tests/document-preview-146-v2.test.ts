import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unzipSync,zipSync,strToU8} from 'fflate';
import * as fns from './document-preview-fixture-146-v1.js';
import {campaignPDF,campaignWorkbook,campaignSlides} from './document-fixtures-146-v2.js';
import {saveAsset} from '../src/storage.js';
import {DocumentPreviews} from '../src/document-preview.js';
import {inspectOfficePreview} from '../src/document-preview-package.js';
import {hash} from '../src/lib.js';
before(fns.start);after(fns.stop);
async function save(f:any,name:string,bytes:Buffer,asset?:any){return fns.s.db.tx(tx=>saveAsset(tx,fns.s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name,mime:name.endsWith('.pdf')?'application/pdf':'application/octet-stream',bytes,...(asset?{asset:asset.id,expectedVersion:asset.current_version}:{})}),undefined,true);}
async function preview(f:any,a:any,page=1,user=f.owner){return fns.call(user,'GET',`${f.base}/assets/${a.id}/document-preview?asset_version_id=${a.version.id}&page=${page}`,undefined,f.tenant);}
test('API previews fixed PDF pages, exact SHA and private nodes; previews create no AI requests',{timeout:120000},async()=>{
  const f=await fns.fixture(),a=await save(f,'Campaign.pdf',await campaignPDF());
  const one=await preview(f,a),two=await preview(f,a,2);assert.equal(one.status,200,one.raw.body);assert.equal(two.status,200,two.raw.body);
  assert.equal(one.data.sha256,a.version.sha256);assert.equal(one.data.page_count,2);assert.match(two.data.text,/Measured campaign result/);assert.match(one.raw.headers['cache-control'] as string,/no-store/);
  assert.notEqual(one.data.preview_image.base64,two.data.preview_image.base64);assert.equal((await preview(f,a,3)).status,416);
  const root=(await fns.ok(f.owner,'GET',`/v1/workspaces/${f.privateWs.id}/nodes`,undefined,f.tenant)).items.find((x:any)=>x.root_kind==='attachments');
  const node=await fns.ok(f.owner,'POST',`/v1/workspaces/${f.privateWs.id}/nodes`,{name:'Private campaign',kind:'file',parent_id:root.id,asset_version_id:a.version.id},f.tenant,201);
  const url=`/v1/workspace-nodes/${node.id}/document-preview?asset_version_id=${a.version.id}`;
  assert.equal((await fns.call(f.member,'GET',url,undefined,f.tenant)).status,404);
  assert.equal((await fns.call(f.owner,'GET',url,undefined,f.tenant)).status,200);
  const changed=await save(f,'Campaign.pdf',await campaignPDF(),a);
  assert.equal((await fns.call(f.owner,'GET',url.replace(a.version.id,changed.version.id),undefined,f.tenant)).status,409);
  assert.equal((await fns.call(f.owner,'GET',url,undefined,f.tenant)).data.source_version,1);
  assert.equal((await fns.s.db.control.query('SELECT count(*)::int AS n FROM current_ai_provider_requests WHERE tenant_id=$1',[f.tenant])).rows[0].n,0);
});
test('modern workbook and slides render actual independent Office pages and preserve uploaded bytes',{timeout:180000},async()=>{
  const f=await fns.fixture();
  for(const [name,bytes]of [['Campaign.xlsx',campaignWorkbook()],['Campaign.pptx',await campaignSlides()]] as const){
    const a=await save(f,name,bytes),one=await preview(f,a),two=await preview(f,a,2);
    assert.equal(one.status,200,one.raw.body);assert.equal(two.status,200,two.raw.body);assert.equal(one.data.page_count,2,name);
    assert.match(one.data.text,/Approved campaign/);assert.match(two.data.text,/Measured campaign result/);assert.notEqual(one.data.preview_image.base64,two.data.preview_image.base64);
    const key=(await fns.s.db.control.query('SELECT storage_key FROM asset_versions WHERE id=$1',[a.version.id])).rows[0].storage_key;
    assert.equal(hash(await fns.s.storage.get(key)),hash(bytes));
  }
});
test('post-read authorization rejects revoked sessions, withdrawn project membership and quarantined cached Office sources',{timeout:180000},async()=>{
  for(const change of ['session','membership','quarantine']){
    const f=await fns.fixture(),a=await save(f,change==='quarantine'?'Campaign.xlsx':'Campaign.pdf',change==='quarantine'?campaignWorkbook():await campaignPDF());
    if(change==='quarantine')assert.equal((await preview(f,a,1,f.member)).status,200);
    const original=fns.s.storage.get.bind(fns.s.storage);let changed=false;
    fns.s.storage.get=async(key:string)=>{const b=await original(key);if(!changed){changed=true;
      if(change==='session')await fns.s.db.control.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[f.member.id]);
      if(change==='membership')await fns.s.db.control.query("UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.member.id]);
      if(change==='quarantine')await fns.s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[a.id]);
    }return b;};
    try{const reply=await preview(f,a,1,f.member);assert.ok([401,403,404].includes(reply.status),`${change}: ${reply.raw.body}`);assert.equal(reply.data.preview_image,undefined);}finally{fns.s.storage.get=original;}
  }
});
test('asset cursor traverses more than 200 rows without microsecond skips and filters literal search and private scope',{timeout:180000},async()=>{
  const f=await fns.fixture(),ids:string[]=[];
  for(let i=0;i<213;i++)ids.push((await save(f,`Campaign ${String(i).padStart(3,'0')}.pdf`,Buffer.from('fixture-data'))).id);
  await fns.s.db.control.query("UPDATE assets SET created_at='2026-10-01 00:00:00.123456+00'::timestamptz + ((array_position($1::uuid[],id)%3)||' microseconds')::interval WHERE id=ANY($1::uuid[])",[ids]);
  const hidden=await save(f,'Private customer strategy.pdf',Buffer.from('private'));
  await fns.s.db.control.query('UPDATE assets SET private_owner=$2 WHERE id=$1',[hidden.id,f.owner.id]);
  const seen:string[]=[];let cursor:string|null=null;
  do{const page=await fns.ok(f.member,'GET',f.base+'/assets?limit=50'+(cursor?'&cursor='+cursor:''),undefined,f.tenant);seen.push(...page.items.map((x:any)=>x.id));cursor=page.next_cursor;}while(cursor);
  assert.equal(seen.length,213);assert.equal(new Set(seen).size,213);assert.deepEqual([...seen].sort(),[...ids].sort());
  const literal=await save(f,'Campaign 100%_\\ approved.pdf',Buffer.from('literal'));
  const searched=await fns.ok(f.owner,'GET',f.base+'/assets?limit=50&q='+encodeURIComponent('100%_\\'),undefined,f.tenant);
  assert.deepEqual(searched.items.map((x:any)=>x.id),[literal.id]);
  const priv=await fns.ok(f.owner,'GET',f.base+'/assets?scope=private&limit=50',undefined,f.tenant);assert.deepEqual(priv.items.map((x:any)=>x.id),[hidden.id]);
  assert.equal((await fns.call(f.member,'GET',f.base+'/assets?limit=50&cursor='+hidden.id,undefined,f.tenant)).status,409);
});
test('version pagination keeps selected older revision and excludes erased sources',{timeout:120000},async()=>{
  const f=await fns.fixture();let a=await save(f,'Versioned campaign.pdf',Buffer.from('version 1'));const first=a.version.id;
  for(let i=2;i<=54;i++)a=await save(f,'Versioned campaign.pdf',Buffer.from('version '+i),a);
  const top=await fns.ok(f.owner,'GET',`${f.base}/assets/${a.id}/versions?limit=50`,undefined,f.tenant);assert.equal(top.items.length,50);assert.equal(top.items[0].version,54);
  const older=await fns.ok(f.owner,'GET',`${f.base}/assets/${a.id}/versions?limit=50&before_version=${top.next_cursor}`,undefined,f.tenant);
  assert.deepEqual(older.items.map((v:any)=>v.version),[4,3,2,1]);assert.equal(older.items[3].id,first);assert.equal(older.next_cursor,null);
  await fns.s.db.control.query('UPDATE asset_versions SET erased_at=now() WHERE id=$1',[first]);
  assert.ok(!(await fns.ok(f.owner,'GET',`${f.base}/assets/${a.id}/versions?limit=50&before_version=5`,undefined,f.tenant)).items.some((v:any)=>v.id===first));
});
test('Office preflight rejects encoded external images, SVG fetches, traversal and nested macros before launch',async()=>{
  const source=campaignWorkbook();
  for(const [name,content]of [
    ['xl/_rels/unsafe.xml.rels','<Relationships><Relationship Type="image" Target="https&#58;//example.invalid/private" TargetMode="External"/></Relationships>'],
    ['xl/media/image.svg','<svg xmlns="http://www.w3.org/2000/svg"><image href="https&#58;//example.invalid/private.png"/></svg>'],
    ['_rels/.rels','<Relationships><Relationship Type="officeDocument" Target="../private.xml"/></Relationships>'],
  ]){const files=unzipSync(source);files[name]=strToU8(content);await assert.rejects(inspectOfficePreview(Buffer.from(zipSync(files))),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');}
  const nested=unzipSync(source);nested['xl/vbaProject.bin']=strToU8('blocked');const files=unzipSync(source);files['xl/embeddings/embedded.xlsx']=zipSync(nested);
  await assert.rejects(inspectOfficePreview(Buffer.from(zipSync(files))),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
});
test('cancelled, invalid and stopped previews release their user slot',{timeout:60000},async()=>{
  const renderer=new DocumentPreviews(),signal=new AbortController();signal.abort();
  try{await assert.rejects(renderer.render('customer','cancelled',await campaignPDF(),1,signal.signal));
    await assert.rejects(renderer.render('customer','bad',Buffer.from('x'),1,new AbortController().signal));
    assert.equal((await renderer.render('customer','valid',await campaignPDF(),1,new AbortController().signal)).page_count,2);
  }finally{await renderer.close();}
  await assert.rejects(renderer.render('customer','stopped',await campaignPDF(),1,new AbortController().signal),(e:any)=>e.code==='DOCUMENT_PREVIEW_STOPPED');
});
