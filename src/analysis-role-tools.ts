import { z } from "zod";
import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { analysisDatasets } from "./analysis-reports.js";
import {
  calculateAnalysis,
  normalizedAnalysis,
  stableAnalysisId,
} from "./analysis-calculation.js";
import {
  analysisCalculationPage,
  analysisDeliveryVersion,
  renderAnalysisDelivery,
  roleAnalysisSpec,
  type AnalysisRenderInput,
} from "./analysis-role-delivery.js";
import {
  recordTaskSourceRead,
  recordTaskContentRead,
} from "./task-content-sources.js";
import { taskPrivateAssetScopeSQL } from "./task-private-asset-scope.js";
import { connectorFact, connectorLimits } from "./connector-model.js";
import { campaignFile, normalizeCampaignFile } from "./analytics-file.js";
import {
  calculateWebAnalytics,
  checkedWebSnapshot,
  webAnalyticsPage,
  webAnalyticsSelection,
} from "./web-analytics.js";

export const analysisSourcesInput = z
  .object({
    kind: z.enum(["datasets", "files"]).default("datasets"),
    after_id: uuid.optional(),
    limit: z.number().int().min(1).max(20).default(12),
  })
  .strict();
const connectorReadFields = z
  .object({
    snapshot_id: uuid.optional(),
    after_id: uuid.optional(),
    offset: z.number().int().min(0).max(connectorLimits.facts).default(0),
    limit: z.number().int().min(1).max(20).default(12),
  })
  .strict();
export const connectorReadInputV1 = connectorReadFields.refine(
  (v) => (v.snapshot_id ? !v.after_id : v.offset === 0),
  "Choose a snapshot with a fact offset, or list snapshots with an optional cursor",
);
export const connectorReadInput = connectorReadFields
  .extend({ analysis: webAnalyticsSelection.optional() })
  .refine(
    (v) => (v.snapshot_id ? !v.after_id : v.offset === 0),
    "Choose a snapshot with a fact offset, or list snapshots with an optional cursor",
  )
  .refine(
    (v) => !v.analysis || !!v.snapshot_id,
    "Website calculations require one exact captured snapshot",
  );
export const analysisSourceReadInput = z
  .object({ source_version_id: uuid })
  .strict();
export const analysisFileInspectInput = z
  .object({
    asset_version_id: uuid,
    sheet_name: z.string().min(1).max(200).optional(),
    header_row: z.number().int().min(1).max(1000).optional(),
    csv_delimiter: z.enum(["comma", "semicolon", "tab"]).optional(),
    csv_encoding: z.enum(["utf8", "utf16le", "utf16be"]).optional(),
  })
  .strict();

