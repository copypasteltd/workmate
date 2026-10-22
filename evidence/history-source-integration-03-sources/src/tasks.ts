import { assertTaskContentSources } from "./task-content-sources.js";
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
import type { Catalog } from "./catalog.js";
import { inputDependencies } from "./task-dependencies.js";
import { assertReportSources } from "./analysis-reports.js";
import {
  controlUnclaimedTask,
  requestTaskCancellation,
} from "./task-control.js";
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
            `SELECT id,title,role_key,status,mode,conversation_id,private_owner,acceptance,charged_micros,budget_micros,created_at,updated_at,parent_id,version
             FROM tasks WHERE tenant_id=$1 AND project_id=$2 AND task_content_sources_available(id)
             AND (NOT(input_context ? 'analysis_report_id') OR EXISTS(
               SELECT 1 FROM analysis_reports r WHERE r.task_id=tasks.id AND r.id::text=tasks.input_context->>'analysis_report_id' AND analysis_report_available(r.id)))
             AND (NOT(input_context ? 'seo_audit_id') OR EXISTS(
               SELECT 1 FROM seo_runs r WHERE r.task_id=tasks.id AND r.id::text=tasks.input_context->>'seo_audit_id' AND seo_run_sources_available(r.id)))
             AND (NOT(input_context ? 'seo_change_task_id') OR EXISTS(
               SELECT 1 FROM seo_change_tasks c WHERE c.task_id=tasks.id AND c.id::text=tasks.input_context->>'seo_change_task_id' AND seo_change_available(c.id)))
             ORDER BY created_at DESC LIMIT 100`,
            [tenant, project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const payer = uuid.optional().parse(req.headers["x-billing-account-id"]);
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
        payer ? { ...b, billing_account_id: payer } : b,
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
            { context, billing_account_id: payer },
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
      await assertReportSources(tx, t, false);
      await assertTaskContentSources(tx, t);
      await projectAccess(tx, req.principal, tenant, project);
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
        const sourceTask = (
          await tx.query("SELECT * FROM tasks WHERE id=$1 AND project_id=$2", [
            task,
            project,
          ])
        ).rows[0];
        await assertReportSources(tx, sourceTask, false);
        await assertTaskContentSources(tx, sourceTask);
        await projectAccess(tx, req.principal, tenant, project);
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
    base + "/:task/controls",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project, task } = taskParams.parse(req.params);
      const b = z
        .object({
          action: z.enum(["pause", "resume"]),
          expected_version: z.number().int().positive(),
          reason: z.string().trim().min(1).max(2000).optional(),
        })
        .strict()
        .parse(req.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        // Revalidate visibility even when replaying a completed request.
        if (
          !(
            await tx.query(
              "SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2",
              [task, project],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Task not found");
        return replay(
          tx,
          req.principal.id,
          "task.control",
          key(req),
          { task, ...b },
          async () => {
            const t = (
              await tx.query(
                "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE",
                [task, project],
              )
            ).rows[0];
            if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
            if (t.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Task changed; refresh first",
              );
            const value = await controlUnclaimedTask(
              tx,
              db,
              catalog,
              t,
              b.action,
            );
            await audit(
              tx,
              req.principal,
              `task.${b.action}`,
              task,
              "succeeded",
              {
                checkpoint: "before_first_model_turn",
                ...(b.reason ? { reason: b.reason } : {}),
              },
              tenant,
            );
            return value;
          },
        );
      }, tenant);
      return reply.code(202).send(result);
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
        return requestTaskCancellation(tx, t);
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
