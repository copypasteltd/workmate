import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireUser, requireAdmin, audit } from "./auth.js";
import { projectAccess, key, replay } from "./access.js";
import { lockUserAuthorities, currentUserAuthority } from "./user-authority.js";
import { lockAdminAccess, permit, requireSensitiveAdmin } from "./admin-access.js";
import { readScope } from "./admin-directory.js";
import { Problem, uuid } from "./lib.js";
import { budgetToolPrepare, budgetToolPreview, budgetPolicyInput, googleIdentifier } from "./external-budget-model.js";
import { budgetConnection, budgetDetail, budgetOperation, budgetOperationDTO, budgetPolicyDTO, currentBudgetPolicy,
  saveBudgetPolicy, previewBudget, prepareBudget, decideBudget, cancelBudget, observeBudget, closeUnknownBudget, externalBudgetMode } from "./external-budget.js";

const root = "/v1/tenants/:tenant/projects/:project/external-budget";
const permission = { read:"admin.external_budget.read", policy:"admin.external_budget.policy.write", resolve:"admin.external_budget.resolve" };
const scopeOf = (req: FastifyRequest) => z.object({tenant:uuid,project:uuid}).passthrough().parse(req.params);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as any).id);
const query = z.object({ connection_id:uuid.optional(),account_id:googleIdentifier.optional(),state:z.enum(["awaiting_confirmation","queued","checking","dispatched","succeeded","failed","cancelled","expired","unknown","closed_unknown","no_change"]).optional(),cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(30) }).strict();
async function userGuard(tx: Tx, req: FastifyRequest, action: "read"|"write"|"manage" = "read") {
  const {tenant,project} = scopeOf(req);
  await lockUserAuthorities(tx,[req.principal.id]);
  await currentUserAuthority(tx,req.principal);
  await projectAccess(tx,req.principal,tenant,project,action);
}
async function adminGuard(tx: Tx, req: FastifyRequest, key: string, tenant: string, project: string) {
  await lockAdminAccess(tx); await requireSensitiveAdmin(tx,req.principal);
  await permit(tx,req.principal,key,{tenant,project});
}
async function list(db: Database, tx: Tx, where: string, args: unknown[], q: z.infer<typeof query>) {
  const add = (v: unknown) => {args.push(v);return "$"+args.length;};
  where += ` AND o.data_mode=${add(externalBudgetMode(db))}`;
  if(q.connection_id) where+=` AND o.connection_id=${add(q.connection_id)}::uuid`;
  if(q.account_id) where+=` AND o.account_id=${add(q.account_id)}`;
  if(q.state) where+=` AND o.state=${add(q.state)}`;
  if(q.cursor) where+=` AND o.id>${add(q.cursor)}::uuid`;
  const rows=(await tx.query(`SELECT o.* FROM external_budget_operations o WHERE ${where} ORDER BY o.id LIMIT ${add(q.limit+1)}`,args)).rows;
  return {items:rows.slice(0,q.limit).map(budgetOperationDTO),next_cursor:rows.length>q.limit?rows[q.limit-1].id:null,data_mode:externalBudgetMode(db)};
}
export function registerExternalBudgets(app: FastifyInstance, db: Database) {
  app.get(root+"/policy",{preHandler:requireUser(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const {tenant,project}=scopeOf(req),q=z.object({connection_id:uuid,account_id:googleIdentifier}).strict().parse(req.query);
    return db.tx(async tx=>{
      await userGuard(tx,req);
      await budgetConnection(db,tx,req.principal,tenant,project,q.connection_id,q.account_id);
      const m=(await tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",[tenant,req.principal.id])).rows[0];
      return {policy:budgetPolicyDTO(await currentBudgetPolicy(tx,q.connection_id,project,q.account_id)),can_manage:["owner","admin"].includes(m.role),data_mode:externalBudgetMode(db)};
    },tenant,true,req.principal.id);
  });
  app.put(root+"/policy/:connection/:account",{preHandler:requireUser(db)},async(req)=>{
    const {tenant,project}=scopeOf(req),connection=uuid.parse((req.params as any).connection),account=googleIdentifier.parse((req.params as any).account),b=budgetPolicyInput.parse(req.body),k=key(req);
    return db.tx(async tx=>{
      await userGuard(tx,req,"manage");
      return replay(tx,req.principal.id,`external_budget.policy:${project}:${connection}:${account}`,k,b,()=>saveBudgetPolicy(db,tx,req.principal,tenant,project,connection,account,b));
    },tenant,true,req.principal.id);
  });
  app.post(root+"/previews",{preHandler:requireUser(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const {tenant,project}=scopeOf(req),{connection_id,...b}=budgetToolPreview.parse(req.body);
    return previewBudget(db,req.principal,tenant,project,connection_id,b,tx=>userGuard(tx,req,"write"));
  });
  app.post(root+"/operations",{preHandler:requireUser(db)},async(req,reply)=>{
    const {tenant,project}=scopeOf(req),{connection_id,...b}=budgetToolPrepare.parse(req.body),k=key(req);
    reply.code(202).header("cache-control","private, no-store");
    return prepareBudget(db,req.principal,tenant,project,connection_id,b,k,undefined,tx=>userGuard(tx,req,"write"));
  });
  app.get(root+"/operations",{preHandler:requireUser(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const {tenant,project}=scopeOf(req),q=query.parse(req.query);
    return db.tx(async tx=>{await userGuard(tx,req);return list(db,tx,"o.tenant_id=$1 AND o.project_id=$2",[tenant,project],q);},tenant,true,req.principal.id);
  });
  app.get(root+"/operations/:id",{preHandler:requireUser(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const {tenant,project}=scopeOf(req),id=idOf(req);
    return db.tx(async tx=>{await userGuard(tx,req);return budgetDetail(db,tx,tenant,project,id);},tenant,true,req.principal.id);
  });
  for(const action of ["decision","cancel","close-unknown"] as const) app.post(root+`/operations/:id/${action}`,{preHandler:requireUser(db)},async(req)=>{
    const {tenant,project}=scopeOf(req),id=idOf(req),k=key(req);
    return db.tx(async tx=>{
      await userGuard(tx,req,action==="cancel"?"write":"manage");
      await replay(tx,req.principal.id,`external_budget.${action}:${id}`,k,req.body,async()=>{
        await (action==="decision"?decideBudget:action==="cancel"?cancelBudget:closeUnknownBudget)(db,tx,req.principal,tenant,project,id,req.body);return {id};
      });
      return budgetOperationDTO(await budgetOperation(db,tx,tenant,project,id));
    },tenant,true,req.principal.id);
  });
  app.post(root+"/operations/:id/observe",{preHandler:requireUser(db)},async(req)=>{
    const {tenant,project}=scopeOf(req);
    return observeBudget(db,req.principal,tenant,project,idOf(req),req.body,tx=>userGuard(tx,req,"manage"));
  });
  app.get("/v1/admin/external-budget/operations",{preHandler:requireAdmin(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const q=query.extend({tenant_id:uuid.optional(),project_id:uuid.optional()}).strict().parse(req.query);
    return db.tx(async tx=>{
      const s=await readScope(tx,req.principal,permission.read);
      let where=s.scope(permission.read,"o.tenant_id","o.project_id");
      if(q.tenant_id) where+=` AND o.tenant_id=${s.arg(q.tenant_id)}::uuid`;
      if(q.project_id) where+=` AND o.project_id=${s.arg(q.project_id)}::uuid`;
      const result=await list(db,tx,where,s.values,q);
      await audit(tx,req.principal,permission.read,undefined,"succeeded",{count:result.items.length});return result;
    },undefined,true,req.principal.id);
  });
  const adminScope=async(tx:Tx,req:FastifyRequest,required=permission.read)=>{
    const {tenant,project}=scopeOf(req);
    await adminGuard(tx,req,required,tenant,project);
    if(!(await tx.query("SELECT 1 FROM projects p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2 AND t.data_mode=$3",[project,tenant,externalBudgetMode(db)])).rowCount)
      throw new Problem(404,"NOT_FOUND","Project not found");
    return {tenant,project};
  };
  const adminRoot="/v1/admin/tenants/:tenant/projects/:project/external-budget";
  app.get(adminRoot+"/operations/:id",{preHandler:requireAdmin(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    return db.tx(async tx=>{
      const {tenant,project}=await adminScope(tx,req),detail=await budgetDetail(db,tx,tenant,project,idOf(req));
      await audit(tx,req.principal,permission.read,idOf(req),"succeeded",{},tenant);return detail;
    },undefined,true,req.principal.id);
  });
  app.get(adminRoot+"/policy",{preHandler:requireAdmin(db)},async(req,reply)=>{
    reply.header("cache-control","private, no-store");
    const q=z.object({connection_id:uuid,account_id:googleIdentifier}).strict().parse(req.query);
    return db.tx(async tx=>{
      const {tenant,project}=await adminScope(tx,req);
      await budgetConnection(db,tx,req.principal,tenant,project,q.connection_id,q.account_id,"read",true);
      await audit(tx,req.principal,permission.read,q.connection_id,"succeeded",{account_id:q.account_id,project_id:project},tenant);
      return {policy:budgetPolicyDTO(await currentBudgetPolicy(tx,q.connection_id,project,q.account_id)),data_mode:externalBudgetMode(db)};
    },undefined,true,req.principal.id);
  });
  app.put(adminRoot+"/policy/:connection/:account",{preHandler:requireAdmin(db)},async(req)=>{
    const b=budgetPolicyInput.parse(req.body),connection=uuid.parse((req.params as any).connection),account=googleIdentifier.parse((req.params as any).account),k=key(req);
    return db.tx(async tx=>{
      const {tenant,project}=await adminScope(tx,req,permission.policy);
      await permit(tx,req.principal,permission.policy,{tenant,project},{amount:BigInt(b.policy.maximum_average_daily_micros),hours:b.policy.enabled?Math.ceil((Date.parse(b.policy.expires_at)-Date.now())/3600000):0});
      return replay(tx,req.principal.id,`admin.external_budget.policy:${project}:${connection}:${account}`,k,b,()=>saveBudgetPolicy(db,tx,req.principal,tenant,project,connection,account,b,true));
    },undefined,true,req.principal.id);
  });
  for(const action of ["cancel","close-unknown"] as const) app.post(adminRoot+`/operations/:id/${action}`,{preHandler:requireAdmin(db)},async(req)=>{
    const id=idOf(req),k=key(req);
    return db.tx(async tx=>{
      const {tenant,project}=await adminScope(tx,req,permission.resolve);
      await replay(tx,req.principal.id,`admin.external_budget.${action}:${id}`,k,req.body,async()=>{
        await (action==="cancel"?cancelBudget:closeUnknownBudget)(db,tx,req.principal,tenant,project,id,req.body,true);return {id};
      });
      return budgetOperationDTO(await budgetOperation(db,tx,tenant,project,id));
    },undefined,true,req.principal.id);
  });
  app.post(adminRoot+"/operations/:id/observe",{preHandler:requireAdmin(db)},async(req)=>{
    const {tenant,project}=scopeOf(req);
    return observeBudget(db,req.principal,tenant,project,idOf(req),req.body,tx=>adminScope(tx,req,permission.resolve),true);
  });
}
