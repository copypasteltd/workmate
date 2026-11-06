from pathlib import Path
import json

root=Path('D:/dev/copypasted/自有agent/dev')
backend=root/'copypaste-platform'
baseline=(backend/'tests/business-quality.test.ts').read_text(encoding='utf-8')
# Use the established isolated native DB/fixture harness. No production records change.
head=baseline[:baseline.index('test("current artifact reviews')]
tests=r'''
async function operator(permissions=["admin.catalog.read","admin.catalog.publish"]){
 const address=`round195-${randomUUID()}@example.invalid`,secret=new OTPAuth.Secret({size:20});
 const principal=(await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Round 195 test reviewer',$2) RETURNING id",[address,seal(s.db.config.MASTER_KEY!,secret.base32)])).rows[0];
 const role="test195_"+principal.id.replaceAll("-","");
 await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Round 195 test only',$2)",[role,JSON.stringify(permissions)]);
 await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",[principal.id,role]);
 return {...await user(secret,address),id:principal.id};
}
test("task workspace keeps private task boundaries and immutable file versions",async()=>{
 const f=await fixture(),q=await completed(f),root=f.base+"/tasks/"+q.task_id+"/workspace";
 const view=await ok(f.owner,"GET",root);assert.equal(view.task.id,q.task_id);assert.equal(view.files.length,2);
 const file=view.files[0],preview=await ok(f.owner,"GET",root+"/preview?asset_version_id="+file.version_id);
 assert.equal(preview.state,"ready");assert.match(preview.text,/Explicit simulated delivery/);
 assert.equal((await call(await user(),"GET",root)).status,403);
 assert.equal((await call(f.owner,"GET",root+"/preview?asset_version_id="+randomUUID())).status,404);
 await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[file.id]);
 assert.equal((await call(f.owner,"GET",root+"/preview?asset_version_id="+file.version_id)).status,404);
 assert.equal((await ok(f.owner,"GET",root)).files.length,1);
});
test("readiness does not expose credentials or mistake the test inbox for production mail",async()=>{
 const admin=await operator(),body=await ok(admin,"GET","/v1/admin/operational-readiness");
 assert.equal(body.kernel,"codex");assert.equal(body.checks.find((c:any)=>c.key==="mail").state,"test_only");
 assert.equal(body.checks.find((c:any)=>c.key==="production_profile").state,"test_only");
 assert.equal(JSON.stringify(body).includes("controlled-fixture"),false);
 assert.equal(JSON.stringify(body).includes(s.db.config.MASTER_KEY!),false);
 const limited=await operator(["admin.overview.read"]);assert.equal((await call(limited,"GET","/v1/admin/operational-readiness")).status,403);
});
test("acceptance evidence freezes task/delivery versions, retries once and revokes as an audited batch",async()=>{
 const f=await fixture(),q=await completed(f),admin=await operator(),root="/v1/admin/role-acceptance";
 const catalog=await ok(admin,"GET",root),template=catalog.templates.find((a:any)=>a.role_key==="assistant");assert.ok(template);
 const snapshot=await ok(admin,"GET",root+"/tasks/"+q.task_id+"/snapshot");
 const body={template_version_id:template.template_version_id,task_id:q.task_id,case_kind:"normal",decision:"passed",comment:"Human test review of the controlled delivery fixture.",expected_task_version:snapshot.task_version,expected_delivery_hash:snapshot.delivery_hash};
 assert.equal((await call(admin,"POST",root,body)).status,409,"An unaccepted delivery must not pass");
 const failed={...body,decision:"failed"},key=randomUUID();
 const recorded=await call(admin,"POST",root,failed,key);assert.equal(recorded.status,200,JSON.stringify(recorded.data));
 const retried=await call(admin,"POST",root,failed,key);assert.deepEqual(retried.data,recorded.data);
 assert.equal((await call(admin,"POST",root,failed)).status,409);
 const list=await ok(admin,"GET",root+"?template_version_id="+template.template_version_id);assert.equal(list.items.length,1);
 assert.equal(list.professional_qualification,"manual_acceptance_required");assert.equal(list.items[0].proof.delivery_hash,snapshot.delivery_hash);
 const revoke={ids:[recorded.data.id],reason:"Correct an explicitly controlled test review"};const revokeKey=randomUUID();
 assert.equal((await call(admin,"POST",root+"/revoke",revoke,revokeKey)).status,200);
 assert.equal((await call(admin,"POST",root+"/revoke",revoke,revokeKey)).status,200);
 assert.equal((await ok(admin,"GET",root)).items.find((r:any)=>r.id===recorded.data.id).revoked_at!==null,true);
 await assert.rejects(s.db.control.query("UPDATE role_acceptance_evidence SET comment='Changed' WHERE id=$1",[recorded.data.id]));
 assert.ok((await s.db.control.query("SELECT 1 FROM audit_events WHERE action='role.acceptance.revoke' AND target_id=$1",[recorded.data.id])).rowCount);
});
'''
(backend/'tests/integrated-workspace-195-v1.test.ts').write_text(head+tests,encoding='utf-8',newline='\n')
versions={'copypaste-platform':'0.5.2','copypaste-web':'0.5.1','copypaste-admin':'0.5.1','copypaste-desktop':'0.7.5','copypaste-extension':'0.5.5','copypaste-delivery':'0.5.1'}
for name,version in versions.items():
 package=root/name/'package.json';data=json.loads(package.read_text(encoding='utf-8'));data['version']=version
 if name=='copypaste-platform':data['scripts']['setup:document-preview:linux']='node scripts/setup-document-preview-linux.mjs'
 package.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 lock=root/name/'package-lock.json'
 if lock.exists():
  data=json.loads(lock.read_text(encoding='utf-8'));data['version']=version
  if '' in data.get('packages',{}):data['packages']['']['version']=version
  lock.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
# The native renderer contains only these two selected shared additions.
for name in ['task-workbench.tsx','task-workbench.css']:(root/'copypaste-desktop/renderer/src'/name).write_bytes((root/'copypaste-web/src'/name).read_bytes())
print('Round code and validation fixtures prepared. No test/build executed.')
