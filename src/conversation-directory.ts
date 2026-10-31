import type {FastifyInstance} from "fastify";
import {requireUser} from "./auth.js";
import {z} from "zod";
import type {Database,Tx} from "./db.js";
import type {Principal} from "./auth.js";
import {projectAuthority} from "./project-authority.js";
import {canonical,equal,hash,hmac,Problem,uuid} from "./lib.js";
const query=z.object({q:z.string().trim().max(160).default(""),archived:z.enum(["true","false"]).default("false"),
 limit:z.coerce.number().int().min(1).max(200).default(200),cursor:z.string().min(1).max(2048).optional()});
const shape=z.object({v:z.literal(1),tenant:uuid,project:uuid.nullable(),actor:uuid,session:uuid,auth:z.number().int().nonnegative(),
 filter:z.string().regex(/^[a-f0-9]{64}$/),pinned:z.boolean(),at:z.string().datetime({precision:6}),id:uuid,expires:z.number().int().positive()}).strict();
const invalid=()=>new Problem(400,"CONVERSATION_CURSOR_INVALID","Refresh conversations before changing the account, project or filters");
const domain="conversation-directory-v1:";
export async function conversationDirectory(tx:Tx,db:Database,p:Principal,tenant:string,project:string|null,raw:unknown){
 const q=query.parse(raw);const access=await projectAuthority(tx,p,{tenant,project},"read");
 const scope={tenant,project,actor:p.id,session:p.sessionId,auth:p.authVersion,filter:hash(canonical({q:q.q,archived:q.archived,limit:q.limit}))};
 let after:z.infer<typeof shape>|null=null;
 if(q.cursor){try{
  const [encoded,signature,extra]=q.cursor.split(".");
  if(extra!==undefined||!encoded||!signature||!equal(signature,hmac(db.config.MASTER_KEY!,domain+encoded)))throw invalid();
  const bytes=Buffer.from(encoded,"base64url");if(bytes.toString("base64url")!==encoded)throw invalid();
  after=shape.parse(JSON.parse(bytes.toString("utf8")));
  const {v,pinned,at,id,expires,...bound}=after;if(canonical(bound)!==canonical(scope))throw invalid();
 }catch{throw invalid();}
 if(after.expires<=Date.now())throw new Problem(409,"CONVERSATION_CURSOR_EXPIRED","Refresh conversations to continue browsing");}
 const rows=(await tx.query(`SELECT c.*,a.name AS agent_name,
  to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
  FROM conversations c JOIN agents a ON a.id=c.agent_id
  WHERE c.tenant_id=$9 AND ($1::uuid IS NULL OR c.project_id=$1) AND c.created_by=$2 AND c.content_state='active' AND c.archived=$3
   AND ($4='' OR position(lower($4) in lower(c.name))>0)
   AND EXISTS(SELECT 1 FROM projects pr WHERE pr.id=c.project_id AND pr.tenant_id=$9 AND pr.archived=false
    AND ($10::boolean OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=pr.id AND pm.user_id=$2 AND pm.tenant_id=$9)))
   AND ($5::boolean IS NULL OR (c.pinned,c.updated_at,c.id)<($5::boolean,$6::timestamptz,$7::uuid))
  ORDER BY c.pinned DESC,c.updated_at DESC,c.id DESC LIMIT $8`,
 [project,p.id,q.archived==="true",q.q,after?.pinned??null,after?.at??null,after?.id??null,q.limit+1,tenant,["owner","admin"].includes(access.membership.role)])).rows;
 const items=rows.slice(0,q.limit),last=items.at(-1);let next_cursor:string|null=null;
 if(rows.length>q.limit&&last){const body=shape.parse({v:1,...scope,pinned:last.pinned,at:last.cursor_at,id:last.id,expires:after?.expires??Date.now()+1800000});
  const encoded=Buffer.from(canonical(body)).toString("base64url");next_cursor=encoded+"."+hmac(db.config.MASTER_KEY!,domain+encoded);}
 return {items:items.map(({cursor_at,...row})=>row),next_cursor};
}

export function registerConversationDirectory(app:FastifyInstance,db:Database){
 app.get("/v1/conversations",{preHandler:requireUser(db)},async(req,reply)=>{
  const tenant=uuid.parse(req.headers["x-tenant-id"]),input=z.object({project_id:uuid.optional(),q:z.string().trim().min(1).max(160).optional(),
   archived:z.enum(["true","false"]).optional(),limit:z.coerce.number().int().min(1).max(100).default(40),cursor:z.string().min(1).max(2048).optional()}).strict().parse(req.query);
  const result=await db.tx(tx=>conversationDirectory(tx,db,req.principal,tenant,input.project_id??null,input),tenant,false,req.principal.id);
  reply.header("Cache-Control","no-store");return {items:result.items.map(c=>({id:c.id,project_id:c.project_id,agent_id:c.agent_id,title:c.name,version:c.version,created_at:c.created_at,
   pinned:c.pinned,archived:c.archived,last_activity_at:c.updated_at})),next_cursor:result.next_cursor};
 });
}
