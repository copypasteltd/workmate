import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireAdmin, audit } from "./auth.js";
import {
  permit,
  scopePredicate,
  requireRecentMfa,
  lockAdminAccess,
} from "./admin-access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { replay, key } from "./access.js";
import { Problem, uuid } from "./lib.js";

export const adminEventMetadataDTO = z
  .object({
    id: uuid,
    tenant_id: uuid,
    project_id: uuid,
    private_owner: uuid,
    state: z.enum(["active", "paused", "blocked", "retired", "ended"]),
    version: z.number().int().positive(),
    revision: z.number().int().positive(),
    key_version: z.number().int().positive(),
    max_budget_micros: z.string().regex(/^\d+$/).nullable(),
    max_daily_budget_micros: z.string().regex(/^\d+$/).nullable(),
    pending_events: z.number().int().nonnegative(),
    last_error: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .strict();
export const adminEventQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    state: z
      .enum(["active", "paused", "blocked", "retired", "ended"])
      .optional(),
  })
  .strict();
export const adminEventPause = z
  .object({
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export function registerAdminCloudEvents(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/admin/private-cloud-events",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = adminEventQuery.parse(req.query);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireRecentMfa(tx, req.principal);
          const scope = await scopePredicate(
            tx,
            req.principal,
            "admin.execution.read",
            "s.tenant_id",
            "s.project_id",
          );
          const n = scope.values.length,
            values = [...scope.values, q.state ?? null];
          const where = `${scope.sql} AND ($${n + 1}::text IS NULL OR s.state=$${n + 1})`;
          const rows = (
            await tx.query(
              `SELECT s.id,s.tenant_id,s.project_id,s.private_owner,s.state,s.version,s.revision,s.key_version,s.last_error,s.created_at,
        v.body->>'max_budget_micros' AS max_budget_micros,v.body->>'max_daily_budget_micros' AS max_daily_budget_micros,
        (SELECT count(*)::int FROM cloud_event_inbox i WHERE i.trigger_id=s.id AND i.state='pending') AS pending_events
        FROM cloud_event_triggers s JOIN cloud_event_versions v ON v.trigger_id=s.id AND v.revision=s.revision
        WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT $${n + 2} OFFSET $${n + 3}`,
              [...values, q.page_size, (q.page - 1) * q.page_size],
            )
          ).rows;
          const total = Number(
            (
              await tx.query(
                `SELECT count(*) FROM cloud_event_triggers s WHERE ${where}`,
                values,
              )
            ).rows[0].count,
          );
          const items = rows.map((r) =>
            adminEventMetadataDTO.parse({
              ...r,
              created_at: new Date(r.created_at).toISOString(),
            }),
          );
          await audit(
            tx,
            req.principal,
            "admin.execution.event.read",
            "cloud-event-triggers",
            "succeeded",
            { count: items.length, page: q.page },
            undefined,
          );
          return { items, total, ...q };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/private-cloud-events/:id/pause",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = adminEventPause.parse(req.body);
      // Discover only the lock identity. Recheck the complete row and authority under the transaction locks.
      const located = (
        await db.control.query(
          "SELECT private_owner FROM cloud_event_triggers WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!located)
        throw new Problem(404, "NOT_FOUND", "Event workflow not found");
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [located.private_owner]);
          await lockAdminAccess(tx);
          const row = (
            await tx.query(
              "SELECT * FROM cloud_event_triggers WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!row)
            throw new Problem(404, "NOT_FOUND", "Event workflow not found");
          await permit(tx, req.principal, "admin.execution.pause", {
            tenant: row.tenant_id,
            project: row.project_id,
          });
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "admin.cloud.event.pause:" + id,
            key(req),
            b,
            async () => {
              if (row.version !== b.expected_version || row.state !== "active")
                throw new Problem(
                  409,
                  "EVENT_VERSION_CHANGED",
                  "Refresh the event workflow before pausing",
                );
              await tx.query(
                "UPDATE cloud_event_inbox SET state='ignored_inactive',code='ADMIN_PAUSED' WHERE trigger_id=$1 AND state='pending'",
                [id],
              );
              const next = (
                await tx.query(
                  "UPDATE cloud_event_triggers SET state='paused',version=version+1,updated_at=now() WHERE id=$1 RETURNING version",
                  [id],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "admin.execution.pause",
                id,
                "succeeded",
                {
                  kind: "private_cloud_event",
                  reason: b.reason,
                  current_runs_preserved: true,
                },
                row.tenant_id,
              );
              return { ok: true, version: next.version };
            },
          );
        },
        undefined,
        true,
      );
    },
  );
}
