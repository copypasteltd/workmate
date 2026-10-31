import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";

const text = z.string().max(6000);
export const designEvidenceRecord = z.object({
  id: uuid, metric_id: z.string().min(1).max(120), label: text.min(1),
  value: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/).nullable(),
  unit: z.string().max(120), null_reason: text.nullable(), scope: text.min(2),
}).strict().superRefine((r, ctx) => {
  try {
    const value = JSON.parse(r.scope);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
  } catch { ctx.addIssue({ code: "custom", path: ["scope"], message: "Retain a bounded JSON scope object" }); }
  if (r.value === null && !r.null_reason) ctx.addIssue({ code: "custom", message: "Missing values require a reason" });
});
export const importedDesignEvidence = z.object({
  schema: z.literal("copypaste-imported-design-evidence-1"),
  provenance: z.literal("user_attested_import"),
  rows: z.array(designEvidenceRecord).min(1).max(12800),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.rows.map(r => r.id)).size !== v.rows.length) ctx.addIssue({ code: "custom", message: "Evidence IDs must be distinct" });
});
export type ImportedDesignEvidence = z.infer<typeof importedDesignEvidence>;
export type DesignEvidenceRecord = z.infer<typeof designEvidenceRecord>;
export function selectDesignEvidence(rows: DesignEvidenceRecord[], ids: string[]) {
  const selected = ids.map(id => rows.find(r => r.id === id));
  if (selected.some(r => !r)) throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "A chart contains an unknown evidence ID");
  const checked = selected as DesignEvidenceRecord[];
  const scopes = new Set(checked.map(r => { const s = JSON.parse(r.scope); return canonical({
    metric: r.metric_id, unit: r.unit, currency: s.currency, account_id: s.account_id,
    attribution_definition: s.attribution_definition, conversion_definition: s.conversion_definition,
    period: s.period, date_from: s.date_from, date_to: s.date_to,
  }); }));
  if (scopes.size !== 1) throw new Problem(422, "DESIGN_EVIDENCE_SCOPE", "Separate metrics, accounts, currencies, periods and attribution definitions into distinct charts");
  return checked;
}
export const importedEvidenceDigest = (rows: DesignEvidenceRecord[]) => hash(canonical(rows));