/** A list is a fresh authorized directory, never a cached claim of source access. */
export async function listAnalysisSources(
  tx: Tx,
  t: any,
  input: z.infer<typeof analysisSourcesInput>,
) {
  if (input.kind === "files") {
    const rows = (
      await tx.query(
        `SELECT a.id AS asset_id,a.name,v.id AS asset_version_id,v.version,v.sha256,v.bytes,v.mime_type
      FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
      WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND v.bytes<=5000000 AND a.name~*'\\.(csv|xlsx)$'
        AND ($3::uuid IS NULL OR v.id>$3)
        AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5 AND ${taskPrivateAssetScopeSQL(6, 8)}))
        AND task_asset_version_sources_available(v.id) ORDER BY v.id LIMIT $7`,
        [
          t.tenant_id,
          t.project_id,
          input.after_id ?? null,
          t.created_by,
          t.private_owner ?? null,
          t.conversation_id ?? null,
          input.limit + 1,
          t.id,
        ],
      )
    ).rows;
    const page = rows.slice(0, input.limit);
    for (const v of page)
      await recordTaskSourceRead(
        tx,
        t,
        "asset_version",
        v.asset_version_id,
        v.asset_version_id,
        v.sha256,
      );
    return {
      kind: "authorized_analysis_files",
      data_mode: t.data_mode,
      items: page,
      next_after_id:
        rows.length > input.limit ? page.at(-1)!.asset_version_id : null,
      instructions:
        "Inspect the selected fixed CSV/XLSX with analysis_file_inspect. Supply its exact version and SHA-256 plus confirmed source definitions in file_inputs for sheet_calculate/chart_render. Private attachments remain private; this flow creates no shared analytics dataset.",
    };
  }
  const rows = (
    await tx.query(
      `SELECT d.id,d.name,d.source,d.currency,d.timezone,d.import_spec,d.source_sha256,d.spec_hash,d.created_at,
      d.supersedes_id,d.source_asset_version_id,jsonb_array_length(d.rows) AS row_count
     FROM analytics_datasets d WHERE d.tenant_id=$1 AND d.project_id=$2
      AND ($3::uuid IS NULL OR d.id>$3) AND d.content_state='active' AND d.source_state='active'
      AND d.retention_expires_at>clock_timestamp() AND d.import_spec IS NOT NULL
      AND d.metric_snapshot IS NOT NULL AND d.source_sha256 IS NOT NULL AND d.spec_hash IS NOT NULL
      AND (d.source_asset_version_id IS NULL OR EXISTS(
        SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
        WHERE v.id=d.source_asset_version_id AND v.sha256=d.source_sha256 AND v.erased_at IS NULL
          AND a.tenant_id=d.tenant_id AND a.project_id=d.project_id AND a.private_owner IS NULL
          AND a.state='active' AND a.retention_expires_at>clock_timestamp()))
     ORDER BY d.id LIMIT $4`,
      [t.tenant_id, t.project_id, input.after_id ?? null, input.limit + 1],
    )
  ).rows;
  const page = rows.slice(0, input.limit);
  for (const d of page) await recordTaskSourceRead(tx, t, "dataset", d.id);
  return {
    kind: "frozen_analysis_datasets",
    data_mode: t.data_mode,
    items: page.map((d) => ({
      id: d.id,
      name: d.name,
      source: d.source,
      currency: d.currency,
      timezone: d.timezone,
      row_count: d.row_count,
      captured_at: d.created_at,
      platform_data_as_of: null,
      source_sha256: d.source_sha256,
      definition_sha256: d.spec_hash,
      account_id: d.import_spec.account_id ?? null,
      attribution_definition: d.import_spec.attribution_definition,
      conversion_definition: d.import_spec.conversion_definition,
      entity_level: d.import_spec.entity_level,
      date_range: d.import_spec.date_range ?? null,
      supersedes_id: d.supersedes_id,
    })),
    next_after_id: rows.length > input.limit ? page.at(-1)!.id : null,
    limitation:
      "Only currently authorized frozen imports are listed. A captured CSV does not prove complete live account coverage. Import an authorized CSV/XLSX or select a completed connector snapshot if none exists.",
  };
}

