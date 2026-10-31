import { lockMemberships, registerMemberships } from "./membership.js";
import { registerProjectManagement } from "./project-management.js";
import { effectivePlan } from "./plans.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
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
import { registerResourceQuotas } from "./resource-quota-routes.js";

const creationRequestKey = z.string().regex(/^[\w:-]{16,128}$/);

/** A saved creation result identifies the operation; it never preserves access. */
async function currentCreationResult(
  tx: Tx,
  db: Database,
  actor: Principal,
  saved: unknown,
) {
  const receipt = saved as { tenant?: { id?: unknown }; project?: { id?: unknown } } | null;
  const tenantId = uuid.safeParse(receipt?.tenant?.id);
  if (!tenantId.success) return null;
  await lockMemberships(tx, tenantId.data);
  try {
    await tenantAccess(tx, actor, tenantId.data);
  } catch (error) {
    if (error instanceof Problem && [403, 404].includes(error.status)) return null;
    throw error;
  }
  const tenant = (await tx.query(
    `SELECT id,name,data_mode FROM tenants WHERE id=$1 AND status='active'
     AND erasure_requested_at IS NULL AND data_mode=$2 FOR SHARE`,
    [tenantId.data, db.config.DEMO_MODE ? "simulated" : "configured_services"],
  )).rows[0];
  if (!tenant) return null;
  await tx.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.id]);
  let project: { id: string; name: string } | null = null;
  const projectId = uuid.safeParse(receipt?.project?.id);
  if (projectId.success) {
    try {
      const current = await projectAccess(tx, actor, tenant.id, projectId.data);
      if (!current.erasure_requested_at) project = { id: current.id, name: current.name };
    } catch (error) {
      // Recover the enterprise even if its original project is no longer readable.
      if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
    }
  }
  return { tenant: { id: tenant.id as string, name: tenant.name as string, data_mode: tenant.data_mode as string }, project };
}

export function registerWorkspaces(app: FastifyInstance, db: Database) {
  registerResourceQuotas(app, db);
  registerMemberships(app, db);
  registerProjectManagement(app, db);
  app.get("/v1/workspace-creation-requests/:key", { preHandler: requireUser(db) }, async (req, reply) => {
    const attempt = creationRequestKey.parse((req.params as any).key);
    reply.header("Cache-Control", "no-store");
    return db.tx(async (tx) => {
      // Same order as POST: user authority, request identity, then workspace authority.
      // A lookup cannot report absence while this user's creation is committing.
      await lockUserAuthorities(tx, [req.principal.id]);
      await currentUserAuthority(tx, req.principal);
      const locked = (await tx.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
        [`${req.principal.id}:tenant.create:${attempt}`],
      )).rows[0].acquired;
      if (!locked) return { state: "in_progress" };
      const saved = (await tx.query(
        "SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action='tenant.create' AND key=$2",
        [req.principal.id, attempt],
      )).rows[0];
      if (!saved) return { state: "not_found" };
      if (saved.revoked_at) return { state: "removed" };
      const result = await currentCreationResult(tx, db, req.principal, saved.response);
      if (!result) return { state: "unavailable" };
      return { state: "completed", result: { tenant: { id: result.tenant.id, name: result.tenant.name }, project: result.project } };
    });
  });
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
      const saved = await replay(
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
      // Keep the immutable original replay, but return only currently readable metadata.
      const result = await currentCreationResult(tx, db, req.principal, saved);
      if (!result)
        throw new Problem(410, "WORKSPACE_CREATION_UNAVAILABLE", "The original workspace is no longer available; it will not be recreated");
      return result;
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
