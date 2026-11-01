import type { Tx } from "./db.js";
import { audit, type Principal } from "./auth.js";
import { enableSuperAdminDirect } from "./admin-execution-policy.js";
import { Problem } from "./lib.js";

/** A highest-admin execution is explicitly recorded as such. It never invents
 * an independent reviewer and uses the original frozen business executor. */
export async function commitApprovalDecision(tx: Tx, actor: Principal, op: any, request: any,
  decision: {decision:"approve"|"reject";reason:string}, apply:()=>Promise<void>) {
  const direct = await enableSuperAdminDirect(tx, actor);
  if (!direct && actor.id === op.principal_id)
    throw new Problem(403,"SELF_APPROVAL_FORBIDDEN","A different authorized administrator must review this operation");
  await apply();
  await tx.query("INSERT INTO admin_approval_decisions(approval_id,reviewer_id,expected_version,payload_hash,decision,reason) VALUES($1,$2,$3,$4,$5,$6)",
    [request.id,actor.id,request.version,request.payload_hash,decision.decision,decision.reason]);
  await tx.query("UPDATE admin_approval_requests SET state=$2,version=version+1 WHERE id=$1",
    [request.id,decision.decision === "approve" ? "approved":"rejected"]);
  await audit(tx,actor,"admin.approval.decision",request.id,"succeeded",{
    operation_id:op.id,original_actor_id:op.principal_id,payload_hash:op.payload_hash,
    execution_mode:direct ? "super_admin_direct":"independent_review",
    decision:decision.decision,reason:decision.reason,
  },op.tenant_id ?? undefined);
}