async function analysisFileVersion(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
  expected?: string,
) {
  const v = (
    await tx.query(
      `SELECT v.*,a.name FROM assets a JOIN asset_versions v ON v.asset_id=a.id
    WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.state='active'
      AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5
        AND ${taskPrivateAssetScopeSQL(6, 7)}))
      AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`,
      [
        id,
        t.tenant_id,
        t.project_id,
        t.created_by,
        t.private_owner ?? null,
        t.conversation_id ?? null,
        t.id,
      ],
    )
  ).rows[0];
  if (!v || !/\.(csv|xlsx)$/i.test(v.name))
    throw new Problem(
      404,
      "NOT_FOUND",
      "The fixed analysis file is unavailable",
    );
  if (Number(v.bytes) > 5000000)
    throw new Problem(
      413,
      "IMPORT_FILE_SIZE",
      "Choose a CSV or XLSX up to 5 MB",
    );
  if (expected && v.sha256 !== expected)
    throw new Problem(
      409,
      "ANALYSIS_FILE_CHANGED",
      "The analysis file digest does not match its fixed version",
    );
  const bytes = await storage.get(v.storage_key);
  if (hash(bytes) !== v.sha256)
    throw new Problem(
      409,
      "ANALYSIS_SOURCE_INTEGRITY",
      "The analysis file failed its byte check",
    );
  await recordTaskContentRead(tx, t, "asset_version", v.id, v.id, v.sha256);
  return { v, bytes };
}
export async function inspectAnalysisFile(
  tx: Tx,
  storage: Storage,
  t: any,
  input: z.infer<typeof analysisFileInspectInput>,
) {
  const { v, bytes } = await analysisFileVersion(
    tx,
    storage,
    t,
    input.asset_version_id,
  );
  const file = campaignFile(bytes, v.name, input);
  return {
    asset_version_id: v.id,
    sha256: v.sha256,
    filename: v.name,
    file_type: file.file_type,
    headers: file.headers,
    input_row_count: file.input_row_count,
    sheets: file.sheets,
    selected_sheet: file.selected_sheet,
    header_row: file.header_row,
    hidden_rows: file.hidden_rows,
    csv_delimiter: file.csv_delimiter,
    csv_encoding: file.csv_encoding,
    instructions:
      "Confirm date order, decimal/grouping format and CSV delimiter/header/encoding without guessing; use number_format/date_format in options. Confirm source, currency, timezone, account, attribution and conversion definitions; map actual column headers if necessary. Supply file_inputs with this fixed version/hash. Missing conversions or revenue stay unknown. Platform exports require complete definitions. No shared dataset is created.",
  };
}
export async function taskAnalysis(
  tx: Tx,
  storage: Storage,
  t: any,
  input: unknown,
) {
  const original = roleAnalysisSpec.parse(input);
  const { file_inputs: rawFiles, ...base } = original;
  const file_inputs = [...rawFiles].sort((a, b) =>
    a.asset_version_id.localeCompare(b.asset_version_id),
  );
  if (
    new Set(file_inputs.map((f) => f.asset_version_id)).size !==
    file_inputs.length
  )
    throw new Problem(
      422,
      "ANALYSIS_FILE_DUPLICATE",
      "Select each fixed input file once",
    );
  const datasets = await analysisDatasets(tx, t.project_id, base.snapshot_ids);
  if (datasets.length !== new Set(base.snapshot_ids).size)
    throw new Problem(
      404,
      "NOT_FOUND",
      "A selected analysis source is unavailable",
    );
  for (const d of datasets) await recordTaskSourceRead(tx, t, "dataset", d.id);
  const fileBindings = new Map<string, string>();
  for (const file of file_inputs) {
    const { v, bytes } = await analysisFileVersion(
      tx,
      storage,
      t,
      file.asset_version_id,
      file.sha256,
    );
    const d = normalizeCampaignFile(bytes, v.name, file.options, file);
    const id = stableAnalysisId({
      kind: "task-fixed-file",
      asset_version_id: v.id,
      source_sha256: d.source_sha256,
      spec_hash: d.spec_hash,
    });
    fileBindings.set(id, v.id);
    datasets.push({
      id,
      project_id: t.project_id,
      source: d.source,
      currency: d.currency,
      timezone: d.timezone,
      rows: d.rows,
      import_spec: d.spec,
      source_sha256: d.source_sha256,
      spec_hash: d.spec_hash,
      metric_snapshot: { summary: d.summary },
      created_at: v.created_at,
    });
  }
  const spec = normalizedAnalysis({
    ...base,
    snapshot_ids: [...new Set(datasets.map((d) => d.id))],
  });
  const id = stableAnalysisId({ task_id: t.id, specification: spec });
  const calculation = calculateAnalysis(id, t.project_id, spec, datasets);
  calculation.sources = calculation.sources.map((s) => ({
    ...s,
    ...(fileBindings.has(s.snapshot_id)
      ? { source_asset_version_id: fileBindings.get(s.snapshot_id) }
      : {}),
  }));
  return {
    datasets,
    calculation,
    specification: {
      ...base,
      snapshot_ids: [...new Set(base.snapshot_ids)].sort(),
      file_inputs: [...file_inputs].sort((a, b) =>
        a.asset_version_id.localeCompare(b.asset_version_id),
      ),
    },
  };
}
export async function calculateTaskAnalysis(
  tx: Tx,
  storage: Storage,
  t: any,
  input: { specification: unknown; offset: number },
) {
  const result = await taskAnalysis(tx, storage, t, input.specification);
  return {
    ...analysisCalculationPage(result.calculation, input.offset),
    specification: result.specification,
  };
}

