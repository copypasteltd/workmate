import { planSchema, authorizeTaskPlan } from "./plans.js";
import { registerAdminContent, contentUnion } from "./admin-content.js";
import { registerAdminJobs } from "./admin-jobs.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import { requireAdmin, audit, csrf } from "./auth.js";
import {
  bindings,
  can,
  permit,
  requireRecentMfa,
  visibleTenants,
  scopePredicate,
} from "./admin-access.js";
import { name, Problem, uuid, publicRow } from "./lib.js";
import { key, replay, projectAccess } from "./access.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import { settle, reserve } from "./billing.js";
import { event } from "./tasks.js";

const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(160).default(""),
  tenant_id: uuid.optional(),
});
const reason = z.string().trim().min(3).max(2000);
export function registerAdmin(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  app.get("/v1/admin/me", { preHandler: requireAdmin(db) }, async (req) =>
    db.tx(
      async (tx) => {
        const bs = await bindings(tx, req.principal);
        return {
          user: {
            id: req.principal.id,
            email: req.principal.email,
            name: req.principal.name,
          },
          bindings: bs,
          permissions: [
            ...new Set(
              bs
                .filter((b) => b.effect === "allow")
                .flatMap((b) => b.permissions),
            ),
          ],
          csrf_token: csrf(db, req.cookies.cp_admin_session!),
        };
      },
      undefined,
      true,
    ),
  );
  app.get("/v1/admin/overview", { preHandler: requireAdmin(db) }, async (req) =>
    db.tx(
      async (tx) => {
        const tenants = await visibleTenants(
          tx,
          req.principal,
          "admin.overview.read",
          true,
        );
        if (
          !tenants.length &&
          !(await can(tx, req.principal, "admin.overview.read"))
        )
          throw new Problem(
            403,
            "ADMIN_FORBIDDEN",
            "No authorized overview scope",
          );
        const summary: any = {
          tenants: tenants.length,
          users: null,
          tasks: null,
          charged_micros: null,
          reserved_micros: null,
          reconciling: null,
        };
        const userTenants = await visibleTenants(
          tx,
          req.principal,
          "admin.users.read",
        );
        if (await can(tx, req.principal, "admin.users.read"))
          summary.users = Number(
            (await tx.query("SELECT count(*) AS n FROM users")).rows[0].n,
          );
        else if (userTenants.length)
          summary.users = Number(
            (
              await tx.query(
                "SELECT count(DISTINCT user_id) AS n FROM memberships WHERE status='active' AND tenant_id=ANY($1::uuid[])",
                [userTenants],
              )
            ).rows[0].n,
          );
        const us = await scopePredicate(
          tx,
          req.principal,
          "admin.usage.read",
          "tenant_id",
          "project_id",
        );
        if (
          (await visibleTenants(tx, req.principal, "admin.usage.read", true))
            .length
        ) {
          Object.assign(
            summary,
            (
              await tx.query(
                `SELECT count(*)::int AS tasks,coalesce(sum(charged_micros),0)::text AS charged_micros FROM tasks WHERE ${us.sql}`,
                us.values,
              )
            ).rows[0],
          );
        }
        const bill = await visibleTenants(
          tx,
          req.principal,
          "admin.billing.read",
        );
        if (bill.length)
          summary.reserved_micros = (
            await tx.query(
              "SELECT coalesce(sum(reserved_micros),0)::text AS n FROM wallets WHERE tenant_id=ANY($1::uuid[])",
              [bill],
            )
          ).rows[0].n;
        const ex = await scopePredicate(
          tx,
          req.principal,
          "admin.execution.read",
          "tenant_id",
          "project_id",
        );
        if (
          (
            await visibleTenants(
              tx,
              req.principal,
              "admin.execution.read",
              true,
            )
          ).length
        )
          summary.reconciling = Number(
            (
              await tx.query(
                `SELECT count(*) AS n FROM tasks WHERE status='reconciling' AND ${ex.sql}`,
                ex.values,
              )
            ).rows[0].n,
          );
        await audit(tx, req.principal, "admin.overview.read", undefined);
        return {
          summary,
          activity: (
            await tx.query(
              "SELECT action,outcome,created_at FROM audit_log WHERE principal_id=$1 ORDER BY id DESC LIMIT 12",
              [req.principal.id],
            )
          ).rows,
        };
      },
      undefined,
      true,
    ),
  );
  app.get("/v1/admin/users", { preHandler: requireAdmin(db) }, async (req) => {
    const q = pagination.parse(req.query);
    return db.tx(
      async (tx) => {
        const global = await can(tx, req.principal, "admin.users.read");
        const scope = q.tenant_id
          ? [q.tenant_id]
          : await visibleTenants(tx, req.principal, "admin.users.read");
        if (q.tenant_id)
          await permit(tx, req.principal, "admin.users.read", {
            tenant: q.tenant_id,
          });
        if (!global && !scope.length)
          throw new Problem(403, "ADMIN_FORBIDDEN", "No readable user scope");
        const contactSearch = await can(
          tx,
          req.principal,
          "admin.users.contact.read",
          q.tenant_id ? { tenant: q.tenant_id } : {},
        );
        const where = `WHERE (${contactSearch ? "u.email ILIKE $1 OR " : ""}u.name ILIKE $1) ${global && !q.tenant_id ? "" : "AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=ANY($2::uuid[]))"}`;
        const args: any[] = [`%${q.search.replace(/[\\%_]/g, "\\$&")}%`];
        if (!global || q.tenant_id) args.push(scope);
        const count = Number(
          (await tx.query(`SELECT count(*) AS n FROM users u ${where}`, args))
            .rows[0].n,
        );
        const offset = args.length;
        const rows = (
          await tx.query(
            `SELECT u.id,u.email,u.name,u.status,u.locale,u.created_at,(SELECT count(*)::int FROM memberships m WHERE m.user_id=u.id AND m.status='active' ${global && !q.tenant_id ? "" : "AND m.tenant_id=ANY($2::uuid[])"}) AS workspaces FROM users u ${where} ORDER BY u.created_at DESC LIMIT $${offset + 1} OFFSET $${offset + 2}`,
            [...args, q.page_size, (q.page - 1) * q.page_size],
          )
        ).rows;
        const contacts = await can(
          tx,
          req.principal,
          "admin.users.contact.read",
          q.tenant_id ? { tenant: q.tenant_id } : {},
        );
        const usageTenants = await visibleTenants(
          tx,
          req.principal,
          "admin.usage.read",
          true,
        );
        const usage = q.tenant_id
          ? usageTenants.includes(q.tenant_id)
          : usageTenants.length > 0;
        const us = await scopePredicate(
          tx,
          req.principal,
          "admin.usage.read",
          "tenant_id",
          "project_id",
          1,
        );
        for (const r of rows)
          r.charged_micros = usage
            ? (
                await tx.query(
                  `SELECT coalesce(sum(charged_micros),0)::text AS n FROM tasks WHERE created_by=$1 AND ${us.sql}${q.tenant_id ? " AND tenant_id=$7::uuid" : ""}`,
                  [r.id, ...us.values, ...(q.tenant_id ? [q.tenant_id] : [])],
                )
              ).rows[0].n
            : undefined;
        await audit(
          tx,
          req.principal,
          "admin.users.read",
          undefined,
          "succeeded",
          { page: q.page },
        );
        return {
          items: rows.map((r) => ({
            ...r,
            email: contacts
              ? r.email
              : r.email.replace(/^(.).*(@.*)$/, "$1***$2"),
            charged_micros: usage ? r.charged_micros : undefined,
          })),
          total: count,
          page: q.page,
          page_size: q.page_size,
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    "/v1/admin/users/:id",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          const global = await can(tx, req.principal, "admin.users.read");
          const tenants = await visibleTenants(
            tx,
            req.principal,
            "admin.users.read",
          );
          const u = (
            await tx.query(
              "SELECT id,email,name,status,locale,created_at FROM users WHERE id=$1",
              [id],
            )
          ).rows[0];
          if (!u) throw new Problem(404, "NOT_FOUND", "User not found");
          const memberships = (
            await tx.query(
              "SELECT m.*,t.name AS tenant_name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND ($2 OR m.tenant_id=ANY($3::uuid[]))",
              [id, global, tenants],
            )
          ).rows;
          if (!global && !memberships.length)
            throw new Problem(404, "NOT_FOUND", "User not found");
          if (!(await can(tx, req.principal, "admin.users.contact.read")))
            u.email = u.email.replace(/^(.).*(@.*)$/, "$1***$2");
          const usageScope = await scopePredicate(
            tx,
            req.principal,
            "admin.usage.read",
            "tenant_id",
            "project_id",
            1,
          );
          const usage = (
            await tx.query(
              `SELECT tenant_id,count(*)::int AS tasks,sum(charged_micros)::text AS charged_micros,sum(input_tokens)::text AS input_tokens,sum(output_tokens)::text AS output_tokens FROM tasks WHERE created_by=$1 AND ${usageScope.sql} GROUP BY tenant_id`,
              [id, ...usageScope.values],
            )
          ).rows;
          const entitlements = (await can(
            tx,
            req.principal,
            "admin.entitlements.read",
          ))
            ? (
                await tx.query(
                  "SELECT * FROM entitlements WHERE user_id=$1 ORDER BY created_at DESC",
                  [id],
                )
              ).rows
            : [];
          await audit(tx, req.principal, "admin.users.read", id);
          return { user: u, memberships, usage, entitlements };
        },
        undefined,
        true,
      );
    },
  );
  app.patch(
    "/v1/admin/users/:id",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          name: name.optional(),
          status: z.enum(["active", "suspended"]).optional(),
          revoke_sessions: z.boolean().optional(),
          reason,
        })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          if (b.name)
            await permit(tx, req.principal, "admin.users.profile.write");
          if (b.status)
            await permit(tx, req.principal, "admin.users.status.write");
          if (b.revoke_sessions)
            await permit(tx, req.principal, "admin.users.sessions.revoke");
          const u = (
            await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id])
          ).rows[0];
          if (!u) throw new Problem(404, "NOT_FOUND", "User not found");
          await tx.query(
            "UPDATE users SET name=coalesce($2,name),status=coalesce($3,status),auth_version=auth_version+$4 WHERE id=$1",
            [
              id,
              b.name ?? null,
              b.status ?? null,
              b.status || b.revoke_sessions ? 1 : 0,
            ],
          );
          if (b.status || b.revoke_sessions) {
            await tx.query(
              "UPDATE sessions SET revoked_at=now() WHERE user_id=$1",
              [id],
            );
            await tx.query(
              "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1",
              [id],
            );
          }
          await audit(
            tx,
            req.principal,
            "admin.users.update",
            id,
            "succeeded",
            { ...b },
            undefined,
          );
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
  for (const section of [
    "tenants",
    "usage",
    "billing",
    "entitlements",
    "execution",
    "connections",
    "devices",
    "content",
    "jobs",
    "approvals",
    "audit",
    "access",
    "support",
    "catalog",
    "plans",
    "policy",
  ] as const) {
    app.get(
      "/v1/admin/" + section,
      { preHandler: requireAdmin(db) },
      async (req) => {
        const q = pagination.parse(req.query);
        return db.tx(
          async (tx) => {
            const perm =
              section === "jobs"
                ? "admin.jobs.read"
                : section === "approvals"
                  ? "admin.approvals.read"
                  : section === "audit"
                    ? "admin.audit.read"
                    : section === "execution"
                      ? "admin.execution.read"
                      : `admin.${section}.read`;
            const global = await can(tx, req.principal, perm);
            const allowed = q.tenant_id
              ? [q.tenant_id]
              : await visibleTenants(
                  tx,
                  req.principal,
                  perm,
                  ["content", "execution", "connections", "usage"].includes(
                    section,
                  ),
                );
            if (q.tenant_id)
              await permit(tx, req.principal, perm, { tenant: q.tenant_id });
            if (!global && !allowed.length)
              throw new Problem(403, "ADMIN_FORBIDDEN", "No authorized scope");
            const sources: Record<string, string> = {
              tenants:
                "SELECT t.*,w.balance_micros,w.reserved_micros,w.credit_limit_micros,(SELECT count(*)::int FROM memberships m WHERE m.tenant_id=t.id AND m.status='active') AS members FROM tenants t JOIN wallets w ON w.tenant_id=t.id",
              billing:
                "SELECT l.*,t.name AS tenant_name FROM ledger l JOIN tenants t ON t.id=l.tenant_id",
              entitlements:
                "SELECT e.*,t.name AS tenant_name,u.name AS user_name,(e.state='active' AND e.starts_at<=now() AND e.ends_at>now()) AS effective FROM entitlements e LEFT JOIN tenants t ON t.id=e.tenant_id LEFT JOIN users u ON u.id=e.user_id",
              execution:
                "SELECT id,tenant_id,project_id,created_by,title,role_key,status,acceptance,charged_micros,budget_micros,cancel_requested,error_code,version,created_at FROM tasks",
              connections:
                "SELECT id,tenant_id,project_id,provider,name,state,scopes,created_at FROM connections",
              devices:
                "SELECT id,tenant_id,user_id,name,client,state,last_seen_at,created_at FROM devices",
              content: contentUnion,
              jobs: "SELECT id,principal_id,action,tenant_id,state,result,approved_by,created_at FROM admin_operations",
              approvals:
                "SELECT id,principal_id,action,tenant_id,state,result,approved_by,created_at FROM admin_operations WHERE state='pending_approval'",
              audit: "SELECT * FROM audit_log",
              support: "SELECT * FROM support_sessions",
              catalog:
                "SELECT * FROM catalog_entries WHERE kind NOT IN ('plan','policy')",
              plans: "SELECT * FROM catalog_entries WHERE kind='plan'",
              policy: "SELECT * FROM catalog_entries WHERE kind='policy'",
              access:
                "SELECT id,email,name,status,created_at FROM admin_principals",
            };
            let source = sources[section],
              extra: any = {},
              args: any[] = [];
            let filter = "true";
            if (section === "usage") {
              const us = await scopePredicate(
                tx,
                req.principal,
                perm,
                "t.tenant_id",
                "t.project_id",
              );
              args = us.values;
              source = `SELECT t.created_by AS user_id,u.name,t.tenant_id,n.name AS tenant_name,count(*)::int AS tasks,sum(charged_micros)::text AS charged_micros,sum(input_tokens)::text AS input_tokens,sum(output_tokens)::text AS output_tokens,count(*) FILTER(WHERE t.status='reconciling')::int AS reconciling FROM tasks t JOIN users u ON u.id=t.created_by JOIN tenants n ON n.id=t.tenant_id WHERE ${us.sql} GROUP BY t.created_by,u.name,t.tenant_id,n.name`;
            } else if (
              ["catalog", "plans", "policy", "access"].includes(section)
            ) {
              await permit(tx, req.principal, perm);
            } else {
              const scoped = await scopePredicate(
                tx,
                req.principal,
                perm,
                section === "tenants" ? "r.id" : "r.tenant_id",
                ["content", "execution", "connections"].includes(section)
                  ? "r.project_id"
                  : undefined,
              );
              args = scoped.values;
              filter = scoped.sql;
            }
            if (
              q.tenant_id &&
              !["catalog", "plans", "policy", "access"].includes(section)
            ) {
              args.push(q.tenant_id);
              filter += ` AND ${section === "tenants" ? "r.id" : "r.tenant_id"}=$${args.length}::uuid`;
            }
            args.push("%" + q.search.replace(/[\\%_]/g, "\\$&") + "%");
            const searchable =
              section === "tenants"
                ? "(to_jsonb(r)-'balance_micros'-'reserved_micros'-'credit_limit_micros')::text"
                : "row_to_json(r)::text";
            filter += ` AND ${searchable} ILIKE $${args.length}`;
            const baseQuery = `FROM (${source}) r WHERE ${filter}`;
            const total = Number(
              (await tx.query(`SELECT count(*) AS n ${baseQuery}`, args))
                .rows[0].n,
            );
            const order =
              section === "usage"
                ? "charged_micros::numeric DESC"
                : section === "support"
                  ? "expires_at DESC"
                  : "created_at DESC";
            const items = (
              await tx.query(
                `SELECT * ${baseQuery} ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
                [...args, q.page_size, (q.page - 1) * q.page_size],
              )
            ).rows;
            if (section === "access")
              extra = {
                roles: (
                  await tx.query("SELECT * FROM admin_roles ORDER BY key")
                ).rows,
                bindings: (
                  await tx.query(
                    "SELECT * FROM admin_bindings ORDER BY created_at DESC",
                  )
                ).rows,
                permission_catalog: catalog.admin.permissions,
              };
            await audit(tx, req.principal, perm, undefined, "succeeded", {
              tenant_id: q.tenant_id,
            });
            for (const r of items)
              if (
                section === "tenants" &&
                !(await can(tx, req.principal, "admin.billing.read", {
                  tenant: r.id,
                }))
              ) {
                delete r.balance_micros;
                delete r.reserved_micros;
                delete r.credit_limit_micros;
              }
            return {
              items,
              total,
              page: q.page,
              page_size: q.page_size,
              ...extra,
            };
          },
          undefined,
          true,
        );
      },
    );
  }
  app.patch(
    "/v1/admin/tenants/:id",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({ status: z.enum(["active", "suspended"]), reason })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.tenants.status.write", {
            tenant: id,
          });
          if (
            !(
              await tx.query(
                "UPDATE tenants SET status=$2 WHERE id=$1 RETURNING id",
                [id, b.status],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Workspace not found");
          await audit(
            tx,
            req.principal,
            "admin.tenants.status.write",
            id,
            "succeeded",
            b,
            id,
          );
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/content/:id/download",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id);
      const a = await db.tx(
        async (tx) => {
          const a = (
            await tx.query(
              "SELECT a.*,v.storage_key,v.mime_type FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1",
              [id],
            )
          ).rows[0];
          if (!a) throw new Problem(404, "NOT_FOUND", "Content not found");
          await permit(tx, req.principal, "admin.content.download", {
            tenant: a.tenant_id,
            project: a.project_id,
          });
          await audit(
            tx,
            req.principal,
            "admin.content.download",
            id,
            "succeeded",
            {},
            a.tenant_id,
          );
          return a;
        },
        undefined,
        true,
      );
      const bytes = await storage.get(a.storage_key);
      await db.tx(
        (tx) =>
          permit(tx, req.principal, "admin.content.download", {
            tenant: a.tenant_id,
            project: a.project_id,
          }),
        undefined,
        true,
      );
      return reply
        .type(a.mime_type)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
        )
        .send(bytes);
    },
  );
  app.post(
    "/v1/admin/content/:id/versions",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const f = await req.file();
      if (!f) throw new Problem(400, "FILE_REQUIRED", "Choose a file");
      const bytes = await f.toBuffer();
      const expected = z.coerce
        .number()
        .int()
        .positive()
        .parse((f.fields.expected_version as any)?.value);
      return db.tx(
        async (tx) => {
          const a = (
            await tx.query("SELECT * FROM assets WHERE id=$1 FOR UPDATE", [id])
          ).rows[0];
          if (!a) throw new Problem(404, "NOT_FOUND", "Content not found");
          await permit(tx, req.principal, "admin.content.version.create", {
            tenant: a.tenant_id,
            project: a.project_id,
          });
          const result = await saveAsset(tx, storage, {
            tenant: a.tenant_id,
            project: a.project_id,
            user: a.created_by,
            name: a.name,
            mime: f.mimetype,
            bytes,
            asset: id,
            expectedVersion: expected,
          });
          await audit(
            tx,
            req.principal,
            "admin.content.version.create",
            id,
            "succeeded",
            { version: result.current_version },
            a.tenant_id,
          );
          return result;
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/execution/:id/action",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          action: z.enum(["cancel", "pause", "resume", "retry"]),
          version: z.number().int().positive(),
          reason,
        })
        .strict()
        .parse(req.body);
      return db.tx(
        (tx) =>
          replay(
            tx,
            req.principal.id,
            "admin.execution.action",
            key(req),
            { id, ...b },
            async () => {
              const t = (
                await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
                  id,
                ])
              ).rows[0];
              if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
              await permit(tx, req.principal, `admin.execution.${b.action}`, {
                tenant: t.tenant_id,
                project: t.project_id,
              });
              if (t.version !== b.version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Task changed; refresh first",
                );
              if (b.action === "cancel") {
                if (t.status === "running")
                  await tx.query(
                    "UPDATE tasks SET cancel_requested=true,version=version+1 WHERE id=$1",
                    [id],
                  );
                else if (
                  ["queued", "paused", "awaiting_approval"].includes(t.status)
                ) {
                  await settle(tx, t.tenant_id, id, 0, t.created_by);
                  await tx.query(
                    "UPDATE tasks SET status='cancelled',version=version+1 WHERE id=$1",
                    [id],
                  );
                }
              }
              if (b.action === "pause") {
                if (t.status !== "queued")
                  throw new Problem(
                    409,
                    "CANNOT_PAUSE",
                    "Only a queued task can be paused safely",
                  );
                await tx.query(
                  "UPDATE tasks SET status='paused',version=version+1 WHERE id=$1",
                  [id],
                );
              }
              if (b.action === "resume") {
                if (t.status !== "paused")
                  throw new Problem(409, "CANNOT_RESUME", "Task is not paused");
                await tx.query(
                  "UPDATE tasks SET status='queued',version=version+1 WHERE id=$1",
                  [id],
                );
                await tx.query(
                  "INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)",
                  [t.tenant_id, { task_id: id }],
                );
              }
              if (b.action === "retry") {
                if (!["failed", "cancelled"].includes(t.status))
                  throw new Problem(
                    409,
                    "RETRY_NOT_SAFE",
                    "Only a settled failed or cancelled task can start a new attempt",
                  );
                const reservation = (
                  await tx.query(
                    "SELECT status FROM reservations WHERE task_id=$1",
                    [id],
                  )
                ).rows[0];
                if (
                  reservation &&
                  !["settled", "released"].includes(reservation.status)
                )
                  throw new Problem(
                    409,
                    "RECONCILIATION_REQUIRED",
                    "Reconcile the previous reservation first",
                  );
                await permit(
                  tx,
                  req.principal,
                  "admin.execution.retry",
                  { tenant: t.tenant_id, project: t.project_id },
                  { amount: Number(t.budget_micros) },
                );
                await requireRecentMfa(tx, req.principal);
                const u = (
                  await tx.query("SELECT * FROM users WHERE id=$1", [
                    t.created_by,
                  ])
                ).rows[0];
                const actor = {
                  id: u.id,
                  email: u.email,
                  name: u.name,
                  audience: "user" as const,
                  sessionId: "",
                  sessionHash: "",
                  authVersion: u.auth_version,
                };
                await projectAccess(
                  tx,
                  actor,
                  t.tenant_id,
                  t.project_id,
                  "write",
                );
                await catalog.ensureEnabled(tx, t.role_key);
                const role = catalog.role(t.role_key);
                const ready = catalog.available(db.config, role);
                if (!ready.available)
                  throw new Problem(
                    503,
                    ready.reason!,
                    "Role service requires configuration",
                  );
                await catalog.boundSkills(role);
                const plan = await authorizeTaskPlan(
                  tx,
                  t.tenant_id,
                  t.created_by,
                  role,
                  Number(t.budget_micros),
                );
                const child = (
                  await tx.query(
                    "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status,parent_id",
                    [
                      t.tenant_id,
                      t.project_id,
                      t.created_by,
                      t.title,
                      t.prompt,
                      t.role_key,
                      catalog.digest(role),
                      t.budget_micros,
                      "retry:" + key(req),
                      u.auth_version,
                      id,
                    ],
                  )
                ).rows[0];
                await tx.query(
                  "UPDATE tasks SET plan_snapshot=$2 WHERE id=$1",
                  [child.id, plan],
                );
                await reserve(
                  tx,
                  t.tenant_id,
                  child.id,
                  Number(t.budget_micros),
                );
                await event(tx, t.tenant_id, child.id, "task.queued", {
                  parent_id: id,
                  by_admin: req.principal.id,
                });
                await tx.query(
                  "INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)",
                  [t.tenant_id, { task_id: child.id }],
                );
                await audit(
                  tx,
                  req.principal,
                  "admin.execution.retry",
                  child.id,
                  "succeeded",
                  { parent_id: id, reason: b.reason },
                  t.tenant_id,
                );
                return child;
              }
              await event(tx, t.tenant_id, id, `admin.task.${b.action}`, {
                reason: b.reason,
              });
              await audit(
                tx,
                req.principal,
                `admin.execution.${b.action}`,
                id,
                "succeeded",
                { reason: b.reason },
                t.tenant_id,
              );
              return { ok: true };
            },
          ),
        undefined,
        true,
      );
    },
  );
  for (const section of ["connections", "devices"] as const)
    app.post(
      `/v1/admin/${section}/:id/revoke`,
      { preHandler: requireAdmin(db) },
      async (req) => {
        const id = uuid.parse((req.params as any).id);
        const b = z.object({ reason }).strict().parse(req.body);
        return db.tx(
          async (tx) => {
            const r = (
              await tx.query(
                `SELECT * FROM ${section} WHERE id=$1 FOR UPDATE`,
                [id],
              )
            ).rows[0];
            if (!r) throw new Problem(404, "NOT_FOUND", "Resource not found");
            await permit(tx, req.principal, `admin.${section}.revoke`, {
              tenant: r.tenant_id,
              project: r.project_id,
            });
            await tx.query(
              `UPDATE ${section} SET state='revoked'${section === "connections" ? ",encrypted_secret=NULL" : ",grants='[]'"} WHERE id=$1`,
              [id],
            );
            if (section === "devices")
              await tx.query(
                "UPDATE device_commands SET state='cancelled' WHERE device_id=$1 AND state IN ('pending','claimed')",
                [id],
              );
            await audit(
              tx,
              req.principal,
              `admin.${section}.revoke`,
              id,
              "succeeded",
              b,
              r.tenant_id,
            );
            return { ok: true };
          },
          undefined,
          true,
        );
      },
    );
  app.post(
    "/v1/admin/support",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = z
        .object({
          tenant_id: uuid,
          reason,
          duration_minutes: z.number().int().min(5).max(60).default(15),
        })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await permit(
            tx,
            req.principal,
            "admin.support.start",
            { tenant: b.tenant_id },
            { hours: b.duration_minutes / 60 },
          );
          const r = (
            await tx.query(
              "INSERT INTO support_sessions(principal_id,tenant_id,reason,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 minute') RETURNING *",
              [req.principal.id, b.tenant_id, b.reason, b.duration_minutes],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.support.start",
            r.id,
            "succeeded",
            b,
            b.tenant_id,
          );
          return r;
        },
        undefined,
        true,
      );
    },
  );
  registerAdminContent(app, db, storage);
  registerAdminJobs(app, db);
  registerAdminCatalog(app, db, catalog);
  registerAdminAccess(app, db, catalog);
}
function registerAdminCatalog(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.post(
    "/v1/admin/catalog",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = z
        .object({
          kind: z.enum([
            "role",
            "skill",
            "help",
            "announcement",
            "navigation",
            "plan",
            "policy",
          ]),
          key: z.string().regex(/^[\w-]{1,80}$/),
          body: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await permit(
            tx,
            req.principal,
            b.kind === "plan"
              ? "admin.plans.draft"
              : b.kind === "policy"
                ? "admin.policy.draft"
                : "admin.catalog.draft",
          );
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`catalog:${b.kind}:${b.key}`],
          );
          const v = (
            await tx.query(
              "SELECT coalesce(max(version),0)+1 AS n FROM catalog_entries WHERE kind=$1 AND key=$2",
              [b.kind, b.key],
            )
          ).rows[0].n;
          const r = (
            await tx.query(
              "INSERT INTO catalog_entries(kind,key,version,body,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [b.kind, b.key, v, b.body, req.principal.id],
            )
          ).rows[0];
          await audit(tx, req.principal, "admin.catalog.draft", r.id);
          return r;
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/catalog/:id/publish",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          const e = (
            await tx.query(
              "SELECT * FROM catalog_entries WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!e) throw new Problem(404, "NOT_FOUND", "Draft not found");
          await permit(
            tx,
            req.principal,
            e.kind === "plan"
              ? "admin.plans.publish"
              : e.kind === "policy"
                ? "admin.policy.publish"
                : "admin.catalog.publish",
          );
          await requireRecentMfa(tx, req.principal);
          if (e.kind === "role") {
            catalog.role(e.key);
            z.object({
              enabled: z.boolean(),
              display_name: z.string().min(1).max(160).optional(),
              description: z.string().max(2000).optional(),
            })
              .strict()
              .parse(e.body);
          }
          if (e.kind === "skill") {
            if (!catalog.skills.some((s) => s.key === e.key))
              throw new Problem(
                409,
                "QUALIFICATION_REQUIRED",
                "Install and qualify the executable Skill package before publishing",
              );
            z.object({ enabled: z.boolean() }).strict().parse(e.body);
          }
          if (["help", "announcement"].includes(e.kind))
            z.object({
              title: z.string().min(1).max(160),
              title_en: z.string().max(160).optional(),
              text: z.string().max(10000),
              text_en: z.string().max(10000).optional(),
              enabled: z.boolean().default(true),
            })
              .strict()
              .parse(e.body);
          if (e.kind === "navigation")
            z.object({
              path: z.enum([
                "roles",
                "projects",
                "tasks",
                "assets",
                "creative",
                "analytics",
                "workflows",
                "brand",
                "members",
                "connections",
                "devices",
                "usage",
                "settings",
              ]),
              label: z.string().max(80),
              label_en: z.string().max(80).optional(),
              enabled: z.boolean(),
              order: z.number().int().min(0).max(100),
            })
              .strict()
              .parse(e.body);
          if (e.kind === "policy")
            z.object({
              approval_threshold_micros: z.number().int().positive().max(1e12),
              max_vip_hours: z
                .number()
                .int()
                .positive()
                .max(24 * 366 * 5),
            })
              .strict()
              .parse(e.body);
          if (e.kind === "plan") planSchema.parse(e.body);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`catalog:${e.kind}:${e.key}`],
          );
          await tx.query(
            "UPDATE catalog_entries SET state='retired' WHERE kind=$1 AND key=$2 AND state='published'",
            [e.kind, e.key],
          );
          await tx.query(
            "UPDATE catalog_entries SET state='published' WHERE id=$1",
            [id],
          );
          await audit(
            tx,
            req.principal,
            "admin.catalog.publish",
            id,
            "succeeded",
            { kind: e.kind },
          );
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/catalog/:id/rollback",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.catalog.rollback");
          const e = (
            await tx.query(
              "SELECT * FROM catalog_entries WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (
            !e ||
            e.state !== "retired" ||
            ["role", "skill", "policy", "plan"].includes(e.kind)
          )
            throw new Problem(
              409,
              "ROLLBACK_UNAVAILABLE",
              "This version requires its own publication qualification",
            );
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`catalog:${e.kind}:${e.key}`],
          );
          await tx.query(
            "UPDATE catalog_entries SET state='retired' WHERE kind=$1 AND key=$2 AND state='published'",
            [e.kind, e.key],
          );
          await tx.query(
            "UPDATE catalog_entries SET state='published' WHERE id=$1",
            [id],
          );
          await audit(tx, req.principal, "admin.catalog.rollback", id);
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
}
async function keepEffectiveSuper(tx: any) {
  const r = await tx.query(
    "SELECT 1 FROM admin_bindings b JOIN admin_principals p ON p.id=b.principal_id WHERE b.role_key='super_admin' AND b.effect='allow' AND b.scope_kind='global' AND b.expires_at IS NULL AND p.status='active' AND NOT EXISTS(SELECT 1 FROM admin_bindings d JOIN admin_roles r ON r.key=d.role_key WHERE d.principal_id=p.id AND d.effect='deny' AND d.scope_kind='global' AND (d.expires_at IS NULL OR d.expires_at>now()) AND r.permissions ?| ARRAY['admin.access.bindings.write','admin.access.bindings.revoke','admin.access.roles.write']) LIMIT 1",
  );
  if (!r.rowCount)
    throw new Problem(
      409,
      "LAST_SUPER_ADMIN",
      "Keep at least one active permanent global super administrator with recovery permissions",
    );
}
function registerAdminAccess(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.post(
    "/v1/admin/access/bindings",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = z
        .object({
          principal_id: uuid,
          role_key: z.string().max(80),
          scope_kind: z.enum(["global", "tenant", "project"]),
          scope_id: uuid.optional(),
          effect: z.enum(["allow", "deny"]).default("allow"),
          limits: z
            .object({
              max_amount_micros: z
                .number()
                .int()
                .nonnegative()
                .max(1e12)
                .optional(),
              max_duration_hours: z.number().int().positive().optional(),
              max_batch: z.number().int().min(1).max(100).optional(),
            })
            .strict()
            .default({}),
          expires_at: z.string().datetime({ offset: true }).optional(),
          reason,
        })
        .strict()
        .refine((b) => (b.scope_kind === "global" ? !b.scope_id : !!b.scope_id))
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.access.bindings.write");
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('admin-super-protection',0))",
          );
          await requireRecentMfa(tx, req.principal);
          const r = (
            await tx.query("SELECT * FROM admin_roles WHERE key=$1", [
              b.role_key,
            ])
          ).rows[0];
          if (!r) throw new Problem(404, "NOT_FOUND", "Role not found");
          const scope =
            b.scope_kind === "tenant"
              ? { tenant: b.scope_id }
              : b.scope_kind === "project"
                ? { project: b.scope_id }
                : {};
          for (const permission of r.permissions) {
            const inherited = await permit(
              tx,
              req.principal,
              permission,
              scope,
            );
            if (
              b.effect === "allow" &&
              !inherited.some(
                (source) =>
                  [
                    "max_amount_micros",
                    "max_duration_hours",
                    "max_batch",
                  ].every(
                    (k) =>
                      source.limits[k] === undefined ||
                      ((b.limits as any)[k] !== undefined &&
                        (b.limits as any)[k] <= source.limits[k]),
                  ) &&
                  (!source.expires_at ||
                    (b.expires_at &&
                      Date.parse(b.expires_at) <=
                        new Date(source.expires_at).getTime())),
              )
            )
              throw new Problem(
                403,
                "DELEGATION_LIMIT",
                "Delegated limits and expiry must fit an existing grant",
              );
          }
          if (
            b.scope_kind !== "global" &&
            !(
              await tx.query(
                `SELECT 1 FROM ${b.scope_kind === "tenant" ? "tenants" : "projects"} WHERE id=$1`,
                [b.scope_id],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Scope not found");
          if (b.expires_at && Date.parse(b.expires_at) <= Date.now())
            throw new Problem(
              400,
              "EXPIRY_INVALID",
              "Expiry must be in the future",
            );
          if (b.principal_id === req.principal.id)
            throw new Problem(
              403,
              "SELF_BINDING_FORBIDDEN",
              "Another authorized administrator must change your own access",
            );
          const result = (
            await tx.query(
              "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect,limits,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [
                b.principal_id,
                b.role_key,
                b.scope_kind,
                b.scope_id ?? null,
                b.effect,
                b.limits,
                b.expires_at ?? null,
              ],
            )
          ).rows[0];
          await keepEffectiveSuper(tx);
          await audit(
            tx,
            req.principal,
            "admin.access.bindings.write",
            result.id,
            "succeeded",
            { reason: b.reason },
          );
          return result;
        },
        undefined,
        true,
      );
    },
  );
  app.delete(
    "/v1/admin/access/bindings/:id",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.access.bindings.revoke");
          await requireRecentMfa(tx, req.principal);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('admin-super-protection',0))",
          );
          const b = (
            await tx.query(
              "SELECT * FROM admin_bindings WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!b) throw new Problem(404, "NOT_FOUND", "Binding not found");
          if (
            b.role_key === "super_admin" &&
            b.effect === "allow" &&
            b.scope_kind === "global"
          ) {
            const n = (
              await tx.query(
                "SELECT count(DISTINCT b.principal_id)::int AS n FROM admin_bindings b JOIN admin_principals p ON p.id=b.principal_id WHERE b.role_key='super_admin' AND b.effect='allow' AND b.scope_kind='global' AND p.status='active' AND (b.expires_at IS NULL OR b.expires_at>now())",
              )
            ).rows[0].n;
            if (n <= 1)
              throw new Problem(
                409,
                "LAST_SUPER_ADMIN",
                "Keep at least one active global super administrator",
              );
          }
          await tx.query("DELETE FROM admin_bindings WHERE id=$1", [id]);
          await keepEffectiveSuper(tx);
          await audit(tx, req.principal, "admin.access.bindings.revoke", id);
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/access/roles",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const keys = catalog.admin.permissions.map((p: any) => p.key);
      const b = z
        .object({
          key: z.string().regex(/^[a-z][a-z\d_-]{2,63}$/),
          name,
          permissions: z
            .array(z.string().refine((k) => keys.includes(k)))
            .min(1)
            .max(67),
          reason,
        })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.access.roles.write");
          await requireRecentMfa(tx, req.principal);
          for (const p of b.permissions) await permit(tx, req.principal, p);
          const r = (
            await tx.query(
              "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$2,$3) RETURNING *",
              [b.key, b.name, JSON.stringify([...new Set(b.permissions)])],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.access.roles.write",
            b.key,
            "succeeded",
            { reason: b.reason },
          );
          return r;
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/access/principals/:id/revoke-sessions",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          await permit(tx, req.principal, "admin.access.sessions.revoke");
          await requireRecentMfa(tx, req.principal);
          await tx.query(
            "UPDATE admin_principals SET auth_version=auth_version+1 WHERE id=$1",
            [id],
          );
          await tx.query(
            "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
            [id],
          );
          await audit(tx, req.principal, "admin.access.sessions.revoke", id);
          return { ok: true };
        },
        undefined,
        true,
      );
    },
  );
}
