import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { audit, requireAdmin } from "./auth.js";
import { readScope } from "./admin-directory.js";
import { z } from "zod";

/** Aggregate the same readable subjects as the directory and billing pages. */
export function registerAdminOverview(app: FastifyInstance, db: Database) {
  app.get("/v1/admin/overview", { preHandler: requireAdmin(db) }, async (req) => {
    z.object({}).strict().parse(req.query);
    return db.tx(async (tx) => {
      // Recheck the exact live MFA session after the access lock, then retain
      // one binding set for every field. A global allow never overrides deny.
      const s = await readScope(tx, req.principal, "admin.overview.read");
      const mode = s.arg(db.config.DEMO_MODE ? "simulated" : "configured_services");
      const tenants = `SELECT count(*)::int FROM tenants n WHERE ${s.scope("admin.overview.read", "n.id")}
        OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=n.id AND ${s.scope("admin.overview.read", "p.tenant_id", "p.id")})`;
      const users = s.has("admin.users.read")
        ? `(SELECT count(*)::int FROM users u WHERE ${s.user("admin.users.read")})`
        : "NULL::integer";
      const tasks = s.has("admin.usage.read")
        ? `(SELECT count(*)::int FROM tasks t WHERE t.data_mode=${mode} AND ${s.scope("admin.usage.read", "t.tenant_id", "t.project_id")})`
        : "NULL::integer";
      // Customer charge facts are immutable ledger entries. Include dedicated
      // cloud resource charges, which have a project but no ordinary task.
      // Refunds, funding, holds and unknown usage are separate accounting facts.
      const charges = s.has("admin.usage.read")
        ? `(SELECT coalesce(sum(-l.amount_micros),0)::text FROM ledger l
          LEFT JOIN tasks t ON t.id=l.task_id
          LEFT JOIN cloud_runtime_sessions c ON c.id=l.cloud_runtime_session_id
          WHERE l.kind='charge' AND l.data_mode=${mode}
          AND ${s.scope("admin.usage.read", "coalesce(t.tenant_id,c.tenant_id,l.tenant_id)", "coalesce(t.project_id,c.project_id)")})`
        : "NULL::text";
      const reserved = s.has("admin.billing.read")
        ? `(SELECT coalesce(sum(w.reserved_micros),0)::text FROM wallets w
          WHERE w.data_mode=${mode} AND ${s.account("admin.billing.read")})`
        : "NULL::text";
      const reconciling = s.has("admin.execution.read")
        ? `(SELECT count(*)::int FROM tasks t WHERE t.status='reconciling'
          AND t.data_mode=${mode} AND ${s.scope("admin.execution.read", "t.tenant_id", "t.project_id")})`
        : "NULL::integer";
      // One statement gives all figures the same database snapshot. The mode
      // placeholder is typed even for operators with no financial/task fields.
      const summary = (await tx.query(`SELECT (${tenants}) AS tenants,${users} AS users,
        ${tasks} AS tasks,${charges} AS charged_micros,${reserved} AS reserved_micros,
        ${reconciling} AS reconciling WHERE ${mode}::text IS NOT NULL`, s.values)).rows[0];
      await audit(tx, req.principal, "admin.overview.read", undefined);
      return {
        summary,
        activity: (await tx.query("SELECT action,outcome,created_at FROM audit_log WHERE principal_id=$1 ORDER BY id DESC LIMIT 12", [req.principal.id])).rows,
      };
    }, undefined, true);
  });
}
