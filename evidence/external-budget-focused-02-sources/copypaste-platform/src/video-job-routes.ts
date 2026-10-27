import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { key, replay } from "./access.js";
import { canonical, Problem, uuid } from "./lib.js";
import { GeneratedVideoJobs } from "./video-jobs.js";
import { readScope } from "./admin-directory.js";
import { providerAuthority, providerVisibility, modeOf } from "./provider-admin-access.js";
import { generatedVideoPageQuery, generatedVideoAdminQuery, generatedVideoCancelRequest, generatedVideoRecheckRequest } from "./video-job-model.js";

const scope = z.object({ tenant: uuid, project: uuid });
const jobScope = scope.extend({ job: uuid });

export function videoObservationSignature(secret: string, path: string, timestamp: string, body: unknown) {
  return "v1=" + createHmac("sha256", secret).update("POST\n" + path + "\n" + timestamp + "\n" + canonical(body)).digest("hex");
}

export function registerGeneratedVideoJobs(app: FastifyInstance, db: Database, catalog: Catalog, storage: Storage) {
  const jobs = new GeneratedVideoJobs(db, catalog, storage);
  const base = "/v1/tenants/:tenant/projects/:project/generated-video-jobs";
  app.get(base, { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = scope.parse(req.params), q = generatedVideoPageQuery.parse(req.query);
    return jobs.list(req.principal, p.tenant, p.project, q);
  });
  app.get(base + "/:job", { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = jobScope.parse(req.params);
    z.object({}).strict().parse(req.query);
    return jobs.read(req.principal, p.tenant, p.project, p.job);
  });
  app.post(base + "/:job/cancel", { preHandler: requireUser(db) }, async req => {
    const p = jobScope.parse(req.params), b = generatedVideoCancelRequest.parse(req.body);
    return jobs.cancel(req.principal, p.tenant, p.project, p.job, b.expected_revision, key(req));
  });
  app.get(base + "/:job/preview", { preHandler: requireUser(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = jobScope.parse(req.params);
    z.object({}).strict().parse(req.query);
    return jobs.preview(req.principal, p.tenant, p.project, p.job);
  });
  app.post("/v1/internal/video-operations/:operation/observations", { bodyLimit: 16384 }, async req => {
    const operation = uuid.parse((req.params as any).operation), path = "/v1/internal/video-operations/" + operation + "/observations";
    const secret = db.config.AI_VIDEO_WEBHOOK_SECRET, timestamp = req.headers["x-copypaste-video-timestamp"], signature = req.headers["x-copypaste-video-signature"];
    if (!secret || req.headers.cookie || req.headers.origin || typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp)
      || Math.abs(Date.now() - Number(timestamp)) > 300000 || typeof signature !== "string" || !/^v1=[a-f0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature), Buffer.from(videoObservationSignature(secret, path, timestamp, req.body))))
      throw new Problem(401, "VIDEO_CALLBACK_AUTHENTICATION_REQUIRED", "A current authenticated company observation is required");
    const job = (await db.control.query("SELECT id FROM ai_video_jobs WHERE operation_id=$1 AND data_mode=$2", [operation, modeOf(db)])).rows[0];
    if (!job) throw new Problem(404, "NOT_FOUND", "Video operation not found");
    return jobs.observe(job.id, req.body, "callback");
  });

  // Metadata and financial duties use the existing independent, scoped/MFA
  // permissions. None of these routes returns prompts, references or media.
  const adminBase = "/v1/admin/ai/video-jobs";
  app.get(adminBase, { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = generatedVideoAdminQuery.parse(req.query);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.ai.requests.read");
      const where = `j.data_mode=${s.arg(modeOf(db))} AND ${providerVisibility(s, "admin.ai.requests.read", "j")}`;
      const tenant = s.arg(q.tenant_id ?? null), project = s.arg(q.project_id ?? null), task = s.arg(q.task_id ?? null), cursor = s.arg(q.cursor ?? null);
      const rows = (await tx.query(`SELECT j.id,j.tenant_id,j.project_id,j.task_id,j.actor_id,j.data_mode,j.operation_id,j.state,j.progress,
        j.model_alias,j.capability_version_id,j.policy_version_id,j.created_at,j.observed_at,j.next_poll_at,j.finished_at,
        j.public_revision AS revision,j.usage_known,j.cancel_requested_at,j.error_code,j.delivery_state,j.delivery_error,
        CASE WHEN ${providerVisibility(s, "admin.ai.cost.read", "j")} THEN jsonb_build_object(
          'quoted_micros',j.quoted_micros::text,'actual_micros',j.actual_micros::text,'billable_seconds',j.billable_seconds::text,
          'rate_micros',j.rate_micros::text,'budget_violation',coalesce(j.actual_micros>j.quoted_micros,false)) END AS cost
        FROM ai_video_jobs j WHERE ${where} AND (${tenant}::uuid IS NULL OR j.tenant_id=${tenant})
        AND (${project}::uuid IS NULL OR j.project_id=${project}) AND (${task}::uuid IS NULL OR j.task_id=${task})
        AND (${cursor}::uuid IS NULL OR j.id<${cursor}) ORDER BY j.id DESC LIMIT ${s.arg(q.limit + 1)}`, s.values)).rows;
      await audit(tx, req.principal, "admin.ai.video_jobs.read", "list", "succeeded", { count: Math.min(rows.length, q.limit) });
      return { items: rows.slice(0, q.limit), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
    }, undefined, true);
  });
  app.post(adminBase + "/:job/recheck", { preHandler: requireAdmin(db) }, async req => {
    const id = uuid.parse((req.params as any).job), b = generatedVideoRecheckRequest.parse(req.body);
    const requestKey = key(req);
    return db.tx(async tx => {
      const hint = (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1 AND data_mode=$2", [id, modeOf(db)])).rows[0];
      if (!hint) throw new Problem(404, "NOT_FOUND", "Video operation not found");
      await providerAuthority(tx, req.principal, hint, "admin.ai.cost.reconcile");
      return replay(tx, req.principal.id, "admin.ai.video_job.recheck:" + id, requestKey, b, async () => {
        const job = (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (job.public_revision !== b.expected_revision) throw new Problem(409, "VIDEO_REVISION_CONFLICT", "Reload the video operation");
        await tx.query("UPDATE ai_video_jobs SET next_poll_at=clock_timestamp(),revision=revision+1,public_revision=public_revision+1 WHERE id=$1", [id]);
        await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'reconciled',$2)", [id, { action: "request_observation", admin_id: req.principal.id }]);
        await audit(tx, req.principal, "admin.ai.video_job.recheck", id, "succeeded", { operation_id: job.operation_id, reason: b.reason }, job.tenant_id);
        return { id, revision: job.public_revision + 1, requested: "observe_existing_operation", generation_submitted: false };
      });
    }, undefined, true);
  });
}
