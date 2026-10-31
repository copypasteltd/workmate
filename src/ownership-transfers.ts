import type {FastifyInstance, FastifyRequest} from "fastify";
import {z} from "zod";
import type {Database, Tx} from "./db.js";
import {audit, requireAdmin, requireUser, type Principal} from "./auth.js";
import {key, replay} from "./access.js";
import {lockMemberships} from "./membership.js";
import {lockUserAuthorities} from "./user-authority.js";
import {lockCurrentScopeSession} from "./scope-closure-authority.js";
import {lockAdminAccess, requireSensitiveAdmin} from "./admin-access.js";
import {membershipAdminAuthority} from "./admin-memberships.js";
import {Problem, uuid} from "./lib.js";

const command=z.object({recipient_id:uuid,confirmation:z.string().min(1).max(160),acknowledge_responsibility:z.literal(true)}).strict();
const decision=z.object({expected_revision:z.number().int().positive(),acknowledge_responsibility:z.literal(true)}).strict();
const paging=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(20),direction:z.enum(["all","incoming"]).default("all")}).strict();
function parameters(req:FastifyRequest){
 const tenant=uuid.parse((req.params as any).tenant), id=(req.params as any).id===undefined?undefined:uuid.parse((req.params as any).id);
 if(req.headers["x-tenant-id"]!==undefined&&uuid.parse(req.headers["x-tenant-id"])!==tenant)throw new Problem(400,"TENANT_MISMATCH","Workspace header does not match the path");
 return {tenant,id};
}
async function tenantRow(tx:Tx,tenant:string){
 const row=(await tx.query("SELECT * FROM tenants WHERE id=$1 FOR SHARE",[tenant])).rows[0];
 if(!row||row.status!=="active"||row.erasure_requested_at)throw new Problem(404,"NOT_FOUND","Workspace not found");
 return row;
}
async function membership(tx:Tx,tenant:string,user:string){
 return (await tx.query("SELECT m.*,u.status AS user_status,u.auth_version AS user_auth_version FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2",[tenant,user])).rows[0];
}
const active=(m:any)=>m&&m.status==="active"&&!m.admin_suspended&&m.user_status==="active";
async function lockParties(tx:Tx,users:string[]){
 await lockUserAuthorities(tx,users);
 // SSO withdrawal also locks users directly. Hold every affected account in
 // the same sorted order before taking membership/tenant/transfer locks.
 await tx.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",[[...new Set(users)].sort()]);
}
async function currentMember(tx:Tx,p:Principal,tenant:string){
 const m=await membership(tx,tenant,p.id);if(!active(m))throw new Problem(404,"NOT_FOUND","Workspace not found");return m;
}
async function hint(tx:Tx,tenant:string,id:string){
 const row=(await tx.query("SELECT * FROM ownership_transfers WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0];
 if(!row)throw new Problem(404,"NOT_FOUND","Ownership transfer not found");return row;
}
async function finish(tx:Tx,row:any,state:string,reason:string,p?:Principal){
 const result=(await tx.query(`UPDATE ownership_transfers SET state=$2,reason_code=$3,resolved_at=clock_timestamp(),resolved_by=$4,resolved_audience=$5,revision=revision+1 WHERE id=$1 AND state='pending' RETURNING *`,[row.id,state,reason,p?.id??null,p?.audience??null])).rows[0];
 await audit(tx,p,"ownership.transfer."+state,row.id,state,{from_user_id:row.from_user_id,to_user_id:row.to_user_id,reason_code:reason},row.tenant_id);
 return result;
}
async function invalidate(tx:Tx,row:any){
 if(row.state!=="pending")return row;
 const t=(await tx.query("SELECT status,erasure_requested_at FROM tenants WHERE id=$1",[row.tenant_id])).rows[0];
 if(!t||t.erasure_requested_at)return finish(tx,row,"cancelled","workspace_removed");
 if(new Date(row.expires_at).getTime()<=Date.now())return finish(tx,row,"expired","expired");
 const f=await membership(tx,row.tenant_id,row.from_user_id),r=await membership(tx,row.tenant_id,row.to_user_id);
 if(t.status!=="active"||!active(f)||!active(r)||f.role!=="owner"||r.role==="owner"||f.version!==row.from_version||r.version!==row.to_version||f.user_auth_version!==row.from_auth_version||r.user_auth_version!==row.to_auth_version)
  return finish(tx,row,"invalidated","authorization_changed");
 return row;
}
async function dto(tx:Tx,row:any){
 const users=(await tx.query("SELECT id,name,email FROM users WHERE id=ANY($1::uuid[])",[[row.from_user_id,row.to_user_id]])).rows;
 const who=(id:string)=>users.find(u=>u.id===id);
 return {id:row.id,tenant_id:row.tenant_id,from_user:who(row.from_user_id),to_user:who(row.to_user_id),state:row.state,revision:row.revision,created_at:row.created_at,expires_at:row.expires_at,resolved_at:row.resolved_at,reason_code:row.reason_code,former_owner_role:"admin"};
}
async function list(tx:Tx,p:Principal,tenant:string,q:z.infer<typeof paging>,operator=false){
 const actor=operator?null:await currentMember(tx,p,tenant);
 const args=[tenant,p.id,operator||actor?.role==="owner",q.direction,q.page_size,(q.page-1)*q.page_size];
 const filter="tenant_id=$1 AND ($3::boolean OR from_user_id=$2 OR to_user_id=$2) AND ($4::text='all' OR (to_user_id=$2 AND state='pending' AND expires_at>clock_timestamp()))";
 const rows=(await tx.query(`SELECT * FROM ownership_transfers WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6`,args)).rows;
 const total=(await tx.query(`SELECT count(*)::int n FROM ownership_transfers WHERE ${filter}`,args.slice(0,4))).rows[0].n;
 return {items:await Promise.all(rows.map(r=>dto(tx,r))),total,page:q.page,page_size:q.page_size};
}

/** No external links or bearer handover tokens. Only the exact signed-in
 * recipient can accept; the original owner's permissions stay until then. */
export function registerOwnershipTransfers(app:FastifyInstance,db:Database){
 const base="/v1/tenants/:tenant/ownership-transfers";
 app.get(base,{preHandler:requireUser(db)},async(req,reply)=>{
  const {tenant}=parameters(req),q=paging.parse(req.query);reply.header("Cache-Control","no-store");
  return db.tx(async tx=>{await lockCurrentScopeSession(tx,req.principal);await tenantRow(tx,tenant);return list(tx,req.principal,tenant,q);},tenant,true,req.principal.id);
 });
 app.post(base,{preHandler:requireUser(db)},async(req,reply)=>{
  const {tenant}=parameters(req),b=command.parse(req.body),p=req.principal;reply.header("Cache-Control","no-store");
  return db.tx(async tx=>{
   await lockParties(tx,[p.id,b.recipient_id]);await lockCurrentScopeSession(tx,p);await lockMemberships(tx,tenant);
   const t=await tenantRow(tx,tenant),from=await currentMember(tx,p,tenant),to=await membership(tx,tenant,b.recipient_id);
   if(from.role!=="owner")throw new Problem(403,"OWNER_REQUIRED","Only a current workspace owner can initiate a handover");
   if(t.name!==b.confirmation)throw new Problem(409,"CONFIRMATION_MISMATCH","Type the current workspace name");
   if(p.id===b.recipient_id||!active(to)||to.role==="owner")throw new Problem(409,"RECIPIENT_UNAVAILABLE","Choose another active member who is not already an owner");
   const result=await replay(tx,p.id,"ownership.transfer.create:"+tenant,key(req),b,async()=>{
    const pending=(await tx.query("SELECT * FROM ownership_transfers WHERE tenant_id=$1 AND state='pending' FOR UPDATE",[tenant])).rows[0];
    if(pending&&(await invalidate(tx,pending)).state==="pending")throw new Problem(409,"HANDOVER_PENDING","Resolve the existing handover before starting another");
    const row=(await tx.query("INSERT INTO ownership_transfers(tenant_id,from_user_id,to_user_id,from_version,to_version,from_auth_version,to_auth_version) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[tenant,p.id,b.recipient_id,from.version,to.version,from.user_auth_version,to.user_auth_version])).rows[0];
    await audit(tx,p,"ownership.transfer.request",row.id,"pending",{from_user_id:p.id,to_user_id:b.recipient_id},tenant);return{id:row.id};
   });
   return dto(tx,await hint(tx,tenant,result.id));
  },tenant,true,p.id);
 });
 for(const action of ["accept","decline","cancel"] as const)app.post(base+"/:id/"+action,{preHandler:requireUser(db)},async(req,reply)=>{
  const {tenant,id}=parameters(req),b=decision.parse(req.body),p=req.principal;key(req);reply.header("Cache-Control","no-store");
  const result=await db.tx(async tx=>{
   const h=await hint(tx,tenant,id!);await lockParties(tx,[p.id,h.from_user_id,h.to_user_id]);await lockCurrentScopeSession(tx,p);await lockMemberships(tx,tenant);
   await tenantRow(tx,tenant);const actor=await currentMember(tx,p,tenant);
   if(action==="cancel"?h.from_user_id!==p.id&&actor.role!=="owner":h.to_user_id!==p.id)throw new Problem(404,"NOT_FOUND","Ownership transfer not found");
   let row=(await tx.query("SELECT * FROM ownership_transfers WHERE id=$1 FOR UPDATE",[id])).rows[0];
   row=await invalidate(tx,row);
   const terminal=action==="accept"?"accepted":action==="decline"?"declined":"cancelled";
   if(row.state!=="pending")return{value:await dto(tx,row),blocked:row.state!==terminal};
   if(row.revision!==b.expected_revision)throw new Problem(409,"VERSION_CONFLICT","The handover changed; refresh before deciding");
   if(action==="accept"){
    // Promote first, then demote, in the same transaction: no zero-owner window.
    await tx.query("UPDATE memberships SET role='owner',version=version+1 WHERE tenant_id=$1 AND user_id=$2",[tenant,row.to_user_id]);
    await tx.query("UPDATE memberships SET role='admin',version=version+1 WHERE tenant_id=$1 AND user_id=$2",[tenant,row.from_user_id]);
   }
   row=await finish(tx,row,terminal,action==="accept"?"accepted":action==="decline"?"recipient_declined":"owner_cancelled",p);
   return{value:await dto(tx,row),blocked:false};
  },tenant,true,p.id);
  if(result.blocked)throw new Problem(409,"HANDOVER_CLOSED","The handover expired or authorization changed; refresh the current record");
  return result.value;
 });
 const adminBase="/v1/admin/tenants/:tenant/ownership-transfers";
 app.get(adminBase,{preHandler:requireAdmin(db)},async(req,reply)=>{
  const {tenant}=parameters(req),q=paging.parse(req.query);reply.header("Cache-Control","no-store");
  return db.tx(async tx=>{await lockAdminAccess(tx);await requireSensitiveAdmin(tx,req.principal);await membershipAdminAuthority(tx,req.principal,tenant);return list(tx,req.principal,tenant,q,true);},undefined,true);
 });
 app.post(adminBase+"/:id/cancel",{preHandler:requireAdmin(db)},async(req,reply)=>{
  const {tenant,id}=parameters(req),b=decision.parse(req.body),p=req.principal;key(req);reply.header("Cache-Control","no-store");
  return db.tx(async tx=>{
   await lockAdminAccess(tx);await requireSensitiveAdmin(tx,p);await membershipAdminAuthority(tx,p,tenant);
   const h=await hint(tx,tenant,id!);await lockParties(tx,[h.from_user_id,h.to_user_id]);await lockMemberships(tx,tenant);
   const row=(await tx.query("SELECT * FROM ownership_transfers WHERE id=$1 FOR UPDATE",[id])).rows[0];
   if(row.state==="cancelled")return dto(tx,row);
   if(row.state!=="pending"||row.revision!==b.expected_revision)throw new Problem(409,"VERSION_CONFLICT","Refresh the current handover before cancelling");
   return dto(tx,await finish(tx,row,"cancelled","operator_cancelled",p));
  },undefined,true);
 });
}

export async function expireOwnershipTransfers(db:Database){
 return db.tx(async tx=>{
  const rows=(await tx.query(`SELECT x.* FROM ownership_transfers x WHERE state='pending' AND (
   expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=x.tenant_id AND t.status='active' AND t.erasure_requested_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM memberships f JOIN users u ON u.id=f.user_id WHERE f.tenant_id=x.tenant_id AND f.user_id=x.from_user_id AND f.role='owner' AND f.status='active' AND NOT f.admin_suspended AND f.version=x.from_version AND u.status='active' AND u.auth_version=x.from_auth_version)
   OR NOT EXISTS(SELECT 1 FROM memberships r JOIN users u ON u.id=r.user_id WHERE r.tenant_id=x.tenant_id AND r.user_id=x.to_user_id AND r.role<>'owner' AND r.status='active' AND NOT r.admin_suspended AND r.version=x.to_version AND u.status='active' AND u.auth_version=x.to_auth_version)
  ) ORDER BY expires_at,id LIMIT 100 FOR UPDATE OF x SKIP LOCKED`)).rows;
  for(const row of rows)await invalidate(tx,row);
  return rows.length;
 },undefined,true);
}
