import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import { requireUser } from "./auth.js";
import { key, replay, projectAccess } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { desktopRuntime } from "./desktop-runtime.js";
import { desktopSessionFamily } from "./desktop-family.js";
import { Solutions } from "./solution-service.js";
import { solutionTrial } from "./solution-model.js";

export const desktopSolutionBinding = z
  .object({
    device_id: uuid,
    local_session_id: uuid,
    workspace_hash: z.string().regex(/^[a-f0-9]{64}$/),
    runtime_version: z.literal(desktopRuntime.pinned_version),
    runtime_sha256: z.literal(desktopRuntime.windows_x64_sha256),
    role_key: z.string().min(1).max(80),
  })
  .strict();
export const desktopSolutionTrial = z
  .object({
    trial: solutionTrial,
    sessions: z
      .array(desktopSolutionBinding)
      .min(1)
      .max(6)
      .refine(
        (s) => new Set(s.map((v) => v.local_session_id)).size === s.length,
      ),
  })
  .strict();

export function registerDesktopSolutions(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  roles: readonly string[],
) {
  const service = new Solutions(db, catalog);
  app.post(
    "/v1/solution-versions/:id/desktop-trials",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        id = uuid.parse((req.params as any).id),
        b = desktopSolutionTrial.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const family = (await desktopSessionFamily(tx, req.principal))!;
          const s = await service.version(tx, req.principal, tenant, id);
          await projectAccess(
            tx,
            req.principal,
            tenant,
            b.trial.project_id,
            "write",
          );
          if (
            s.frozen.length !== b.sessions.length ||
            b.sessions.some(
              (v, i) =>
                !roles.includes(v.role_key) ||
                v.role_key !== s.frozen[i].role_key ||
                v.device_id !== b.sessions[0].device_id,
            )
          )
            throw new Problem(
              409,
              "SOLUTION_LOCAL_ROLE_MISMATCH",
              "Select a fresh local session for every pinned specialist, on the same device",
            );
          // A deterministic lock order also excludes concurrent ordinary admissions
          // against any of the native sessions in this batch.
          for (const v of [...b.sessions].sort((a, b) =>
            a.local_session_id.localeCompare(b.local_session_id),
          ))
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              ["desktop-session:" + v.local_session_id],
            );
          return replay(
            tx,
            req.principal.id,
            "solution.desktop-trial:" + id,
            key(req),
            { tenant, family, ...b },
            async () => {
              if (
                (
                  await tx.query(
                    "SELECT 1 FROM desktop_executions WHERE local_session_id=ANY($1::uuid[]) LIMIT 1",
                    [b.sessions.map((v) => v.local_session_id)],
                  )
                ).rowCount
              )
                throw new Problem(
                  409,
                  "SOLUTION_LOCAL_SESSION_USED",
                  "Create fresh local sessions so every trial starts with its exact pinned method",
                );
              if (b.trial.budget_micros < b.sessions.length * 10000)
                throw new Problem(
                  422,
                  "SOLUTION_TRIAL_BUDGET",
                  "Allow at least 10000 micro-HKD per native specialist",
                );
              return service.trial(
                tx,
                req.principal,
                tenant,
                s,
                b.trial,
                key(req),
                { family, sessions: b.sessions },
              );
            },
          ).then(async (saved) => {
            await service.trialRows(tx, req.principal, tenant, saved.id);
            // A current but different login family cannot recover the original
            // device's admission, even if it knows the idempotency key.
            const native = (
              await tx.query(
                "SELECT native_bindings FROM solution_trials WHERE id=$1",
                [saved.id],
              )
            ).rows[0];
            if (native?.native_bindings.family !== family)
              throw new Problem(
                404,
                "NOT_FOUND",
                "Local method trial not found",
              );
            return saved;
          });
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
}
