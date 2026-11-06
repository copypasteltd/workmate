import { z } from "zod";
import { calculationDigest, analysisDeliveryVersion, analysisRenderInput } from "./analysis-role-delivery.js";
import { Problem, uuid } from "./lib.js";

const sourceEvidence = z.object({
  id: uuid, snapshot_id: uuid, metric_id: z.string().min(1).max(120),
  value: z.string().regex(/^-?\d+(?:\.\d+)?$/).max(100).nullable(),
  unit: z.string().max(120), formula_version: z.string().max(120),
  scope: z.string().min(2).max(6000), null_reason: z.string().max(6000).nullable(),
}).strict();

// Classification alone is not authority. Recheck the actual immutable document
// before publishing it, reading a revision or using its calculated chart facts.
export function checkedAnalysisSource(bytes: Buffer, metadata: Record<string, unknown>) {
  if (bytes.length > 4 * 1024 ** 2) throw new Problem(422, "ANALYSIS_SOURCE_LIMIT", "Choose an analysis source below 4 MiB");
  let body: any;
  try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new Problem(422, "ANALYSIS_SOURCE_INVALID", "Choose a valid structured analysis source"); }
  try {
    if (body?.schema !== analysisDeliveryVersion || metadata.analysis_role_schema !== analysisDeliveryVersion
      || body.data_mode !== metadata.data_mode || body.calculation_sha256 !== metadata.calculation_sha256
      || !body.calculation || calculationDigest(body.calculation) !== body.calculation_sha256) throw Error();
    const render = analysisRenderInput.parse(body.render);
    if (render.calculation_sha256 !== body.calculation_sha256) throw Error();
    const evidence = z.array(sourceEvidence).min(1).max(12800).parse(body.calculation.evidence);
    if (new Set(evidence.map(v => v.id)).size !== evidence.length) throw Error();
    for (const row of evidence) {
      const scope = JSON.parse(row.scope);
      if (!scope || typeof scope !== "object" || Array.isArray(scope) || row.value === null && !row.null_reason) throw Error();
    }
    return body;
  } catch { throw new Problem(409, "ANALYSIS_SOURCE_INTEGRITY", "The analysis source does not match its recorded calculation, environment or evidence"); }
}
