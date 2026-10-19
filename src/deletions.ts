import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import {
  eraseReplayContent,
  key,
  projectAccess,
  replay,
  tenantAccess,
} from "./access.js";
import { permit, requireRecentMfa, scopePredicate } from "./admin-access.js";
import { Problem, uuid } from "./lib.js";
import { eraseConversation } from "./persistent-work.js";
import { eraseWorkspaceNode } from "./cloud-files.js";

const targetTables = {
  asset: "assets",
  memory: "memories",
  conversation: "conversations",
  agent: "agents",
  workspace_node: "workspace_nodes",
} as const;
const result = (r: any) => ({
  id: r.id,
  state: r.state,
  exceptions: r.exceptions,
});
async function detail(tx: Tx, row: any) {
  const counts = (
    await tx.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE state='completed')::int AS completed FROM deletion_items WHERE job_id=$1",
      [row.id],
    )
  ).rows[0];
  const failures = (
    await tx.query(
      "SELECT id,kind,attempts,error_code FROM deletion_items WHERE job_id=$1 AND state='failed' ORDER BY id LIMIT 100",
      [row.id],
    )
  ).rows;
  return {
    ...result(row),
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    target_type: row.target_type,
    target_id: row.target_id,
    attempts: row.attempts,
    created_at: row.created_at,
    completed_at: row.completed_at,
    progress: counts,
    failures,
  };
}
export function registerDeletions(app: FastifyInstance, db: Database) {
  const create: RouteHandlerMethod = async (req, reply) => {
    const tenant = uuid.parse(
      (req.params as any).tenant ?? req.headers["x-tenant-id"],
    );
    const b = z
      .object({
        target_type: z.enum([
          "asset",
          "memory",
          "conversation",
          "agent",
          "workspace_node",
        ]),
        target_id: uuid,
        project_id: uuid.optional(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    const value = await db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      return replay(
        tx,
        req.principal.id,
        "data.delete",
        key(req),
        { tenant, ...b },
        async () => {
          const table = targetTables[b.target_type];
          const row = (
            await tx.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [
              b.target_id,
            ])
          ).rows[0];
          if (
            !row ||
            (b.project_id && row.project_id !== b.project_id) ||
            ((req.params as any).project &&
              row.project_id !== (req.params as any).project)
          )
            throw new Problem(404, "NOT_FOUND", "Content not found");
          if (row.project_id)
            await projectAccess(
              tx,
              req.principal,
              tenant,
              row.project_id,
              b.target_type === "conversation" ||
                b.target_type === "workspace_node" ||
                row.private_owner === req.principal.id
                ? "write"
                : "manage",
            );
          else
            await tenantAccess(
              tx,
              req.principal,
              tenant,
              row.private_owner === req.principal.id ? "read" : "manage",
            );
          if (table === "workspace_nodes") await eraseWorkspaceNode(tx, row.id);
          else if (table === "conversations")
            await eraseConversation(tx, req.principal, row);
          else {
            await eraseReplayContent(tx, [row.id]);
            await tx.query(
              `UPDATE ${table} SET ${table === "assets" ? "state" : "content_state"}='deleted',moderation_version=moderation_version+1 WHERE id=$1`,
              [row.id],
            );
          }
          const job = (
            await tx.query(
              "SELECT * FROM deletion_jobs WHERE target_type=$1 AND target_id=$2",
              [table, row.id],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "data.delete",
            row.id,
            "accepted",
            { deletion_id: job.id, reason: b.reason },
            tenant,
          );
          return result(job);
        },
      );
    }, tenant);
    return reply.code(202).send(value);
  };
  app.post("/v1/deletions", { preHandler: requireUser(db) }, create);
  app.post(
    "/v1/tenants/:tenant/projects/:project/deletions",
    { preHandler: requireUser(db) },
    create,
  );
  app.get("/v1/deletions/:id", { preHandler: requireUser(db) }, async (req) => {
    const tenant = uuid.parse(req.headers["x-tenant-id"]),
      id = uuid.parse((req.params as any).id);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const job = (
        await tx.query("SELECT * FROM deletion_jobs WHERE id=$1", [id])
      ).rows[0];
      if (!job) throw new Problem(404, "NOT_FOUND", "Deletion not found");
      if (job.project_id)
        await projectAccess(tx, req.principal, tenant, job.project_id);
      return result(job);
    }, tenant);
  });
  app.get(
    "/v1/tenants/:tenant/projects/:project/deletions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = z
        .object({ tenant: uuid, project: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const rows = (
          await tx.query(
            "SELECT * FROM deletion_jobs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
            [project],
          )
        ).rows;
        return { items: await Promise.all(rows.map((r) => detail(tx, r))) };
      }, tenant);
    },
  );
  app.get(
    "/v1/admin/deletions",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = z
        .object({
          tenant_id: uuid.optional(),
          project_id: uuid.optional(),
          page: z.coerce.number().int().min(1).max(10000).default(1),
          page_size: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(req.query);
      return db.tx(
        async (tx) => {
          const scope = await scopePredicate(
            tx,
            req.principal,
            "admin.content.read",
            "d.tenant_id",
            "d.project_id",
          );
          const filter = `(${scope.sql}) AND ($6::uuid IS NULL OR d.tenant_id=$6) AND ($7::uuid IS NULL OR d.project_id=$7)`;
          const args = [
            ...scope.values,
            q.tenant_id ?? null,
            q.project_id ?? null,
          ];
          const rows = (
            await tx.query(
              `SELECT d.* FROM deletion_jobs d WHERE ${filter} ORDER BY d.created_at DESC,d.id DESC LIMIT $8 OFFSET $9`,
              [...args, q.page_size, (q.page - 1) * q.page_size],
            )
          ).rows;
          const total = (
            await tx.query(
              `SELECT count(*)::int AS n FROM deletion_jobs d WHERE ${filter}`,
              args,
            )
          ).rows[0].n;
          return {
            items: await Promise.all(rows.map((r) => detail(tx, r))),
            page: q.page,
            page_size: q.page_size,
            total,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/deletions/:id/retry",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({ reason: z.string().trim().min(3).max(2000) })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          const job = (
            await tx.query(
              "SELECT * FROM deletion_jobs WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!job) throw new Problem(404, "NOT_FOUND", "Deletion not found");
          await permit(tx, req.principal, "admin.content.delete", {
            tenant: job.tenant_id,
            project: job.project_id,
          });
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "admin.deletion.retry",
            key(req),
            { id, ...b },
            async () => {
              if (job.state === "completed") return result(job);
              if (job.lease_until && new Date(job.lease_until) > new Date())
                throw new Problem(
                  409,
                  "ERASURE_BUSY",
                  "Deletion is already running",
                );
              const row = (
                await tx.query(
                  "UPDATE deletion_jobs SET state='queued',attempts=0,next_attempt_at=now(),exceptions='[]',lease_token=NULL,lease_until=NULL WHERE id=$1 RETURNING *",
                  [id],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "admin.deletion.retry",
                id,
                "accepted",
                { reason: b.reason },
                job.tenant_id,
              );
              return result(row);
            },
          );
        },
        undefined,
        true,
      );
    },
  );
}
