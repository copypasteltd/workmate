import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, requireUser, type Principal } from "./auth.js";
import { key, projectAccess, replay, tenantAccess } from "./access.js";
import { scopePredicate } from "./admin-access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { assertReportSources } from "./analysis-reports.js";
import { assertTaskContentSources } from "./task-content-sources.js";

const decision = z.enum(["accepted", "changes_requested", "discarded"]);
const reviewInput = z.object({
  expected_version: z.number().int().positive(),
  expected_delivery_hash: z.string().regex(/^[a-f0-9]{64}$/),
  artifact_ids: z.array(uuid).min(1).optional(),
  decision,
  comment: z.string().max(5000).default(""),
}).strict();
const measurements = z.object({
  expected_version: z.number().int().positive(),
  baseline_minutes: z.number().int().min(0).max(525600).nullable(),
  human_minutes: z.number().int().min(0).max(525600).nullable(),
  manual_revisions: z.number().int().min(0).max(10000).nullable(),
}).strict();
const params = z.object({ tenant: uuid, project: uuid, task: uuid });
const base = "/v1/tenants/:tenant/projects/:project";

async function taskAccess(tx: Tx, p: Principal, tenant: string, id: string, project?: string, approve = false) {
  await tenantAccess(tx, p, tenant);
  const t = (await tx.query("SELECT * FROM tasks WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenant, id])).rows[0];
  if (!t || (project && t.project_id !== project)) throw new Problem(404, "NOT_FOUND", "Task not found");
  await projectAccess(tx, p, tenant, t.project_id, approve ? "approve" : "read");
  await assertReportSources(tx, t, false);
  await assertTaskContentSources(tx, t);
  return t;
}
async function snapshot(tx: Tx, t: any) {
  // Lock current asset heads against concurrent editing/moderation. Locking only
  // the task does not serialize a separate asset-version publication.
  await tx.query(`SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
    WHERE a.tenant_id=$1 AND a.project_id=$2 AND v.metadata->>'task_id'=$3 ORDER BY a.id FOR SHARE OF a`, [t.tenant_id, t.project_id, t.id]);
  return (await tx.query("SELECT business_delivery_snapshot($1) AS snapshot", [t.id])).rows[0].snapshot;
}
export { taskAccess as deliveryTaskAccess, snapshot as deliverySnapshot };
export async function recordDeliveryReview(tx: Tx, p: Principal, t: any, input: {
  expected_version?: number; expected_delivery_hash?: string; artifact_ids?: string[]; decision: z.infer<typeof decision>; comment?: string;
}) {
  if (t.status !== "succeeded" || t.mode === "plan" || (input.expected_version !== undefined && t.version !== input.expected_version))
    throw new Problem(409, "VERSION_CONFLICT", "Refresh and review the current completed delivery");
  const delivery = await snapshot(tx, t);
  if (input.expected_delivery_hash && hash(canonical(delivery)) !== input.expected_delivery_hash)
    throw new Problem(409, "DELIVERY_VERSION_CONFLICT", "The delivery changed; reload and review its current version");
  const all: string[] = delivery?.artifacts.map((a: any) => a.id) ?? [];
  const selected = input.artifact_ids ?? all;
  if (new Set(selected).size !== selected.length || selected.some(id => !all.includes(id)))
    throw new Problem(409, "DELIVERY_VERSION_CONFLICT", "Choose only current artifacts belonging to this delivery");
  if (!all.length && !delivery?.output_sha256)
    throw new Problem(409, "DELIVERY_MISSING", "This task has no current delivery to review");
  const r = (await tx.query(`INSERT INTO delivery_reviews(tenant_id,project_id,task_id,reviewer_id,task_version,decision,comment,delivery_snapshot,artifact_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,task_id,decision,created_at`,
    [t.tenant_id, t.project_id, t.id, p.id, t.version, input.decision, input.comment ?? "", delivery, selected])).rows[0];
  await tx.query("UPDATE tasks SET acceptance=CASE business_review_state(id) WHEN 'pending_review' THEN 'pending' ELSE business_review_state(id) END,version=version+1,updated_at=now() WHERE id=$1", [t.id]);
  await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'delivery.reviewed',$3)", [t.tenant_id, t.id, { review_id: r.id, decision: r.decision, by: p.id }]);
  await audit(tx, p, "delivery.review", t.id, "succeeded", { review_id: r.id, decision: r.decision }, t.tenant_id);
  return { ...r, created_at: new Date(r.created_at).toISOString() };
}

const intervalInput = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  data_mode: z.enum(["simulated", "configured_services"]).optional(),
  tenant_id: uuid.optional(), project_id: uuid.optional(),
}).strict();
function interval(query: unknown) {
  const q = intervalInput.parse(query);
  const to = q.to ? new Date(q.to) : new Date(), from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400000);
  if (from >= to || to.getTime() - from.getTime() > 366 * 86400000)
    throw new Problem(400, "QUALITY_INTERVAL_INVALID", "Choose an increasing interval of at most 366 days");
  return { ...q, from: from.toISOString(), to: to.toISOString() };
}
async function summary(tx: Tx, where: string, values: unknown[], q: ReturnType<typeof interval>) {
  const offset = values.length;
  const add = (n: number) => "$" + (offset + n);
  // Include failures and cancellations in the same task-created cohort. A
  // known observed cost is not a complete settled cost while any hold remains.
  const result = (await tx.query(`WITH cohort AS MATERIALIZED (
    SELECT t.*,r.status AS cost_status,
      CASE WHEN t.status='succeeded' AND t.mode<>'plan' THEN business_review_state(t.id) ELSE NULL END AS review_state,
      greatest(t.charged_micros,t.accrued_micros) AS known_cost,
      business_quality_sources_available(t.id) AS sources_available,
      (business_delivery_snapshot(t.id)->>'output_sha256' IS NOT NULL OR jsonb_array_length(business_delivery_snapshot(t.id)->'artifacts')>0) AS has_delivery
    FROM tasks t LEFT JOIN reservations r ON r.task_id=t.id
    WHERE ${where} AND t.content_state='active' AND t.created_at>=${add(1)}::timestamptz AND t.created_at<${add(2)}::timestamptz
      AND (${add(3)}::text IS NULL OR t.data_mode=${add(3)})
  ), measured AS (
    SELECT c.id,m.baseline_minutes,m.human_minutes,m.manual_revisions FROM cohort c
    LEFT JOIN LATERAL(SELECT * FROM task_quality_measurements q WHERE q.task_id=c.id AND q.erased_at IS NULL
      ORDER BY q.task_version DESC LIMIT 1) m ON c.sources_available
  ), reuse AS (
    SELECT DISTINCT source.id AS source_id,destination.id AS destination_id,destination.status
    FROM cohort source JOIN asset_versions v ON v.metadata->>'task_id'=source.id::text AND v.erased_at IS NULL
    JOIN assets a ON a.id=v.asset_id AND a.state='active' AND a.retention_expires_at>statement_timestamp()
    JOIN task_source_reads reads ON reads.asset_version_id=v.id AND reads.kind IN('asset_version','cloud_reference')
    JOIN tasks destination ON destination.id=reads.task_id AND destination.id<>source.id AND destination.content_state='active'
      AND destination.tenant_id=source.tenant_id AND destination.project_id=source.project_id
    WHERE source.sources_available AND business_quality_sources_available(destination.id)
  ) SELECT
    (SELECT count(*)::int FROM cohort) AS tasks,
    (SELECT count(*)::int FROM cohort WHERE status='succeeded') AS technical_successes,
    (SELECT count(*)::int FROM cohort WHERE status='failed') AS failed,
    (SELECT count(*)::int FROM cohort WHERE status='cancelled') AS cancelled,
    (SELECT count(*)::int FROM cohort WHERE status='succeeded' AND mode<>'plan' AND sources_available AND has_delivery) AS reviewable,
    (SELECT count(*)::int FROM cohort WHERE review_state='accepted' AND sources_available) AS accepted,
    (SELECT count(*)::int FROM cohort WHERE review_state='changes_requested' AND sources_available) AS changes_requested,
    (SELECT count(*)::int FROM delivery_reviews r JOIN cohort c ON c.id=r.task_id WHERE r.decision='changes_requested' AND r.erased_at IS NULL AND c.sources_available) AS revision_requests,
    (SELECT count(*)::int FROM cohort WHERE review_state='discarded' AND sources_available) AS discarded,
    (SELECT count(*)::int FROM cohort WHERE review_state='pending_review' AND sources_available AND has_delivery) AS pending_review,
    (SELECT count(*)::int FROM cohort WHERE NOT sources_available) AS sources_unavailable,
    (SELECT coalesce(sum(known_cost),0)::text FROM cohort) AS known_cost_micros,
    (SELECT coalesce(sum(known_cost),0)::text FROM cohort WHERE status IN('failed','cancelled')) AS failed_cancelled_cost_micros,
    (SELECT count(*)::int FROM cohort WHERE cost_status IS DISTINCT FROM 'settled' AND cost_status IS DISTINCT FROM 'released') AS incomplete_cost_tasks,
    (SELECT count(*)::int FROM cohort WHERE status='reconciling' OR cost_status='reconciling') AS uncertain_cost_tasks,
    (SELECT count(human_minutes)::int FROM measured) AS human_minutes_coverage,
    (SELECT count(baseline_minutes)::int FROM measured) AS baseline_minutes_coverage,
    (SELECT count(manual_revisions)::int FROM measured) AS manual_revisions_coverage,
    (SELECT sum(human_minutes)::text FROM measured) AS human_minutes,
    (SELECT sum(baseline_minutes)::text FROM measured) AS baseline_minutes,
    (SELECT sum(manual_revisions)::text FROM measured) AS manual_revisions,
    (SELECT count(*)::int FROM reuse) AS observed_reuse_pairs,
    (SELECT count(*)::int FROM reuse WHERE status='succeeded') AS successful_reuse_pairs,
    (SELECT count(*)::int FROM cohort WHERE data_mode='simulated') AS simulated_tasks,
    (SELECT count(*)::int FROM cohort WHERE data_mode='configured_services') AS configured_services_tasks`,
    [...values, q.from, q.to, q.data_mode ?? null])).rows[0];
  return { cohort: { from: q.from, to: q.to, clock: "task_created_at", data_mode: q.data_mode ?? "all" }, currency: "HKD", ...result,
    acceptance_rate: result.reviewable ? result.accepted / result.reviewable : null,
    complete_cost_per_accepted_micros: result.accepted && !result.incomplete_cost_tasks ? (BigInt(result.known_cost_micros) / BigInt(result.accepted)).toString() : null,
    measurements_source: "customer_reported", reuse_source: "observed_fixed_asset_reads", cost_basis: "company_task_usage_before_refunds_excludes_external_and_labor_cost", roi: null };
}

