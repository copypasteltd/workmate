import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireUser, type Principal } from "./auth.js";
import { key, replay } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { desktopRuntime } from "./desktop-runtime.js";
import { geoOwn, geoQuota, geoWrite } from "./geo-observations.js";
import { geoDigest, geoPrompt } from "./geo-model.js";
import { getAgentVersion, resolveWorkContext, type WorkContext } from "./persistent-work.js";
import { enqueueTask } from "./task-service.js";
import { runtimeSelection, taskCapabilities } from "./capability-bindings.js";

export const desktopGeoProtocol = "codex-desktop-geo-v1";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const desktopGeoInput = z.object({
  name: z.string().trim().min(1).max(160),
  expected_experiment_sha256: sha,
  per_question_budget_micros: z.string().regex(/^[1-9]\d{0,10}$/)
    .refine(v => BigInt(v) >= 10000n && BigInt(v) <= 10000000000n),
  sessions: z.array(z.object({
    question_key: z.string().min(1).max(80), device_id: uuid, local_session_id: uuid,
    workspace_hash: sha, runtime_version: z.literal(desktopRuntime.pinned_version),
    runtime_sha256: z.literal(desktopRuntime.windows_x64_sha256),
  }).strict()).min(1).max(20),
}).strict().superRefine((v, c) => {
  for (const field of ["question_key", "local_session_id", "workspace_hash"] as const)
    if (new Set(v.sessions.map(s => s[field])).size !== v.sessions.length)
      c.addIssue({ code: "custom", message: "Every question requires its own fresh local session and empty workspace", path: ["sessions"] });
  if (new Set(v.sessions.map(s => s.device_id)).size !== 1)
    c.addIssue({ code: "custom", message: "Run the batch on one device", path: ["sessions"] });
});

