import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import { requireUser, requireAdmin, audit } from "./auth.js";
import { key, replay, projectAccess, tenantAccess } from "./access.js";
import {
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
  scopePredicate,
} from "./admin-access.js";
import { Problem, uuid } from "./lib.js";
import { Solutions, solutionMissing } from "./solution-service.js";
import {
  solutionCreate,
  solutionPublish,
  solutionInstall,
  solutionBindings,
  solutionPreview,
  solutionTrial,
  solutionReview,
  solutionDTO,
  emptySolutionBindings,
} from "./solution-model.js";

const tenantOf = (r: FastifyRequest) => uuid.parse(r.headers["x-tenant-id"]);
const idOf = (r: FastifyRequest) => uuid.parse((r.params as any).id);
const page = {
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
};
const disable = z
  .object({
    expected_version: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
const base = "/v1/solution-versions";

export function registerSolutions(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const service = new Solutions(db, catalog);
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const tenant = tenantOf(req),
      q = z
        .object({ ...page, project_id: uuid.optional() })
        .strict()
        .parse(req.query);
    return db.tx(
      async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        if (q.project_id)
          await projectAccess(tx, req.principal, tenant, q.project_id);
        const rows = (
          await tx.query(
            `SELECT s.* FROM solution_versions s JOIN projects p ON p.id=s.project_id AND p.tenant_id=s.tenant_id
         WHERE s.tenant_id=$1 AND NOT p.archived AND ($2::uuid IS NULL OR s.project_id=$2)
         AND ($2::uuid IS NOT NULL OR s.state='published') AND ($3::uuid IS NULL OR s.id>$3) ORDER BY s.id LIMIT $4`,
            [tenant, q.project_id ?? null, q.cursor ?? null, q.limit + 1],
          )
        ).rows;
        return {
          items: rows.slice(0, q.limit).map(solutionDTO),
          next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.post(base, { preHandler: requireUser(db) }, async (req, reply) => {
    const tenant = tenantOf(req),
      b = solutionCreate.parse(req.body);
    const result = await db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, b.project_id, "manage");
        return replay(
          tx,
          req.principal.id,
          "solution.create",
          key(req),
          { tenant, ...b },
          () => service.create(tx, req.principal, tenant, b),
        );
      },
      tenant,
      false,
      req.principal.id,
    );
    return reply.code(201).send(result);
  });
  app.get(base + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const tenant = tenantOf(req),
      id = idOf(req);
    return db.tx(
      async (tx) =>
        solutionDTO(await service.version(tx, req.principal, tenant, id)),
      tenant,
      false,
      req.principal.id,
    );
  });
  app.get(
    base + "/:id/details",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req);
      return db.tx(
        async (tx) => {
          const row = await service.version(tx, req.principal, tenant, id);
          return {
            ...solutionDTO(row),
            definition_hash: row.definition_hash,
            templates: row.frozen,
            family_id: row.family_id,
            published_at: row.published_at,
            disabled_at: row.disabled_at,
            qualification: "customer_review_required",
            data_mode: db.config.DEMO_MODE
              ? "simulated"
              : "configured_services",
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    base + "/:id/revisions",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionCreate.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const row = await service.version(
            tx,
            req.principal,
            tenant,
            id,
            true,
          );
          return replay(
            tx,
            req.principal.id,
            "solution.revise:" + id,
            key(req),
            { tenant, ...b },
            () => service.create(tx, req.principal, tenant, b, row),
          );
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    base + "/:id/previews",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionPreview.parse(req.body);
      return db.tx(
        async (tx) =>
          service.assess(
            tx,
            req.principal,
            tenant,
            await service.version(tx, req.principal, tenant, id),
            b,
          ),
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    base + "/:id/trials",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionTrial.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const s = await service.version(tx, req.principal, tenant, id);
          await projectAccess(tx, req.principal, tenant, b.project_id, "write");
          if (s.state === "disabled")
            throw new Problem(
              409,
              "SOLUTION_DISABLED",
              "This version has been disabled",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            "solution.trial:" + id,
            key(req),
            { tenant, ...b },
            () => service.trial(tx, req.principal, tenant, s, b, key(req)),
          );
          // Replays cannot reveal removed trial output or revive paid work.
          await service.trialRows(tx, req.principal, tenant, saved.id);
          return saved;
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
  app.get(
    base + "/:id/trials",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        q = z
          .object({ ...page, project_id: uuid })
          .strict()
          .parse(req.query);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, q.project_id, "write");
          await service.version(tx, req.principal, tenant, id);
          const rows = (
            await tx.query(
              `SELECT id,solution_version_id,project_id,created_at,reviewed_at,budget_micros FROM solution_trials
         WHERE solution_version_id=$1 AND project_id=$2 AND private_owner=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5`,
              [
                id,
                q.project_id,
                req.principal.id,
                q.cursor ?? null,
                q.limit + 1,
              ],
            )
          ).rows;
          return {
            items: rows
              .slice(0, q.limit)
              .map((v) => ({ ...v, budget_micros: Number(v.budget_micros) })),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/solution-trials/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req);
      return db.tx(
        (tx) => service.trialDTO(tx, req.principal, tenant, id),
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    "/v1/solution-trials/:id/reviews",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionReview.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          await service.trialRows(tx, req.principal, tenant, id);
          await replay(
            tx,
            req.principal.id,
            "solution.review:" + id,
            key(req),
            { tenant, ...b },
            () => service.review(tx, req.principal, tenant, id, b),
          );
          return service.trialDTO(tx, req.principal, tenant, id);
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    base + "/:id/publications",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionPublish.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const s = await service.version(tx, req.principal, tenant, id, true);
          await replay(
            tx,
            req.principal.id,
            "solution.publish:" + id,
            key(req),
            { tenant, ...b },
            () =>
              service.publish(
                tx,
                req.principal,
                tenant,
                s,
                b.expected_version,
                b.validation_task_id,
              ),
          );
          return solutionDTO(
            await service.version(tx, req.principal, tenant, id, true),
          );
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    base + "/:id/installations",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = solutionInstall.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const s = await service.version(tx, req.principal, tenant, id);
          await projectAccess(
            tx,
            req.principal,
            tenant,
            b.project_id,
            "manage",
          );
          if (s.state !== "published")
            throw new Problem(
              409,
              "SOLUTION_NOT_PUBLISHED",
              "Install only a published method version",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            "solution.install:" + id,
            key(req),
            { tenant, ...b },
            async () => {
              const row = (
                await tx.query(
                  "INSERT INTO solution_installations(tenant_id,project_id,solution_version_id,name,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
                  [
                    tenant,
                    b.project_id,
                    s.id,
                    b.name ?? s.definition.name,
                    req.principal.id,
                  ],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "solution.install",
                row.id,
                "succeeded",
                { solution_version_id: id, source_project_id: s.project_id },
                tenant,
              );
              return { id: row.id };
            },
          );
          return service.installationDTO(
            tx,
            req.principal,
            tenant,
            await service.installation(tx, req.principal, tenant, saved.id),
            s,
          );
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    base + "/:id/disable",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = disable.parse(req.body);
      return db.tx(
        async (tx) => {
          const s = await service.version(tx, req.principal, tenant, id, true);
          await replay(
            tx,
            req.principal.id,
            "solution.disable:" + id,
            key(req),
            { tenant, ...b },
            async () => {
              if (s.version !== b.expected_version || s.state === "disabled")
                throw new Problem(
                  409,
                  "SOLUTION_VERSION_CONFLICT",
                  "Refresh this version before disabling it",
                );
              await tx.query(
                "UPDATE solution_versions SET state='disabled',disabled_at=clock_timestamp(),disable_reason=$2 WHERE id=$1",
                [id, b.reason],
              );
              await audit(
                tx,
                req.principal,
                "solution.disable",
                id,
                "succeeded",
                { reason: b.reason },
                tenant,
              );
              return { id };
            },
          );
          return solutionDTO(
            await service.version(tx, req.principal, tenant, id, true),
          );
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/solution-installations",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        q = z
          .object({
            ...page,
            limit: z.coerce.number().int().min(1).max(30).default(10),
            project_id: uuid,
          })
          .strict()
          .parse(req.query);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, q.project_id);
          const rows = (
            await tx.query(
              "SELECT * FROM solution_installations WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
              [tenant, q.project_id, q.cursor ?? null, q.limit + 1],
            )
          ).rows;
          const items = [];
          for (const i of rows.slice(0, q.limit)) {
            const s = (
              await tx.query(
                "SELECT * FROM solution_versions WHERE tenant_id=$1 AND id=$2",
                [tenant, i.solution_version_id],
              )
            ).rows[0];
            items.push({
              ...(await service.installationDTO(
                tx,
                req.principal,
                tenant,
                i,
                s,
              )),
              name: i.name,
            });
          }
          return {
            items,
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/solution-installations/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req);
      return db.tx(
        async (tx) => {
          const i = await service.installation(tx, req.principal, tenant, id);
          const s = (
            await tx.query(
              "SELECT * FROM solution_versions WHERE tenant_id=$1 AND id=$2",
              [tenant, i.solution_version_id],
            )
          ).rows[0];
          return {
            installation: await service.installationDTO(
              tx,
              req.principal,
              tenant,
              i,
              s,
            ),
            revision: i.revision,
            bindings: i.bindings,
            name: i.name,
            solution: s.state === "published" ? solutionDTO(s) : null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    "/v1/solution-installations/:id/configurations",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = z
          .object({
            expected_revision: z.number().int().positive(),
            bindings: solutionBindings,
          })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          const i = await service.installation(
            tx,
            req.principal,
            tenant,
            id,
            "manage",
          );
          const s = await service.version(
            tx,
            req.principal,
            tenant,
            i.solution_version_id,
          );
          if (s.state !== "published")
            throw new Problem(
              409,
              "SOLUTION_NOT_PUBLISHED",
              "This installed method is unavailable",
            );
          await replay(
            tx,
            req.principal.id,
            "solution.configure:" + id,
            key(req),
            { tenant, ...b },
            async () => {
              if (i.revision !== b.expected_revision)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Reload the current installation settings",
                );
              await service.assess(tx, req.principal, tenant, s, {
                project_id: i.project_id,
                bindings: b.bindings,
              });
              await tx.query(
                "UPDATE solution_installations SET bindings=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
                [id, b.bindings],
              );
              await audit(
                tx,
                req.principal,
                "solution.configure",
                id,
                "succeeded",
                { revision: i.revision + 1 },
                tenant,
              );
              return { id };
            },
          );
          const current = await service.installation(
            tx,
            req.principal,
            tenant,
            id,
          );
          return {
            installation: await service.installationDTO(
              tx,
              req.principal,
              tenant,
              current,
              s,
            ),
            revision: current.revision,
            bindings: current.bindings,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/solution-targets",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        q = z
          .object({
            ...page,
            project_id: uuid,
            kind: z.enum(["assets", "connectors"]),
          })
          .strict()
          .parse(req.query);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, q.project_id, "write");
          const rows =
            q.kind === "assets"
              ? (
                  await tx.query(
                    `SELECT a.id,a.name,a.private_owner,v.id AS asset_version_id,v.sha256,v.mime_type,v.version
         FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
         WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND v.erased_at IS NULL
         AND (a.private_owner IS NULL OR a.private_owner=$3) AND a.retention_expires_at>clock_timestamp()
         AND task_asset_version_sources_available(v.id) AND ($4::uuid IS NULL OR a.id>$4) ORDER BY a.id LIMIT $5`,
                    [
                      tenant,
                      q.project_id,
                      req.principal.id,
                      q.cursor ?? null,
                      q.limit + 1,
                    ],
                  )
                ).rows
              : (
                  await tx.query(
                    `SELECT c.id,c.provider,c.state,p.version,p.auth_version,p.catalog_state,p.account_ids,
          coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.account_id,'name',a.body->>'name')) FROM connector_accounts a
            WHERE a.connection_id=c.id AND a.auth_version=p.auth_version AND a.account_id=ANY(p.account_ids)
            AND (a.body->>'readable')::boolean AND a.body->>'kind'<>'manager'),'[]'::jsonb) AS accounts
         FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
         WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.state='connected' AND p.catalog_state='complete'
          AND $2=ANY(p.project_ids) AND p.configuration_hash<>repeat('0',64)
          AND ($3::uuid IS NULL OR c.id>$3) ORDER BY c.id LIMIT $4`,
                    [tenant, q.project_id, q.cursor ?? null, q.limit + 1],
                  )
                ).rows;
          return {
            items: rows.slice(0, q.limit),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );

  // The operation panel uses existing scoped content permissions, separately
  // gates method bodies, and never grants support access to trial conversations.
  app.get(
    "/v1/admin/solutions",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = z
        .object({
          ...page,
          state: z.enum(["draft", "published", "disabled"]).optional(),
        })
        .strict()
        .parse(req.query);
      return db.tx(
        async (tx) => {
          const scope = await scopePredicate(
            tx,
            req.principal,
            "admin.content.read",
            "s.tenant_id",
            "s.project_id",
          );
          const n = scope.values.length;
          const rows = (
            await tx.query(
              `SELECT s.id,s.tenant_id,s.project_id,s.version,s.state,s.definition->>'name' AS name,s.created_at,s.published_at,s.disabled_at
        FROM solution_versions s WHERE ${scope.sql} AND ($${n + 1}::uuid IS NULL OR s.id>$${n + 1})
         AND ($${n + 2}::text IS NULL OR s.state=$${n + 2}) ORDER BY s.id LIMIT $${n + 3}`,
              [...scope.values, q.cursor ?? null, q.state ?? null, q.limit + 1],
            )
          ).rows;
          return {
            items: rows.slice(0, q.limit),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/solutions/:id/body",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = idOf(req);
      return db.tx(
        async (tx) => {
          const row = (
            await tx.query("SELECT * FROM solution_versions WHERE id=$1", [id])
          ).rows[0];
          if (!row) throw solutionMissing();
          await permit(tx, req.principal, "admin.content.body.read", {
            tenant: row.tenant_id,
            project: row.project_id,
          });
          await audit(
            tx,
            req.principal,
            "admin.solution.body.read",
            id,
            "succeeded",
            {},
            row.tenant_id,
          );
          return {
            ...solutionDTO(row),
            definition_hash: row.definition_hash,
            templates: row.frozen,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/solutions/:id/disable",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = idOf(req),
        b = disable.parse(req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireSensitiveAdmin(tx, req.principal);
          const row = (
            await tx.query(
              "SELECT * FROM solution_versions WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!row) throw solutionMissing();
          await permit(tx, req.principal, "admin.content.quarantine", {
            tenant: row.tenant_id,
            project: row.project_id,
          });
          await replay(
            tx,
            req.principal.id,
            "admin.solution.disable:" + id,
            key(req),
            b,
            async () => {
              if (
                row.version !== b.expected_version ||
                row.state === "disabled"
              )
                throw new Problem(
                  409,
                  "SOLUTION_VERSION_CONFLICT",
                  "Refresh the current method version",
                );
              await tx.query(
                "UPDATE solution_versions SET state='disabled',disabled_at=clock_timestamp(),disable_reason=$2 WHERE id=$1",
                [id, b.reason],
              );
              await audit(
                tx,
                req.principal,
                "admin.solution.disable",
                id,
                "succeeded",
                { reason: b.reason },
                row.tenant_id,
              );
              return { id };
            },
          );
          return { id, state: "disabled" };
        },
        undefined,
        true,
      );
    },
  );
}
