from pathlib import Path

scripts=Path(__file__).resolve().parent
source=(scripts/'configure-image-model-189-v2.sh').read_text(encoding='utf8')
prefix=source.split("const report={stage:189,status:'running'")[0]
prefix=prefix.replace("stateFile=folder+'image-model-gpt-image-2-state.private.json'", "stateFile=folder+'desktop-qa-plan-state.private.json'")
prefix=prefix.replace("state={stage:189,model:'gpt-image-2',operations:{}}", "state={stage:189,operations:{}}")
login=source.split(" const challenge=await api('/v1/admin/auth/challenge'")[1].split(" const source=(await control.query")[0]
text=prefix+"""const report={stage:189,status:'running',at:new Date().toISOString(),scope:'Time-limited Pro grant on the existing owned acceptance workspace through normal audited admin APIs. Preserve all uncertain tasks, original credit and provider concurrency limits.'};
try{
 const challenge=await api('/v1/admin/auth/challenge'"""+login+"""
 const tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0';
 const owned=(await control.query("SELECT id FROM tenants WHERE id=$1 AND owner_id=$2",[tenant,'d81349e4-77fc-4321-a9ba-24dca9714376'])).rows[0];assert.ok(owned);
 const root='/v1/admin/entitlement-grants',subject={kind:'tenant',id:tenant};
 const holder=await api(root+'/subjects/tenant/'+tenant),options=await api(root+'/plan-options');
 const plan=options.items.find(p=>p.plan_id==='3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c12');assert.ok(plan);
 const body=state.operations.grant?.body??{subject,plan_version_id:plan.id,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),overlap_policy:'reject',source:'manual',auto_renew:false,expected_subject_version:holder.version,reason:'Owned Desktop 189 real acceptance: temporary published Pro entitlement while an earlier uncertain request remains reserved. No payment, credit change, request release or policy bypass.'};
 const preview=await api('/v1/admin/entitlement-previews',body);assert.equal(preview.decision,'super_admin_direct');
 const result=await operation('grant',root,body,{'X-Admin-Preview-ID':preview.preview_id});assert.equal(result.state,'succeeded');
 const grant=await api(root+'/'+result.result_ids[0]);assert.equal(grant.state,'active');assert.equal(grant.auto_renew,false);
 report.subject=subject;report.grant_id=grant.id;report.operation_id=result.id;report.ends_at=body.ends_at;report.status='granted';
}catch(error){report.status='failed';report.error=error.name+': '+String(error.message).split('\\n')[0];}
finally{
 if(csrf)await api('/v1/admin/auth/logout',{}).catch(()=>{});await control.end();
 const file=folder+'desktop-qa-plan-'+randomUUID()+'.sanitized.json';
 await writeFile(file,JSON.stringify(report,null,2)+'\\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
}
assert.equal(report.status,'granted');
WM_IMAGE_189
"""
with (scripts/'prepare-desktop-qa-plan-189-v1.sh').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
