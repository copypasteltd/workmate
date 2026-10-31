import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { key, replay } from "./access.js";
import { permit, requireSensitiveAdmin } from "./admin-access.js";
import { lockCurrentScopeSession } from "./scope-closure-authority.js";
import { lockMemberships } from "./membership.js";
import { Problem, uuid } from "./lib.js";
import { deletionJobDetails } from "./deletions.js";

export const scopeKinds = ["projects", "tenants"] as const;
export type ScopeKind = typeof scopeKinds[number];
const body = z.object({
  confirmation: z.string().min(1).max(160),
  reason_code: z.enum(["customer_request", "workspace_closure", "privacy_request"]),
  acknowledge_irreversible: z.literal(true),
  acknowledge_retention: z.literal(true),
}).strict();
const safeJob = (job: any) => ({ id: job.id, target_type: job.target_type, target_id: job.target_id,
  tenant_id: job.tenant_id, project_id: job.project_id, state: job.state, exceptions: job.exceptions });

async function scope(tx: Tx, kind: ScopeKind, id: string) {
  const row = (await tx.query(`SELECT * FROM ${kind} WHERE id=$1`, [id])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Workspace or project not found");
  return row;
}

async function authorizeUser(tx: Tx, p: Principal, tenant: string, kind: ScopeKind) {
  await lockCurrentScopeSession(tx,p);
  await lockMemberships(tx, tenant);
  const m = (await tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active' AND NOT admin_suspended", [tenant, p.id])).rows[0];
  if (!m) throw new Problem(404, "NOT_FOUND", "Workspace not found");
  if (!(kind === "tenants" ? ["owner"] : ["owner", "admin"]).includes(m.role))
    throw new Problem(403, "FORBIDDEN", "Current workspace ownership or project administration is required");
}

async function preview(tx: Tx, row: any, kind: ScopeKind) {
  const tenant = kind === "tenants" ? row.id : row.tenant_id, project = kind === "projects" ? row.id : null;
  const counts = (await tx.query(`SELECT
    (SELECT count(*)::int FROM projects WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2)) AS projects,
    (SELECT count(*)::int FROM assets WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND state<>'deleted') AS assets,
    (SELECT count(*)::int FROM tasks WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND content_state<>'deleted') AS tasks,
    (SELECT count(*)::int FROM tasks WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND status IN('queued','running','paused','awaiting_approval','needs_input','reconciling')) AS executions_to_close,
    (SELECT count(*)::int FROM upload_sessions WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2)) AS uploads`, [tenant, project])).rows[0];
  return { target_type: kind, target_id: row.id, tenant_id: tenant, name: row.name,
    irreversible: true, requested: !!row.erasure_requested_at, counts,
    retention: ["minimal_financial_audit_facts", "shared_objects_with_live_references", "backups_with_mandatory_erasure_replay", "customer_local_downloads_outside_cloud_scope"],
    inflight: "Cancellation is requested. Unknown external charges or unverified computer cleanup remain pending; no funds are released by the erasure request." };
}

async function request(tx: Tx, p: Principal, kind: ScopeKind, row: any, b: z.infer<typeof body>) {
  // Only first acceptance needs the root lock. Never wait on an existing job
  // while holding its root: the worker finishes in the opposite direction.
  if (!row.erasure_requested_at) row = (await tx.query(`SELECT * FROM ${kind} WHERE id=$1 FOR UPDATE`, [row.id])).rows[0];
  if (row.erasure_requested_at) return safeJob((await tx.query("SELECT * FROM deletion_jobs WHERE target_type=$1 AND target_id=$2", [kind, row.id])).rows[0]);
  if (!row.erasure_requested_at && b.confirmation !== row.name)
    throw new Problem(409, "ERASURE_CONFIRMATION_MISMATCH", "Type the exact current workspace or project name");
  const tenant = kind === "tenants" ? row.id : row.tenant_id;
  await tx.query(`UPDATE ${kind} SET erasure_requested_at=coalesce(erasure_requested_at,clock_timestamp()),
    ${kind === "tenants" ? "status='suspended'" : "archived=true"} WHERE id=$1`, [row.id]);
  const job = (await tx.query("SELECT * FROM deletion_jobs WHERE target_type=$1 AND target_id=$2", [kind, row.id])).rows[0];
  await tx.query("UPDATE deletion_jobs SET created_by=coalesce(created_by,$2) WHERE id=$1", [job.id, p.audience === "admin" ? null : p.id]);
  // Commit the root fence without waiting for upload/task locks. Old uploads
  // can hold their own row while waiting on a project FK; locking both here
  // would create a lock cycle. The worker expands and rescans the durable scope.
  await audit(tx, p, "scope.erasure.request", row.id, "accepted", { deletion_id: job.id, target_type: kind, reason_code: b.reason_code }, tenant);
  return safeJob(job);
}

export function registerScopeErasure(app: FastifyInstance, db: Database) {
  for (const kind of scopeKinds) {
    const route = kind === "tenants" ? "/v1/tenants/:tenant/erasure" : "/v1/tenants/:tenant/projects/:project/erasure";
    app.get(route + "-preview", { preHandler: requireUser(db) }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant), id = kind === "tenants" ? tenant : uuid.parse((req.params as any).project);
      if (req.headers["x-tenant-id"] !== undefined && uuid.parse(req.headers["x-tenant-id"]) !== tenant) throw new Problem(400, "TENANT_MISMATCH", "Workspace header does not match the path");
      return db.tx(async tx => {
        await authorizeUser(tx, req.principal, tenant, kind);
        const row = await scope(tx, kind, id);
        if (kind === "projects" && row.tenant_id !== tenant) throw new Problem(404, "NOT_FOUND", "Project not found");
        return preview(tx, row, kind);
      }, tenant, true, req.principal.id);
    });
    app.post(route, { preHandler: requireUser(db) }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant), id = kind === "tenants" ? tenant : uuid.parse((req.params as any).project), b = body.parse(req.body);
      if (req.headers["x-tenant-id"] !== undefined && uuid.parse(req.headers["x-tenant-id"]) !== tenant) throw new Problem(400, "TENANT_MISMATCH", "Workspace header does not match the path");
      const result = await db.tx(async tx => {
        await authorizeUser(tx, req.principal, tenant, kind);
        const row = await scope(tx, kind, id);
        if (kind === "projects" && row.tenant_id !== tenant) throw new Problem(404, "NOT_FOUND", "Project not found");
        await replay(tx, req.principal.id, `scope.erasure:${kind}:${id}`, key(req), b, () => request(tx, req.principal, kind, row, b));
        return safeJob((await tx.query("SELECT * FROM deletion_jobs WHERE target_type=$1 AND target_id=$2", [kind, id])).rows[0]);
      }, tenant, true, req.principal.id);
      return reply.code(202).send(result);
    });
  }

  // This account-level page survives deletion of the last project or workspace.
  app.get("/v1/scope-deletions", { preHandler: requireUser(db) }, async (req, reply) => {
    const q = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), page_size: z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(req.query);
    reply.header("Cache-Control", "no-store");
    return db.tx(async tx => {
      await lockCurrentScopeSession(tx, req.principal);
      const where = "d.target_type IN('projects','tenants') AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=d.tenant_id AND m.user_id=$1 AND m.status='active' AND NOT m.admin_suspended AND (m.role='owner' OR (d.target_type='projects' AND m.role='admin')))";
      const items = (await tx.query(`SELECT d.* FROM deletion_jobs d WHERE ${where} ORDER BY d.created_at DESC,d.id DESC LIMIT $2 OFFSET $3`, [req.principal.id, q.page_size, (q.page - 1) * q.page_size])).rows;
      const total = (await tx.query(`SELECT count(*)::int AS n FROM deletion_jobs d WHERE ${where}`, [req.principal.id])).rows[0].n;
      return { items: await deletionJobDetails(tx, items), total, page: q.page, page_size: q.page_size };
    }, undefined, true, req.principal.id);
  });

  for (const method of ["get", "post"] as const) app[method]("/v1/admin/scopes/:kind/:id/erasure" + (method === "get" ? "-preview" : ""), { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { kind, id } = z.object({ kind: z.enum(scopeKinds), id: uuid }).parse(req.params), b = method === "post" ? body.parse(req.body) : null;
    const result = await db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal);
      const row = await scope(tx, kind, id), tenant = kind === "tenants" ? id : row.tenant_id;
      await permit(tx, req.principal, "admin.content.delete", { tenant, ...(kind === "projects" ? { project: id } : {}) });
      if (kind === "tenants") for (const child of (await tx.query("SELECT id FROM projects WHERE tenant_id=$1 ORDER BY id", [tenant])).rows)
        await permit(tx, req.principal, "admin.content.delete", { tenant, project: child.id });
      if (!b) return preview(tx, row, kind);
      await replay(tx, req.principal.id, `admin.scope.erasure:${kind}:${id}`, key(req), b, () => request(tx, req.principal, kind, row, b));
      return safeJob((await tx.query("SELECT * FROM deletion_jobs WHERE target_type=$1 AND target_id=$2", [kind, id])).rows[0]);
    }, undefined, true);
    return reply.code(method === "post" ? 202 : 200).send(result);
  });
}
