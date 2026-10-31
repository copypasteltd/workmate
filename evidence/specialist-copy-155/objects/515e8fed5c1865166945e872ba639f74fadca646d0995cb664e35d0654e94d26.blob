import {historyFixture,historyOk,type System} from "./admin-history-fixture.js";
import {presetBrandDefinition} from "./preset-brand-fixture.js";
export async function specialistCopyFixture(s:System) {
 const f=await historyFixture(s,{versions:1,notes:1,authenticateAdmin:false});
 await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[f.tenant]);
 const brand=await historyOk(s,f.owner,"POST",f.base+"/brand/definitions",presetBrandDefinition("Approved original brand revision"));
 const options=await historyOk(s,f.owner,"GET","/v1/brand-version-options?project_id="+f.project),fixed=options.items.find((r:any)=>r.brand_id===brand.id);
 const templates=await historyOk(s,f.owner,"GET","/v1/agent-templates"),template=templates.items.find((r:any)=>r.kind==="default_helper");
 const created=await historyOk(s,f.owner,"POST","/v1/agent-templates/"+template.id+"/instances",{project_id:f.project,template_version:template.version,
  name:"Harbour retained brand specialist",overrides:{brand_version_id:fixed.id,role_description:"Use approved facts and retain the original brand revision.",delivery_preferences:["Deliver a concise campaign checklist"]}});
 const source={...(await historyOk(s,f.owner,"GET",f.base+"/agents")).items.find((a:any)=>a.id===created.id),template_version_id:created.template_version_id};
 await historyOk(s,f.owner,"PUT",f.base+"/brand/"+brand.id,{expected_version:1,definition:presetBrandDefinition("Later brand revision must not replace the original")});
 const proposal={source_version:source.version,name:"Harbour independent specialist",instructions:source.body.instructions,tool_ids:source.body.tool_ids};
 const endpoint=f.base+"/agents/"+source.id;
 return {...f,source,brand,fixed,template,proposal,endpoint};
}
export type CopyFixture=Awaited<ReturnType<typeof specialistCopyFixture>>;
export async function copyPreview(s:System,f:CopyFixture,proposal:any=f.proposal){return historyOk(s,f.owner,"POST",f.endpoint+"/copy-previews",proposal);}
export async function copyConfirm(s:System,f:CopyFixture,preview:any,proposal:any=f.proposal){return historyOk(s,f.owner,"POST",f.endpoint+"/copies",{proposal,preview_token:preview.preview_token,acknowledged:true});}
export const copyFacts=async(s:System,f:CopyFixture)=>(await s.db.control.query("SELECT (SELECT count(*)::int FROM agents WHERE project_id=$1) agents,(SELECT count(*)::int FROM conversations WHERE project_id=$1) conversations,(SELECT count(*)::int FROM memories WHERE project_id=$1) memories,(SELECT count(*)::int FROM assets WHERE project_id=$1) assets,(SELECT count(*)::int FROM tasks WHERE project_id=$1) tasks,(SELECT count(*)::int FROM ai_gateway_requests WHERE tenant_id=$2) requests",[f.project,f.tenant])).rows[0];
