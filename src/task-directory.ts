import type {FastifyInstance} from "fastify";
import type {Database,Tx} from "./db.js";
import type {Principal} from "./auth.js";
import {requireUser} from "./auth.js";
import {projectAuthority} from "./project-authority.js";
import {canonical,equal,hash,hmac,Problem,uuid} from "./lib.js";
import {z} from "zod";

const statuses=["queued","running","needs_input","awaiting_approval","paused","reconciling","succeeded","failed","cancelled"] as const;
const input=z.object({q:z.string().trim().max(160).default(""),status:z.enum(statuses).optional(),
 location:z.enum(["cloud","desktop"]).optional(),mode:z.enum(["ask","plan","execute"]).optional(),
 limit:z.coerce.number().int().min(1).max(100).default(40),cursor:z.string().min(1).max(2048).optional()}).strict();
const token=z.object({v:z.literal(1),tenant:uuid,project:uuid,actor:uuid,session:uuid,auth:z.number().int().nonnegative(),
 filter:z.string().regex(/^[a-f0-9]{64}$/),at:z.string().datetime({precision:6}),id:uuid,expires:z.number().int().positive()}).strict();
const domain="task-directory-v1:";
const invalid=()=>new Problem(400,"TASK_DIRECTORY_CURSOR_INVALID","Refresh the task list after changing the account, project or filters");

/** Read-only metadata over the same private/source boundary as project tasks. */
export async function taskDirectory(tx:Tx,db:Database,p:Principal,tenant:string,project:string,raw:unknown){
 const q=input.parse(raw);await projectAuthority(tx,p,{tenant,project},"read");
 const scope={tenant,project,actor:p.id,session:p.sessionId,auth:p.authVersion,
  filter:hash(canonical({q:q.q,status:q.status??null,location:q.location??null,mode:q.mode??null,limit:q.limit}))};
 let after:z.infer<typeof token>|null=null;
 if(q.cursor){try{
  const [encoded,signature,extra]=q.cursor.split(".");if(extra!==undefined||!encoded||!signature||!equal(signature,hmac(db.config.MASTER_KEY!,domain+encoded)))throw invalid();
  const bytes=Buffer.from(encoded,"base64url");if(bytes.toString("base64url")!==encoded)throw invalid();after=token.parse(JSON.parse(bytes.toString("utf8")));
  const {v,at,id,expires,...bound}=after;if(canonical(bound)!==canonical(scope))throw invalid();
 }catch{throw invalid();}
 if(after.expires<=Date.now())throw new Problem(409,"TASK_DIRECTORY_CURSOR_EXPIRED","This task page expired. Refresh the list to continue");}
 const rows=(await tx.query(`SELECT t.id,t.title,t.role_key,t.status,t.mode,t.execution_location,t.conversation_id,
  t.charged_micros,t.accrued_micros,t.budget_micros,t.created_at,t.updated_at,t.version,t.cancel_requested,
  NOT task_content_sources_available(t.id) AS source_unavailable,
  to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
  FROM tasks t WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.content_state='active'
   AND ($3='' OR position(lower($3) in lower(t.title))>0) AND ($4::text IS NULL OR t.status=$4)
   AND ($5::text IS NULL OR t.execution_location=$5) AND ($6::text IS NULL OR t.mode=$6)
   AND (NOT(t.input_context ? 'analysis_report_id') OR EXISTS(SELECT 1 FROM analysis_reports r WHERE r.task_id=t.id AND r.id::text=t.input_context->>'analysis_report_id' AND analysis_report_available(r.id)))
   AND (NOT(t.input_context ? 'seo_audit_id') OR EXISTS(SELECT 1 FROM seo_runs r WHERE r.task_id=t.id AND r.id::text=t.input_context->>'seo_audit_id' AND seo_run_sources_available(r.id)))
   AND (NOT(t.input_context ? 'seo_change_task_id') OR EXISTS(SELECT 1 FROM seo_change_tasks c WHERE c.task_id=t.id AND c.id::text=t.input_context->>'seo_change_task_id' AND seo_change_available(c.id)))
   AND ($7::timestamptz IS NULL OR (t.created_at,t.id)<($7::timestamptz,$8::uuid))
  ORDER BY t.created_at DESC,t.id DESC LIMIT $9`,[tenant,project,q.q,q.status??null,q.location??null,q.mode??null,after?.at??null,after?.id??null,q.limit+1])).rows;
 const page=rows.slice(0,q.limit),last=page.at(-1);let next_cursor:string|null=null;
 if(rows.length>q.limit&&last){const encoded=Buffer.from(canonical(token.parse({v:1,...scope,at:last.cursor_at,id:last.id,expires:after?.expires??Date.now()+1800000}))).toString("base64url");next_cursor=encoded+"."+hmac(db.config.MASTER_KEY!,domain+encoded);}
 return {items:page.map(({cursor_at,...row})=>row),next_cursor};
}
export function registerTaskDirectory(app:FastifyInstance,db:Database){
 app.get("/v1/tenants/:tenant/projects/:project/task-directory",{preHandler:requireUser(db)},async(req,reply)=>{
  const p=z.object({tenant:uuid,project:uuid}).parse(req.params);reply.header("Cache-Control","private, no-store");
  return db.tx(tx=>taskDirectory(tx,db,req.principal,p.tenant,p.project,req.query),p.tenant,false,req.principal.id);
 });
}
