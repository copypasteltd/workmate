import { PNG } from "pngjs";
import type { Tx } from "./db.js";
import { saveAsset, type Storage } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  recordTaskSourceRead,
  recordTaskContentRead,
} from "./task-content-sources.js";
import { taskPrivateAssetScopeSQL } from "./task-private-asset-scope.js";
import { readAnalysisSource } from "./analysis-role-tools.js";
import { calculationDigest } from "./analysis-role-delivery.js";
import { importedDesignEvidence, importedEvidenceDigest } from "./portable-design-evidence.js";
import { prepareBrandProduction } from "./brand-production.js";
import {
  editableDesignSchema,
  vectorInput,
  slidesInput,
  type SlidesInput,
  type VectorInput,
  type DesignScene,
} from "./editable-design-model.js";
import {
  renderEditableDesign,
  packageEditableDesign,
  designChartKey,
  type DesignEvidence,
  type DesignResources,
} from "./editable-design-render.js";

const missing = () =>
  new Problem(
    404,
    "NOT_FOUND",
    "The authorized fixed design source is unavailable",
  );
async function version(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
  expected?: string,
) {
  const v = (
    await tx.query(
      `SELECT v.*,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.state='active'
      AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5 AND ${taskPrivateAssetScopeSQL(6, 7)}))
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
  if (!v) throw missing();
  if (expected && v.sha256 !== expected)
    throw new Problem(
      409,
      "DESIGN_SOURCE_CHANGED",
      "Read the exact source version before using or changing it",
    );
  if (Number(v.bytes) > 12 * 1024 * 1024)
    throw new Problem(
      413,
      "DESIGN_SOURCE_LIMIT",
      "Choose a fixed source below 12 MiB",
    );
  const bytes = await storage.get(v.storage_key);
  if (bytes.length !== Number(v.bytes) || hash(bytes) !== v.sha256)
    throw new Problem(
      409,
      "DESIGN_SOURCE_INTEGRITY",
      "The source bytes no longer match their saved digest",
    );
  if (v.metadata.task_id !== t.id)
    await recordTaskContentRead(tx, t, "asset_version", v.id, v.id, v.sha256);
  return { v, bytes };
}
export async function listDesignSources(
  tx: Tx,
  t: any,
  input: { kind: "images" | "analysis"; after_id?: string; limit: number },
) {
  const rows = (
    await tx.query(
      `SELECT a.id AS asset_id,a.name,v.id AS asset_version_id,v.sha256,v.mime_type,v.bytes,v.version
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
    WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND ($3::uuid IS NULL OR v.id>$3) AND task_asset_version_sources_available(v.id)
      AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5 AND ${taskPrivateAssetScopeSQL(6, 9)}))
      AND (($7='images' AND v.mime_type='image/png' AND v.bytes<=10485760) OR ($7='analysis' AND v.metadata->>'analysis_role_schema'='copypaste-analysis-delivery-1' AND a.name='analysis.source.json'))
    ORDER BY v.id LIMIT $8`,
      [
        t.tenant_id,
        t.project_id,
        input.after_id ?? null,
        t.created_by,
        t.private_owner ?? null,
        t.conversation_id ?? null,
        input.kind,
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
    kind: input.kind,
    data_mode: t.data_mode,
    items: page,
    next_after_id:
      rows.length > input.limit ? page.at(-1)!.asset_version_id : null,
    instructions:
      "Select exact version IDs and hashes. Images remain raster. Read analysis evidence through design_chart_read; never supply invented chart values. Use the analysis tools or analyst specialist to prepare missing evidence.",
  };
}
async function analysis(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
  expected?: string,
) {
  const imported = await version(tx, storage, t, id, expected);
  if (imported.v.mime_type === "application/json" && imported.v.metadata.design_evidence_provenance === "user_attested_import") {
    const snapshot = importedDesignEvidence.parse(JSON.parse(imported.bytes.toString("utf8")));
    return { source_version_id: id, sha256: imported.v.sha256, calculation_sha256: importedEvidenceDigest(snapshot.rows),
      evidence: snapshot.rows, provenance: "user_attested_import" as const };
  }
  const read = await readAnalysisSource(tx, storage, t, id);
  if (expected && read.sha256 !== expected)
    throw new Problem(
      409,
      "DESIGN_SOURCE_CHANGED",
      "The analysis source changed",
    );
  const { bytes } = await version(tx, storage, t, id, read.sha256),
    body = JSON.parse(bytes.toString("utf8"));
  if (
    body.schema !== "copypaste-analysis-delivery-1" ||
    body.calculation_sha256 !== read.calculation_sha256 ||
    calculationDigest(body.calculation) !== read.calculation_sha256
  )
    throw new Problem(
      409,
      "DESIGN_EVIDENCE_INTEGRITY",
      "Use an intact deterministic analysis source",
    );
  return {
    source_version_id: id,
    sha256: read.sha256,
    calculation_sha256: read.calculation_sha256,
    provenance: "current_project_analysis" as const,
    evidence: body.calculation.evidence as Array<{
      id: string;
      value: string | null;
      unit: string;
      scope: string;
      null_reason: string | null;
      metric_id: string;
    }>,
  };
}
export async function readDesignChart(
  tx: Tx,
  storage: Storage,
  t: any,
  input: { source_version_id: string; offset: number },
) {
  const a = await analysis(tx, storage, t, input.source_version_id);
  if (input.offset > a.evidence.length)
    throw new Problem(
      422,
      "DESIGN_EVIDENCE_OFFSET",
      "The offset exceeds this source",
    );
  return {
    source_version_id: a.source_version_id,
    sha256: a.sha256,
    calculation_sha256: a.calculation_sha256,
    data_provenance: a.provenance,
    evidence: a.evidence.slice(input.offset, input.offset + 24),
    next_offset:
      input.offset + 24 < a.evidence.length ? input.offset + 24 : null,
    total: a.evidence.length,
    instructions:
      "Choose up to eight actual evidence IDs for each chart. A chart must retain one metric, unit, currency, account, attribution, conversion definition and date range. Missing values retain N/A and are not zero.",
  };
}
export async function readDesignSource(
  tx: Tx,
  storage: Storage,
  t: any,
  id: string,
  expected?: string,
) {
  const { v, bytes } = await version(tx, storage, t, id, expected);
  if (
    v.mime_type !== "application/json" ||
    v.metadata.editable_design_schema !== editableDesignSchema
  )
    throw missing();
  const body = JSON.parse(bytes.toString("utf8"));
  if (
    body.schema !== editableDesignSchema ||
    body.kind !== v.metadata.design_kind ||
    !["vector", "presentation"].includes(body.kind)
  )
    throw missing();
  const input =
    body.kind === "vector"
      ? vectorInput.parse(body.input)
      : slidesInput.parse(body.input);
  if (hash(canonical(input)) !== body.input_sha256)
    throw new Problem(
      409,
      "DESIGN_SOURCE_INTEGRITY",
      "The editable source input does not match its recorded digest",
    );
  return {
    schema: editableDesignSchema,
    kind: body.kind,
    source_version_id: v.id,
    sha256: v.sha256,
    input,
    instructions:
      "Revise this actual input and supply revision_of with its exact source version ID and SHA-256. Existing source/deliverable bytes remain intact. A prepared presentation still requires slides_render before it is delivered.",
  };
}
export function decodePNG(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 10 * 1024 * 1024 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Problem(
      422,
      "DESIGN_IMAGE_INVALID",
      "Choose a complete PNG image below 10 MiB",
    );
  const w = bytes.readUInt32BE(16),
    h = bytes.readUInt32BE(20);
  if (w < 1 || h < 1 || w > 4096 || h > 4096 || w * h > 16777216)
    throw new Problem(
      422,
      "DESIGN_IMAGE_LIMIT",
      "PNG dimensions must not exceed 4096 pixels or 16 megapixels",
    );
  let pos = 8,
    ended = false;
  while (pos < bytes.length) {
    if (pos + 12 > bytes.length)
      throw new Problem(422, "DESIGN_IMAGE_INVALID", "Truncated PNG chunk");
    const length = bytes.readUInt32BE(pos),
      end = pos + 12 + length,
      type = bytes.toString("ascii", pos + 4, pos + 8);
    if (end > bytes.length || ["acTL", "fcTL", "fdAT"].includes(type))
      throw new Problem(
        422,
        "DESIGN_IMAGE_INVALID",
        "Use a static intact PNG image",
      );
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length)
        throw new Problem(
          422,
          "DESIGN_IMAGE_INVALID",
          "Unexpected PNG trailing content",
        );
      ended = true;
    }
    pos = end;
  }
  if (!ended)
    throw new Problem(422, "DESIGN_IMAGE_INVALID", "The PNG is incomplete");
  try {
    PNG.sync.read(bytes, { checkCRC: true });
  } catch {
    throw new Problem(
      422,
      "DESIGN_IMAGE_INVALID",
      "The PNG bytes failed decoding",
    );
  }
}
async function assertFixedBrand(
  tx: Tx,
  t: any,
  input: VectorInput | SlidesInput,
) {
  const bound = t.input_context?.agent_id
    ? (
        await tx.query(
          "SELECT body->'brand' AS brand FROM agent_versions WHERE agent_id=$1 AND version=$2",
          [t.input_context.agent_id, t.input_context.agent_version],
        )
      ).rows[0]?.brand
    : null;
  if (
    bound &&
    (input.brand?.id !== bound.id || input.brand?.version !== bound.version)
  )
    throw new Problem(
      422,
      "BRAND_BINDING_REQUIRED",
      "This specialist must render with its fixed brand version",
    );
}
async function resources(
  tx: Tx,
  storage: Storage,
  t: any,
  kind: "vector" | "presentation",
  input: VectorInput | SlidesInput,
) {
  const scenes: DesignScene[] =
    kind === "vector"
      ? [(input as VectorInput).scene]
      : (input as SlidesInput).slides.map((s) => s.scene);
  const result: DesignResources = { images: new Map(), charts: new Map() },
    sources: any[] = [];
  if (input.brand) {
    if (
      input.brand.locale !== input.locale &&
      !(input.locale === "zh-HK" && input.brand.locale === "zh-Hant-HK")
    )
      throw new Problem(
        422,
        "DESIGN_BRAND_LOCALE",
        "Use the same language as the fixed brand binding",
      );
    const texts = scenes
      .flatMap((s) => s.layers)
      .filter((l) => l.kind === "text")
      .map((l) => ({ text: l.kind === "text" ? l.text : "" }));
    const brand = await prepareBrandProduction(
      tx,
      storage,
      t.project_id,
      input.brand,
      texts,
    );
    if (brand.row.body.font_bindings[0]?.source?.builtin !== "noto-sans-tc")
      throw new Problem(
        422,
        "DESIGN_BRAND_FONT_UNSUPPORTED",
        "This editable exporter currently requires the brand's Noto Sans TC binding. Use the existing brand layout renderer for other authorized custom fonts.",
      );
    sources.push({
      kind: "brand_version",
      ...input.brand,
      sha256: brand.row.sha256,
      rights_status: brand.rights_status,
    });
  }
  const analysisCache = new Map<string, Awaited<ReturnType<typeof analysis>>>();
  for (const scene of scenes)
    for (const layer of scene.layers) {
      if (layer.kind === "image") {
        const { v, bytes } = await version(
          tx,
          storage,
          t,
          layer.asset_version_id,
          layer.sha256,
        );
        if (v.mime_type !== "image/png")
          throw new Problem(
            422,
            "DESIGN_IMAGE_INVALID",
            "Select an actual PNG asset version",
          );
        decodePNG(bytes);
        result.images.set(v.id, bytes);
        sources.push({
          kind: "image",
          asset_version_id: v.id,
          sha256: v.sha256,
        });
      }
      if (layer.kind === "chart") {
        let a = analysisCache.get(layer.source_version_id);
        if (!a) {
          a = await analysis(
            tx,
            storage,
            t,
            layer.source_version_id,
            layer.sha256,
          );
          analysisCache.set(layer.source_version_id, a);
        }
        if (a.sha256 !== layer.sha256)
          throw new Problem(
            409,
            "DESIGN_SOURCE_CHANGED",
            "Use one exact analysis version digest",
          );
        const selected = layer.evidence_ids.map((id) =>
          a!.evidence.find((e) => e.id === id),
        );
        if (selected.some((e) => !e))
          throw new Problem(
            422,
            "DESIGN_EVIDENCE_INVALID",
            "A chart contains an unknown evidence ID",
          );
        const compatibility = new Set(
          selected.map((e) => {
            const scope = JSON.parse(e!.scope);
            return canonical({
              metric: e!.metric_id,
              unit: e!.unit,
              currency: scope.currency,
              account_id: scope.account_id,
              attribution_definition: scope.attribution_definition,
              conversion_definition: scope.conversion_definition,
              period: scope.period,
              date_from: scope.date_from,
              date_to: scope.date_to,
            });
          }),
        );
        if (compatibility.size !== 1)
          throw new Problem(
            422,
            "DESIGN_EVIDENCE_SCOPE",
            "Separate currencies, accounts, metrics, attribution definitions and date ranges into distinct charts",
          );
        const rows: DesignEvidence[] = selected.map((e) => {
          const scope = JSON.parse(e!.scope);
          return {
            id: e!.id,
            label: String(
              scope.campaign ??
                scope.channel ??
                scope.entity_id ??
                scope.currency ??
                e!.metric_id,
            ),
            value: e!.value,
            unit: e!.unit,
            null_reason: e!.null_reason,
            scope: e!.scope,
          };
        });
        result.charts.set(designChartKey(layer), rows);
        sources.push({
          kind: "analysis",
          source_version_id: a.source_version_id,
          sha256: a.sha256,
          calculation_sha256: a.calculation_sha256,
          evidence_ids: layer.evidence_ids,
          source_status: a.provenance,
        });
      }
    }
  if (
    [...result.images.values()].reduce((n, b) => n + b.length, 0) >
    24 * 1024 * 1024
  )
    throw new Problem(
      413,
      "DESIGN_IMAGES_LIMIT",
      "Reduce the total distinct image bytes below 24 MiB",
    );
  return { resources: result, sources };
}
async function completed(tx: Tx, t: any, name: string, input: unknown) {
  const prior = (
    await tx.query(
      "SELECT result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 AND tool_name=$2 AND input_hash=$3 AND attempt<=$4 ORDER BY attempt,created_at LIMIT 1",
      [t.id, name, hash(canonical(input)), t.attempt],
    )
  ).rows[0];
  if (!prior) return;
  const found = (
    await tx.query(
      `SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=ANY($1::uuid[]) AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
      [prior.output_version_ids],
    )
  ).rowCount;
  if (found !== prior.output_version_ids.length)
    throw new Problem(
      409,
      "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
      "The original delivery is unavailable; do not regenerate it automatically",
    );
  return prior.result;
}
async function save(
  tx: Tx,
  storage: Storage,
  t: any,
  kind: string,
  name: string,
  mime: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const a = await saveAsset(tx, storage, {
    tenant: t.tenant_id,
    project: t.project_id,
    user: t.created_by,
    kind: "deliverable",
    name,
    mime,
    bytes,
    metadata: {
      task_id: t.id,
      editable_design_schema: editableDesignSchema,
      design_kind: kind,
      provider_calls: 0,
      ...extra,
    },
  });
  return {
    filename: name,
    mime_type: mime,
    asset_id: a.id,
    asset_version_id: a.version.id,
    version: a.version.version,
    sha256: a.version.sha256,
    bytes: bytes.length,
  };
}
function sourceMetadata(
  input: VectorInput | SlidesInput,
  sources: any[],
  prepared?: { source_version_id: string; sha256: string },
) {
  // A task may consume its own newly generated image or analysis source.
  // Task-level read lineage deliberately skips self references; each actual
  // output must therefore carry these fixed asset versions independently.
  const versions = new Set<string>();
  for (const source of sources) {
    if (source.kind === "image") versions.add(source.asset_version_id);
    if (source.kind === "analysis") versions.add(source.source_version_id);
  }
  if (input.revision_of) versions.add(input.revision_of.source_version_id);
  if (prepared) versions.add(prepared.source_version_id);
  return {
    ...(input.brand ? { brand_reference: input.brand } : {}),
    editable_design_source_versions: [...versions].sort(),
  };
}
export async function buildSlides(
  tx: Tx,
  storage: Storage,
  t: any,
  input: SlidesInput,
) {
  await assertFixedBrand(tx, t, input);
  const replay = await completed(tx, t, "slides_build", input);
  if (replay) return replay;
  if (input.revision_of) {
    const old = await readDesignSource(
      tx,
      storage,
      t,
      input.revision_of.source_version_id,
      input.revision_of.sha256,
    );
    if (old.kind !== "presentation")
      throw new Problem(
        422,
        "DESIGN_REVISION_KIND",
        "Revise a presentation source",
      );
  }
  const checked = await resources(tx, storage, t, "presentation", input);
  // Validate all text and native geometry before advertising a prepared version.
  // Final render repeats source and layout checks; it never trusts a cached claim.
  const rendered = await renderEditableDesign(
    "presentation",
    input,
    checked.resources,
    checked.sources.some(s => s.source_status === "user_attested_import") ? "user_attested_import" : t.data_mode,
  );
  const body = {
    schema: editableDesignSchema,
    kind: "presentation",
    input,
    input_sha256: hash(canonical(input)),
    sources: checked.sources,
    font: rendered.font,
    pages: rendered.pages,
    data_mode: t.data_mode,
    data_provenance: checked.sources.some(s => s.source_status === "user_attested_import") ? "user_attested_import" : "current_project_sources",
  };
  const source = await save(
    tx,
    storage,
    t,
    "presentation",
    "presentation.source.json",
    "application/json",
    Buffer.from(JSON.stringify(body, null, 2) + "\n"),
    sourceMetadata(input, checked.sources),
  );
  return {
    schema: editableDesignSchema,
    state: "prepared",
    kind: "presentation",
    source_version_id: source.asset_version_id,
    sha256: source.sha256,
    pages: rendered.pages,
    files: [source],
    provider_calls: 0,
    requires_render: true,
    instructions:
      "The immutable source is saved. Call slides_render with this exact source_version_id and sha256 to produce actual PPTX/PDF/page files; preparation alone is not delivered work.",
  };
}
async function deliver(
  tx: Tx,
  storage: Storage,
  t: any,
  kind: "vector" | "presentation",
  input: VectorInput | SlidesInput,
  source?: { source_version_id: string; sha256: string },
) {
  const checked = await resources(tx, storage, t, kind, input);
  const rendered = await renderEditableDesign(
    kind,
    input,
    checked.resources,
    checked.sources.some(s => s.source_status === "user_attested_import") ? "user_attested_import" : t.data_mode,
  );
  const body = {
    schema: editableDesignSchema,
    kind,
    input,
    input_sha256: hash(canonical(input)),
    sources: checked.sources,
    font: rendered.font,
    pages: rendered.pages,
    data_mode: t.data_mode,
    data_provenance: checked.sources.some(s => s.source_status === "user_attested_import") ? "user_attested_import" : "current_project_sources",
  };
  rendered.files.push({
    name: kind === "vector" ? "vector.source.json" : "presentation.source.json",
    mime: "application/json",
    bytes: Buffer.from(JSON.stringify(body, null, 2) + "\n"),
  });
  const manifest = {
    schema: "copypaste-editable-design-manifest-1",
    kind,
    data_mode: t.data_mode,
    data_provenance: body.data_provenance,
    revision_of: input.revision_of ?? null,
    prepared_source: source ?? null,
    pages: rendered.pages,
    font: rendered.font,
    sources: checked.sources,
    provider_calls: 0,
    limitations: rendered.limitations,
    files: rendered.files.map((f) => ({
      filename: f.name,
      mime_type: f.mime,
      bytes: f.bytes.length,
      sha256: hash(f.bytes),
    })),
  };
  const files = packageEditableDesign(
      rendered.files,
      rendered.fontBytes,
      rendered.fontLicense,
      manifest,
      rendered.staticFontFiles,
    ),
    saved = [];
  for (const f of files)
    saved.push(
      await save(tx, storage, t, kind, f.name, f.mime, f.bytes, {
        design_revision_of: input.revision_of ?? null,
        ...sourceMetadata(input, checked.sources, source),
      }),
    );
  const editable = saved.find(
    (f) =>
      f.filename ===
      (kind === "vector" ? "vector.source.json" : "presentation.source.json"),
  )!;
  return {
    schema: editableDesignSchema,
    state: "delivered",
    kind,
    data_mode: t.data_mode,
    data_provenance: body.data_provenance,
    files: saved,
    pages: rendered.pages,
    editable_source: {
      asset_version_id: editable.asset_version_id,
      sha256: editable.sha256,
    },
    revision_of: input.revision_of ?? null,
    provider_calls: 0,
    additional_ai_charge_micros: "0",
    limitations: rendered.limitations,
  };
}
export async function renderVector(
  tx: Tx,
  storage: Storage,
  t: any,
  input: VectorInput,
) {
  await assertFixedBrand(tx, t, input);
  const replay = await completed(tx, t, "vector_render", input);
  if (replay) return replay;
  if (input.revision_of) {
    const old = await readDesignSource(
      tx,
      storage,
      t,
      input.revision_of.source_version_id,
      input.revision_of.sha256,
    );
    if (old.kind !== "vector")
      throw new Problem(422, "DESIGN_REVISION_KIND", "Revise a vector source");
  }
  return deliver(tx, storage, t, "vector", input);
}
export async function renderSlides(
  tx: Tx,
  storage: Storage,
  t: any,
  input: { source_version_id: string; sha256: string },
) {
  const source = await readDesignSource(
    tx,
    storage,
    t,
    input.source_version_id,
    input.sha256,
  );
  if (source.kind !== "presentation")
    throw new Problem(
      422,
      "DESIGN_REVISION_KIND",
      "Render a prepared presentation source",
    );
  await assertFixedBrand(tx, t, source.input);
  const replay = await completed(tx, t, "slides_render", input);
  if (replay) return replay;
  return deliver(
    tx,
    storage,
    t,
    "presentation",
    source.input as SlidesInput,
    input,
  );
}
