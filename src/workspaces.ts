import { effectivePlan } from "./plans.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireUser, audit, sendMail } from "./auth.js";
import {
  key,
  listProjects,
  projectAccess,
  replay,
  tenantAccess,
  activePlans,
} from "./access.js";
import { email, hash, name, Problem, token, uuid } from "./lib.js";
import { wallet } from "./billing.js";

export function registerWorkspaces(app: FastifyInstance, db: Database) {
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
    return db.tx((tx) =>
      replay(tx, req.principal.id, "tenant.create", key(req), b, async () => {
        const t = (
          await tx.query(
            "INSERT INTO tenants(name,data_mode) VALUES($1,$2) RETURNING *",
            [b.name, db.config.DEMO_MODE ? "simulated" : "configured_services"],
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
      }),
    );
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
    "/v1/tenants/:tenant/members",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "manage");
        return {
          items: (
            await tx.query(
              "SELECT u.id,u.email,u.name,m.role,m.status,m.version,ARRAY(SELECT pm.project_id FROM project_members pm WHERE pm.tenant_id=m.tenant_id AND pm.user_id=u.id) AS project_ids FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY m.created_at",
              [tenant],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.patch(
    "/v1/tenants/:tenant/members/:user",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, user } = z
        .object({ tenant: uuid, user: uuid })
        .parse(req.params);
      const b = z
        .object({
          role: z.enum(["owner", "admin", "member", "approver", "viewer"]),
          status: z.enum(["active", "removed"]),
          version: z.number().int().positive(),
          project_ids: z.array(uuid).max(100).default([]),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "owner");
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `members:${tenant}`,
        ]);
        const old = (
          await tx.query(
            "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
            [tenant, user],
          )
        ).rows[0];
        if (!old || old.version !== b.version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Membership changed; refresh first",
          );
        if (
          old.role === "owner" &&
          (b.role !== "owner" || b.status !== "active")
        ) {
          const n = (
            await tx.query(
              "SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND role='owner' AND status='active'",
              [tenant],
            )
          ).rows[0].n;
          if (n <= 1)
            throw new Problem(
              409,
              "LAST_OWNER",
              "Transfer ownership before removing the last owner",
            );
        }
        for (const id of b.project_ids)
          if (
            !(
              await tx.query(
                "SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2",
                [tenant, id],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Project not found");
        const result = (
          await tx.query(
            "UPDATE memberships SET role=$3,status=$4,version=version+1 WHERE tenant_id=$1 AND user_id=$2 RETURNING *",
            [tenant, user, b.role, b.status],
          )
        ).rows[0];
        await tx.query(
          "DELETE FROM project_members WHERE tenant_id=$1 AND user_id=$2",
          [tenant, user],
        );
        if (b.status === "active")
          for (const id of b.project_ids)
            await tx.query(
              "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,$4)",
              [
                tenant,
                id,
                user,
                b.role === "member"
                  ? "editor"
                  : b.role === "approver"
                    ? "approver"
                    : "viewer",
              ],
            );
        await audit(
          tx,
          req.principal,
          "membership.update",
          user,
          "succeeded",
          { role: b.role, status: b.status },
          tenant,
        );
        return result;
      }, tenant);
    },
  );
  app.post(
    "/v1/tenants/:tenant/invites",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      const b = z
        .object({
          email,
          role: z.enum(["admin", "member", "approver", "viewer"]),
          project_ids: z.array(uuid).max(100).default([]),
        })
        .strict()
        .parse(req.body);
      const invite = await db.tx(async (tx) => {
        const m = await tenantAccess(tx, req.principal, tenant, "manage");
        if (b.role === "admin" && m.role !== "owner")
          throw new Problem(
            403,
            "OWNER_REQUIRED",
            "Only owners can grant workspace admin access",
          );
        for (const id of b.project_ids)
          await projectAccess(tx, req.principal, tenant, id, "manage");
        return replay(
          tx,
          req.principal.id,
          `invite:${tenant}`,
          key(req),
          b,
          async () => {
            const value = token();
            const row = (
              await tx.query(
                "INSERT INTO invites(tenant_id,email,digest,role,project_ids,expires_at,created_by) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6) RETURNING id,expires_at",
                [
                  tenant,
                  b.email,
                  hash(value),
                  b.role,
                  b.project_ids,
                  req.principal.id,
                ],
              )
            ).rows[0];
            return {
              ...row,
              invite_url: `${db.config.WEB_ORIGIN}/invite?token=${value}`,
            };
          },
        );
      }, tenant);
      await sendMail(
        db,
        b.email,
        "CopyPaste · Workspace invitation",
        `You have been invited to a CopyPaste workspace. Sign in using this email and accept: ${invite.invite_url}`,
      );
      return invite;
    },
  );
  app.post(
    "/v1/invites/accept",
    { preHandler: requireUser(db) },
    async (req) => {
      const b = z
        .object({ token: z.string().min(40).max(100) })
        .strict()
        .parse(req.body);
      // Invite lookup uses control only to find its tenant; all mutation then runs with RLS.
      const locator = (
        await db.control.query(
          "SELECT tenant_id FROM invites WHERE digest=$1",
          [hash(b.token)],
        )
      ).rows[0];
      if (!locator)
        throw new Problem(404, "INVITE_NOT_FOUND", "Invitation not found");
      return db.tx(async (tx) => {
        const i = (
          await tx.query(
            "SELECT *,expires_at>now() AS valid FROM invites WHERE digest=$1 FOR UPDATE",
            [hash(b.token)],
          )
        ).rows[0];
        if (
          !i ||
          !i.valid ||
          i.consumed_at ||
          i.revoked_at ||
          i.email !== req.principal.email
        )
          throw new Problem(
            409,
            "INVITE_INVALID",
            "Invitation is expired, already used, or belongs to another email",
          );
        const t = (
          await tx.query(
            "SELECT * FROM tenants WHERE id=$1 AND status='active'",
            [i.tenant_id],
          )
        ).rows[0];
        if (!t) throw new Problem(404, "NOT_FOUND", "Workspace not found");
        const existing = (
          await tx.query(
            "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
            [i.tenant_id, req.principal.id],
          )
        ).rows[0];
        // Accepting an invitation never silently demotes or elevates an existing active member.
        if (existing?.status === "active")
          throw new Problem(
            409,
            "ALREADY_MEMBER",
            "You already belong to this workspace",
          );
        await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',version=memberships.version+1",
          [i.tenant_id, req.principal.id, i.role],
        );
        for (const p of i.project_ids)
          await tx.query(
            "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role",
            [
              i.tenant_id,
              p,
              req.principal.id,
              i.role === "member"
                ? "editor"
                : i.role === "approver"
                  ? "approver"
                  : "viewer",
            ],
          );
        await tx.query("UPDATE invites SET consumed_at=now() WHERE id=$1", [
          i.id,
        ]);
        await audit(
          tx,
          req.principal,
          "invite.accept",
          i.id,
          "succeeded",
          {},
          i.tenant_id,
        );
        return { tenant: t };
      }, locator.tenant_id);
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
              "SELECT id,kind,amount_micros,reason,created_at FROM ledger WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
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
