import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireUser, type Principal } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { lockMemberships } from "./membership.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { saveAsset, type Storage } from "./storage.js";
import { getAgentVersion, resolveWorkContext, type WorkContext } from "./persistent-work.js";
import { enqueueTask } from "./task-service.js";
import { taskCapabilities, runtimeSelection } from "./capability-bindings.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { requestTaskCancellation } from "./task-control.js";
import { effectivePlan } from "./plans.js";
import { compareGeo, geoAnalysis, geoDigest, geoManual, geoPrompt, geoProtocol, geoSpec } from "./geo-model.js";

const root = "/v1/tenants/:tenant/projects/:project/geo";
const params = z.object({ tenant: uuid, project: uuid });
const rowParams = params.extend({ id: uuid });
const budget = z.string().regex(/^[1-9]\d{0,11}$/).refine(v => BigInt(v) <= 100000000000n);
const create = z.object({ spec: geoSpec, previous_id: uuid.optional(), expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
  .refine(v => !!v.previous_id === !!v.expected_sha256, "A new version must name its reviewed previous hash");
const runInput = z.object({ name: z.string().trim().min(1).max(160), per_question_budget_micros: budget }).strict();
const limits = ["API observations use Codex with the company internal Responses gateway, not a consumer product.",
  "Requested region is prompt context; provider processing location is unknown.", "The API harness disables retrieval and business tools.",
  "Model labels are requested aliases, not independently verified resolved provider models.", "This is a bounded sample, not a global ranking or causal claim."];

async function write(tx: Tx, actor: Principal, tenant: string, project: string) {
  await lockUserAuthorities(tx, [actor.id]);
  await lockMemberships(tx, tenant);
  await projectAccess(tx, actor, tenant, project, "write");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["geo:" + project]);
}
async function own(tx: Tx, table: "geo_experiments" | "geo_runs", id: string, actor: Principal, tenant: string, project: string) {
  const row = (await tx.query(`SELECT * FROM ${table} WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND private_owner=$4
    AND content_state='active' AND retention_expires_at>clock_timestamp() FOR SHARE`, [id, tenant, project, actor.id])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "GEO observation not found");
  return row;
}
async function quota(tx: Tx, actor: Principal, tenant: string) {
  const plan = await effectivePlan(tx, tenant, actor.id);
  const active = (await tx.query("SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1 AND created_by=$2 AND status IN('queued','running','paused','awaiting_approval','reconciling','needs_input')", [tenant, actor.id])).rows[0].n;
  return { active, max_active_tasks: plan.body.max_active_tasks, available: Math.max(0, plan.body.max_active_tasks - active), max_question_budget_micros: String(plan.body.max_task_budget_micros) };
}
async function authorizeRead(tx: Tx, actor: Principal, tenant: string, project: string) {
  await lockUserAuthorities(tx, [actor.id]);
  await lockMemberships(tx, tenant);
  await projectAccess(tx, actor, tenant, project);
}
const receipt = (r: any) => ({ id: r.id, version: r.version, sha256: r.sha256, experiment_id: r.experiment_id, surface: r.surface });
async function freezeHarness(tx: Tx, catalog: Catalog, actor: Principal, tenant: string, project: string, agentId: string) {
  const agent = await getAgentVersion(tx, project, agentId, undefined, true);
  if (agent.body.brand) throw new Problem(422, "GEO_UNBRANDED_AGENT_REQUIRED", "Choose an Agent without an attached brand to avoid priming the measured aliases");
  const context: WorkContext = { agent_id: agent.id, agent_version: agent.bound_version, role_hash: agent.body.role_hash, memories: [], history: [] };
  await resolveWorkContext(tx, actor, tenant, project, context);
  const capability = (await tx.query("SELECT id,body FROM internal_capability_versions WHERE id=ANY($1::uuid[]) AND profile_key='internal-text-v1' AND ready AND NOT revoked", [agent.body.capability_version_ids])).rows;
  if (capability.length !== 1) throw new Problem(409, "GEO_MODEL_UNAVAILABLE", "A single enabled internal text capability is required");
  return { context, harness: { protocol: geoProtocol, agent_definition_sha256: geoDigest(agent.body),
    runtime_profile_id: agent.runtime_profile_id, runtime_version: agent.body.runtime_version, role_key: agent.role_key,
    role_hash: agent.body.role_hash, skills: agent.body.skills, text_capability_id: capability[0].id,
    requested_model_alias: capability[0].body.model_alias, reasoning_effort: capability[0].body.reasoning_effort,
    gateway_fingerprint: capability[0].body.gateway_fingerprint, data_mode: capability[0].body.data_mode,
    retrieval: "disabled", business_tools: [], memory_ids: [], history_ids: [], brand: null, provider_processing_region: "unknown" } };
}
async function answerFile(tx: Tx, storage: Storage, sample: any, actor: Principal, answer: string, observed: Date) {
  const analysis = geoAnalysis(answer, sample.brands);
  const asset = await saveAsset(tx, storage, { tenant: sample.tenant_id, project: sample.project_id, user: actor.id,
    privateOwner: actor.id, name: sample.name + ".txt", kind: "report", mime: "text/plain", bytes: Buffer.from(answer, "utf8"),
    metadata: { geo_sample_id: sample.id, ...(sample.task_id ? { task_id: sample.task_id } : {}), provenance: sample.task_id ? "actual_task_output" : "user_supplied_consumer_answer" } });
  await tx.query(`UPDATE geo_samples SET asset_version_id=$2,answer_sha256=$3,analysis=$4,observed_at=$5,captured_at=clock_timestamp() WHERE id=$1 AND asset_version_id IS NULL`,
    [sample.id, asset.version.id, analysis.answer_sha256, analysis, observed]);
}
async function readRun(tx: Tx, actor: Principal, tenant: string, project: string, id: string, storage?: Storage) {
  const run = await own(tx, "geo_runs", id, actor, tenant, project);
  const experiment = await own(tx, "geo_experiments", run.experiment_id, actor, tenant, project);
  await tx.query(`SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id JOIN geo_samples s ON s.asset_version_id=v.id
    WHERE s.run_id=$1 ORDER BY a.id FOR SHARE OF a`, [id]);
  const rows = (await tx.query(`SELECT s.*,t.status AS task_status,t.error_code,t.charged_micros,t.budget_micros,t.cancel_requested,t.updated_at AS task_updated_at,
    a.id AS asset_id,v.version AS asset_version,v.sha256 AS file_sha256,v.storage_key FROM geo_samples s LEFT JOIN tasks t ON t.id=s.task_id
    LEFT JOIN asset_versions v ON v.id=s.asset_version_id LEFT JOIN assets a ON a.id=v.asset_id WHERE s.run_id=$1 ORDER BY s.question_key FOR SHARE OF s`, [id])).rows;
  const samples = [];
  for (const r of rows) {
    if (r.content_state !== "active" || !(await tx.query("SELECT geo_sample_source_manifest($1,$2,$3) AS refs", [r.id, tenant, project])).rows[0].refs)
      throw new Problem(404, "GEO_SOURCE_UNAVAILABLE", "An observation source is no longer retained or available");
    if (r.task_id) await assertTaskContentSources(tx, { id: r.task_id });
    let answer: string | undefined;
    if (storage && r.asset_version_id) {
      const bytes = await storage.get(r.storage_key);
      if (hash(bytes) !== r.answer_sha256 || r.file_sha256 !== r.answer_sha256) throw new Problem(409, "GEO_ANSWER_INTEGRITY", "Retained answer integrity mismatch");
      answer = bytes.toString("utf8");
    }
    samples.push({ id: r.id, question_key: r.question_key, question: r.body.question, task_id: r.task_id, task_status: r.task_status,
      state: r.asset_version_id ? "captured" : r.task_status ?? "missing", error_code: r.error_code,
      answer_sha256: r.answer_sha256, analysis: r.analysis, observed_at: r.observed_at, captured_at: r.captured_at,
      asset_id: r.asset_id, asset_version_id: r.asset_version_id, asset_version: r.asset_version, answer,
      budget_micros: r.task_id ? String(r.budget_micros) : null, confirmed_cost_micros: r.task_id ? String(r.charged_micros) : null,
      cost_state: !r.task_id ? "no_api_request" : r.task_status === "reconciling" ? "requires_reconciliation" : ["succeeded", "failed", "cancelled"].includes(r.task_status) ? "see_task_receipt" : "in_progress" });
  }
  return { id: run.id, name: run.name, experiment_id: experiment.id, experiment_version: experiment.version,
    surface: run.surface, config_hash: run.config_hash, effective_config: run.body.effective_config, created_at: run.created_at,
    questions: experiment.body.spec.questions, brands: experiment.body.spec.brands, samples,
    progress: { captured: samples.filter(s => s.state === "captured").length, total: experiment.body.spec.questions.length },
    limitations: [...limits, ...(run.surface === "consumer_manual" ? ["Consumer answers and their metadata are user supplied and are not provider-verified."] : [])] };
}

export function registerGeoObservations(app: FastifyInstance, db: Database, catalog: Catalog, storage: Storage) {
  app.get(root + "/experiments", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = params.parse(req.params);
    const q = z.object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict().parse(req.query);
    return db.tx(async tx => {
      await authorizeRead(tx, req.principal, tenant, project);
      const items = (await tx.query(`SELECT * FROM geo_experiments WHERE tenant_id=$1 AND project_id=$2 AND private_owner=$3 AND content_state='active'
        AND retention_expires_at>clock_timestamp() AND ($4::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM geo_experiments WHERE id=$4 AND private_owner=$3 AND project_id=$2))
        ORDER BY created_at DESC,id DESC LIMIT $5`, [tenant, project, req.principal.id, q.cursor ?? null, q.limit + 1])).rows;
      let canWrite = true;
      try { await projectAccess(tx, req.principal, tenant, project, "write"); } catch (e) { if (e instanceof Problem && e.status === 403) canWrite = false; else throw e; }
      return { items: items.slice(0, q.limit), next_cursor: items.length > q.limit ? items[q.limit - 1].id : null, can_write: canWrite, quota: await quota(tx, req.principal, tenant) };
    }, tenant, true, req.principal.id);
  });
  app.post(root + "/experiments", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project } = params.parse(req.params), b = create.parse(req.body);
    const result = await db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      const previous = b.previous_id ? await own(tx, "geo_experiments", b.previous_id, req.principal, tenant, project) : null;
      return replay(tx, req.principal.id, "geo.experiment:" + project, key(req), b, async () => {
        if (previous && previous.sha256 !== b.expected_sha256) throw new Problem(409, "GEO_VERSION_CHANGED", "Review the previous configuration hash first");
        if (previous && (await tx.query("SELECT max(version) AS version FROM geo_experiments WHERE series_id=$1", [previous.series_id])).rows[0].version !== previous.version)
          throw new Problem(409, "GEO_VERSION_CHANGED", "Create the next version from the latest configuration");
        if ((await tx.query("SELECT count(*)::int AS n FROM geo_experiments WHERE project_id=$1 AND private_owner=$2 AND content_state<>'deleted'", [project, req.principal.id])).rows[0].n >= 500)
          throw new Problem(409, "GEO_EXPERIMENT_LIMIT", "Remove an unused configuration before creating more");
        const frozen = await freezeHarness(tx, catalog, req.principal, tenant, project, b.spec.agent_id);
        const body = { schema: 1, spec: b.spec, ...frozen }, id = randomUUID();
        const row = (await tx.query(`INSERT INTO geo_experiments(id,tenant_id,project_id,name,series_id,version,previous_id,body,sha256,created_by,private_owner)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`, [id, tenant, project, b.spec.name, previous?.series_id ?? id,
          (previous?.version ?? 0) + 1, previous?.id ?? null, body, geoDigest(body), req.principal.id])).rows[0];
        await audit(tx, req.principal, "geo.experiment.create", row.id, "succeeded", { version: row.version, sha256: row.sha256 }, tenant);
        return receipt(row);
      });
    }, tenant, true, req.principal.id);
    return reply.code(201).send(result);
  });
  app.get(root + "/experiments/:id/runs", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = rowParams.parse(req.params);
    const q = z.object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict().parse(req.query);
    return db.tx(async tx => {
      await authorizeRead(tx, req.principal, tenant, project);
      await own(tx, "geo_experiments", id, req.principal, tenant, project);
      const rows = (await tx.query(`SELECT id,name,surface,config_hash,created_at FROM geo_runs WHERE experiment_id=$1 AND content_state='active' AND retention_expires_at>clock_timestamp()
        AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM geo_runs WHERE id=$2 AND experiment_id=$1)) ORDER BY created_at DESC,id DESC LIMIT $3`, [id, q.cursor ?? null, q.limit + 1])).rows;
      return { items: rows.slice(0, q.limit), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
    }, tenant, true, req.principal.id);
  });
  app.post(root + "/experiments/:id/runs", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project, id } = rowParams.parse(req.params), b = runInput.parse(req.body);
    const result = await db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      const e = await own(tx, "geo_experiments", id, req.principal, tenant, project);
      return replay(tx, req.principal.id, "geo.run:" + id, key(req), b, async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`task-quota:${tenant}:${req.principal.id}`]);
        const slots = await quota(tx, req.principal, tenant);
        if (slots.available < e.body.spec.questions.length) throw new Problem(409, "GEO_TASK_SLOTS_REQUIRED", `This observation needs ${e.body.spec.questions.length} active task slots; ${slots.available} are available. Finish existing work, use a smaller fixed question set or review your plan.`);
        const agent = await getAgentVersion(tx, project, e.body.context.agent_id, e.body.context.agent_version, true);
        if (geoDigest(agent.body) !== e.body.harness.agent_definition_sha256) throw new Problem(409, "GEO_HARNESS_CHANGED", "Create a new experiment version for a changed Agent configuration");
        await resolveWorkContext(tx, req.principal, tenant, project, e.body.context);
        const runId = randomUUID(), config = { experiment_sha256: e.sha256, surface: "internal_api", harness: e.body.harness, region: e.body.spec.region, language: e.body.spec.language };
        const run = (await tx.query(`INSERT INTO geo_runs(id,tenant_id,project_id,name,experiment_id,surface,body,config_hash,created_by,private_owner)
          VALUES($1,$2,$3,$4,$5,'internal_api',$6,$7,$8,$8) RETURNING *`, [runId, tenant, project, b.name, id, { effective_config: config }, geoDigest(config), req.principal.id])).rows[0];
        for (const q of e.body.spec.questions) {
          const sid = randomUUID();
          await tx.query(`INSERT INTO geo_samples(id,tenant_id,project_id,name,run_id,question_key,body,created_by,private_owner)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [sid, tenant, project, b.name + " · " + q.key, runId, q.key, { question: q.text }, req.principal.id]);
          const task = await enqueueTask(tx, db, catalog, req.principal, tenant, project, { title: ("GEO · " + q.text).slice(0, 160),
            prompt: geoPrompt(e.body.spec, q.text), role_key: agent.role_key, mode: "ask", budget_micros: Number(b.per_question_budget_micros) },
          "geo-sample:" + sid, { context: { ...e.body.context, geo_sample_id: sid } as WorkContext });
          const actual = runtimeSelection(await taskCapabilities(tx, db.config, catalog, task));
          if (actual.capabilityVersionId !== e.body.harness.text_capability_id || actual.runtimeVersion !== e.body.harness.runtime_version
            || actual.model !== e.body.harness.requested_model_alias || actual.gatewayFingerprint !== e.body.harness.gateway_fingerprint)
            throw new Problem(409, "GEO_HARNESS_CHANGED", "Frozen task capability does not match the observation configuration");
          await tx.query("UPDATE geo_samples SET task_id=$2 WHERE id=$1", [sid, task.id]);
        }
        await audit(tx, req.principal, "geo.run.create", runId, "accepted", { experiment_id: id, questions: e.body.spec.questions.length, config_hash: run.config_hash }, tenant);
        return receipt(run);
      });
    }, tenant, true, req.principal.id);
    return reply.code(201).send(result);
  });
  app.post(root + "/experiments/:id/manual", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project, id } = rowParams.parse(req.params), b = geoManual.parse(req.body);
    const result = await db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      const e = await own(tx, "geo_experiments", id, req.principal, tenant, project);
      if (b.samples.some(s => !e.body.spec.questions.some((q: any) => q.key === s.question_key))) throw new Problem(422, "GEO_QUESTION_UNKNOWN", "Use a question from this fixed configuration");
      return replay(tx, req.principal.id, "geo.manual:" + id, key(req), b, async () => {
        const config = { experiment_sha256: e.sha256, surface: "consumer_manual", product: b.product, reported_model: b.reported_model,
          region: b.region, language: b.language, retrieval: b.retrieval, provenance: "user_supplied_unverified", processing_region: "unknown" };
        const rid = randomUUID();
        const run = (await tx.query(`INSERT INTO geo_runs(id,tenant_id,project_id,name,experiment_id,surface,body,config_hash,created_by,private_owner)
          VALUES($1,$2,$3,$4,$5,'consumer_manual',$6,$7,$8,$8) RETURNING *`, [rid, tenant, project, b.name, id, { effective_config: config, attested: true }, geoDigest(config), req.principal.id])).rows[0];
        for (const s of b.samples) {
          const q = e.body.spec.questions.find((q: any) => q.key === s.question_key), sid = randomUUID();
          const sample = (await tx.query(`INSERT INTO geo_samples(id,tenant_id,project_id,name,run_id,question_key,body,created_by,private_owner)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [sid, tenant, project, b.name + " · " + s.question_key, rid, s.question_key, { question: q.text }, req.principal.id])).rows[0];
          await answerFile(tx, storage, { ...sample, brands: e.body.spec.brands }, req.principal, s.answer, new Date(b.observed_at));
        }
        await audit(tx, req.principal, "geo.manual.create", rid, "succeeded", { samples: b.samples.length, config_hash: run.config_hash }, tenant);
        return receipt(run);
      });
    }, tenant, true, req.principal.id);
    return reply.code(201).send(result);
  });
  app.get(root + "/runs/:id", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = rowParams.parse(req.params);
    return db.tx(async tx => { await authorizeRead(tx, req.principal, tenant, project); return readRun(tx, req.principal, tenant, project, id); }, tenant, true, req.principal.id);
  });
  app.post(root + "/runs/:id/capture", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = rowParams.parse(req.params);
    z.object({}).strict().parse(req.body);
    return db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      const r = await own(tx, "geo_runs", id, req.principal, tenant, project), e = await own(tx, "geo_experiments", r.experiment_id, req.principal, tenant, project);
      // Capture is naturally idempotent per immutable sample. A repeat can pick
      // up later completed tasks without reusing an old serialized answer body.
      let captured = 0;
      const samples = (await tx.query("SELECT * FROM geo_samples WHERE run_id=$1 ORDER BY id FOR UPDATE", [id])).rows;
      for (const s of samples) {
        if (s.asset_version_id || !s.task_id) continue;
        if (!(await tx.query("SELECT geo_sample_source_manifest($1,$2,$3) AS refs", [s.id, tenant, project])).rows[0].refs)
          throw new Problem(404, "GEO_SOURCE_UNAVAILABLE", "An observation source is unavailable");
        const t = (await tx.query("SELECT * FROM tasks WHERE id=$1 FOR SHARE", [s.task_id])).rows[0];
        if (t.status !== "succeeded" || typeof t.output !== "string" || !t.output.length) continue;
        if (Buffer.byteLength(t.output, "utf8") > 2_000_000) throw new Problem(422, "GEO_ANSWER_LIMIT", "The retained answer exceeds the capture limit");
        await assertTaskContentSources(tx, t);
        await answerFile(tx, storage, { ...s, brands: e.body.spec.brands }, req.principal, t.output, t.updated_at);
        ++captured;
      }
      await audit(tx, req.principal, "geo.run.capture", id, "succeeded", { captured }, tenant);
      return { id, captured };
    }, tenant, true, req.principal.id);
  });
  app.post(root + "/runs/:id/cancel", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = rowParams.parse(req.params);
    z.object({}).strict().parse(req.body);
    return db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      await own(tx, "geo_runs", id, req.principal, tenant, project);
      const tasks = (await tx.query("SELECT t.* FROM tasks t JOIN geo_samples s ON s.task_id=t.id WHERE s.run_id=$1 ORDER BY t.id FOR UPDATE OF t", [id])).rows;
      for (const t of tasks) await requestTaskCancellation(tx, t);
      await audit(tx, req.principal, "geo.run.cancel", id, "accepted", { tasks: tasks.length }, tenant);
      return { id, cancellation_requested: tasks.length, cost: "see_individual_task_receipts" };
    }, tenant, true, req.principal.id);
  });
  app.get(root + "/compare", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project } = params.parse(req.params);
    const q = z.object({ left: uuid, right: uuid, download: z.enum(["json"]).optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await authorizeRead(tx, req.principal, tenant, project);
      const left = await readRun(tx, req.principal, tenant, project, q.left, q.download ? storage : undefined);
      const right = await readRun(tx, req.principal, tenant, project, q.right, q.download ? storage : undefined);
      const body = { comparison: compareGeo(left, right), left, right };
      if (q.download) {
        await audit(tx, req.principal, "geo.comparison.download", q.left, "succeeded", { right: q.right }, tenant);
        reply.header("Content-Disposition", 'attachment; filename="geo-observation-comparison.json"').header("Cache-Control", "no-store");
        return reply.type("application/json; charset=utf-8").send(canonical(body));
      }
      return body;
    }, tenant, true, req.principal.id);
  });
  app.get(root + "/runs/:id/export", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project, id } = rowParams.parse(req.params);
    return db.tx(async tx => {
      await authorizeRead(tx, req.principal, tenant, project);
      const report = await readRun(tx, req.principal, tenant, project, id, storage);
      await audit(tx, req.principal, "geo.run.download", id, "succeeded", {}, tenant);
      return reply.header("Content-Disposition", 'attachment; filename="geo-observation.json"').header("Cache-Control", "no-store").type("application/json; charset=utf-8").send(canonical(report));
    }, tenant, true, req.principal.id);
  });
  app.post(root + "/content/:id/delete", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = rowParams.parse(req.params);
    const b = z.object({ kind: z.enum(["experiment", "run"]), expected_version: z.number().int().positive() }).strict().parse(req.body);
    return db.tx(async tx => {
      await write(tx, req.principal, tenant, project);
      const table = b.kind === "experiment" ? "geo_experiments" : "geo_runs";
      return replay(tx, req.principal.id, "geo.delete:" + id, key(req), b, async () => {
        const r = await own(tx, table, id, req.principal, tenant, project);
        if (r.moderation_version !== b.expected_version) throw new Problem(409, "VERSION_CONFLICT", "Review the current observation before deleting it");
        await tx.query(`UPDATE ${table} SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1`, [id]);
        await audit(tx, req.principal, "geo.content.delete", id, "succeeded", { kind: b.kind }, tenant);
        return { id, state: "deleted" };
      });
    }, tenant, true, req.principal.id);
  });
}