async function sourceVersion(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
  expected?: string,
) {
  const v = (
    await tx.query(
      `SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id
     WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.state='active'
       AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
       AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5
         AND ${taskPrivateAssetScopeSQL(6, 7)}))
       AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`,
      [
        id,
        t.tenant_id,
        t.project_id,
        t.created_by,
        t.private_owner ?? null,
        t.conversation_id ?? null,
        t.id,
      ],
    )
  ).rows[0];
  if (
    !v ||
    v.mime_type !== "application/json" ||
    v.metadata.analysis_role_schema !== analysisDeliveryVersion
  )
    throw new Problem(
      404,
      "NOT_FOUND",
      "The editable analysis source is unavailable",
    );
  if (expected && v.sha256 !== expected)
    throw new Problem(
      409,
      "ANALYSIS_REVISION_CHANGED",
      "The selected original source digest does not match",
    );
  if (Number(v.bytes) > 4 * 1024 * 1024)
    throw new Problem(
      422,
      "ANALYSIS_SOURCE_LIMIT",
      "The editable analysis source exceeds the supported size",
    );
  const bytes = await storage.get(v.storage_key);
  if (hash(bytes) !== v.sha256)
    throw new Problem(
      409,
      "ANALYSIS_SOURCE_INTEGRITY",
      "The editable analysis source failed its byte check",
    );
  const body = JSON.parse(bytes.toString("utf8"));
  if (
    body.schema !== analysisDeliveryVersion ||
    body.calculation_sha256 !== v.metadata.calculation_sha256
  )
    throw new Problem(
      409,
      "ANALYSIS_SOURCE_INTEGRITY",
      "The editable analysis source has an invalid schema or binding",
    );
  await recordTaskContentRead(tx, t, "asset_version", v.id, v.id, v.sha256);
  return { v, body };
}
export async function readAnalysisSource(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
) {
  const { v, body } = await sourceVersion(tx, storage, t, id);
  return {
    schema: body.schema,
    source_version_id: v.id,
    sha256: v.sha256,
    calculation_sha256: body.calculation_sha256,
    render: body.render,
    narrative: body.narrative,
    instructions:
      "Recalculate this specification through sheet_calculate before chart_render. Changes create new immutable artifacts; supply revision_of with this exact version ID and digest. Old files are retained.",
  };
}
export async function deliverTaskAnalysis(
  tx: Tx,
  storage: Storage,
  t: any,
  input: AnalysisRenderInput,
) {
  const prior = (
    await tx.query(
      `SELECT result,output_version_ids FROM task_tool_receipts
    WHERE task_id=$1 AND tool_name='chart_render' AND input_hash=$2 AND attempt<=$3
    ORDER BY attempt,created_at LIMIT 1`,
      [t.id, hash(canonical(input)), t.attempt],
    )
  ).rows[0];
  if (prior) {
    const current = (
      await tx.query(
        `SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=ANY($1::uuid[]) AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
        [prior.output_version_ids],
      )
    ).rowCount;
    if (current !== prior.output_version_ids.length)
      throw new Problem(
        409,
        "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
        "The original delivery is unavailable; do not regenerate it automatically",
      );
    return prior.result;
  }
  if (input.revision_of)
    await sourceVersion(
      tx,
      storage,
      t,
      input.revision_of.source_version_id,
      input.revision_of.sha256,
    );
  const { datasets, calculation } = await taskAnalysis(
    tx,
    storage,
    t,
    input.specification,
  );
  const delivery = renderAnalysisDelivery(
    calculation,
    input,
    datasets,
    t.data_mode,
  );
  const saved = [];
  // All output bytes are validated before the first write. A single transaction
  // publishes the whole revision and its exact replay receipt.
  for (const f of delivery.files) {
    const result = await saveAsset(tx, storage, {
      tenant: t.tenant_id,
      project: t.project_id,
      user: t.created_by,
      kind: "deliverable",
      name: f.name,
      mime: f.mime,
      bytes: f.bytes,
      metadata: {
        task_id: t.id,
        analysis_role_schema: analysisDeliveryVersion,
        calculation_sha256: delivery.calculation_sha256,
        ...(input.revision_of
          ? { analysis_revision_of: input.revision_of }
          : {}),
        deterministic_tool: "chart.render/1.0.0",
        provider_calls: 0,
      },
    });
    saved.push({
      filename: f.name,
      mime_type: f.mime,
      asset_id: result.id,
      asset_version_id: result.version.id,
      version: result.version.version,
      sha256: result.version.sha256,
      bytes: f.bytes.length,
    });
  }
  const source = saved.find((f) => f.filename === "analysis.source.json")!;
  return {
    schema: analysisDeliveryVersion,
    state: "delivered",
    data_mode: t.data_mode,
    calculation_sha256: delivery.calculation_sha256,
    files: saved,
    editable_source: {
      asset_version_id: source.asset_version_id,
      sha256: source.sha256,
    },
    revision_of: input.revision_of ?? null,
    provider_calls: 0,
    additional_ai_charge_micros: "0",
    limitations: delivery.manifest.limitations,
  };
}

const snapshotBody = z
  .object({
    schema: z.literal("copypaste-connector-snapshot-1"),
    source_mode: z.enum(["simulated", "configured_services"]),
    spec_hash: z.string().regex(/^[a-f\d]{64}$/),
    specification: z.record(z.string(), z.unknown()),
    facts: z.array(connectorFact).max(connectorLimits.facts),
    limitations: z.array(z.string()),
    captured_at: z.iso.datetime(),
    data_as_of: z.null(),
  })
  .strict();
/** This tool reads captured facts only. It cannot authorize, sync or write an
 * external account and never returns credentials or provider request payloads. */
export async function readFrozenConnector(
  tx: Tx,
  storage: Storage,
  t: any,
  input: z.infer<typeof connectorReadInput>,
) {
  const rows = (
    await tx.query(
      `SELECT s.*,v.id AS source_version_id,v.storage_key,v.sha256 AS version_sha256
     FROM connector_snapshots s JOIN assets a ON a.id=s.asset_id
       JOIN asset_versions v ON v.asset_id=s.asset_id AND v.version=s.asset_version
     WHERE s.tenant_id=$1 AND s.project_id=$2 AND ($3::uuid IS NULL OR s.id=$3)
       AND ($4::uuid IS NULL OR s.id>$4) AND a.private_owner IS NULL AND a.state='active'
       AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
       AND connector_asset_available(a.id) ORDER BY s.id LIMIT $5`,
      [
        t.tenant_id,
        t.project_id,
        input.snapshot_id ?? null,
        input.after_id ?? null,
        input.snapshot_id ? 1 : input.limit + 1,
      ],
    )
  ).rows;
  if (!input.snapshot_id) {
    const page = rows.slice(0, input.limit);
    for (const s of page)
      await recordTaskSourceRead(
        tx,
        t,
        "asset_version",
        s.source_version_id,
        s.source_version_id,
        s.sha256,
      );
    return {
      kind: "captured_connector_snapshots",
      data_mode: t.data_mode,
      items: page.map((s) => ({
        id: s.id,
        source: s.source,
        state: s.state,
        row_count: s.row_count,
        data_mode: s.data_mode,
        captured_at: s.captured_at,
        platform_data_as_of: s.data_as_of,
        source_sha256: s.sha256,
        spec_hash: s.spec_hash,
        dataset_ids: s.dataset_ids,
        limitations: s.limitations,
      })),
      next_after_id: rows.length > input.limit ? page.at(-1)!.id : null,
      limitation:
        "Captured snapshots only; no live account request is made. Use dataset_ids with sheet_calculate for normalized marketing metrics; unsupported report types remain facts, not invented analytics datasets.",
    };
  }
  const row = rows[0];
  if (!row)
    throw new Problem(
      404,
      "NOT_FOUND",
      "The connector snapshot is unavailable",
    );
  const bytes = await storage.get(row.storage_key);
  if (
    bytes.length > connectorLimits.rawBytes ||
    hash(bytes) !== row.sha256 ||
    row.sha256 !== row.version_sha256
  )
    throw new Problem(
      409,
      "CONNECTOR_SNAPSHOT_INTEGRITY",
      "The captured connector snapshot failed its byte check",
    );
  const body = snapshotBody.parse(JSON.parse(bytes.toString("utf8")));
  if (
    body.spec_hash !== row.spec_hash ||
    body.source_mode !== row.data_mode ||
    body.facts.length !== row.row_count
  )
    throw new Problem(
      409,
      "CONNECTOR_SNAPSHOT_INTEGRITY",
      "The captured connector snapshot failed its scope check",
    );
  if (!input.analysis && input.offset > body.facts.length)
    throw new Problem(
      422,
      "ANALYSIS_PAGE_RANGE",
      "The fact offset exceeds this snapshot",
    );
  await recordTaskContentRead(
    tx,
    t,
    "asset_version",
    row.source_version_id,
    row.source_version_id,
    row.sha256,
  );
  if (input.analysis) {
    const checked = checkedWebSnapshot(row, bytes);
    const query = new URLSearchParams({
      profile: input.analysis.profile,
      account_id: input.analysis.account_id,
      date_from: input.analysis.date_from,
      date_to: input.analysis.date_to,
      group_by: [...input.analysis.group_by].sort().join(","),
    });
    const reportPath = `/v1/tenants/${t.tenant_id}/projects/${t.project_id}/connector-snapshots/${row.id}/web-analysis`;
    return {
      kind: "captured_web_analytics",
      ...webAnalyticsPage(
        calculateWebAnalytics(row, checked, input.analysis),
        input.offset,
        Math.min(input.limit, 2),
      ),
      report_downloads: Object.fromEntries(
        ["html", "csv", "json"].map((format) => [
          format,
          reportPath + "?" + query.toString() + "&format=" + format,
        ]),
      ),
      page_notice:
        "Group evidence is paginated. Follow next_offset. Summary covers observed captured rows only; totalUsers is never added across source rows. No live request or additional model charge.",
    };
  }
  const end = input.offset + input.limit;
  return {
    kind: "captured_connector_facts",
    snapshot_id: row.id,
    data_mode: body.source_mode,
    specification: body.specification,
    spec_hash: body.spec_hash,
    source_sha256: row.sha256,
    captured_at: body.captured_at,
    platform_data_as_of: body.data_as_of,
    dataset_ids: row.dataset_ids,
    facts: body.facts.slice(input.offset, end),
    total_facts: body.facts.length,
    next_offset: end < body.facts.length ? end : null,
    limitations: body.limitations,
  };
}
