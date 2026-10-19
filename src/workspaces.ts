import { registerMemberships } from "./membership.js";
import { effectivePlan } from "./plans.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireUser, audit } from "./auth.js";
import {
  key,
  listProjects,
  projectAccess,
  replay,
  tenantAccess,
  activePlans,
} from "./access.js";
import { name, Problem, uuid } from "./lib.js";
import { wallet } from "./billing.js";
import { lockUserAuthorities, currentUserAuthority } from "./user-authority.js";

export function registerWorkspaces(app: FastifyInstance, db: Database) {
  registerMemberships(app, db);
  app.get(
    "/v1/tenants/:tenant/plan",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        return effectivePlan(tx, tenant, req.principal.id);
      }, tenant);
    },
  );

  app.post("/v1/tenants", { preHandler: requireUser(db) }, async (req) => {
    const b = z.object({ name, project_name: name }).strict().parse(req.body);
    return db.tx(async (tx) => {
      await lockUserAuthorities(tx, [req.principal.id]);
      await currentUserAuthority(tx, req.principal);
      return replay(
        tx,
        req.principal.id,
        "tenant.create",
        key(req),
        b,
        async () => {
          const t = (
            await tx.query(
              "INSERT INTO tenants(name,data_mode) VALUES($1,$2) RETURNING *",
              [
                b.name,
                db.config.DEMO_MODE ? "simulated" : "configured_services",
              ],
            )
          ).rows[0];
          await tx.query("SELECT set_config('app.tenant_id',$1,true)", [t.id]);
          await tx.query(
            "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
            [t.id, req.principal.id],
          );
          await tx.query("INSERT INTO wallets(tenant_id) VALUES($1)", [t.id]);
          const p = (
            await tx.query(
              "INSERT INTO projects(tenant_id,name) VALUES($1,$2) RETURNING *",
              [t.id, b.project_name],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "tenant.create",
            t.id,
            "succeeded",
            {},
            t.id,
          );
          return { tenant: t, project: p };
        },
      );
    });
  });
  app.get(
    "/v1/tenants/:tenant/projects",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(
        async (tx) => ({
          items: await listProjects(tx, req.principal, tenant),
        }),
        tenant,
      );
    },
  );
  app.post(
    "/v1/tenants/:tenant/projects",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      const b = z
        .object({ name, description: z.string().max(2000).default("") })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "manage");
        return replay(
          tx,
          req.principal.id,
          `project.create:${tenant}`,
          key(req),
          b,
          async () =>
            (
              await tx.query(
                "INSERT INTO projects(tenant_id,name,description) VALUES($1,$2,$3) RETURNING *",
                [tenant, b.name, b.description],
              )
            ).rows[0],
        );
      }, tenant);
    },
  );
  app.patch(
    "/v1/tenants/:tenant/projects/:project",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = z
        .object({ tenant: uuid, project: uuid })
        .parse(req.params);
      const b = z
        .object({
          name: name.optional(),
          description: z.string().max(2000).optional(),
          archived: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        return (
          await tx.query(
            "UPDATE projects SET name=coalesce($3,name),description=coalesce($4,description),archived=coalesce($5,archived) WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              tenant,
              project,
              b.name ?? null,
              b.description ?? null,
              b.archived ?? null,
            ],
          )
        ).rows[0];
      }, tenant);
    },
  );
  app.get(
    "/v1/tenants/:tenant/billing",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "manage");
        return {
          wallet: await wallet(tx, tenant),
          entitlements: await activePlans(tx, tenant),
          ledger: (
            await tx.query(
              "SELECT id,kind,amount_micros,reason,created_at FROM ledger WHERE tenant_id=$1 AND (billing_account_id IS NULL OR billing_account_id=(SELECT id FROM wallets WHERE tenant_id=$1)) ORDER BY created_at DESC LIMIT 100",
              [tenant],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.get(
    "/v1/tenants/:tenant/usage",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        const m = await tenantAccess(tx, req.principal, tenant);
        const scope = ["owner", "admin"].includes(m.role)
          ? ""
          : " AND created_by=$2";
        const args = scope ? [tenant, req.principal.id] : [tenant];
        const totals = (
          await tx.query(
            `SELECT count(*)::int AS tasks,coalesce(sum(charged_micros),0)::text AS charged_micros,coalesce(sum(input_tokens),0)::text AS input_tokens,coalesce(sum(output_tokens),0)::text AS output_tokens,count(*) FILTER(WHERE status='reconciling')::int AS reconciling FROM tasks WHERE tenant_id=$1${scope}`,
            args,
          )
        ).rows[0];
        const daily = (
          await tx.query(
            `SELECT to_char(created_at AT TIME ZONE 'Asia/Hong_Kong','YYYY-MM-DD') AS date,count(*)::int AS tasks,sum(charged_micros)::text AS charged_micros FROM tasks WHERE tenant_id=$1${scope} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
            args,
          )
        ).rows;
        return { totals, daily };
      }, tenant);
    },
  );
}
