import { planSchema, authorizeTaskPlan } from "./plans.js";
import { freezeTaskSkills } from "./skill-lifecycle.js";
import {
  freezeTaskCapabilities,
  boundTaskAvailability,
} from "./capability-bindings.js";
import { stageInputDependencies } from "./task-dependencies.js";
import { resolveWorkContext } from "./persistent-work.js";
import { registerAdminContent, contentUnion } from "./admin-content.js";
import { registerAdminDirectory, readScope } from "./admin-directory.js";
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
  adminBindingInput,
  validateAdminDelegation,
  keepEffectiveSuper,
  lockAdminAccess,
  revokeAdminSessions,
  validateAdminDenyRemoval,
} from "./admin-access.js";
import { name, Problem, uuid, publicRow } from "./lib.js";
import { key, replay, projectAccess } from "./access.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import { reserve } from "./billing.js";
import {
  controlUnclaimedTask,
  requestTaskCancellation,
} from "./task-control.js";
import { event } from "./tasks.js";

const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
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
  for (const section of [
    "usage",
    "billing",
    "entitlements",
    "execution",
    "connections",
    "devices",
    "content",
    "jobs",
    "audit",
    "access",
    "support",
    "catalog",
    "policy",
  ] as const) {
    app.get(
      "/v1/admin/" + section,
      { preHandler: requireAdmin(db) },
      async (req) => {
        if (section === "support")
          throw new Problem(
            410,
            "SUPPORT_SELECTION_REQUIRED",
            "Use the scoped support sessions directory",
          );
        const q = pagination.parse(req.query);
        return db.tx(
          async (tx) => {
            const perm =
              section === "jobs"
                ? "admin.jobs.read"
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
              billing:
                "SELECT l.*,t.name AS tenant_name FROM ledger l JOIN tenants t ON t.id=l.tenant_id JOIN wallets w ON w.tenant_id=l.tenant_id AND (l.billing_account_id IS NULL OR l.billing_account_id=w.id)",
              entitlements:
                "SELECT e.*,t.name AS tenant_name,u.name AS user_name,(e.state='active' AND e.starts_at<=now() AND e.ends_at>now()) AS effective FROM entitlement_access e LEFT JOIN tenants t ON t.id=e.tenant_id LEFT JOIN users u ON u.id=e.user_id",
              execution:
                "SELECT id,tenant_id,project_id,created_by,title,role_key,status,execution_class,capacity_wait_reason,acceptance,charged_micros,budget_micros,cancel_requested,error_code,version,created_at FROM tasks",
              connections:
                "SELECT id,tenant_id,project_id,provider,name,state,scopes,created_at FROM connections",
              devices:
                "SELECT id,tenant_id,user_id,name,client,state,last_seen_at,created_at FROM devices",
              content: contentUnion,
              jobs: "SELECT id,principal_id,action,tenant_id,state,result,approved_by,created_at,(coalesce(payload->>'financial_command_version'='1',false) OR coalesce(payload->>'payment_record_command_version'='1',false)) AS financial_command,payload->>'billing_account_id' AS billing_account_id,coalesce(payload->>'vip_command_version'='1',false) AS vip_command,payload->>'data_mode' AS data_mode,CASE WHEN payload->>'subject_kind'='user' THEN (payload->>'subject_id')::uuid ELSE NULL::uuid END AS user_id FROM admin_operations",
              audit: "SELECT * FROM audit_log",
              support: "SELECT * FROM support_sessions",
              catalog:
                "SELECT * FROM catalog_entries WHERE kind NOT IN ('plan','policy')",
              plans: "SELECT * FROM catalog_entries WHERE kind='plan'",
              policy: "SELECT * FROM catalog_entries WHERE kind='policy'",
              access:
                "SELECT id,email,name,status,enrollment_state,enrolled_at,version,created_at FROM admin_principals",
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
            } else if (section === "billing") {
              const scope = await readScope(tx, req.principal, perm);
              filter = `EXISTS(SELECT 1 FROM wallets w WHERE w.tenant_id=r.tenant_id AND ${scope.account(perm)})`;
              args = scope.values;
            } else if (section === "entitlements") {
              const scope = await readScope(tx, req.principal, perm);
              filter = scope.account(perm, "r");
              args = scope.values;
            } else if (["jobs", "approvals"].includes(section)) {
              const scope = await readScope(tx, req.principal, perm);
              const ordinary = scope.scope(perm, "r.tenant_id");
              filter = `(CASE WHEN r.vip_command THEN r.data_mode=${scope.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${scope.account(perm, "r")} AND ${scope.account("admin.entitlements.read", "r")} WHEN r.financial_command THEN EXISTS(SELECT 1 FROM wallets w WHERE w.id::text=r.billing_account_id AND w.data_mode=${scope.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${scope.account(perm)} AND ${scope.account("admin.billing.read")}) ELSE ${ordinary} END)`;
              args = scope.values;
            } else if (
              ["catalog", "plans", "policy", "access"].includes(section)
            ) {
              await permit(tx, req.principal, perm);
            } else {
              const scoped = await scopePredicate(
                tx,
                req.principal,
                perm,
                "r.tenant_id",
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
              filter += ` AND ${"r.tenant_id"}=$${args.length}::uuid`;
            }
            args.push("%" + q.search.replace(/[\\%_]/g, "\\$&") + "%");
            const searchable = "row_to_json(r)::text";
            filter += ` AND ${searchable} ILIKE $${args.length}`;
            const baseQuery = `FROM (${source}) r WHERE ${filter}`;
            const total = Number(
              (await tx.query(`SELECT count(*) AS n ${baseQuery}`, args))
                .rows[0].n,
            );
            const order =
              section === "usage"
                ? "charged_micros::numeric DESC"
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
  app.get(
    "/v1/admin/content/:id/download",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id);
      const a = await db.tx(
        async (tx) => {
          const a = (
            await tx.query(
              "SELECT a.*,v.storage_key,v.mime_type,v.bytes,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1",
              [id],
            )
          ).rows[0];
          if (!a) throw new Problem(404, "NOT_FOUND", "Content not found");
          await permit(tx, req.principal, "admin.content.download", {
            tenant: a.tenant_id,
            project: a.project_id,
          });
          if (a.state === "deleted")
            throw new Problem(
              410,
              "CONTENT_DELETED",
              "Deleted content is unavailable",
            );
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
      const bytes = await storage.stream(a.storage_key);
      try {
        await db.tx(
          async (tx) => {
            await permit(tx, req.principal, "admin.content.download", {
              tenant: a.tenant_id,
              project: a.project_id,
            });
            const current = (
              await tx.query("SELECT state FROM assets WHERE id=$1", [id])
            ).rows[0];
            if (!current || current.state === "deleted")
              throw new Problem(
                410,
                "CONTENT_DELETED",
                "Deleted content is unavailable",
              );
          },
          undefined,
          true,
        );
      } catch (e) {
        bytes.destroy();
        throw e;
      }
      return reply
        .type(a.mime_type)
        .header("Content-Length", a.bytes)
        .header("X-Content-SHA256", a.sha256)
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
              if (b.action === "cancel") await requestTaskCancellation(tx, t);
              if (b.action === "pause" || b.action === "resume")
                await controlUnclaimedTask(tx, db, catalog, t, b.action);
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
                const { availability: ready, binding } =
                  await boundTaskAvailability(tx, db.config, catalog, t);
                if (!ready.available)
                  throw new Problem(
                    503,
                    ready.reason!,
                    "Role service requires configuration",
                  );
                await catalog.boundSkills(role);
                if (
                  t.input_context?.role_hash &&
                  t.input_context.role_hash !== catalog.digest(role)
                )
                  throw new Problem(
                    409,
                    "ROLE_VERSION_CHANGED",
                    "Update the specialist to the installed role version",
                  );
                await resolveWorkContext(
                  tx,
                  actor,
                  t.tenant_id,
                  t.project_id,
                  t.input_context,
                  db.config.CODEX_VERSION,
                  binding.versionIds,
                );
                const plan = await authorizeTaskPlan(
                  tx,
                  t.tenant_id,
                  t.created_by,
                  role,
                  Number(t.budget_micros),
                  t.mode,
                );
                const child = (
                  await tx.query(
                    "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,parent_id,private_owner,conversation_id,input_context,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
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
                      t.private_owner,
                      t.conversation_id,
                      t.input_context,
                      t.mode,
                    ],
                  )
                ).rows[0];
                await freezeTaskCapabilities(tx, db.config, catalog, child);
                await freezeTaskSkills(tx, catalog, child);
                const waiting = await stageInputDependencies(
                  tx,
                  child,
                  role,
                  undefined,
                  id,
                );
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
                await event(
                  tx,
                  t.tenant_id,
                  child.id,
                  waiting ? "task.needs_input" : "task.queued",
                  {
                    parent_id: id,
                    by_admin: req.principal.id,
                  },
                );
                if (!waiting)
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
                return {
                  id: child.id,
                  status: child.status,
                  parent_id: child.parent_id,
                };
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
  app.post("/v1/admin/support", { preHandler: requireAdmin(db) }, async () => {
    throw new Problem(
      410,
      "SUPPORT_SELECTION_REQUIRED",
      "Use the canonical support command with an explicit user and project selection",
    );
  });
  registerAdminDirectory(app, db);
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
          if (b.kind === "plan")
            throw new Problem(
              409,
              "CANONICAL_PLAN_REQUIRED",
              "Use the immutable plan draft and publication APIs",
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
          if (e.kind === "plan")
            throw new Problem(
              409,
              "CANONICAL_PLAN_REQUIRED",
              "Use the immutable plan draft and publication APIs",
            );
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
                "specialists",
                "skills",
                "conversations",
                "memories",
                "files",
                "notifications",
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
              vip_approval_hours: z
                .number()
                .int()
                .min(1)
                .max(24 * 366 * 5)
                .optional(),
              vip_replace_requires_approval: z.boolean().optional(),
              vip_paid_requires_approval: z.boolean().optional(),
              vip_all_changes_require_approval: z.boolean().optional(),
              vip_approval_window_minutes: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional(),
              membership_privileged_requires_approval: z.boolean().optional(),
              plan_publication_requires_approval: z.boolean().optional(),
              plan_approval_window_minutes: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional(),
              account_close_requires_approval: z.boolean().optional(),
              account_approval_window_minutes: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional(),
              membership_approval_window_minutes: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional(),
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
function registerAdminAccess(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.post(
    "/v1/admin/access/bindings",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = adminBindingInput
        .extend({ principal_id: uuid, reason })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireRecentMfa(tx, req.principal);
          await validateAdminDelegation(tx, req.principal, b);
          if (b.principal_id === req.principal.id)
            throw new Problem(
              403,
              "SELF_BINDING_FORBIDDEN",
              "Another authorized administrator must change your own access",
            );
          if (
            !(
              await tx.query("SELECT 1 FROM admin_principals WHERE id=$1", [
                b.principal_id,
              ])
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Administrator not found");
          return replay(
            tx,
            req.principal.id,
            "admin.access.bindings.write",
            key(req),
            b,
            async () => {
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
              await revokeAdminSessions(tx, b.principal_id, true);
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
          );
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
          await lockAdminAccess(tx);
          await permit(tx, req.principal, "admin.access.bindings.revoke");
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            `admin.binding.revoke:${id}`,
            key(req),
            {},
            async () => {
              const b = (
                await tx.query(
                  "SELECT * FROM admin_bindings WHERE id=$1 FOR UPDATE",
                  [id],
                )
              ).rows[0];
              if (!b) throw new Problem(404, "NOT_FOUND", "Binding not found");
              await validateAdminDenyRemoval(tx, req.principal, b);
              await tx.query("DELETE FROM admin_bindings WHERE id=$1", [id]);
              await keepEffectiveSuper(tx);
              await revokeAdminSessions(tx, b.principal_id, true);
              await audit(
                tx,
                req.principal,
                "admin.access.bindings.revoke",
                id,
              );
              return { ok: true };
            },
          );
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
          await lockAdminAccess(tx);
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
}