export function registerDesktopGeo(app: FastifyInstance, db: Database, catalog: Catalog,
  family: (tx: Tx, actor: Principal) => Promise<string>, roles: readonly string[]) {
  app.get("/v1/tenants/:tenant/projects/:project/geo/experiments/:id/desktop-configuration", { preHandler: requireUser(db) }, async req => {
    const p = z.object({ tenant: uuid, project: uuid, id: uuid }).parse(req.params);
    return db.tx(async tx => {
      await geoWrite(tx, req.principal, p.tenant, p.project);
      await family(tx, req.principal);
      const e = await geoOwn(tx, "geo_experiments", p.id, req.principal, p.tenant, p.project);
      if (!roles.includes(e.body.harness.role_key)) throw new Problem(409, "DESKTOP_ROLE_UNAVAILABLE", "Choose a supported native role");
      return { id: e.id, name: e.name, sha256: e.sha256, body: e.body, runtime: desktopRuntime, quota: await geoQuota(tx, req.principal, p.tenant) };
    }, p.tenant, true, req.principal.id);
  });
  app.post("/v1/tenants/:tenant/projects/:project/geo/experiments/:id/desktop-runs", { preHandler: requireUser(db) }, async (req, reply) => {
    const p = z.object({ tenant: uuid, project: uuid, id: uuid }).parse(req.params), b = desktopGeoInput.parse(req.body);
    const result = await db.tx(async tx => {
      await geoWrite(tx, req.principal, p.tenant, p.project);
      const nativeFamily = await family(tx, req.principal);
      const e = await geoOwn(tx, "geo_experiments", p.id, req.principal, p.tenant, p.project);
      return replay(tx, req.principal.id, "geo.desktop.run:" + p.id, key(req), b, async () => {
        if (b.expected_experiment_sha256 !== e.sha256) throw new Problem(409, "GEO_EXPERIMENT_CHANGED", "Review the exact fixed question set again");
        if (b.sessions.length !== e.body.spec.questions.length || b.sessions.some((s, i) => s.question_key !== e.body.spec.questions[i].key))
          throw new Problem(422, "GEO_LOCAL_QUESTION_BINDING", "Bind every fixed question in its original order");
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`task-quota:${p.tenant}:${req.principal.id}`]);
        const quota = await geoQuota(tx, req.principal, p.tenant);
        if (quota.available < b.sessions.length) throw new Problem(409, "GEO_TASK_SLOTS_REQUIRED", "The whole question set needs available task slots before reserving any question");
        const agent = await getAgentVersion(tx, p.project, e.body.context.agent_id, e.body.context.agent_version, true);
        if (!roles.includes(agent.role_key)) throw new Problem(409, "DESKTOP_ROLE_UNAVAILABLE", "Choose a role supported by the local Codex protocol");
        if (geoDigest(agent.body) !== e.body.harness.agent_definition_sha256 || agent.body.brand)
          throw new Problem(409, "GEO_HARNESS_CHANGED", "Review a new experiment version for a changed Agent");
        await resolveWorkContext(tx, req.principal, p.tenant, p.project, e.body.context);
        for (const s of [...b.sessions].sort((a, b) => a.local_session_id.localeCompare(b.local_session_id))) {
          await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["desktop-session:" + s.local_session_id]);
          if ((await tx.query("SELECT 1 FROM desktop_executions WHERE local_session_id=$1", [s.local_session_id])).rowCount)
            throw new Problem(409, "GEO_LOCAL_SESSION_USED", "Each observation needs a never-used local session");
        }
        const config = { experiment_sha256: e.sha256, surface: "internal_api", execution_location: "desktop",
          harness: { ...e.body.harness, protocol: desktopGeoProtocol, runtime_version: desktopRuntime.pinned_version,
            native_runtime: desktopRuntime, fresh_thread: true, local_tools: [], project_guidance: "disabled" },
          region: e.body.spec.region, language: e.body.spec.language };
        const runId = randomUUID();
        const run = (await tx.query(`INSERT INTO geo_runs(id,tenant_id,project_id,name,experiment_id,surface,body,config_hash,created_by,private_owner)
          VALUES($1,$2,$3,$4,$5,'internal_api',$6,$7,$8,$8) RETURNING *`,
          [runId, p.tenant, p.project, b.name, p.id, { effective_config: config }, geoDigest(config), req.principal.id])).rows[0];
        const sessions = [];
        for (let i = 0; i < b.sessions.length; i++) {
          const local = b.sessions[i], q = e.body.spec.questions[i], sampleId = randomUUID();
          await tx.query(`INSERT INTO geo_samples(id,tenant_id,project_id,name,run_id,question_key,body,created_by,private_owner)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [sampleId, p.tenant, p.project, b.name + " · " + q.key, runId, q.key, { question: q.text }, req.principal.id]);
          const t = await enqueueTask(tx, db, catalog, req.principal, p.tenant, p.project,
            { title: ("GEO · " + q.text).slice(0, 160), prompt: geoPrompt(e.body.spec, q.text), role_key: agent.role_key, mode: "ask", budget_micros: Number(b.per_question_budget_micros) },
            "geo-native-sample:" + sampleId, { execution_location: "desktop", context: { ...e.body.context, geo_sample_id: sampleId } as WorkContext });
          const actual = runtimeSelection(await taskCapabilities(tx, db.config, catalog, t));
          if (actual.capabilityVersionId !== e.body.harness.text_capability_id || actual.model !== e.body.harness.requested_model_alias || actual.gatewayFingerprint !== e.body.harness.gateway_fingerprint)
            throw new Problem(409, "GEO_HARNESS_CHANGED", "The native model publication differs from the reviewed experiment");
          await tx.query(`INSERT INTO desktop_executions(task_id,tenant_id,project_id,actor_id,device_id,local_session_id,native_family_id,workspace_hash,runtime_sha256,method_tools_version)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)`, [t.id, p.tenant, p.project, req.principal.id, local.device_id, local.local_session_id, nativeFamily, local.workspace_hash, local.runtime_sha256]);
          await tx.query("UPDATE geo_samples SET task_id=$2 WHERE id=$1", [sampleId, t.id]);
          sessions.push({ question_key: q.key, sample_id: sampleId, task_id: t.id, local_session_id: local.local_session_id,
            budget_micros: b.per_question_budget_micros, role_key: agent.role_key });
        }
        await audit(tx, req.principal, "geo.desktop.run.create", runId, "accepted", { experiment_id: p.id, questions: sessions.length, config_hash: run.config_hash }, p.tenant);
        return { id: runId, experiment_id: p.id, execution_location: "desktop", protocol: desktopGeoProtocol,
          config_hash: run.config_hash, total_budget_micros: (BigInt(b.per_question_budget_micros) * BigInt(sessions.length)).toString(), sessions };
      });
    }, p.tenant, true, req.principal.id);
    return reply.code(201).send(result);
  });
}
