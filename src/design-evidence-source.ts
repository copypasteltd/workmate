import { checkedAnalysisSource } from "./analysis-source.js";
import { designEvidenceRecord, importedDesignEvidence, type DesignEvidenceRecord } from "./portable-design-evidence.js";
import { Problem } from "./lib.js";

export function checkedDesignEvidence(bytes: Buffer, metadata: Record<string, unknown>) {
  let body: any;
  try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "Choose a structured chart source"); }
  if (body?.schema === "copypaste-imported-design-evidence-1") {
    if (metadata.design_evidence_provenance !== "user_attested_import") throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "The imported snapshot has no recorded provenance");
    return { rows: importedDesignEvidence.parse(body).rows, imported: true, unsupported_count: 0 };
  }
  const source = checkedAnalysisSource(bytes, metadata), rows: DesignEvidenceRecord[] = [];
  let unsupported_count = 0;
  for (const row of source.calculation.evidence) {
    const scope = JSON.parse(row.scope), dimensions = scope.dimensions ?? {};
    const parsed = designEvidenceRecord.safeParse({ id: row.id, metric_id: row.metric_id,
      label: String(dimensions.campaign ?? dimensions.channel ?? dimensions.entity_id ?? dimensions.date?.period_day ?? scope.campaign ?? scope.channel ?? scope.entity_id ?? scope.currency ?? row.metric_id),
      value: row.value, unit: row.unit, null_reason: row.null_reason, scope: row.scope });
    // This renderer deliberately supports nonnegative bars. An unrelated signed
    // change must not prevent a valid spend chart from using the same source.
    if (parsed.success) rows.push(parsed.data); else unsupported_count++;
  }
  return { rows, imported: false, unsupported_count };
}
