import { publicToolOutcomeSummary } from "./tool-outcome-ledger.js";
import type {FastifyInstance} from "fastify";
import {z} from "zod";
import type {Database} from "./db.js";
import {requireUser,audit} from "./auth.js";
import {deliveryTaskAccess,deliverySnapshot} from "./business-quality.js";
import {hash,Problem,uuid} from "./lib.js";
import type {Storage} from "./storage.js";

const params=z.object({tenant:uuid,project:uuid,task:uuid});
const base="/v1/tenants/:tenant/projects/:project/tasks/:task/workspace";
/** The workspace is a view over existing authorized tasks and immutable versions. */
export function registerTaskWorkspace(app:FastifyInstance,db:Database,storage:Storage){
 app.get(base,{preHandler:requireUser(db)},async(req,reply)=>{
  reply.header("Cache-Control","private, no-store");
  const p=params.parse(req.params);
  return db.tx(async tx=>{
   const task=await deliveryTaskAccess(tx,req.principal,p.tenant,p.task,p.project);
   const delivery=await deliverySnapshot(tx,task);
   const ids=(delivery?.artifacts??[]).map((a:any)=>a.version_id);
   const files=(await tx.query(`SELECT a.id,a.name,v.id AS version_id,v.version,v.mime_type,v.bytes,v.sha256
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.id=ANY($1::uuid[])
    AND a.state='active' AND v.erased_at IS NULL ORDER BY a.name,a.id LIMIT 201`,[ids])).rows;
   return {task:{id:task.id,title:task.title,status:task.status,mode:task.mode,output:task.output,execution_location:task.execution_location,
    version:task.version,charged_micros:task.charged_micros,accrued_micros:task.accrued_micros,budget_micros:task.budget_micros,
    input_tokens:task.input_tokens,output_tokens:task.output_tokens,error_code:task.error_code,tool_outcomes:await publicToolOutcomeSummary(tx,p.tenant,p.task)},files:files.slice(0,200),files_truncated:files.length>200};
  },p.tenant,false,req.principal.id);
 });
 app.get(base+"/preview",{preHandler:requireUser(db)},async(req,reply)=>{
  const p=params.parse(req.params),q=z.object({asset_version_id:uuid}).strict().parse(req.query);
  const authorize=async()=>{await requireUser(db)(req);return db.tx(async tx=>{
   const task=await deliveryTaskAccess(tx,req.principal,p.tenant,p.task,p.project),snapshot=await deliverySnapshot(tx,task);
   if(!snapshot?.artifacts.some((a:any)=>a.version_id===q.asset_version_id))throw new Problem(404,"NOT_FOUND","Current authorized deliverable not found");
   const file=(await tx.query(`SELECT a.id,a.name,v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id
    WHERE v.id=$1 AND a.state='active' AND v.erased_at IS NULL`,[q.asset_version_id])).rows[0];
   if(!file)throw new Problem(404,"NOT_FOUND","Deliverable not found");return file;
  },p.tenant,false,req.principal.id);};
  const file=await authorize(),image=["image/png","image/jpeg","image/webp","image/gif"].includes(file.mime_type),
   text=/^(?:text\/|application\/(?:json|xml)$)/.test(file.mime_type),limit=image?4*1024**2:text?256*1024:0;
  reply.header("Cache-Control","private, no-store");
  if(!limit||Number(file.bytes)>limit)return {state:"download_required",asset_id:file.asset_id,version:file.version};
  const bytes=await storage.get(file.storage_key);
  if(bytes.length!==Number(file.bytes)||hash(bytes)!==file.sha256)throw new Problem(422,"REFERENCE_INTEGRITY_FAILED","The deliverable checksum does not match its version");
  await authorize();
  await db.tx(tx=>audit(tx,req.principal,"task.workspace.preview",p.task,"succeeded",{asset_version_id:q.asset_version_id},p.tenant),p.tenant,false,req.principal.id);
  return {state:"ready",asset_id:file.asset_id,version:file.version,...(image?{preview_image:{content_type:file.mime_type,base64:bytes.toString("base64")}}:{text:bytes.toString("utf8")})};
 });
}
