import { authorizeTaskPlan } from "./plans.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireUser, audit } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import { micros, name, Problem, uuid } from "./lib.js";
import { reserve, settle } from "./billing.js";
import type { Catalog } from "./catalog.js";
export async function event(
  tx: Tx,
  tenant: string,
  task: string,
  kind: string,
  body: unknown,
) {
  return (
    await tx.query(
      "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4) RETURNING id",
      [tenant, task, kind, JSON.stringify(body)],
    )
  ).rows[0].id;
}
export function registerTasks(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const params = z.object({ tenant: uuid, project: uuid });
  const taskParams = params.extend({ task: uuid });
  const base = "/v1/tenants/:tenant/projects/:project/tasks";
  app.get("/v1/catalog/roles", async () => ({
    items: await db.tx(
      (tx) => catalog.publicConfigured(tx, db.config),
      undefined,
      true,
    ),
    kernel: "codex",
    requested_model: "gpt 6 luna max",
  }));
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT id,title,role_key,status,acceptance,charged_micros,budget_micros,created_at,updated_at,parent_id,version FROM tasks WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",
            [tenant, project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = z
      .object({
        title: name,
        prompt: z.string().trim().min(5).max(30000),
        role_key: z.string().max(80),
        budget_micros: micros,
        parent_id: uuid.optional(),
      })
      .strict()
      .parse(req.body);
    const r = catalog.role(b.role_key);
    await catalog.boundSkills(r);
    const ready = catalog.available(db.config, r);
    if (!ready.available)
      throw new Problem(
        503,
        ready.reason!,
        "此服務正在準備，請聯絡工作區管理員 / This service requires workspace setup",
      );
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(
        tx,
        req.principal.id,
        `task.create:${project}`,
        key(req),
        b,
        async () => {
          if (
            b.parent_id &&
            !(
              await tx.query(
                "SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2",
                [b.parent_id, project],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Original task not found");
          await catalog.ensureEnabled(tx, b.role_key);
          const plan = await authorizeTaskPlan(
            tx,
            tenant,
            req.principal.id,
            r,
            b.budget_micros,
          );
          const t = (
            await tx.query(
              "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
              [
                tenant,
                project,
                req.principal.id,
                b.title,
                b.prompt,
                b.role_key,
                catalog.digest(r),
                b.budget_micros,
                key(req),
                req.principal.authVersion,
                b.parent_id ?? null,
              ],
            )
          ).rows[0];
          await tx.query("UPDATE tasks SET plan_snapshot=$2 WHERE id=$1", [
            t.id,
            plan,
          ]);
          await reserve(tx, tenant, t.id, b.budget_micros);
          await event(tx, tenant, t.id, "task.queued", {
            role_key: b.role_key,
          });
          await tx.query(
            "INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)",
            [tenant, { task_id: t.id }],
          );
          await audit(
            tx,
            req.principal,
            "task.create",
            t.id,
            "succeeded",
            {},
            tenant,
          );
          return t;
        },
      );
    }, tenant);
  });
  app.get(base + "/:task", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, task } = taskParams.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const t = (
        await tx.query("SELECT * FROM tasks WHERE id=$1 AND project_id=$2", [
          task,
          project,
        ])
      ).rows[0];
      if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
      return t;
    }, tenant);
  });
  app.get(
    base + "/:task/events",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, task } = taskParams.parse(req.params);
      const q = z
        .object({ after: z.coerce.number().int().nonnegative().default(0) })
        .parse(req.query);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        if (
          !(
            await tx.query(
              "SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2",
              [task, project],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Task not found");
        return {
          items: (
            await tx.query(
              "SELECT id,kind,body,created_at FROM task_events WHERE task_id=$1 AND id>$2 ORDER BY id LIMIT 200",
              [task, q.after],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.post(
    base + "/:task/cancel",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, task } = taskParams.parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const t = (
          await tx.query(
            "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [task, project],
          )
        ).rows[0];
        if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
        if (
          !["queued", "running", "paused", "awaiting_approval"].includes(
            t.status,
          )
        )
          return t;
        if (t.status === "running")
          await tx.query(
            "UPDATE tasks SET cancel_requested=true,version=version+1 WHERE id=$1",
            [task],
          );
        else {
          await settle(tx, tenant, task, 0, t.created_by);
          await tx.query(
            "UPDATE tasks SET status='cancelled',cancel_requested=true,version=version+1,updated_at=now() WHERE id=$1",
            [task],
          );
        }
        await event(tx, tenant, task, "task.cancel_requested", {});
        return (await tx.query("SELECT * FROM tasks WHERE id=$1", [task]))
          .rows[0];
      }, tenant);
    },
  );
  app.post(
    base + "/:task/acceptance",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, task } = taskParams.parse(req.params);
      const b = z
        .object({
          decision: z.enum(["accepted", "changes_requested"]),
          comment: z.string().max(5000).default(""),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "approve");
        const t = (
          await tx.query(
            "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [task, project],
          )
        ).rows[0];
        if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
        if (t.status !== "succeeded" || t.version !== b.version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Only the current completed deliverable can be reviewed",
          );
        await tx.query(
          "UPDATE tasks SET acceptance=$2,version=version+1 WHERE id=$1",
          [task, b.decision],
        );
        await event(tx, tenant, task, "delivery.reviewed", {
          decision: b.decision,
          comment: b.comment,
          by: req.principal.id,
        });
        return { ok: true };
      }, tenant);
    },
  );
}
