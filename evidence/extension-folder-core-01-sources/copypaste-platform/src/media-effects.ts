import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { requireUser } from "./auth.js";
import { projectAccess, key, replay } from "./access.js";
import { Problem, uuid, canonical } from "./lib.js";
import { enqueueTask } from "./task-service.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import {
  effectsCatalog,
  effectDigest,
  effectsTaskInput,
  effectSourcesInput,
  parseEffect,
} from "./media-effects-model.js";
import { listEffectSources, loadEffectSources } from "./media-effects-tools.js";
import { preflightMediaEffect } from "./media-effects-render.js";

export function registerMediaEffects(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  const params = z.object({ tenant: uuid, project: uuid }),
    base = "/v1/tenants/:tenant/projects/:project/effects";
  app.get(base + "/catalog", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const role = catalog.role("video-motion");
        let enabled = role.version === "1.5.0";
        try {
          await catalog.ensureEnabled(tx, role.role_key, catalog.digest(role));
        } catch {
          enabled = false;
        }
        return {
          ...effectsCatalog(),
          role_key: role.role_key,
          role_version: role.version,
          available:
            enabled &&
            (await catalog.availableFor(tx, db.config, role)).available,
          kernel: "codex",
        };
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.get(base + "/sources", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params),
      input = effectSourcesInput.parse(req.query);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        return listEffectSources(
          tx,
          {
            tenant_id: tenant,
            project_id: project,
            created_by: req.principal.id,
          },
          input,
        );
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.post(base + "/tasks", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params),
      b = effectsTaskInput.parse(req.body),
      request = parseEffect(b.request),
      payer = uuid.optional().parse(req.headers["x-billing-account-id"]);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const result = await replay(
          tx,
          req.principal.id,
          `effect.create:${project}`,
          key(req),
          { ...b, ...(payer ? { billing_account_id: payer } : {}) },
          async () => {
            const role = catalog.role("video-motion");
            if (role.version !== "1.5.0")
              throw new Problem(
                409,
                "EFFECT_ROLE_UNAVAILABLE",
                "The reviewed effect role is unavailable",
              );
            await catalog.ensureEnabled(
              tx,
              role.role_key,
              catalog.digest(role),
            );
            const sources = await loadEffectSources(
              tx,
              storage,
              {
                tenant_id: tenant,
                project_id: project,
                created_by: req.principal.id,
              },
              request,
            );
            const renderer_profile = await preflightMediaEffect(
              request,
              sources,
              db.config.DATA_DIR,
            );
            const binding = {
              request,
              request_sha256: effectDigest(request),
              catalog_sha256: effectsCatalog().catalog_sha256,
              renderer_profile,
            };
            const task = await enqueueTask(
              tx,
              db,
              catalog,
              req.principal,
              tenant,
              project,
              {
                title: b.title,
                role_key: role.role_key,
                budget_micros: b.budget_micros,
                mode: "execute",
                prompt:
                  "Run the exact reviewed media effect with effects_catalog followed by effect_render. Do not change any parameters or sources. Deliver the actual MP4, preview, source JSON and ZIP; audio is omitted.\n\n" +
                  canonical(binding),
              },
              key(req),
              { media_effect: binding, billing_account_id: payer },
            );
            return {
              id: task.id,
              request_sha256: binding.request_sha256,
              status: task.status,
              execution_location: "cloud",
            };
          },
        );
        const t = (
          await tx.query(
            "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 AND created_by=$3",
            [result.id, project, req.principal.id],
          )
        ).rows[0];
        if (!t)
          throw new Problem(
            410,
            "REQUEST_RESULT_REMOVED",
            "The original effect request is no longer available",
          );
        await assertTaskContentSources(tx, t);
        return result;
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.get(
    base + "/tasks/:task",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, task } = params
        .extend({ task: uuid })
        .parse(req.params);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, project);
          const t = (
            await tx.query(
              "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 AND role_key='video-motion' AND (private_owner IS NULL OR private_owner=$3)",
              [task, project, req.principal.id],
            )
          ).rows[0];
          if (!t) throw new Problem(404, "NOT_FOUND", "Effect task not found");
          await assertTaskContentSources(tx, t);
          // Completion receipts require both the authorized actor and exact
          // task context. Set it only after the task/source access checks.
          await tx.query("SELECT set_config('app.task_id',$1,true)", [task]);
          const result = (
            await tx.query(
              "SELECT result FROM task_tool_receipts WHERE task_id=$1 AND tool_name='effect_render' ORDER BY created_at DESC LIMIT 1",
              [task],
            )
          ).rows[0]?.result;
          if (!result)
            return {
              id: task,
              status: t.status,
              request: t.input_context?.media_effect?.request ?? null,
              delivery: null,
            };
          const rows = (
            await tx.query(
              `SELECT v.id AS asset_version_id,a.id AS asset_id,a.name,v.version,v.sha256,v.mime_type,v.bytes FROM asset_versions v JOIN assets a ON a.id=v.asset_id
        WHERE v.id=ANY($1::uuid[]) AND v.metadata->>'task_id'=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
              [result.files.map((f: any) => f.asset_version_id), task],
            )
          ).rows;
          if (rows.length !== 4)
            throw new Problem(
              409,
              "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
              "The completed effect output is unavailable",
            );
          return {
            id: task,
            status: t.status,
            request: t.input_context?.media_effect?.request ?? null,
            delivery: { ...result, files: rows },
            data_mode: t.data_mode,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
}
