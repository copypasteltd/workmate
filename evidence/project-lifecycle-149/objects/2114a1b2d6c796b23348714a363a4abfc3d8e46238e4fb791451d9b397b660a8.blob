import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit, requireUser } from "./auth.js";
import { key, replay, tenantAccess } from "./access.js";
import { lockMemberships } from "./membership.js";
import { lockUserAuthorities } from "./user-authority.js";
import { name, Problem, uuid } from "./lib.js";

function checkTenant(req: FastifyRequest, tenant: string) {
  const header = req.headers["x-tenant-id"];
  if (header !== undefined && uuid.parse(header) !== tenant)
    throw new Problem(400, "TENANT_MISMATCH", "Workspace header does not match the path");
}

// Archived projects are reachable only through these tenant-management routes.
// Task, source and native execution authorization keeps projectAccess unchanged.
export async function managedProject(tx: Tx, actor: Principal, tenant: string, project: string) {
  await lockUserAuthorities(tx, [actor.id]);
  await lockMemberships(tx, tenant);
  const row = (await tx.query(
    "SELECT * FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenant, project],
  )).rows[0];
  // Authorize after every lock wait using the same locks as account/membership changes.
  await tenantAccess(tx, actor, tenant, "manage");
  if (!row) throw new Problem(404, "NOT_FOUND", "Project not found");
  return row;
}

export function registerProjectManagement(app: FastifyInstance, db: Database) {
  app.get("/v1/tenants/:tenant/project-directory", { preHandler: requireUser(db) }, async (req, reply) => {
    const tenant = uuid.parse((req.params as any).tenant);
    checkTenant(req, tenant);
    const q = z.object({
      state: z.enum(["active", "archived", "all"]).default("active"),
      search: z.string().trim().max(160).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).strict().parse(req.query);
    reply.header("Cache-Control", "no-store");
    return db.tx(async tx => {
      await tenantAccess(tx, req.principal, tenant, "manage");
      const filter = "tenant_id=$1 AND ($2::text='all' OR archived=($2='archived')) AND ($3::text='' OR position(lower($3) in lower(name||' '||description))>0)";
      const values = [tenant, q.state, q.search];
      const items = (await tx.query(
        `SELECT id,tenant_id,name,description,archived,created_at FROM projects WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
        [...values, q.page_size, (q.page - 1) * q.page_size],
      )).rows;
      const total = (await tx.query(`SELECT count(*)::int AS n FROM projects WHERE ${filter}`, values)).rows[0].n;
      return { items, total, page: q.page, page_size: q.page_size };
    }, tenant);
  });

  app.patch("/v1/tenants/:tenant/projects/:project", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project } = z.object({ tenant: uuid, project: uuid }).parse(req.params);
    checkTenant(req, tenant);
    const b = z.object({
      name: name.optional(),
      description: z.string().max(2000).optional(),
      archived: z.boolean().optional(),
      expected_archived: z.boolean().optional(),
      expected_name: z.string().max(160).optional(),
      expected_description: z.string().max(2000).optional(),
    }).strict().refine(v => v.name !== undefined || v.description !== undefined || v.archived !== undefined, "A project change is required").parse(req.body);
    const requestKey = req.headers["idempotency-key"] === undefined ? null : key(req);
    reply.header("Cache-Control", "no-store");
    return db.tx(async tx => {
      const old = await managedProject(tx, req.principal, tenant, project);
      const change = async () => {
        if ((b.expected_archived !== undefined && old.archived !== b.expected_archived)
          || (b.expected_name !== undefined && old.name !== b.expected_name)
          || (b.expected_description !== undefined && old.description !== b.expected_description))
          throw new Problem(409, "PROJECT_CHANGED", "Project changed; refresh before applying this change");
        const row = (await tx.query(
          "UPDATE projects SET name=coalesce($3,name),description=coalesce($4,description),archived=coalesce($5,archived) WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [tenant, project, b.name ?? null, b.description ?? null, b.archived ?? null],
        )).rows[0];
        await audit(tx, req.principal, b.archived === true ? "project.archive" : b.archived === false ? "project.restore" : "project.update",
          project, "succeeded", { fields: ["name", "description", "archived"].filter(field => field in b), archived: row.archived }, tenant);
        return { id: row.id };
      };
      if (requestKey) await replay(tx, req.principal.id, `project.update:${tenant}:${project}`, requestKey, b, change);
      else await change();
      // Replayed acknowledgements cannot reapply an old archive after a restore,
      // and return current metadata instead of an obsolete cached representation.
      return (await tx.query("SELECT * FROM projects WHERE tenant_id=$1 AND id=$2", [tenant, project])).rows[0];
    }, tenant);
  });
}
