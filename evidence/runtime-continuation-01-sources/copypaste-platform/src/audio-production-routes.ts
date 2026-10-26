import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { requireUser, requireAdmin, audit } from "./auth.js";
import { key } from "./access.js";
import { uuid, Problem } from "./lib.js";
import { readScope } from "./admin-directory.js";
import { providerVisibility, providerAuthority, modeOf } from "./provider-admin-access.js";
import { AudioProduction } from "./audio-production.js";
import { audioListQuery, subtitleEdit } from "./audio-production-model.js";
import { audioAuthorizationConfirm, audioAuthorizationDecision } from "./audio-authorizations.js";

export function registerAudioProduction(app: FastifyInstance, db: Database, catalog: Catalog, storage: Storage) {
  const jobs = new AudioProduction(db, catalog, storage), scope = z.object({ tenant: uuid, project: uuid, job: uuid });
  const base = "/v1/tenants/:tenant/projects/:project/audio-jobs";
  const authorizations = "/v1/tenants/:tenant/projects/:project/audio-authorizations";
  const authorizationScope = z.object({ tenant: uuid, project: uuid, authorization: uuid });
  app.get(authorizations, { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = authorizationScope.omit({ authorization: true }).parse(req.params);
    return jobs.authorizations.list(req.principal, p.tenant, p.project, audioListQuery.parse(req.query));
  });
  app.get(authorizations + "/:authorization", { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query);
    const p = authorizationScope.parse(req.params);
    return jobs.authorizations.read(req.principal, p.tenant, p.project, p.authorization);
  });
  for (const action of ["confirm", "decline", "withdraw"] as const) {
    app.post(authorizations + "/:authorization/" + action, { preHandler: requireUser(db) }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const p = authorizationScope.parse(req.params);
      const b = (action === "confirm" ? audioAuthorizationConfirm : audioAuthorizationDecision).parse(req.body);
      return jobs.authorizations.decide(req.principal, p.tenant, p.project, p.authorization, action, b, key(req));
    });
  }
  app.get(base, { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = scope.omit({ job: true }).parse(req.params);
    return jobs.list(req.principal, p.tenant, p.project, audioListQuery.parse(req.query));
  });
  app.get(base + "/:job", { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query);
    const p = scope.parse(req.params); return jobs.read(req.principal, p.tenant, p.project, p.job);
  });
  app.get(base + "/:job/preview", { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = scope.parse(req.params), q = z.object({ kind: z.enum(["audio", "transcript", "raw_response", "srt", "vtt"]), revision: z.coerce.number().int().min(0).optional() }).strict().parse(req.query);
    return jobs.preview(req.principal, p.tenant, p.project, p.job, q.kind, q.revision);
  });
  app.post(base + "/:job/subtitles", { preHandler: requireUser(db) }, async req => {
    const p = scope.parse(req.params); return jobs.edit(req.principal, p.tenant, p.project, p.job, subtitleEdit.parse(req.body), key(req));
  });
  app.post(base + "/:job/cancel", { preHandler: requireUser(db) }, async req => {
    const p = scope.parse(req.params), b = z.object({ expected_revision: z.number().int().positive() }).strict().parse(req.body);
    return jobs.cancel(req.principal, p.tenant, p.project, p.job, b.expected_revision, key(req));
  });
  app.get("/v1/admin/ai/audio-jobs", { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = audioListQuery.extend({ tenant_id: uuid.optional(), project_id: uuid.optional() }).parse(req.query);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.ai.requests.read");
      const where = `j.data_mode=${s.arg(modeOf(db))} AND ${providerVisibility(s, "admin.ai.requests.read", "j")}`;
      const tenant = s.arg(q.tenant_id ?? null), project = s.arg(q.project_id ?? null), task = s.arg(q.task_id ?? null), cursor = s.arg(q.cursor ?? null);
      const rows = (await tx.query(`SELECT j.id,j.tenant_id,j.project_id,j.task_id,j.actor_id,j.data_mode,j.kind,j.state,j.operation_id,
        j.model_alias,j.capability_version_id,j.policy_version_id,j.revision,j.subtitle_revision,j.delivery_state,j.usage_known,j.authorization_id,
        j.cancel_requested_at,j.error_code,j.created_at,j.dispatched_at,j.finished_at,
        CASE WHEN ${providerVisibility(s, "admin.ai.cost.read", "j")} THEN jsonb_build_object('quoted_micros',j.quoted_micros::text,
          'actual_micros',j.actual_micros::text,'quoted_units',j.quoted_units::text,'billable_units',j.billable_units::text,
          'pricing_unit',j.pricing_unit,'rate_micros',j.rate_micros::text,'supplier_cost_micros',NULL) END AS cost
        FROM ai_audio_jobs j WHERE ${where} AND (${tenant}::uuid IS NULL OR j.tenant_id=${tenant})
        AND (${project}::uuid IS NULL OR j.project_id=${project}) AND (${task}::uuid IS NULL OR j.task_id=${task})
        AND (${cursor}::uuid IS NULL OR j.id<${cursor}) ORDER BY j.id DESC LIMIT ${s.arg(q.limit + 1)}`, s.values)).rows;
      // Prompts, rights attestations, original audio and transcript bodies stay
      // under the separately scoped, audited existing content/asset controls.
      await audit(tx, req.principal, "admin.ai.audio_jobs.read", "list", "succeeded", { count: Math.min(rows.length, q.limit) });
      return { items: rows.slice(0, q.limit), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
    }, undefined, true);
  });
  app.get("/v1/admin/ai/audio-jobs/:job/content", { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query);
    const id = z.object({ job: uuid }).parse(req.params).job;
    return db.tx(async tx => {
      const row = (await tx.query(`SELECT j.*,t.content_state FROM ai_audio_jobs j JOIN tasks t ON t.id=j.task_id
        WHERE j.id=$1 AND j.data_mode=$2`, [id, modeOf(db)])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Audio operation not found");
      await providerAuthority(tx, req.principal, row, "admin.ai.requests.read");
      await providerAuthority(tx, req.principal, row, "admin.content.body.read");
      if (row.erased_at || row.content_state === "deleted") throw new Problem(410, "CONTENT_DELETED", "Deleted audio request is unavailable");
      await audit(tx, req.principal, "admin.audio.content.read", id, "succeeded", { specification_hash: row.specification_hash }, row.tenant_id);
      return { id, specification: row.specification, specification_hash: row.specification_hash,
        authorization: row.authorization_id ? (await tx.query(`SELECT id,state,revision,confirmed_by,confirmed_session_id,confirmed_at,
          confirmation,confirmation_hash,expires_at,decided_at,decision_reason FROM audio_authorizations WHERE id=$1`, [row.authorization_id])).rows[0] : null,
        authorization_basis: row.authorization_id ? "independent_customer_session" : "legacy_model_declaration",
        source: row.source_asset_id ? { asset_id: row.source_asset_id, version: row.source_version, sha256: row.source_sha256 } : null };
    }, undefined, true);
  });
  app.get("/v1/admin/ai/audio-authorizations", { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = audioListQuery.extend({ tenant_id: uuid.optional(), project_id: uuid.optional() }).parse(req.query);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.ai.requests.read");
      const where = `a.data_mode=${s.arg(modeOf(db))} AND ${providerVisibility(s, "admin.ai.requests.read", "a")}`;
      const tenant = s.arg(q.tenant_id ?? null), project = s.arg(q.project_id ?? null), task = s.arg(q.task_id ?? null), cursor = s.arg(q.cursor ?? null);
      const rows = (await tx.query(`SELECT a.id,a.tenant_id,a.project_id,a.task_id,a.actor_id,a.data_mode,a.state,a.revision,
        a.specification_hash,a.capability_version_id,a.model_alias,a.confirmation_hash,a.created_at,a.expires_at,
        a.confirmed_at,a.decided_at,a.decision_reason,
        CASE WHEN ${providerVisibility(s, "admin.ai.cost.read", "a")} THEN jsonb_build_object('quoted_micros',a.quoted_micros::text,
          'quoted_units',a.quoted_units::text,'rate_micros',a.rate_micros::text) END AS cost
        FROM audio_authorizations a WHERE ${where} AND (${tenant}::uuid IS NULL OR a.tenant_id=${tenant})
        AND (${project}::uuid IS NULL OR a.project_id=${project}) AND (${task}::uuid IS NULL OR a.task_id=${task})
        AND (${cursor}::uuid IS NULL OR a.id<${cursor}) ORDER BY a.id DESC LIMIT ${s.arg(q.limit + 1)}`, s.values)).rows;
      await audit(tx, req.principal, "admin.ai.audio_authorizations.read", "list", "succeeded", { count: Math.min(rows.length, q.limit) });
      return { items: rows.slice(0, q.limit), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
    }, undefined, true);
  });
  app.get("/v1/admin/ai/audio-authorizations/:authorization/content", { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query);
    const id = z.object({ authorization: uuid }).parse(req.params).authorization;
    return db.tx(async tx => {
      const row = (await tx.query(`SELECT a.*,t.content_state FROM audio_authorizations a JOIN tasks t ON t.id=a.task_id
        WHERE a.id=$1 AND a.data_mode=$2`, [id, modeOf(db)])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Audio authorization not found");
      await providerAuthority(tx, req.principal, row, "admin.ai.requests.read");
      await providerAuthority(tx, req.principal, row, "admin.content.body.read");
      if (row.erased_at || row.content_state !== "active") throw new Problem(410, "CONTENT_DELETED", "Removed audio authorization is unavailable");
      await audit(tx, req.principal, "admin.audio.authorization.content.read", id, "succeeded",
        { specification_hash: row.specification_hash, confirmation_hash: row.confirmation_hash }, row.tenant_id);
      return { id, proposal: row.specification, specification_hash: row.specification_hash,
        confirmation: row.confirmation, confirmation_hash: row.confirmation_hash,
        confirmed_by: row.confirmed_by, confirmed_session_id: row.confirmed_session_id, confirmed_at: row.confirmed_at,
        state: row.state, revision: row.revision, events: (await tx.query(`SELECT state,revision,actor_id,created_at,
          specification_hash,confirmation_hash FROM audio_authorization_events WHERE authorization_id=$1 ORDER BY revision`, [id])).rows };
    }, undefined, true);
  });
}
