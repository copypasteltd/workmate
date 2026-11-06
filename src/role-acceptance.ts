import type {FastifyInstance} from "fastify";
import {z} from "zod";
import type {Database} from "./db.js";
import {audit,requireAdmin} from "./auth.js";
import {capabilityAuthority} from "./capability-releases.js";
import {key,replay} from "./access.js";
import {canonical,hash,Problem,uuid} from "./lib.js";
import {deliverySnapshot} from "./business-quality.js";

const root="/v1/admin/role-acceptance",input=z.object({template_version_id:uuid,task_id:uuid,
 case_kind:z.enum(["normal","revision","boundary"]),decision:z.enum(["passed","failed"]),
 expected_task_version:z.number().int().positive(),expected_delivery_hash:z.string().regex(/^[a-f0-9]{64}$/),
 expected_error_code:z.string().min(3).max(200).optional(),comment:z.string().trim().min(10).max(5000)}).strict();
export function registerRoleAcceptance(app:FastifyInstance,db:Database){
 app.get(root,{preHandler:requireAdmin(db)},async req=>{
  const q=z.object({template_version_id:uuid.optional(),cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(req.query);
  return db.tx(async tx=>{
   await capabilityAuthority(tx,req.principal,"admin.catalog.read");
   const templates=(await tx.query(`SELECT t.id,t.role_key,v.id AS template_version_id,v.version,v.definition_hash,
    v.body->'name' AS name,c.passed,c.failed,c.case_kinds,c.latest_at FROM agent_templates t
    JOIN agent_template_versions v ON v.template_id=t.id AND v.version=t.current_version
    LEFT JOIN role_acceptance_counts() c ON c.template_version_id=v.id ORDER BY t.role_key`)).rows;
   if(q.cursor&&!(await tx.query("SELECT 1 FROM role_acceptance_evidence WHERE id=$1 AND ($2::uuid IS NULL OR template_version_id=$2)",[q.cursor,q.template_version_id??null])).rowCount)
    throw new Problem(409,"ACCEPTANCE_CURSOR_UNAVAILABLE","Refresh the evidence list");
   const records=(await tx.query(`SELECT e.*,v.version AS template_version,t.role_key FROM role_acceptance_evidence e
    JOIN agent_template_versions v ON v.id=e.template_version_id JOIN agent_templates t ON t.id=v.template_id
    WHERE ($1::uuid IS NULL OR e.template_version_id=$1) AND ($2::uuid IS NULL OR (e.created_at,e.id)<
    (SELECT created_at,id FROM role_acceptance_evidence WHERE id=$2)) ORDER BY e.created_at DESC,e.id DESC LIMIT $3`,
    [q.template_version_id??null,q.cursor??null,q.limit+1])).rows;
   return {templates,items:records.slice(0,q.limit),next_cursor:records.length>q.limit?records[q.limit-1].id:null,
    professional_qualification:"manual_acceptance_required",policy:"Evidence counts do not certify professional quality or business outcomes."};
  },undefined,true);
 });
 app.get(root+"/tasks/:task/snapshot",{preHandler:requireAdmin(db)},async req=>{
  const id=z.object({task:uuid}).parse(req.params).task;
  return db.tx(async tx=>{await capabilityAuthority(tx,req.principal,"admin.catalog.read");
   const t=(await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id])).rows[0];
   if(!t||t.content_state!=="active")throw new Problem(404,"NOT_FOUND","Task not found");
   const delivery=await deliverySnapshot(tx,t);
   return {task_id:t.id,task_version:t.version,role_key:t.role_key,status:t.status,data_mode:t.data_mode,
    delivery_hash:hash(canonical(delivery)),artifact_count:delivery?.artifacts?.length??0,error_code:t.error_code};
  },undefined,true);
 });
 app.post(root,{preHandler:requireAdmin(db)},async req=>{
  const b=input.parse(req.body),idem=key(req);
  return db.tx(async tx=>{await capabilityAuthority(tx,req.principal,"admin.catalog.publish");
   return replay(tx,req.principal.id,"role.acceptance.record",idem,b,async()=>{
    const template=(await tx.query("SELECT * FROM agent_template_versions WHERE id=$1",[b.template_version_id])).rows[0],
     task=(await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[b.task_id])).rows[0];
    if(!template||!task||task.content_state!=="active")throw new Problem(404,"NOT_FOUND","Template or task not found");
    if(task.version!==b.expected_task_version)throw new Problem(409,"VERSION_CONFLICT","Refresh the task snapshot before reviewing");
    if(task.role_hash!==template.body.role_hash||task.role_key!==template.body.role_key||task.kernel!=="codex")throw new Problem(409,"ACCEPTANCE_ROLE_MISMATCH","This task did not run the selected role definition");
    const binding=(await tx.query("SELECT * FROM task_runtime_bindings WHERE task_id=$1",[task.id])).rows[0];
    if(!binding||binding.runtime_profile_id!==template.runtime_profile_id)throw new Problem(409,"ACCEPTANCE_RUNTIME_MISSING","The matching frozen Codex runtime is required");
    const delivery=await deliverySnapshot(tx,task),deliveryHash=hash(canonical(delivery));
    if(deliveryHash!==b.expected_delivery_hash)throw new Problem(409,"DELIVERY_VERSION_CONFLICT","Refresh the changed delivery before reviewing");
    if(b.decision==="passed"){
     if(task.data_mode!=="configured_services")throw new Problem(409,"ACCEPTANCE_REAL_TASK_REQUIRED","Simulated work cannot pass real service acceptance");
     if(b.case_kind==="boundary"){
      if(task.status!=="failed"||!b.expected_error_code||task.error_code!==b.expected_error_code)throw new Problem(409,"ACCEPTANCE_BOUNDARY_MISMATCH","A passing boundary case must fail with the explicitly expected error");
     }else{
      const state=(await tx.query("SELECT business_review_state($1) AS state",[task.id])).rows[0]?.state;
      if(task.status!=="succeeded"||task.mode!=="execute"||state!=="accepted")throw new Problem(409,"ACCEPTANCE_DELIVERY_REVIEW_REQUIRED","First accept the completed executable delivery in its customer review");
      if(b.case_kind==="revision"&&!task.parent_id&&!task.input_context?.delivery_revision)throw new Problem(409,"ACCEPTANCE_REVISION_REQUIRED","Choose a task linked to a real delivery revision");
     }
    }
    if((await tx.query("SELECT 1 FROM role_acceptance_evidence WHERE template_version_id=$1 AND task_id=$2 AND case_kind=$3 AND revoked_at IS NULL",[template.id,task.id,b.case_kind])).rowCount)throw new Problem(409,"ACCEPTANCE_EXISTS","Revoke the prior review before recording a replacement");
    const skills=(await tx.query("SELECT skill_version_id,content_hash FROM task_skill_bindings WHERE task_id=$1 ORDER BY skill_version_id",[task.id])).rows;
    const proof={schema:1,task_id:task.id,task_version:task.version,role_hash:task.role_hash,template_version_id:template.id,
     template_definition_hash:template.definition_hash,runtime_profile_id:binding.runtime_profile_id,capability_version_ids:binding.capability_version_ids,
     skills,delivery,delivery_hash:deliveryHash,data_mode:task.data_mode,status:task.status,error_code:task.error_code,expected_error_code:b.expected_error_code??null};
    const row=(await tx.query(`INSERT INTO role_acceptance_evidence(template_version_id,task_id,case_kind,decision,comment,proof,proof_hash,reviewer_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at`,[template.id,task.id,b.case_kind,b.decision,b.comment,proof,hash(canonical(proof)),req.principal.id])).rows[0];
    await audit(tx,req.principal,"role.acceptance.record",row.id,"succeeded",{task_id:task.id,template_version_id:template.id,decision:b.decision,proof_hash:hash(canonical(proof))},task.tenant_id);return row;
   });
  },undefined,true);
 });
 app.post(root+"/revoke",{preHandler:requireAdmin(db)},async req=>{
  const b=z.object({ids:z.array(uuid).min(1).max(100),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body),idem=key(req);
  if(new Set(b.ids).size!==b.ids.length)throw new Problem(400,"DUPLICATE_IDS","Choose each record once");
  return db.tx(async tx=>{await capabilityAuthority(tx,req.principal,"admin.catalog.publish");
   return replay(tx,req.principal.id,"role.acceptance.revoke",idem,b,async()=>{
    const rows=(await tx.query("SELECT id,revoked_at FROM role_acceptance_evidence WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[b.ids])).rows;
    if(rows.length!==b.ids.length||rows.some(r=>r.revoked_at))throw new Problem(409,"VERSION_CONFLICT","Refresh and select active evidence records");
    await tx.query("UPDATE role_acceptance_evidence SET revoked_at=now(),revoked_by=$2,revocation_reason=$3 WHERE id=ANY($1::uuid[])",[b.ids,req.principal.id,b.reason]);
    for(const row of rows)await audit(tx,req.principal,"role.acceptance.revoke",row.id,"succeeded",{reason:b.reason});return {revoked_ids:b.ids};
   });
  },undefined,true);
 });
}