export function registerBusinessQuality(app: FastifyInstance, db: Database) {
  app.get(base + "/tasks/:task/quality", { preHandler: requireUser(db) }, async req => {
    const p = params.parse(req.params);
    return db.tx(async tx => {
      const t = await taskAccess(tx, req.principal, p.tenant, p.task, p.project);
      const delivery = await snapshot(tx, t);
      let canReview = false;
      try { await projectAccess(tx, req.principal, p.tenant, p.project, "approve"); canReview = true; }
      catch (error) { if (!(error instanceof Problem) || error.status !== 403) throw error; }
      const history = (await tx.query(`SELECT id,decision,task_version,created_at,erased_at,
        delivery_snapshot=$2::jsonb AND erased_at IS NULL AS current_delivery,
        CASE WHEN delivery_snapshot=$2::jsonb AND erased_at IS NULL THEN comment ELSE NULL END AS comment,
        CASE WHEN delivery_snapshot=$2::jsonb AND erased_at IS NULL THEN artifact_ids ELSE NULL END AS artifact_ids
        FROM delivery_reviews WHERE task_id=$1 ORDER BY task_version DESC LIMIT 50`, [t.id, delivery])).rows;
      const measured = (await tx.query("SELECT id,baseline_minutes,human_minutes,manual_revisions,created_at,task_version FROM task_quality_measurements WHERE task_id=$1 AND erased_at IS NULL ORDER BY task_version DESC LIMIT 1", [t.id])).rows[0] ?? null;
      return { task_id: t.id, task_version: t.version, technical_status: t.status,
        review_state: (await tx.query("SELECT business_review_state($1) AS state", [t.id])).rows[0].state,
        delivery, delivery_hash: hash(canonical(delivery)), can_review: canReview && t.status === "succeeded" && t.mode !== "plan" && (!!delivery?.output_sha256 || delivery?.artifacts.length > 0),
        can_measure: canReview && ["succeeded", "failed", "cancelled"].includes(t.status),
        measurements_source: "customer_reported", measurements: measured, reviews: history,
        history_truncated: history.length === 50 };
    }, p.tenant);
  });
  app.post(base + "/tasks/:task/reviews", { preHandler: requireUser(db) }, async (req, reply) => {
    const p = params.parse(req.params), input = reviewInput.parse(req.body), requestKey = key(req);
    const result = await db.tx(async tx => {
      const t = await taskAccess(tx, req.principal, p.tenant, p.task, p.project, true);
      return replay(tx, req.principal.id, "delivery.review:" + t.id, requestKey, input, () => recordDeliveryReview(tx, req.principal, t, input));
    }, p.tenant);
    return reply.code(201).send(result);
  });
  app.post("/v1/tasks/:task_id/reviews", { preHandler: requireUser(db) }, async (req, reply) => {
    const tenant = uuid.parse(req.headers["x-tenant-id"]), id = uuid.parse((req.params as any).task_id);
    const input = z.object({ artifact_ids: z.array(uuid).min(1), decision, comment: z.string().min(1).max(5000).optional() }).strict().parse(req.body);
    const requestKey = key(req);
    const expectedDelivery = req.headers["x-delivery-sha256"] === undefined ? undefined : z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers["x-delivery-sha256"]);
    const expected = req.headers["if-match"] === undefined ? undefined : Number(z.string().regex(/^"[1-9][0-9]*"$/).parse(req.headers["if-match"]).slice(1, -1));
    const result = await db.tx(async tx => {
      const t = await taskAccess(tx, req.principal, tenant, id, undefined, true);
      return replay(tx, req.principal.id, "delivery.review:" + id, requestKey, { ...input, ...(expected === undefined ? {} : { expected_version: expected }), ...(expectedDelivery === undefined ? {} : { expected_delivery_hash: expectedDelivery }) },
        () => recordDeliveryReview(tx, req.principal, t, { ...input, expected_version: expected, expected_delivery_hash: expectedDelivery }));
    }, tenant);
    return reply.code(201).send(result);
  });
  app.post(base + "/tasks/:task/quality/measurements", { preHandler: requireUser(db) }, async (req, reply) => {
    const p = params.parse(req.params), input = measurements.parse(req.body), requestKey = key(req);
    const result = await db.tx(async tx => {
      const t = await taskAccess(tx, req.principal, p.tenant, p.task, p.project, true);
      return replay(tx, req.principal.id, "delivery.measure:" + t.id, requestKey, input, async () => {
        if (input.expected_version !== t.version || !["succeeded", "failed", "cancelled"].includes(t.status))
          throw new Problem(409, "VERSION_CONFLICT", "Refresh the completed task before recording human effort");
        const m = (await tx.query(`INSERT INTO task_quality_measurements(tenant_id,project_id,task_id,reporter_id,task_version,baseline_minutes,human_minutes,manual_revisions)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,task_id,task_version,baseline_minutes,human_minutes,manual_revisions,created_at`,
          [p.tenant, p.project, t.id, req.principal.id, t.version, input.baseline_minutes, input.human_minutes, input.manual_revisions])).rows[0];
        await tx.query("UPDATE tasks SET version=version+1,updated_at=now() WHERE id=$1", [t.id]);
        await audit(tx, req.principal, "delivery.measure", t.id, "succeeded", { measurement_id: m.id, source: "customer_reported" }, p.tenant);
        return m;
      });
    }, p.tenant);
    return reply.code(201).send(result);
  });
  app.get(base + "/quality", { preHandler: requireUser(db) }, async req => {
    const p = params.omit({ task: true }).parse(req.params), q = interval(req.query);
    if (q.tenant_id || q.project_id) throw new Problem(400, "QUALITY_SCOPE_INVALID", "Use the project identified in this path");
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, p.tenant, p.project);
      return summary(tx, "t.tenant_id=$1 AND t.project_id=$2", [p.tenant, p.project], q);
    }, p.tenant);
  });
  app.get("/v1/admin/quality", { preHandler: requireAdmin(db) }, async req => {
    const q = interval(req.query);
    return db.tx(async tx => {
      const scope = await scopePredicate(tx, req.principal, "admin.usage.read", "t.tenant_id", "t.project_id");
      if (!scope.values[0] && !(scope.values[1] as string[]).length && !(scope.values[2] as string[]).length)
        throw new Problem(403, "ADMIN_FORBIDDEN", "No authorized usage scope");
      const result = await summary(tx, scope.sql + " AND ($6::uuid IS NULL OR t.tenant_id=$6) AND ($7::uuid IS NULL OR t.project_id=$7)", [...scope.values, q.tenant_id ?? null, q.project_id ?? null], q);
      await audit(tx, req.principal, "admin.quality.read", undefined, "succeeded", { tenant_id: q.tenant_id, project_id: q.project_id, from: q.from, to: q.to });
      return result;
    }, undefined, true);
  });
}
