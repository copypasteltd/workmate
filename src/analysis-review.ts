import { z } from "zod";
import { canonical, csvCell, hash, Problem, uuid } from "./lib.js";
import { calculateAnalysis, stableAnalysisId, analysisSpec, type AnalysisSpec, type AnalysisCalculation } from "./analysis-calculation.js";

export const reviewDigest = (value: AnalysisCalculation) => hash(canonical(JSON.parse(JSON.stringify(value))));
export function calculatePreview(tenant: string, actor: string, project: string, spec: AnalysisSpec, datasets: Parameters<typeof calculateAnalysis>[3]) {
  return calculateAnalysis(stableAnalysisId({ kind: "analysis-preview/202", tenant, actor, project, spec }), project, spec, datasets);
}
export const previewExport = z.object({
  specification: analysisSpec,
  calculation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(["html", "csv", "json"]),
  locale: z.enum(["zh-HK", "en-HK"]).default("zh-HK"),
}).strict();
export function assertPreviewDigest(calculation: AnalysisCalculation, expected: string) {
  if (reviewDigest(calculation) !== expected) throw new Problem(409, "ANALYSIS_PREVIEW_CHANGED", "The selected calculation changed. Review a fresh preview before continuing.");
}
const escape = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function exportPreview(calculation: AnalysisCalculation, mode: "simulated" | "configured_services", format: "html" | "csv" | "json", locale: "zh-HK" | "en-HK") {
  const digest = reviewDigest(calculation), zh = locale === "zh-HK";
  const body = { schema_version: "analysis-review/202", kind: "deterministic_preview", data_mode: mode, model_charges: false, calculation_sha256: digest, calculation };
  let content: string;
  const title = zh ? "營銷證據復核" : "Marketing evidence review";
  const notice = zh ? "確定性預覽 · 未調用模型 · 不是AI敘述報告。不同來源、帳戶、幣種及歸因定義各自獨立；來源取數截止與完整性未知，變化不證明因果或顯著性。" : "Deterministic preview · No model calls · No AI narrative. Sources, accounts, currencies and attribution definitions remain independent. Extraction cutoff and completeness are unknown; changes establish neither causality nor significance.";
  if (format === "json") content = JSON.stringify(body, null, 2) + "\n";
  else if (format === "csv") {
    const rows: unknown[][] = [["kind", "data_mode", "calculation_sha256", "spec_hash", "source", "account_id", "currency", "timezone", "attribution_definition", "conversion_definition", "entity_level", "dimensions", "period", "date_from", "date_to", "row_count", "metric", "exact_value", "unit", "null_reason", "evidence_id", "snapshot_id", "source_snapshots"]];
    for (const group of calculation.groups) {
      for (const period of ["current", "comparison"] as const) {
        const snapshot = group.periods[period];
        if (!snapshot) continue;
        for (const e of calculation.evidence.filter(e => e.snapshot_id === snapshot.id && !e.metric_id.endsWith(".change")))
          rows.push([body.kind, mode, digest, calculation.spec_hash, group.scope.source, group.scope.account_id, group.scope.currency, group.scope.timezone, group.scope.attribution_definition, group.scope.conversion_definition, group.scope.entity_level, canonical(group.scope.dimensions), period, snapshot.scope.date_from, snapshot.scope.date_to, snapshot.row_count, e.metric_id, e.value, e.unit, e.null_reason, e.id, snapshot.id, snapshot.scope.source_snapshot_ids?.join(";")]);
      }
      for (const e of group.changes) rows.push([body.kind, mode, digest, calculation.spec_hash, group.scope.source, group.scope.account_id, group.scope.currency, group.scope.timezone, group.scope.attribution_definition, group.scope.conversion_definition, group.scope.entity_level, canonical(group.scope.dimensions), "change", calculation.spec.date_from, calculation.spec.date_to, group.periods.current.row_count, e.metric_id, e.value, e.unit, e.null_reason, e.id, e.snapshot_id, group.periods.current.scope.source_snapshot_ids?.join(";")]);
    }
    content = "\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  } else {
    const groups = calculation.groups.map(group => {
      const a = group.periods.current, b = group.periods.comparison;
      const rows = calculation.spec.metrics.map(metric => {
        const current = calculation.evidence.find(e => e.snapshot_id === a.id && e.metric_id === metric);
        const previous = b && calculation.evidence.find(e => e.snapshot_id === b.id && e.metric_id === metric);
        const delta = group.changes.find((e: any) => e.metric_id === metric + ".change");
        return `<tr><th>${escape(metric)}</th><td>${escape(current?.value ?? current?.null_reason ?? "unknown")}</td><td>${escape(previous?.value ?? previous?.null_reason ?? "—")}</td><td>${escape(delta?.value ?? delta?.null_reason ?? "—")}</td><td>${escape(current?.unit)}</td><td>${escape([current?.id, previous?.id, delta?.id].filter(Boolean).join(" · "))}</td></tr>`;
      }).join("");
      return `<section><h2>${escape(group.scope.source)} · ${escape(group.scope.account_id || "unknown")} · ${escape(group.scope.currency)}</h2><pre>${escape(JSON.stringify(group.scope, null, 2))}</pre><p>${escape(calculation.spec.date_from)} → ${escape(calculation.spec.date_to)} (${a.row_count})${b ? ` / ${escape(calculation.spec.comparison?.date_from)} → ${escape(calculation.spec.comparison?.date_to)} (${b.row_count})` : ""}</p><div class="table"><table><thead><tr><th>Metric</th><th>Current · exact</th><th>Comparison · exact</th><th>Change · ratio</th><th>Unit</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join("");
    content = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"><title>${title}</title><style>body{margin:0;background:#f6f7f9;color:#15181d;font:16px/1.6 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:clamp(16px,4vw,52px)}header{border-top:8px solid #194bfb;padding-top:20px}h1{font-size:clamp(30px,5vw,58px);line-height:1.1}section{background:white;border:1px solid #dde2ea;padding:20px;margin:20px 0}pre,td{overflow-wrap:anywhere;white-space:pre-wrap}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px}th,td{border-bottom:1px solid #dde2ea;text-align:left;padding:8px;vertical-align:top}code{overflow-wrap:anywhere}@media print{section{break-inside:avoid}body{background:white}}</style></head><body><main><header><p>COPYPASTE / EVIDENCE</p><h1>${title}</h1><p>${escape(calculation.spec.prompt)}</p><p>${notice}</p><p>${escape(mode)} · SHA256 <code>${digest}</code></p></header>${groups}<section><h2>${zh ? "固定來源與完整證據" : "Fixed sources and complete evidence"}</h2><pre>${escape(JSON.stringify(body, null, 2))}</pre></section></main></body></html>`;
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > 8 * 1024 ** 2) throw new Problem(413, "ANALYSIS_EXPORT_TOO_LARGE", "Select fewer source scopes before exporting this review");
  return { bytes, sha256: hash(bytes), filename: `marketing-review-${digest.slice(0, 12)}.${format}`, mime: ({ html: "text/html", csv: "text/csv", json: "application/json" })[format] + "; charset=utf-8" };
}

// A cursor is a position, never an authorization. Bind it to its list and query;
// every page still runs the current project/actor/source RLS checks.
const listInput = z.object({ search: z.string().trim().max(160).default(""), cursor: z.string().min(1).max(1500).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
const position = z.object({ scope: z.string().regex(/^[a-f0-9]{64}$/), at: z.string().datetime({ offset: true }), id: uuid }).strict();
export function reviewPage(query: unknown, scope: string, defaultLimit: number) {
  const q = listInput.parse(query), fingerprint = hash(canonical({ scope, search: q.search }));
  let after: z.infer<typeof position> | null = null;
  if (q.cursor) {
    try { after = position.parse(JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8"))); if (after.scope !== fingerprint) throw Error(); }
    catch { throw new Problem(400, "INVALID_CURSOR", "This list changed. Start again from the first page."); }
  }
  return { search: q.search, limit: q.limit ?? defaultLimit, at: after?.at ?? null, id: after?.id ?? null, next: (row: any) => Buffer.from(JSON.stringify({ scope: fingerprint, at: row.list_cursor_at, id: row.id })).toString("base64url") };
}
