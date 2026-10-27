import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireUser } from "./auth.js";
import { tenantAccess, projectAccess, key, replay } from "./access.js";
import { effectiveVip } from "./vip.js";
import { Problem, uuid } from "./lib.js";

export function registerUserEntitlements(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireUser(db) };
  app.get("/v1/plans", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = uuid.parse(req.headers["x-tenant-id"]);
    const q = z
      .object({
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        project_id: uuid.optional(),
      })
      .strict()
      .parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      if (q.project_id)
        await projectAccess(tx, req.principal, tenant, q.project_id);
      if (
        q.cursor &&
        !(
          await tx.query(
            "SELECT 1 FROM commercial_plans WHERE published_version_id=$1",
            [q.cursor],
          )
        ).rowCount
      )
        throw new Problem(
          410,
          "CURSOR_EXPIRED",
          "Refresh the current plan list",
        );
      const rows = (
        await tx.query(
          `SELECT v.* FROM commercial_plan_versions v JOIN commercial_plans p ON p.published_version_id=v.id
        WHERE ($1::uuid IS NULL OR v.id>$1) ORDER BY v.id LIMIT $2`,
          [q.cursor ?? null, q.limit + 1],
        )
      ).rows;
      const items = rows
        .slice(0, q.limit)
        .map((v) => ({
          id: v.id,
          name: v.name,
          version: v.version,
          seats: v.allowances.seat_limit,
          included_credit: v.allowances.included_credit,
          capability_ids: v.allowances.feature_ids,
        }));
      return {
        items,
        next_cursor: rows.length > q.limit ? items.at(-1)!.id : null,
      };
    }, tenant);
  });
  app.get("/v1/effective-entitlements", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = uuid.parse(req.headers["x-tenant-id"]);
    const q = z
      .object({ subject_kind: z.enum(["user", "tenant"]).default("user") })
      .strict()
      .parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(
        tx,
        req.principal,
        tenant,
        q.subject_kind === "tenant" ? "manage" : "read",
      );
      const effective = await effectiveVip(
        tx,
        tenant,
        req.principal.id,
        q.subject_kind === "tenant" ? "tenant" : "merged",
      );
      return {
        subject: {
          kind: q.subject_kind,
          id: q.subject_kind === "tenant" ? tenant : req.principal.id,
        },
        as_of: new Date(
          (await tx.query("SELECT now() AS at")).rows[0].at,
        ).toISOString(),
        entitlement_version: effective.entitlement_version,
        auth_version: req.principal.authVersion,
        feature_ids: effective.body.capabilities,
        plan_version_ids: effective.plan_version_ids,
        expires_at: effective.ends_at
          ? new Date(effective.ends_at).toISOString()
          : null,
        restriction_codes: effective.restriction_codes,
        requires_resource_authorization: true,
        requires_budget_check: true,
      };
    }, tenant);
  });
  const noticeQuery = `SELECT n.id,n.read,n.created_at,o.kind,o.grant_id,o.grant_version,o.available_at,
    g.version AS current_version,g.plan_version_id,s.tenant_id,s.user_id
    FROM entitlement_notifications n JOIN entitlement_outbox o ON o.id=n.outbox_id
    JOIN vip_grants g ON g.id=o.grant_id JOIN entitlement_subjects s ON s.id=g.subject_id`;
  const noticeScope =
    "n.recipient_id=$1 AND s.data_mode=$3 AND (s.user_id=$1 OR s.tenant_id=$2)";
  const mode = db.config.DEMO_MODE ? "simulated" : "configured_services";
  app.get("/v1/entitlement-notifications", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = uuid.parse(req.headers["x-tenant-id"]),
      q = z
        .object({
          cursor: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
          unread: z.enum(["true", "false"]).optional(),
        })
        .strict()
        .parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const args = [req.principal.id, tenant, mode];
      const cursor = q.cursor
        ? (
            await tx.query(`${noticeQuery} WHERE ${noticeScope} AND n.id=$4`, [
              ...args,
              q.cursor,
            ])
          ).rows[0]
        : null;
      if (q.cursor && !cursor)
        throw new Problem(
          410,
          "CURSOR_EXPIRED",
          "Refresh your current entitlement inbox",
        );
      const rows = (
        await tx.query(
          `${noticeQuery} WHERE ${noticeScope}
        AND ($4::timestamptz IS NULL OR (n.created_at,n.id)<($4,$5::uuid)) AND ($6::boolean IS NULL OR n.read=NOT $6)
        ORDER BY n.created_at DESC,n.id DESC LIMIT $7`,
          [
            ...args,
            cursor?.created_at ?? null,
            cursor?.id ?? null,
            q.unread === undefined ? null : q.unread === "true",
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  });
  app.patch(
    "/v1/entitlement-notifications/:notification_id",
    auth,
    async (req) => {
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        id = uuid.parse((req.params as any).notification_id),
        b = z.object({ read: z.boolean() }).strict().parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        if (
          !(
            await tx.query(`${noticeQuery} WHERE ${noticeScope} AND n.id=$4`, [
              req.principal.id,
              tenant,
              mode,
              id,
            ])
          ).rowCount
        )
          throw new Problem(
            404,
            "NOT_FOUND",
            "Entitlement notification not found",
          );
        return replay(
          tx,
          req.principal.id,
          `entitlement.notification:${id}`,
          key(req),
          b,
          async () =>
            (
              await tx.query(
                "UPDATE entitlement_notifications SET read=$2 WHERE id=$1 RETURNING id,read",
                [id, b.read],
              )
            ).rows[0],
        );
      }, tenant);
    },
  );
}

/** Delivery is bounded, persistent and idempotent. It never controls access:
 * all authorization uses live server time and current subject permissions. */
export async function dispatchEntitlementNotifications(db: Database) {
  return db.tx(
    async (tx) => {
      const rows = (
        await tx.query(
          `SELECT o.*,g.version,g.state,g.starts_at,g.ends_at,g.replacement_at,s.tenant_id,s.user_id
      FROM entitlement_outbox o JOIN vip_grants g ON g.id=o.grant_id JOIN entitlement_subjects s ON s.id=o.subject_id
      WHERE o.dispatched_at IS NULL AND o.discarded_at IS NULL AND o.available_at<=now() AND s.data_mode=$1
      ORDER BY o.available_at,o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED`,
          [db.config.DEMO_MODE ? "simulated" : "configured_services"],
        )
      ).rows;
      for (const row of rows) {
        const stale =
          row.grant_version !== row.version ||
          (row.kind === "starts" && row.state !== "active") ||
          (["starts", "expires"].includes(row.kind) &&
            row.replacement_at &&
            new Date(row.replacement_at) <= new Date(row.available_at));
        if (stale) {
          await tx.query(
            "UPDATE entitlement_outbox SET discarded_at=now() WHERE id=$1",
            [row.id],
          );
          continue;
        }
        await tx.query(
          `INSERT INTO entitlement_notifications(outbox_id,recipient_id)
        SELECT $1,u.id FROM users u WHERE u.status='active' AND u.admin_closed_at IS NULL AND
        (u.id=$2 OR EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
          WHERE m.user_id=u.id AND m.tenant_id=$3 AND m.status='active' AND NOT m.admin_suspended AND t.status='active' AND t.admin_closed_at IS NULL))
        ON CONFLICT(outbox_id,recipient_id) DO NOTHING`,
          [row.id, row.user_id, row.tenant_id],
        );
        await tx.query(
          "UPDATE entitlement_outbox SET dispatched_at=now() WHERE id=$1",
          [row.id],
        );
      }
      return rows.length;
    },
    undefined,
    true,
  );
}
