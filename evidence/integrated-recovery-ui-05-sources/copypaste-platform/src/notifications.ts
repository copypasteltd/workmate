import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireUser } from "./auth.js";
import {
  key,
  listProjects,
  projectAccess,
  replay,
  tenantAccess,
} from "./access.js";
import { Problem, uuid } from "./lib.js";
const fields = "id,project_id,conversation_id,task_id,kind,read,created_at";
const view = (r: any) => ({
  id: r.id,
  project_id: r.project_id,
  ...(r.conversation_id ? { conversation_id: r.conversation_id } : {}),
  task_id: r.task_id,
  task_title: r.task_title,
  kind: r.kind,
  read: r.read,
  created_at: r.created_at,
});
const tenantOf = (req: FastifyRequest) =>
  uuid.parse((req.params as any).tenant ?? req.headers["x-tenant-id"]);
export function registerNotifications(app: FastifyInstance, db: Database) {
  const list = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      q = z
        .object({
          project_id: uuid.optional(),
          cursor: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          unread: z.enum(["true", "false"]).optional(),
        })
        .strict()
        .parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      if (q.project_id)
        await projectAccess(tx, req.principal, tenant, q.project_id);
      const projects = (await listProjects(tx, req.principal, tenant))
        .map((p: any) => p.id)
        .filter((id: string) => !q.project_id || id === q.project_id);
      let cursor: any;
      if (q.cursor) {
        cursor = (
          await tx.query(
            "SELECT id,created_at::text AS created_at FROM notifications WHERE id=$1 AND project_id=ANY($2::uuid[])",
            [q.cursor, projects],
          )
        ).rows[0];
        if (!cursor)
          throw new Problem(
            410,
            "CURSOR_EXPIRED",
            "Refresh the inbox because its saved page is no longer accessible",
          );
      }
      const rows = (
        await tx.query(
          `SELECT ${fields
            .split(",")
            .map((f) => "n." + f)
            .join(
              ",",
            )},t.title AS task_title FROM notifications n JOIN tasks t ON t.id=n.task_id WHERE n.project_id=ANY($1::uuid[]) AND ($2::boolean IS NULL OR n.read=NOT $2) AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3,$4::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,
          [
            projects,
            q.unread === undefined ? null : q.unread === "true",
            cursor?.created_at ?? null,
            cursor?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map(view),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  };
  const update = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).notification_id),
      b = z.object({ read: z.boolean() }).strict().parse(req.body);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const row = (
        await tx.query(
          "SELECT n.*,t.title AS task_title FROM notifications n JOIN tasks t ON t.id=n.task_id WHERE n.id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Notification not found");
      await projectAccess(tx, req.principal, tenant, row.project_id);
      return replay(
        tx,
        req.principal.id,
        `notification:${id}`,
        key(req),
        b,
        async () => {
          const updated = (
            await tx.query(
              `UPDATE notifications SET read=$2 WHERE id=$1 RETURNING ${fields}`,
              [id, b.read],
            )
          ).rows[0];
          if (!updated)
            throw new Problem(404, "NOT_FOUND", "Notification not found");
          return view({ ...updated, task_title: row.task_title });
        },
      );
    }, tenant);
  };
  for (const base of [
    "/v1/notifications",
    "/v1/tenants/:tenant/notifications",
  ]) {
    app.get(base, { preHandler: requireUser(db) }, list);
    app.patch(
      base + "/:notification_id",
      { preHandler: requireUser(db) },
      update,
    );
  }
}
