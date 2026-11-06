import {workspaceDocument,editedWorkspaceBytes,workspaceDiff,workspaceTextLimit} from "../src/workspace-text.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, hash } from "../src/lib.js";
import { Worker } from "../src/worker.js";
import { defaults } from "../src/plans.js";
import { saveAsset } from "../src/storage.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import contract from "../contracts/business-quality-openapi.json" with { type: "json" };
const ajv=new Ajv2020({allErrors:true,strict:false});createRequire(import.meta.url)("ajv-formats")(ajv);
const definitions=JSON.parse(JSON.stringify(contract.components.schemas).replaceAll("#/components/schemas/","#/$defs/"));
function schema(name:string,value:unknown){const validate=ajv.compile({$defs:definitions,$ref:"#/$defs/"+name});assert.ok(validate(value),JSON.stringify(validate.errors));}
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(c: Client | undefined, method: string, url: string, body?: unknown, key: string | null = randomUUID(), headers: Record<string,string> = {}) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({ method: method as any, url, headers: {
    origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(key ? { "idempotency-key": key } : {}),
    ...(tenant ? { "x-tenant-id": tenant } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: unknown) {
  const r = await call(c,method,url,body); assert.ok(r.status>=200 && r.status<300,`${r.status}: ${JSON.stringify(r.data)}`); return r.data;
}
async function user(secret?: OTPAuth.Secret, address = `business-quality-${randomUUID()}@example.invalid`): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const challenge = await ok(undefined,"POST",prefix+"/challenge",{ email: address });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,"utf8"));
  const r = await call(undefined,"POST",prefix+"/verify",{ challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret ? { totp: new OTPAuth.TOTP({secret,digits:6,period:30,algorithm:"SHA1"}).generate() } : {}) });
  assert.equal(r.status,200,JSON.stringify(r.data));
  const cookie=r.raw.cookies.find(c=>c.name===(secret?"cp_admin_session":"cp_session"))!;
  return { id:r.data.user?.id??r.data.admin?.id,cookie:cookie.name+"="+cookie.value,csrf:r.data.csrf_token,admin:!!secret };
}
async function fixture() {
  const owner=await user(), w=await ok(owner,"POST","/v1/tenants",{name:"Quality fixture (simulated model)",project_name:"Actual record checks"});
  const tenant=w.tenant.id,project=w.project.id,base=`/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Isolated quality fixture',$2)",[tenant,defaults.business]);
  const agent=await ok(owner,"POST",base+"/agents",{name:"Fixture assistant",role_key:"assistant"});
  return { owner,tenant,project,base,agent };
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
class FixtureRuntime extends CodexRuntimeAdapter {
  constructor(private files=2,private readAsset?:string){super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
    if(this.readAsset) await ctx.tools.find(t=>t.name==="asset_text_read")!.run({asset_id:this.readAsset},"quality-actual-read");
    for(let i=0;i<this.files;i++)await ctx.tools.find(t=>t.name==="deliver_text")!.run({filename:`quality-${i}.md`,content:"Explicit simulated delivery "+i,mime_type:"text/markdown"},"quality-delivery-"+i);
    return {text:"Explicit simulated business result",inputTokens:10,outputTokens:20,accepted:true,usageKnown:true,status:"completed",thread:"fixture",turn:"1"};
  }
}
async function completed(f:Fixture,files=2,readAsset?:string,shared=false,selectedVersion?:string) {
  const a=await ok(f.owner,"POST",f.base+"/tasks",{title:"Controlled quality test",prompt:"Write clearly simulated business deliverables.",role_key:"assistant",...(shared?{}:{agent_id:f.agent.id}),budget_micros:1000000,...(selectedVersion?{dependencies:[{kind:"file",description:"Explicitly selected fixed-version source for reuse",resource_ids:[selectedVersion]}]}:{})});
  await new Worker(s.db,s.catalog,s.storage,new FixtureRuntime(files,readAsset)).run(f.tenant,a.id);
  const q=await ok(f.owner,"GET",f.base+"/tasks/"+a.id+"/quality"); schema("TaskQuality",q);assert.equal(q.technical_status,"succeeded");return q;
}
const review=(f:Fixture,q:any,decision="accepted",artifacts?:string[])=>call(f.owner,"POST",f.base+"/tasks/"+q.task_id+"/reviews",{
  expected_version:q.task_version,expected_delivery_hash:q.delivery_hash,decision,comment:"Actual test customer input",...(artifacts?{artifact_ids:artifacts}:{}),
});
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",WORKER_ENABLED:"false",DEMO_MODE:"false",AI_BASE_URL:"http://127.0.0.1:9/v1",AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"controlled-fixture-key-195",AI_MODEL:"controlled-fixture",AI_VERIFIED:"true",AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});



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
