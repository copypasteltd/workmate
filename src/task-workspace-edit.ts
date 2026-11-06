import type {FastifyInstance} from "fastify";
import type {Database,Tx} from "./db.js";
import type {Storage} from "./storage.js";
import {saveAsset} from "./storage.js";
import {requireUser,audit,type Principal} from "./auth.js";
import {projectAccess,key,replay} from "./access.js";
import {deliveryTaskAccess,deliverySnapshot} from "./business-quality.js";
import {revisionBytes} from "./delivery-revisions.js";
import {sameRevisionDelivery} from "./delivery-revision-model.js";
import {canonical,hash,Problem,uuid} from "./lib.js";
import {workspaceTextLimit,workspaceTextMime,workspaceDocument,editedWorkspaceBytes,workspaceDiff} from "./workspace-text.js";
import {z} from "zod";

const params=z.object({tenant:uuid,project:uuid,task:uuid}),base="/v1/tenants/:tenant/projects/:project/tasks/:task/workspace";
type Scope=z.infer<typeof params>;
const view=(r:any)=>({asset_id:r.asset_id,asset_version_id:r.id,name:r.name,version:r.version,mime_type:r.mime_type,bytes:Number(r.bytes),sha256:r.sha256});
async function current(tx:Tx,p:Scope,actor:Principal,version:string){
 const task=await deliveryTaskAccess(tx,actor,p.tenant,p.task,p.project),delivery=await deliverySnapshot(tx,task);
 if(!delivery?.artifacts.some((r:any)=>r.version_id===version))throw new Problem(404,"NOT_FOUND","Current authorized deliverable not found");
 const row=(await tx.query(`SELECT a.name,a.current_version,v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id
  WHERE v.id=$1 AND a.project_id=$2 AND a.state='active' AND v.erased_at IS NULL
  AND a.retention_expires_at>clock_timestamp() AND task_asset_version_sources_available(v.id)`,[version,p.project])).rows[0];
 if(!row)throw new Problem(404,"NOT_FOUND","Deliverable not found");
 return {task,delivery,row,delivery_hash:hash(canonical(delivery))};
}
async function baselines(tx:Tx,p:Scope,actor:Principal,selected:any,task:any){
 const history=(await tx.query(`SELECT a.name,v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id
  WHERE a.id=$1 AND a.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
   AND v.version<$3 AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id) ORDER BY v.version DESC LIMIT 101`,[selected.asset_id,p.project,selected.version])).rows;
 const items=history.slice(0,100).map(r=>({...r,origin:"version_history"}));
 const binding=task.input_context?.delivery_revision;
 if(binding?.source_task_id){
  const source=await deliveryTaskAccess(tx,actor,p.tenant,binding.source_task_id,p.project),snapshot=await deliverySnapshot(tx,source);
  sameRevisionDelivery(snapshot,binding.expected_delivery_hash);
  const ids=snapshot.artifacts.map((r:any)=>r.version_id);
  const originals=(await tx.query(`SELECT a.name,v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id
   WHERE v.id=ANY($1::uuid[]) AND a.project_id=$2 AND a.state='active' AND v.erased_at IS NULL
   AND a.retention_expires_at>clock_timestamp() AND task_asset_version_sources_available(v.id) ORDER BY a.name,a.id LIMIT 201`,[ids,p.project])).rows;
  for(const r of originals.slice(0,200))if(r.id!==selected.id&&!items.some(item=>item.id===r.id))items.push({...r,origin:"original_delivery"});
  return {items,truncated:history.length>100||originals.length>200};
 }
 return {items,truncated:history.length>100};
}
export function registerTaskWorkspaceEdit(app:FastifyInstance,db:Database,storage:Storage){
 app.get(base+"/versions",{preHandler:requireUser(db)},async(req,reply)=>{
  const p=params.parse(req.params),q=z.object({asset_version_id:uuid}).strict().parse(req.query);reply.header("Cache-Control","private, no-store");
  return db.tx(async tx=>{const c=await current(tx,p,req.principal,q.asset_version_id),b=await baselines(tx,p,req.principal,c.row,c.task);
   return {selected:view(c.row),items:b.items.map(r=>({...view(r),origin:r.origin})),truncated:b.truncated,task_version:c.task.version,delivery_hash:c.delivery_hash};
  },p.tenant,false,req.principal.id);
 });
 app.get(base+"/compare",{preHandler:requireUser(db),config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(req,reply)=>{
  const p=params.parse(req.params),q=z.object({asset_version_id:uuid,against_version_id:uuid}).strict().parse(req.query);reply.header("Cache-Control","private, no-store");
  const authorize=async()=>{await requireUser(db)(req);return db.tx(async tx=>{const c=await current(tx,p,req.principal,q.asset_version_id),b=await baselines(tx,p,req.principal,c.row,c.task),before=b.items.find(r=>r.id===q.against_version_id);
   if(!before)throw new Problem(404,"NOT_FOUND","Authorized comparison version not found");return {...c,before};},p.tenant,false,req.principal.id);};
  const c=await authorize(),summary={before:view(c.before),after:view(c.row),identical:c.before.sha256===c.row.sha256};
  if(![c.before,c.row].every(r=>workspaceTextMime(r.mime_type)&&Number(r.bytes)<=workspaceTextLimit))return {...summary,state:"download_required",reason:"format_or_size"};
  let left,right;try{left=workspaceDocument(await revisionBytes(storage,c.before,workspaceTextLimit));right=workspaceDocument(await revisionBytes(storage,c.row,workspaceTextLimit));}
  catch(e){if(e instanceof Problem&&e.code==="WORKSPACE_TEXT_ENCODING"){await authorize();return {...summary,state:"download_required",reason:"encoding"};}throw e;}
  const diff=workspaceDiff(left.text,right.text);await authorize();
  await db.tx(tx=>audit(tx,req.principal,"task.workspace.compare",p.task,"succeeded",{before_version:q.against_version_id,after_version:q.asset_version_id},p.tenant),p.tenant,false,req.principal.id);
  return {...summary,...diff,format_changed:left.newline!==right.newline||left.bom!==right.bom,before_format:{newline:left.newline,bom:left.bom},after_format:{newline:right.newline,bom:right.bom}};
 });
 app.get(base+"/editor",{preHandler:requireUser(db)},async(req,reply)=>{
  const p=params.parse(req.params),q=z.object({asset_version_id:uuid}).strict().parse(req.query);reply.header("Cache-Control","private, no-store");
  const read=async()=>{await requireUser(db)(req);return db.tx(async tx=>{const c=await current(tx,p,req.principal,q.asset_version_id);let writable=true;
   try{await projectAccess(tx,req.principal,p.tenant,p.project,"write");}catch(e){if(!(e instanceof Problem)||e.status!==403)throw e;writable=false;}
   return {...c,writable:writable&&c.task.status==="succeeded"&&c.task.mode!=="plan"&&c.task.execution_location!=="desktop"};},p.tenant,false,req.principal.id);};
  const c=await read();if(!workspaceTextMime(c.row.mime_type))return {state:"download_required",reason:"format"};
  const doc=workspaceDocument(await revisionBytes(storage,c.row,workspaceTextLimit)),fresh=await read();
  if(fresh.delivery_hash!==c.delivery_hash||fresh.task.version!==c.task.version)throw new Problem(409,"WORKSPACE_SOURCE_CHANGED","Reload the current delivery before editing");
  return {state:"ready",file:view(c.row),text:doc.text,format:{bom:doc.bom,newline:doc.newline},can_edit:fresh.writable&&doc.editable,
   reason:!doc.editable?"mixed_newlines":!fresh.writable?"permission_or_task_state":null,task_version:c.task.version,delivery_hash:c.delivery_hash};
 });
 app.post(base+"/edit",{preHandler:requireUser(db),bodyLimit:2*1024**2},async(req,reply)=>{
  const p=params.parse(req.params),b=z.object({asset_version_id:uuid,expected_task_version:z.number().int().positive(),expected_delivery_hash:z.string().regex(/^[a-f0-9]{64}$/),expected_sha256:z.string().regex(/^[a-f0-9]{64}$/),text:z.string().max(workspaceTextLimit)}).strict().parse(req.body);
  reply.header("Cache-Control","private, no-store");
  return db.tx(async tx=>{await projectAccess(tx,req.principal,p.tenant,p.project,"write");await deliveryTaskAccess(tx,req.principal,p.tenant,p.task,p.project);return replay(tx,req.principal.id,"task.workspace.edit:"+p.task,key(req),b,async()=>{
   const c=await current(tx,p,req.principal,b.asset_version_id);
   if(c.task.status!=="succeeded"||c.task.mode==="plan"||c.task.execution_location==="desktop")throw new Problem(409,"WORKSPACE_EDIT_NOT_ALLOWED","Edit a completed cloud delivery here. Local originals remain on the Desktop");
   if(c.task.version!==b.expected_task_version||c.delivery_hash!==b.expected_delivery_hash||c.row.sha256!==b.expected_sha256)throw new Problem(409,"WORKSPACE_SOURCE_CHANGED","This delivery changed. Reload and compare before saving");
   if(!workspaceTextMime(c.row.mime_type))throw new Problem(415,"WORKSPACE_TEXT_ENCODING","Only UTF-8 text can be edited here");
   const old=await revisionBytes(storage,c.row,workspaceTextLimit),bytes=editedWorkspaceBytes(workspaceDocument(old),b.text);
   if(old.equals(bytes))return {changed:false,file:view(c.row),task_version:c.task.version,delivery_hash:c.delivery_hash};
   await tx.query("SELECT set_config('app.task_id',$1,true)",[c.task.id]);
   const saved=await saveAsset(tx,storage,{tenant:p.tenant,project:p.project,user:req.principal.id,asset:c.row.asset_id,expectedVersion:c.row.version,name:c.row.name,mime:c.row.mime_type,bytes,
    metadata:{...c.row.metadata,manual_edit_of_version_id:c.row.id,manual_edit_actor:req.principal.id}});
   const updated=(await tx.query("UPDATE tasks SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING version",[c.task.id])).rows[0];
   await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'delivery.manually_edited',$3)",[p.tenant,p.task,{asset_id:saved.id,before_version_id:c.row.id,asset_version_id:saved.version.id,task_version:updated.version}]);
   await audit(tx,req.principal,"task.workspace.edit",p.task,"succeeded",{before_version_id:c.row.id,asset_version_id:saved.version.id,before_sha256:c.row.sha256,sha256:saved.version.sha256},p.tenant);
   return {changed:true,file:view({...saved.version,asset_id:saved.id,name:saved.name}),task_version:updated.version,delivery_hash:hash(canonical(await deliverySnapshot(tx,{...c.task,version:updated.version})))};
  });},p.tenant,false,req.principal.id);
 });
}
