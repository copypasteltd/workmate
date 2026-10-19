import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { requireUser, audit } from "./auth.js";
import { projectAccess, tenantAccess, replay } from "./access.js";
import { Problem, uuid } from "./lib.js";
import {
  createSpecialist,
  getAgentVersion,
  freezeWorkContext,
} from "./persistent-work.js";
import { enqueueTask } from "./task-service.js";
import { saveAsset, type Storage } from "./storage.js";
import {
  analysisSpec,
  normalizedAnalysis,
  calculateAnalysis,
  validatedNarrative,
  type AnalysisCalculation,
  type Evidence,
} from "./analysis-calculation.js";

const params = z.object({ tenant: uuid, project: uuid });
const create = z
  .object({
    project_id: uuid,
    agent_id: uuid,
    analysis: analysisSpec,
    budget: z
      .object({
        currency: z.literal("HKD"),
        amount_micros: z
          .string()
          .regex(/^[1-9]\d{0,12}$/)
          .refine((s) => BigInt(s) <= 1000000000000n),
      })
      .strict(),
  })
  .strict();
const snapshotFields = (s: any) => ({
  id: s.id,
  project_id: s.project_id,
  source: s.source,
  state: s.state,
  row_count: s.row_count,
  data_as_of: s.data_as_of,
  spec_hash: s.spec_hash,
});
function reportFields(r: any) {
  const state = [
    "queued",
    "needs_input",
    "paused",
    "awaiting_approval",
  ].includes(r.task_status)
    ? "queued"
    : ["running", "reconciling"].includes(r.task_status)
      ? "running"
      : r.task_status === "succeeded" && r.asset_version_id
        ? "ready"
        : "failed";
  return {
    id: r.id,
    task_id: r.task_id,
    snapshot_ids: r.calculation.snapshots.map((s: any) => s.id),
    state,
    evidence_ids: r.calculation.evidence.map((e: any) => e.id),
    ...(state === "ready" ? { asset_version_id: r.asset_version_id } : {}),
  };
}
function tenantOf(req: FastifyRequest) {
  return uuid.parse((req.params as any).tenant ?? req.headers["x-tenant-id"]);
}
async function datasets(tx: Tx, project: string, ids: string[]) {
  return (
    await tx.query(
      "SELECT * FROM analytics_datasets WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
      [project, ids],
    )
  ).rows;
}
export async function assertReportSources(tx: Tx, t: any) {
  const id = t.input_context?.analysis_report_id;
  if (!id) return;
  const r = (
    await tx.query(
      "SELECT id FROM analysis_reports WHERE id=$1 AND task_id=$2 AND invalidated_at IS NULL",
      [id, t.id],
    )
  ).rows[0];
  if (!r)
    throw new Problem(
      403,
      "ANALYSIS_SOURCE_REVOKED",
      "A report source or its authorization is no longer available",
    );
  // Hold source locks through tool execution/final publication, so revocation
  // cannot race a validated read into a newly published report.
  let source: any[];
  await tx.query("SAVEPOINT analysis_source_lock");
  try {
    source = (
      await tx.query(
        "SELECT d.id FROM analytics_datasets d JOIN analysis_report_sources s ON s.dataset_id=d.id WHERE s.report_id=$1 AND d.content_state='active' ORDER BY d.id FOR SHARE OF d NOWAIT",
        [id],
      )
    ).rows;
    await tx.query("RELEASE SAVEPOINT analysis_source_lock");
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT analysis_source_lock");
    await tx.query("RELEASE SAVEPOINT analysis_source_lock");
    if ((e as any).code === "55P03")
      throw new Problem(
        403,
        "ANALYSIS_SOURCE_CHANGING",
        "A report source is being changed; execution stopped before using it",
      );
    throw e;
  }
  const expected = (
    await tx.query("SELECT source_count FROM analysis_reports WHERE id=$1", [
      id,
    ])
  ).rows[0];
  if (source.length !== expected?.source_count)
    throw new Problem(
      403,
      "ANALYSIS_SOURCE_REVOKED",
      "A report source is no longer available",
    );
}
export const analysisReportInstructions = `
This task is a frozen campaign analysis report. First call analysis_report_facts.
Facts are paginated. Read additional pages using next_offset for the scopes you discuss; never claim complete review from a partial page.
Return ONLY one JSON object with keys observations, hypotheses, next_steps.
observations is a nonempty array and hypotheses is an array. Each item has text and evidence_ids.
Every observation/hypothesis must insert at least one exact {{evidence-uuid}} placeholder and list that UUID in evidence_ids.
Use only evidence UUIDs returned by analysis_report_facts. Do not put numerical literals, dates, percentages, amounts or numeric claims in prose; the server substitutes frozen evidence values.
next_steps is a nonempty array of prose strings with no numerical literals or placeholders.
Hypotheses are explicitly unverified explanations, not causal findings. Respect independent account/currency/source/attribution groups and all coverage limitations.
Do not call deliver_text to publish the report. The server validates references and numbers, then creates the immutable HTML artifact.
`;
export async function reportFacts(tx: Tx, t: any, offset = 0) {
  await assertReportSources(tx, t);
  const r = (
    await tx.query(
      "SELECT calculation FROM analysis_reports WHERE id=$1 AND task_id=$2",
      [t.input_context?.analysis_report_id ?? null, t.id],
    )
  ).rows[0];
  if (!r)
    throw new Problem(404, "NOT_FOUND", "This task has no analysis report");
  const c = r.calculation as AnalysisCalculation;
  // Full calculations repeat scope/summary/snapshot/evidence and can exceed
  // the kernel's tool-result context limit. Keep each response parseable and
  // bounded; immutable full calculations remain in the report and export.
  const evidence = c.evidence.slice(offset, offset + 2);
  return {
    report_id: t.input_context.analysis_report_id,
    spec_hash: c.spec_hash,
    date_range: { from: c.spec.date_from, to: c.spec.date_to },
    comparison: c.spec.comparison ?? null,
    timezone: c.spec.timezone,
    requested_metrics: c.spec.metrics,
    selected_snapshot_ids: c.spec.snapshot_ids,
    coverage: c.coverage,
    total_evidence: c.evidence.length,
    evidence,
    next_offset:
      offset + evidence.length < c.evidence.length
        ? offset + evidence.length
        : null,
    limitations: c.limitations,
    page_notice:
      "This is a partial evidence page unless all pages have been read. Follow next_offset for additional independent scopes and metrics; never invent missing values.",
  };
}
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function referenceValue(e: Evidence) {
  return e.value === null
    ? `Unknown / 未知 (${e.null_reason})`
    : `${e.value} ${e.unit}`;
}
export async function finalizeAnalysisReport(
  tx: Tx,
  storage: Storage,
  t: any,
  text: string,
) {
  await assertReportSources(tx, t);
  const r = (
    await tx.query(
      "SELECT * FROM analysis_reports WHERE id=$1 AND task_id=$2 FOR UPDATE",
      [t.input_context.analysis_report_id, t.id],
    )
  ).rows[0];
  if (!r)
    throw new Problem(403, "ANALYSIS_SOURCE_REVOKED", "Report unavailable");
  const calculation = r.calculation as AnalysisCalculation,
    narrative = validatedNarrative(text, calculation);
  const refs = new Map(calculation.evidence.map((e) => [e.id, e]));
  const interpolate = (s: string, html: boolean) =>
    (html ? escape(s) : s).replace(/\{\{([a-f0-9-]{36})\}\}/g, (_, id) =>
      html
        ? `<a href="#evidence-${id}">${escape(referenceValue(refs.get(id)!))}</a>`
        : `${referenceValue(refs.get(id)!)} [evidence:${id}]`,
    );
  const statements = (items: typeof narrative.observations) =>
    items.map((s) => `<li>${interpolate(s.text, true)}</li>`).join("");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CopyPaste · Campaign evidence report</title>
<style>body{font-family:Arial,"Microsoft JhengHei",sans-serif;background:#f6f6f4;color:#15171a;margin:0;line-height:1.6}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:clamp(30px,5vw,52px);line-height:1.1}h2{margin-top:36px}a{color:#1f5eff}header{border-bottom:3px solid #1f5eff;padding-bottom:28px}.tag{color:#1f5eff;font-weight:bold}.box{border:1px solid #e3e4e5;padding:20px;margin:20px 0;background:#fff}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:680px}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:10px}code{overflow-wrap:anywhere}small{color:#555}li{margin:10px 0}details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:white}main{padding:0}a{color:inherit}}</style>
<main><header><div class="tag">COPYPASTE · EVIDENCE BEFORE THE NEXT MOVE</div><h1>Campaign evidence report<br>行銷證據報告</h1><p>${escape(r.spec.prompt)}</p><small>${escape(r.spec.date_from)} → ${escape(r.spec.date_to)} · ${escape(r.spec.timezone)} · ${escape(r.created_at.toISOString())}</small><p>Platform data cutoff unknown / 平台取數截止時間未知</p></header>
<section><h2>Observations / 觀察</h2><ul>${statements(narrative.observations)}</ul><h2>Hypotheses to verify / 待驗證假設</h2><ul>${statements(narrative.hypotheses)}</ul><h2>Next steps / 下一步</h2><ul>${narrative.next_steps.map((s) => `<li>${escape(s)}</li>`).join("")}</ul></section>
<section><h2>Independent scopes / 獨立口徑</h2>${calculation.groups
    .map(
      (g) =>
        `<div class="box"><strong>${escape(g.scope.source)} · ${escape(g.scope.account_id || "Unspecified account")} · ${escape(g.scope.currency)}</strong><details><summary>Definitions / 定義</summary><pre>${escape(JSON.stringify(g.scope, null, 2))}</pre></details>${Object.entries(
          g.periods,
        )
          .map(
            ([period, s]: [string, any]) =>
              `<p>${escape(period)} · ${s.row_count} rows · ${escape(s.scope.date_from)} → ${escape(s.scope.date_to)}</p>`,
          )
          .join("")}</div>`,
    )
    .join("")}</section>
<section><h2>Frozen evidence / 凍結證據</h2><div class="scroll"><table><thead><tr><th>Metric / 指標</th><th>Exact value / 精確值</th><th>Reference / 引用</th><th>Scope / 範圍</th></tr></thead><tbody>${calculation.evidence.map((e) => `<tr id="evidence-${e.id}"><td>${escape(e.metric_id)}</td><td>${escape(referenceValue(e))}</td><td><code>${e.id}</code></td><td><details><summary>Source and formula</summary><pre>${escape(e.scope)}</pre><small>Formula ${escape(e.formula_version)} · Snapshot ${e.snapshot_id}</small></details></td></tr>`).join("")}</tbody></table></div></section>
<section><h2>Sources and limitations / 來源與限制</h2>${calculation.sources.map((s) => `<p><code>${escape(s.snapshot_id)}</code><br>SHA-256 <code>${escape(s.source_sha256)}</code></p>`).join("")}<ul>${calculation.limitations.map((s) => `<li>${escape(s)}</li>`).join("")}</ul><small>Analysis spec SHA-256: ${escape(r.spec_hash)} · Report ${r.id}<br>Data mode / 數據模式: ${escape(t.data_mode)}</small></section></main></html>`;
  const asset = await saveAsset(tx, storage, {
    tenant: t.tenant_id,
    project: t.project_id,
    user: t.created_by,
    name: `campaign-report-${r.id}.html`,
    mime: "text/html",
    kind: "deliverable",
    bytes: Buffer.from(html),
    metadata: {
      task_id: t.id,
      analysis_report_id: r.id,
      spec_hash: r.spec_hash,
      numerical_validation: "bound-evidence-placeholders/1.0",
    },
  });
  await tx.query(
    "UPDATE analysis_reports SET narrative=$2,validation=$3,asset_version_id=$4 WHERE id=$1",
    [
      r.id,
      JSON.stringify(narrative),
      JSON.stringify({
        state: "passed",
        method: "bound-evidence-placeholders/1.0",
        evidence_count: calculation.evidence.length,
      }),
      asset.version.id,
    ],
  );
  return [
    ...narrative.observations.map((s) => interpolate(s.text, false)),
    ...narrative.hypotheses.map(
      (s) => "Hypothesis / 假設: " + interpolate(s.text, false),
    ),
    ...narrative.next_steps,
  ].join("\n\n");
}

export function registerAnalysisReports(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  const base = "/v1/tenants/:tenant/projects/:project/analysis";
  async function readReport(tx: Tx, p: Principal, tenant: string, id: string) {
    await tenantAccess(tx, p, tenant);
    const r = (
      await tx.query(
        "SELECT r.*,t.status AS task_status,t.error_code,t.charged_micros,t.budget_micros FROM analysis_reports r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1",
        [id],
      )
    ).rows[0];
    if (!r) throw new Problem(404, "NOT_FOUND", "Report not found");
    await projectAccess(tx, p, tenant, r.project_id);
    return r;
  }
  app.post(
    base + "/assistant",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      z.object({}).strict().parse(req.body);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, project, "write");
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["analysis-specialist:" + project + ":" + req.principal.id],
          );
          const saved = (
            await tx.query(
              "SELECT agent_id FROM analysis_report_specialists WHERE project_id=$1 AND created_by=$2",
              [project, req.principal.id],
            )
          ).rows[0];
          const a = saved
            ? await getAgentVersion(
                tx,
                project,
                saved.agent_id,
                undefined,
                true,
              )
            : await createSpecialist(
                tx,
                catalog,
                req.principal,
                tenant,
                project,
                {
                  name: "Campaign report analyst / 行銷報告分析師",
                  role_key: "marketing-analyst",
                  instructions:
                    "Use frozen analysis facts and bound evidence placeholders for campaign reports. Separate observations, hypotheses and next steps.",
                  tool_ids: ["asset.read", "asset.write", "dataset.read"],
                  brand_id: null,
                },
              );
          if (!saved)
            await tx.query(
              "INSERT INTO analysis_report_specialists(tenant_id,project_id,created_by,agent_id) VALUES($1,$2,$3,$4)",
              [tenant, project, req.principal.id, a.id],
            );
          return { id: a.id, name: a.name, role_key: a.role_key };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(base + "/preview", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params),
      spec = normalizedAnalysis(req.body);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return calculateAnalysis(
          randomUUID(),
          project,
          spec,
          await datasets(tx, project, spec.snapshot_ids),
        );
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.post(
    "/v1/reports",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        b = create.parse(req.body),
        spec = normalizedAnalysis(b.analysis),
        requestKey = z
          .string()
          .min(8)
          .max(128)
          .parse(req.headers["idempotency-key"]);
      const value = await db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, b.project_id, "write");
          const saved = await replay(
            tx,
            req.principal.id,
            "analysis.report.create",
            requestKey,
            { tenant, ...b, analysis: spec },
            async () => {
              const agent = await getAgentVersion(
                tx,
                b.project_id,
                b.agent_id,
                undefined,
                true,
              );
              if (
                !["dataset.read", "asset.write"].every((tool) =>
                  agent.body.tool_ids.includes(tool),
                )
              )
                throw new Problem(
                  403,
                  "REPORT_AGENT_TOOLS",
                  "Choose a specialist with dataset reading and artifact writing permissions",
                );
              const id = randomUUID(),
                calculation = calculateAnalysis(
                  id,
                  b.project_id,
                  spec,
                  await datasets(tx, b.project_id, spec.snapshot_ids),
                );
              const context = {
                ...(await freezeWorkContext(
                  tx,
                  req.principal,
                  tenant,
                  b.project_id,
                  agent,
                  undefined,
                  catalog,
                )),
                analysis_report_id: id,
              };
              const task = await enqueueTask(
                tx,
                db,
                catalog,
                req.principal,
                tenant,
                b.project_id,
                {
                  title: `Analysis · ${spec.prompt.slice(0, 120)}`,
                  prompt: spec.prompt,
                  role_key: agent.role_key,
                  budget_micros: Number(b.budget.amount_micros),
                },
                "analysis-report:" + id,
                { context },
              );
              await tx.query(
                "INSERT INTO analysis_reports(id,tenant_id,project_id,task_id,created_by,private_owner,source_count,spec,spec_hash,calculation) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)",
                [
                  id,
                  tenant,
                  b.project_id,
                  task.id,
                  req.principal.id,
                  spec.snapshot_ids.length,
                  JSON.stringify(spec),
                  calculation.spec_hash,
                  JSON.stringify(calculation),
                ],
              );
              for (const source of spec.snapshot_ids)
                await tx.query(
                  "INSERT INTO analysis_report_sources(tenant_id,project_id,report_id,dataset_id) VALUES($1,$2,$3,$4)",
                  [tenant, b.project_id, id, source],
                );
              await tx.query(
                "INSERT INTO analysis_snapshots(id,tenant_id,project_id,report_id,body) SELECT (s->>'id')::uuid,$1,$2,$3,s FROM jsonb_array_elements($4::jsonb) s",
                [
                  tenant,
                  b.project_id,
                  id,
                  JSON.stringify(calculation.snapshots),
                ],
              );
              await tx.query(
                "INSERT INTO analysis_evidence(id,tenant_id,project_id,report_id,snapshot_id,body) SELECT (e->>'id')::uuid,$1,$2,$3,(e->>'snapshot_id')::uuid,e FROM jsonb_array_elements($4::jsonb) e",
                [
                  tenant,
                  b.project_id,
                  id,
                  JSON.stringify(calculation.evidence),
                ],
              );
              await audit(
                tx,
                req.principal,
                "analysis.report.create",
                id,
                "accepted",
                { task_id: task.id, spec_hash: calculation.spec_hash },
                tenant,
              );
              return { id };
            },
          );
          return reportFields(
            await readReport(tx, req.principal, tenant, saved.id),
          );
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply.code(202).send(value);
    },
  );
  app.get(
    "/v1/reports/:report",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).report);
      return db.tx(
        async (tx) =>
          reportFields(await readReport(tx, req.principal, tenant, id)),
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(base + "/reports", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const rows = (
          await tx.query(
            "SELECT r.*,t.status AS task_status,t.error_code FROM analysis_reports r JOIN tasks t ON t.id=r.task_id WHERE r.project_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 50",
            [project],
          )
        ).rows;
        return {
          items: rows.map((r) => ({
            ...reportFields(r),
            prompt: r.spec.prompt,
            created_at: r.created_at,
            error_code: r.error_code,
          })),
        };
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.get(
    base + "/reports/:report",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params),
        id = uuid.parse((req.params as any).report);
      return db.tx(
        async (tx) => {
          const r = await readReport(tx, req.principal, tenant, id);
          if (r.project_id !== project)
            throw new Problem(404, "NOT_FOUND", "Report not found");
          return {
            report: reportFields(r),
            spec: r.spec,
            spec_hash: r.spec_hash,
            calculation: r.calculation,
            narrative: r.narrative,
            validation: r.validation,
            created_at: r.created_at,
            error_code: r.error_code,
            budget_micros: r.budget_micros,
            charged_micros: r.charged_micros,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    base + "/reports/:report/download",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project } = params.parse(req.params),
        id = uuid.parse((req.params as any).report),
        q = z
          .object({ format: z.enum(["html", "json"]) })
          .strict()
          .parse(req.query);
      const content = await db.tx(
        async (tx) => {
          const r = await readReport(tx, req.principal, tenant, id);
          if (r.project_id !== project)
            throw new Problem(404, "NOT_FOUND", "Report not found");
          if (reportFields(r).state !== "ready")
            throw new Problem(
              409,
              "REPORT_NOT_READY",
              "Wait until the report is ready before downloading",
            );
          if (q.format === "json")
            return {
              mime: "application/json; charset=utf-8",
              bytes: Buffer.from(
                JSON.stringify(
                  {
                    report: reportFields(r),
                    spec: r.spec,
                    spec_hash: r.spec_hash,
                    calculation: r.calculation,
                    narrative: r.narrative,
                    validation: r.validation,
                    created_at: r.created_at,
                  },
                  null,
                  2,
                ),
              ),
            };
          const v = (
            await tx.query(
              "SELECT v.storage_key,v.mime_type FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=$1 AND a.state='active'",
              [r.asset_version_id],
            )
          ).rows[0];
          if (!v)
            throw new Problem(404, "NOT_FOUND", "Report artifact unavailable");
          return { mime: v.mime_type, bytes: await storage.get(v.storage_key) };
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply
        .type(content.mime)
        .header(
          "Content-Disposition",
          `attachment; filename="campaign-report.${q.format}"`,
        )
        .send(content.bytes);
    },
  );
  app.get(
    "/v1/snapshots/:snapshot",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).snapshot);
      return db.tx(
        async (tx) => {
          await tenantAccess(tx, req.principal, tenant);
          const s = (
            await tx.query(
              "SELECT project_id,body FROM analysis_snapshots WHERE id=$1",
              [id],
            )
          ).rows[0];
          if (s) {
            await projectAccess(tx, req.principal, tenant, s.project_id);
            return snapshotFields(s.body);
          }
          const d = (
            await tx.query("SELECT * FROM analytics_datasets WHERE id=$1", [id])
          ).rows[0];
          if (!d) throw new Problem(404, "NOT_FOUND", "Snapshot not found");
          await projectAccess(tx, req.principal, tenant, d.project_id);
          if (!d.spec_hash || !d.metric_snapshot)
            throw new Problem(
              409,
              "ANALYSIS_SOURCE_UNVERIFIED",
              "Reimport the original file to establish source definitions",
            );
          return snapshotFields({
            id: d.id,
            project_id: d.project_id,
            source: d.source,
            state: "complete",
            row_count: d.rows.length,
            data_as_of: null,
            spec_hash: d.spec_hash,
          });
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/evidence/:evidence",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).evidence);
      return db.tx(
        async (tx) => {
          await tenantAccess(tx, req.principal, tenant);
          const e = (
            await tx.query(
              "SELECT project_id,body FROM analysis_evidence WHERE id=$1 UNION ALL SELECT project_id,body FROM dataset_evidence WHERE id=$1",
              [id],
            )
          ).rows[0];
          if (!e) throw new Problem(404, "NOT_FOUND", "Evidence not found");
          await projectAccess(tx, req.principal, tenant, e.project_id);
          return e.body;
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
}
