import type {FastifyInstance} from "fastify";
import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import type {Database,Tx} from "./db.js";
import type {Catalog} from "./catalog.js";
import type {Principal} from "./auth.js";
import {requireUser} from "./auth.js";
import {key,projectAccess,replay} from "./access.js";
import {canonical,hash,hmac,name,Problem,uuid} from "./lib.js";
import {getAgentVersion,persistSpecialist,retainTemplateProvenance} from "./persistent-work.js";
import {provisionRoleSkills,skillVersionId} from "./skill-lifecycle.js";
import {fixedBrandVersion} from "./brand-bindings.js";
import {projectAuthority as authority} from "./project-authority.js";
import {confirmedAgentCapabilities} from "./capability-bindings.js";

const version=z.number().int().positive().safe(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const specialistCopyProposal=z.object({source_version:version,name,
 instructions:z.string().trim().max(8000).optional(),tool_ids:z.array(z.string().min(1).max(120)).max(40).optional()}).strict();
const claimsSchema=z.object({actor:uuid,session:z.string().min(1).max(200),auth:version,tenant:uuid,project:uuid,source:uuid,
 source_version:version,source_hash:digest,proposal_hash:digest,guard_hash:digest,expires:z.number().int().positive().safe()}).strict();
const confirmation=z.object({proposal:specialistCopyProposal,preview_token:z.string().min(20).max(4096),acknowledged:z.literal(true)}).strict();
const stale=()=>new Problem(409,"COPY_PREVIEW_STALE","The source, methods or access changed. Review this specialist again before copying.");
const sign=(db:Database,payload:string)=>hmac(db.config.MASTER_KEY!,"specialist-copy-v1:"+payload);
function unpack(db:Database,token:string) {
 const [payload,signature,...extra]=token.split(".");
 if(extra.length || !payload || !/^[a-zA-Z0-9_-]+$/.test(payload) || !/^[a-f0-9]{64}$/.test(signature??""))throw stale();
 if(!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(sign(db,payload),"hex")))throw stale();
 try {return claimsSchema.parse(JSON.parse(Buffer.from(payload,"base64url").toString("utf8")));}catch{throw stale();}
}
type Proposal=z.infer<typeof specialistCopyProposal>;
async function prepare(tx:Tx,db:Database,catalog:Catalog,p:Principal,tenant:string,project:string,id:string,input:Proposal) {
 await projectAccess(tx,p,tenant,project,"write");
 if(!(await tx.query("SELECT id FROM agents WHERE id=$1 AND project_id=$2 AND content_state='active' FOR SHARE",[id,project])).rowCount)
  throw new Problem(404,"NOT_FOUND","Agent not found");
 const source=await getAgentVersion(tx,project,id,undefined,true),body=source.body;
 if(source.version!==input.source_version)throw stale();
 if(body.kernel!=="codex" || !body.runtime_profile_id || !body.runtime_version || !body.capability_version_ids?.length)throw stale();
 const role=catalog.role(body.role_key,body.role_hash);await catalog.ensureEnabled(tx,body.role_key,body.role_hash);
 const capabilities=await confirmedAgentCapabilities(tx,db.config,catalog,body);
 if(capabilities.runtimeVersion!==body.runtime_version)throw stale();
 const packages=await catalog.boundSkills(role);
 await tx.query("SELECT lock_adoption_skill_versions($1::uuid[])",[packages.map(s=>skillVersionId(s.key,s.version,s.sha256))]);
 const installed=await provisionRoleSkills(tx,catalog,role,tenant,project,p.id,true,false);
 const bindings=(skills:any[])=>skills.map(s=>({key:s.key,version:s.version,sha256:s.sha256,
  installation_id:s.installation_id,skill_version_id:s.skill_version_id,required:s.required})).sort((a,b)=>a.key.localeCompare(b.key));
 if(canonical(bindings(installed))!==canonical(bindings(body.skills??[])))throw stale();
 const tools=[...new Set<string>(input.tool_ids??body.tool_ids)].sort();
 if(tools.some(t=>!body.tool_ids.includes(t)||!role.tool_ids.includes(t)))
  throw new Problem(403,"COPY_TOOL_SCOPE_EXCEEDED","A copy can only retain or narrow the source specialist's approved tools");
 let brand:any=null,brandId:string|undefined;
 if(body.brand) {
  brandId=body.brand_version_id??(await tx.query("SELECT id FROM brand_profile_versions WHERE brand_id=$1 AND project_id=$2 AND version=$3 AND erased_at IS NULL",[body.brand.id,project,body.brand.version])).rows[0]?.id;
  if(!brandId)throw stale();
  brand=await fixedBrandVersion(tx,project,brandId);
  if(canonical(brand)!==canonical(body.brand))throw stale();
 }
 const definition=retainTemplateProvenance({kernel:"codex",runtime_profile_id:body.runtime_profile_id,runtime_version:body.runtime_version,
  capability_version_ids:[...body.capability_version_ids],name:input.name,role_key:body.role_key,role_hash:body.role_hash,
  instructions:input.instructions??body.instructions,tool_ids:tools,brand,...(brandId?{brand_version_id:brandId}:{}),
  skills:body.skills.map((s:any)=>({key:s.key,version:s.version,sha256:s.sha256,installation_id:s.installation_id,skill_version_id:s.skill_version_id,required:s.required}))},body);
 const models=(await tx.query("SELECT id,body FROM internal_capability_versions WHERE id=ANY($1::uuid[]) ORDER BY id",[body.capability_version_ids])).rows
  .map(r=>({id:r.id,profile_key:r.body.profile_key,model_alias:r.body.model_alias,reasoning_effort:r.body.reasoning_effort,rates:r.body.rates,ready:r.body.ready}));
 const sourceHash=hash(canonical(body)),guardHash=hash(canonical({definition,installations:installed.map(s=>({id:s.installation_id,version:s.installation_version})),models}));
 return {source,definition,sourceHash,guardHash,summary:{source_id:id,source_version:source.version,source_name:source.name,
  copy_name:definition.name,instructions:definition.instructions,role_key:body.role_key,runtime_version:body.runtime_version,
  template_version:body.template_version??null,brand,skills:definition.skills.map((s:any)=>({key:s.key,version:s.version})),models,
  tool_ids:tools,keeps_original_bindings:true,excluded:["conversations","memories","files","credentials","connection_grants","local_permissions"]}};
}

