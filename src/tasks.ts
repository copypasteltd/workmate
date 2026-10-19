import { enqueueTask } from "./task-service.js";
import {
  workMode,
  getAgentVersion,
  freezeWorkContext,
} from "./persistent-work.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireUser, audit } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import { micros, name, Problem, uuid } from "./lib.js";
import { settle } from "./billing.js";
import type { Catalog } from "./catalog.js";
import { inputDependencies } from "./task-dependencies.js";
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
  app.get("/v1/catalog/default-assistant", async () =>
    db.tx(
      async (tx) =>
        (await catalog.publicConfigured(tx, db.config, true)).find(
          (r) => r.role_key === "assistant",
        ),
      undefined,
      true,
    ),
  );
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT id,title,role_key,status,mode,conversation_id,private_owner,acceptance,charged_micros,budget_micros,created_at,updated_at,parent_id,version FROM tasks WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",
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
        mode: workMode.default("execute"),
        agent_id: uuid.optional(),
        dependencies: inputDependencies.optional(),
      })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(
        tx,
        req.principal.id,
        `task.create:${project}`,
        key(req),
        b,
        async () => {
          let context;
          if (b.agent_id) {
            const agent = await getAgentVersion(
              tx,
              project,
              b.agent_id,
              undefined,
              true,
            );
            if (agent.role_key !== b.role_key)
              throw new Problem(
                400,
                "ROLE_MISMATCH",
                "Use the specialist's installed role",
              );
            context = await freezeWorkContext(
              tx,
              req.principal,
              tenant,
              project,
              agent,
              undefined,
              catalog,
            );
          }
          return enqueueTask(
            tx,
            db,
            catalog,
            req.principal,
            tenant,
            project,
            b,
            key(req),
            { context },
          );
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
          ![
            "queued",
            "running",
            "paused",
            "awaiting_approval",
            "needs_input",
          ].includes(t.status)
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
