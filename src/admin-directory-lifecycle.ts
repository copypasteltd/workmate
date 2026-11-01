import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { key, replay } from "./access.js";
import { lockAdminAccess, permit, requireSensitiveAdmin } from "./admin-access.js";
import { adminApprovalRequired } from "./admin-execution-policy.js";
import { createApprovalRequest } from "./admin-approval-storage.js";
import { currentAdminControl, pinAdminPolicy } from "./admin-operation-policy.js";
import { userAccountAuthority, changeAccountStatus, accountState } from "./admin-accounts.js";
import { membershipAdminAuthority, adminOperationDTO } from "./admin-memberships.js";
import { lockUserAuthorities } from "./user-authority.js";
import { lockMemberships } from "./membership.js";
import { requestScopeErasure } from "./scope-erasure.js";
import { canonical, hash, name, email, uuid, Problem } from "./lib.js";

const reason = z.string().trim().min(3).max(1000);
const targets = z.array(z.object({ id: uuid, version: z.number().int().positive() }).strict()).min(1).max(100)
  .refine(v => new Set(v.map(x => x.id)).size === v.length, "Select each record once");
export const directoryCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("users.create"), email, display_name: name, reason }).strict(),
  z.object({ action: z.literal("tenants.create"), name, owner_id: uuid, project_name: name, reason }).strict(),
  z.object({ action: z.literal("users.delete"), targets, reason, acknowledge_retention: z.literal(true) }).strict(),
  z.object({ action: z.literal("tenants.delete"), targets, reason, acknowledge_retention: z.literal(true) }).strict(),
  z.object({ action: z.literal("users.status"), targets, state: z.enum(["active", "frozen"]), reason }).strict(),
  z.object({ action: z.literal("tenants.status"), targets, state: z.enum(["active", "suspended"]), reason }).strict(),
]);
type Command = z.infer<typeof directoryCommand>;
const confirmation = z.object({ preview_id: uuid, payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entity = (c: Command): "users" | "tenants" => c.action.startsWith("users.") ? "users" : "tenants";
export const directoryPermission = (c: Command) => "admin." + c.action.replace(/\.status$/, ".status.write");
export const isDirectoryOperation = (op: any) => op.payload?.directory_command_version === 1;
const stale = () => new Problem(409, "PREVIEW_CHANGED", "Selection, policy or account changed; review a new preview");

export async function directoryAuthority(tx: Tx, p: Principal, c: Command, permission = directoryPermission(c)) {
  await lockAdminAccess(tx);
  await requireSensitiveAdmin(tx, p);
  if ("targets" in c) {
    // A batch is a fixed, explicit selection. The full count must fit every
    // applicable grant; a collection of small grants cannot bypass max_batch.
    if (entity(c) === "users") {
      await permit(tx, p, permission, {}, { batch: c.targets.length });
      for (const t of c.targets) {
        await userAccountAuthority(tx, p, t.id, permission);
        await userAccountAuthority(tx, p, t.id, "admin.users.read");
      }
    } else {
      for (const t of c.targets) {
        await permit(tx, p, permission, { tenant: t.id }, { batch: c.targets.length });
        await membershipAdminAuthority(tx, p, t.id, permission);
        await membershipAdminAuthority(tx, p, t.id, "admin.tenants.read");
      }
    }
  } else {
    await permit(tx, p, permission);
    if (c.action === "tenants.create") await userAccountAuthority(tx, p, c.owner_id, "admin.users.read");
  }
}
async function policy(tx: Tx, p: Principal, c: Command) {
  const published = await currentAdminControl(tx);
  const rules = z.object({ account_close_requires_approval: z.boolean().default(true),
    membership_privileged_requires_approval: z.boolean().default(true) }).parse(published?.body ?? {});
  const id = await pinAdminPolicy(tx, { directory_command_version: 1, action: c.action,
    catalog_version_id: published?.id ?? null, rules, batch_limit: 100, recent_mfa_minutes: 10, preview_minutes: 5 });
  const configured = c.action.endsWith(".delete") ? rules.account_close_requires_approval :
    c.action === "tenants.create" ? rules.membership_privileged_requires_approval : false;
  return { id, approval: await adminApprovalRequired(tx, p, configured) };
}
async function inspect(tx: Tx, c: Command) {
  if (c.action === "users.create") {
    if ((await tx.query("SELECT id FROM users WHERE email=$1", [c.email])).rowCount)
      throw new Problem(409, "EMAIL_ALREADY_EXISTS", "An account already uses this email");
    return [];
  }
  if (c.action === "tenants.create") {
    await lockUserAuthorities(tx, [c.owner_id]);
    const owner = (await tx.query("SELECT id,name,version,auth_version,status,admin_closed_at,deleted_at FROM users WHERE id=$1 FOR NO KEY UPDATE", [c.owner_id])).rows[0];
    if (!owner || owner.status !== "active" || owner.admin_closed_at || owner.deleted_at)
      throw new Problem(409, "OWNER_UNAVAILABLE", "Choose an active, available owner");
    return [{ id: owner.id, version: owner.version, auth_version: owner.auth_version, name: owner.name }];
  }
  const ids = c.targets.map(t => t.id).sort(), type = entity(c);
  if (type === "users") await lockUserAuthorities(tx, ids);
  const tenants = type === "tenants" ? ids : (await tx.query("SELECT DISTINCT tenant_id FROM memberships WHERE user_id=ANY($1::uuid[]) UNION SELECT tenant_id FROM invites WHERE created_by=ANY($1::uuid[]) OR email IN (SELECT email FROM users WHERE id=ANY($1::uuid[])) ORDER BY tenant_id", [ids])).rows.map(r => r.tenant_id);
  for (const id of tenants) await lockMemberships(tx, id);
  const rows = (await tx.query(`SELECT * FROM ${type} WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE`, [ids])).rows;
  if (rows.length !== ids.length) throw new Problem(404, "NOT_FOUND", "Some selected records are unavailable");
  for (const r of rows) {
    if (r.deleted_at || r.erasure_requested_at) throw new Problem(410, "ACCOUNT_DELETED", "A selected record has already been deleted");
    if (r.version !== c.targets.find(t => t.id === r.id)!.version) throw stale();
    if (c.action.endsWith(".status") && r.admin_closed_at)
      throw new Problem(409, "ACCOUNT_CLOSED", "Use the reviewed account workflow to reopen a closed account");
  }
  if (c.action === "users.delete") {
    // Validate the whole selection together: two selected owners must never
    // each count the other as the remaining owner.
    if ((await tx.query(`SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      WHERE m.user_id=ANY($1::uuid[]) AND m.role='owner' AND m.status='active' AND NOT m.admin_suspended
      AND t.erasure_requested_at IS NULL AND t.admin_closed_at IS NULL AND NOT EXISTS(
        SELECT 1 FROM memberships o JOIN users u ON u.id=o.user_id WHERE o.tenant_id=m.tenant_id
        AND NOT(o.user_id=ANY($1::uuid[])) AND o.role='owner' AND o.status='active' AND NOT o.admin_suspended
        AND u.status='active' AND u.deleted_at IS NULL AND u.admin_closed_at IS NULL) LIMIT 1`, [ids])).rowCount)
      throw new Problem(409, "OWNER_TRANSFER_REQUIRED", "Transfer ownership before deleting all available owners");
    if ((await tx.query(`SELECT 1 FROM tasks t LEFT JOIN reservations r ON r.task_id=t.id WHERE t.created_by=ANY($1::uuid[])
      AND (t.status IN ('queued','running','paused','awaiting_approval','needs_input','reconciling') OR r.status IN ('reserved','reconciling')) LIMIT 1`, [ids])).rowCount)
      throw new Problem(409, "UNSETTLED_USAGE", "Stop and reconcile outstanding work before deleting these accounts");
  }
  return rows.map(r => ({ id: r.id, name: r.name, version: r.version, state: accountState(r, type),
    ...(type === "users" ? { auth_version: r.auth_version } : {}) }));
}
async function execute(db: Database, tx: Tx, p: Principal, c: Command, op: any, before: any[]) {
  const items: any[] = [];
  if (c.action === "users.create") {
    const u = (await tx.query("INSERT INTO users(email,name,registration_source) VALUES($1,$2,'admin') ON CONFLICT(email) DO NOTHING RETURNING id,name,version", [c.email, c.display_name])).rows[0];
    if (!u) throw new Problem(409, "EMAIL_ALREADY_EXISTS", "An account already uses this email");
    items.push({ id: u.id, name: u.name, version: u.version, state: "active", email_verification: "required_on_sign_in" });
  } else if (c.action === "tenants.create") {
    const t = (await tx.query("INSERT INTO tenants(name,data_mode) VALUES($1,$2) RETURNING id,name,version", [c.name, db.config.DEMO_MODE ? "simulated" : "configured_services"])).rows[0];
    await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [t.id, c.owner_id]);
    const w = (await tx.query("INSERT INTO wallets(tenant_id) VALUES($1) RETURNING id", [t.id])).rows[0];
    const project = (await tx.query("INSERT INTO projects(tenant_id,name) VALUES($1,$2) RETURNING id", [t.id, c.project_name])).rows[0];
    items.push({ ...t, state: "active", owner_id: c.owner_id, billing_account_id: w.id, project_id: project.id });
  } else for (const r of before) {
    if (c.action.endsWith(".status")) {
      const state = (c as Extract<Command, { state: string }>).state;
      await changeAccountStatus(tx, entity(c), r.id, state, "stop_new");
      items.push({ id: r.id, state, version: r.version + 1 });
    } else if (c.action === "users.delete") {
      await changeAccountStatus(tx, "users", r.id, "closed", "stop_new");
      await tx.query("UPDATE memberships SET status='removed',version=version+1 WHERE user_id=$1 AND status<>'removed'", [r.id]);
      await tx.query("DELETE FROM project_members WHERE user_id=$1", [r.id]);
      await tx.query("UPDATE federated_identities SET status='revoked',version=version+1 WHERE user_id=$1 AND status<>'revoked'", [r.id]);
      await tx.query("UPDATE users SET deleted_at=clock_timestamp(),name='[deleted]',email='deleted+'||id::text||'@account.invalid',labels='[]'::jsonb WHERE id=$1", [r.id]);
      items.push({ id: r.id, state: "deleted", version: r.version + 1 });
    } else {
      const row = (await tx.query("SELECT * FROM tenants WHERE id=$1", [r.id])).rows[0];
      const cleanup = await requestScopeErasure(tx, p, "tenants", row, { confirmation: row.name,
        reason_code: "workspace_closure", acknowledge_irreversible: true, acknowledge_retention: true });
      await tx.query("UPDATE tenants SET version=version+1 WHERE id=$1", [r.id]);
      items.push({ id: r.id, state: "deleting", version: r.version + 1, deletion_job_id: cleanup.id });
    }
  }
  for (const item of items) await audit(tx, p, directoryPermission(c), item.id, "succeeded", {
    operation_id: op.id, reason: c.reason, before: before.find(r => r.id === item.id) ?? null, after: item,
    retention: c.action.endsWith(".delete") ? "financial_audit_and_shared_workspace_content" : undefined,
  }, entity(c) === "tenants" ? item.id : undefined);
  await tx.query("UPDATE admin_operations SET state='succeeded',result=$2,result_ids=$3,version=version+1 WHERE id=$1", [op.id,
    { items, total: items.length, acceptance: "atomic", cleanup: c.action === "tenants.delete" ? "durable_background_jobs" : null }, items.map(x => x.id)]);
}
export async function decideDirectoryOperation(db: Database, tx: Tx, reviewer: Principal, op: any, decision: "approve" | "reject") {
  const c = directoryCommand.parse(op.payload.command);
  await directoryAuthority(tx, reviewer, c);
  if (decision === "reject") {
    await tx.query("UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1 WHERE id=$1", [op.id, reviewer.id]);
    return;
  }
  const actor: Principal = { id: op.principal_id, audience: "admin", sessionId: op.payload.actor_session_id,
    authVersion: op.payload.actor_auth_version, email: "", name: "", sessionHash: "" };
  await directoryAuthority(tx, actor, c);
  const current = await policy(tx, actor, c), before = await inspect(tx, c);
  if (op.payload_hash !== hash(canonical(c)) || current.id !== op.policy_version_id || canonical(before) !== canonical(op.payload.before)) throw stale();
  await execute(db, tx, actor, c, op, before);
  await tx.query("UPDATE admin_operations SET approved_by=$2 WHERE id=$1", [op.id, reviewer.id]);
}
export function registerAdminDirectoryLifecycle(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) };
  app.post("/v1/admin/directory/preview", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const c = directoryCommand.parse(req.body);
    return db.tx(async tx => {
      await directoryAuthority(tx, req.principal, c);
      if ("targets" in c) for (const target of c.targets) {
        if (entity(c) === "users") await userAccountAuthority(tx, req.principal, target.id, "admin.users.read");
        else await membershipAdminAuthority(tx, req.principal, target.id, "admin.tenants.read");
      }
      const before = await inspect(tx, c), rules = await policy(tx, req.principal, c), digest = hash(canonical(c));
      const payload = { directory_command_version: 1, command: c, before, policy_version_id: rules.id, approval: rules.approval };
      const saved = (await tx.query("INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,expires_at", [req.principal.id, "directory." + c.action, payload, digest])).rows[0];
      await audit(tx, req.principal, "admin.directory.preview", saved.id, "succeeded", { action: c.action, count: "targets" in c ? c.targets.length : 1, payload_hash: digest });
      return { ...saved, ...payload, payload_hash: digest, atomic: true,
        retention: c.action === "users.delete" ? "Account contact and profile removed; shared workspace content, billing and audit retained. Email can register a new identity through OTP." : c.action === "tenants.delete" ? "Workspace is immediately fenced; durable cleanup retains financial and audit facts. Global user accounts are preserved." : null };
    }, undefined, true);
  });
  app.post("/v1/admin/directory/commands", auth, async (req, reply) => {
    reply.code(202).header("Cache-Control", "no-store");
    const b = confirmation.parse(req.body), k = key(req);
    return db.tx(async tx => {
      await lockAdminAccess(tx); await requireSensitiveAdmin(tx, req.principal);
      const preview = (await tx.query("SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE", [b.preview_id, req.principal.id])).rows[0];
      if (!preview || preview.payload.directory_command_version !== 1 || preview.payload_hash !== b.payload_hash) throw stale();
      const c = directoryCommand.parse(preview.payload.command);
      await directoryAuthority(tx, req.principal, c);
      const saved = await replay(tx, req.principal.id, "admin.directory.commands", k, b, async () => {
        if (!preview.valid || preview.consumed_at) throw stale();
        const current = await policy(tx, req.principal, c), before = await inspect(tx, c);
        if (hash(canonical(c)) !== b.payload_hash || canonical(before) !== canonical(preview.payload.before) || current.id !== preview.payload.policy_version_id || current.approval !== preview.payload.approval) throw stale();
        const payload = { ...preview.payload, actor_session_id: req.principal.sessionId, actor_auth_version: req.principal.authVersion,
          expires_at: new Date(Date.now() + 5 * 60000).toISOString() };
        const op = (await tx.query("INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [
          req.principal.id, "directory." + c.action, b.payload_hash, payload, "directory:" + hash(k), current.approval ? "pending_approval" : "running", current.id,
          "targets" in c ? c.targets.map(t => t.id) : []])).rows[0];
        if (current.approval) {
          await createApprovalRequest(tx, op);
          await audit(tx, req.principal, directoryPermission(c), op.id, "pending_approval", { reason: c.reason, payload_hash: b.payload_hash });
        } else await execute(db, tx, req.principal, c, op, before);
        await tx.query("UPDATE admin_previews SET consumed_at=now() WHERE id=$1", [preview.id]);
        return { operation_id: op.id };
      });
      const operation = (await tx.query("SELECT * FROM admin_operations WHERE id=$1", [saved.operation_id])).rows[0];
      return { ...adminOperationDTO(operation), result: operation.result };
    }, undefined, true);
  });
}