export function registerAgentCopy(app:FastifyInstance,db:Database,catalog:Catalog) {
 const base="/v1/tenants/:tenant/projects/:project/agents/:id",params=z.object({tenant:uuid,project:uuid,id:uuid});
 app.post(base+"/copy-previews",{preHandler:requireUser(db)},async(req,reply)=>{
  const {tenant,project,id}=params.parse(req.params),input=specialistCopyProposal.parse(req.body);
  const value=await db.tx(async tx=>{
   await authority(tx,req.principal,{tenant,project},"write");
   // Recheck the source even when recovering an earlier preview receipt.
   const ready=await prepare(tx,db,catalog,req.principal,tenant,project,id,input);
   return replay(tx,req.principal.id,"agent.copy.preview:"+id,key(req),input,async()=>{
    const expires=Date.now()+600000;
    const claims=claimsSchema.parse({actor:req.principal.id,session:req.principal.sessionId,auth:req.principal.authVersion,
     tenant,project,source:id,source_version:input.source_version,source_hash:ready.sourceHash,proposal_hash:hash(canonical(input)),guard_hash:ready.guardHash,expires});
    const payload=Buffer.from(canonical(claims)).toString("base64url");
    return {preview_token:payload+"."+sign(db,payload),expires_at:new Date(expires).toISOString(),summary:ready.summary};
   });
  },tenant,false,req.principal.id);
  reply.header("Cache-Control","no-store");return value;
 });
 app.post(base+"/copies",{preHandler:requireUser(db)},async(req,reply)=>{
  const {tenant,project,id}=params.parse(req.params),input=confirmation.parse(req.body),claims=unpack(db,input.preview_token);
  if(claims.actor!==req.principal.id || claims.session!==req.principal.sessionId || claims.auth!==req.principal.authVersion
   || claims.tenant!==tenant || claims.project!==project || claims.source!==id || claims.source_version!==input.proposal.source_version
   || claims.proposal_hash!==hash(canonical(input.proposal)))throw stale();
  const result=await db.tx(async tx=>{
   await authority(tx,req.principal,{tenant,project},"write");
   // The signed preview is one logical copy even if an HTTP retry uses a new key.
   const receipt=await replay(tx,req.principal.id,"agent.copy.request:"+id,key(req),input,()=>
    replay(tx,req.principal.id,"agent.copy.confirm:"+id,hash(input.preview_token),input,async()=>{
     if(claims.expires<=Date.now())throw new Problem(409,"COPY_PREVIEW_EXPIRED","Review this specialist again before copying");
     const ready=await prepare(tx,db,catalog,req.principal,tenant,project,id,input.proposal);
     if(ready.sourceHash!==claims.source_hash || ready.guardHash!==claims.guard_hash)throw stale();
     const agent=await persistSpecialist(tx,req.principal,tenant,project,ready.definition,"agent.copy",{
      source_agent_id:id,source_version:claims.source_version,source_definition_hash:claims.source_hash,template_version_id:ready.source.template_version_id??null});
     return {id:agent.id,version:agent.version};
    }));
   // A lost-response retry can recover an existing copy, never recreate a deleted copy.
   const agent=await getAgentVersion(tx,project,receipt.id);
   return {id:agent.id,version:agent.version};
  },tenant,false,req.principal.id);
  reply.header("Cache-Control","no-store");return result;
 });
}
