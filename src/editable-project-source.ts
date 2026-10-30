import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import { vectorInput, slidesInput, editableDesignSchema, type VectorInput, type SlidesInput, type DesignScene } from "./editable-design-model.js";
import { designChartKey, type DesignResources, editableFontFiles } from "./editable-design-render.js";
import { prepareBrandProduction } from "./brand-production.js";
import { renderProjectPoster } from "./business.js";
import { decodePNG } from "./editable-design-tools.js";
import { calculationDigest } from "./analysis-role-delivery.js";
import { designEvidenceRecord, importedDesignEvidence, selectDesignEvidence, type DesignEvidenceRecord } from "./portable-design-evidence.js";

export type EditableKind = "vector" | "presentation";
export type EditableInput = VectorInput | SlidesInput;
export const editableScenes = (kind: EditableKind, input: EditableInput): DesignScene[] => kind === "vector" ? [(input as VectorInput).scene] : (input as SlidesInput).slides.map(s => s.scene);
export function parseEditableInput(kind: EditableKind, input: unknown): EditableInput {
  return kind === "vector" ? vectorInput.parse(input) : slidesInput.parse(input);
}
export function cleanEditableInput(kind: EditableKind, input: unknown) {
  const { revision_of: _oldAuthority, ...body } = parseEditableInput(kind, input);
  return parseEditableInput(kind, body);
}
export async function readEditableAsset(tx: Tx, storage: Storage, project: string, id: string, expected?: string) {
  // Shared projects never acquire private task/conversation files through this reader.
  const v = (await tx.query(`SELECT v.*,a.name,a.kind FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=$1 AND a.project_id=$2 AND a.private_owner IS NULL AND a.state='active'
      AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`, [id, project])).rows[0];
  if (!v) throw new Problem(404, "NOT_FOUND", "The shared fixed design source is unavailable");
  if (expected && v.sha256 !== expected) throw new Problem(409, "DESIGN_SOURCE_CHANGED", "Choose the exact source version and digest");
  if (Number(v.bytes) > 12 * 1024 ** 2) throw new Problem(413, "DESIGN_SOURCE_LIMIT", "Choose a source below 12 MiB");
  const bytes = await storage.get(v.storage_key);
  if (bytes.length !== Number(v.bytes) || hash(bytes) !== v.sha256) throw new Problem(409, "DESIGN_SOURCE_INTEGRITY", "The fixed source failed its byte check");
  return { v, bytes };
}
export async function readEditableSource(tx: Tx, storage: Storage, project: string, id: string, expected: string) {
  const { v, bytes } = await readEditableAsset(tx, storage, project, id, expected);
  if (v.mime_type !== "application/json" || v.metadata.editable_design_schema !== editableDesignSchema)
    throw new Problem(422, "EDITABLE_SOURCE_REQUIRED", "Choose the editable design source, not a preview or rendered file");
  let body: any; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new Problem(422, "EDITABLE_SOURCE_INVALID", "The source is not valid JSON"); }
  if (body.schema !== editableDesignSchema || !["vector", "presentation"].includes(body.kind) || v.metadata.design_kind !== body.kind)
    throw new Problem(422, "EDITABLE_SOURCE_INVALID", "The source kind does not match its saved version");
  const kind = body.kind as EditableKind, input = parseEditableInput(kind, body.input);
  if (hash(canonical(input)) !== body.input_sha256) throw new Problem(409, "DESIGN_SOURCE_INTEGRITY", "The editable input digest has changed");
  return { kind, input: cleanEditableInput(kind, input), source: v, data_mode: body.data_mode };
}
export async function editableRendererProfile() {
  const f = await editableFontFiles();
  return { renderer: "copypaste-editable-design-1", font_sha256: f.metadata.sha256,
    font_license_sha256: hash(f.license), static_faces: f.faces.map(v => ({ file: v.file, weight: v.weight, sha256: v.sha256 })) };
}
export async function loadEditableResources(tx: Tx, storage: Storage, project: string, kind: EditableKind, input: EditableInput) {
  const scenes = editableScenes(kind, input), resources: DesignResources = { images: new Map(), charts: new Map() };
  const versions = new Map<string, any>(), evidence = new Map<string, { rows: DesignEvidenceRecord[]; imported: boolean }>();
  if (input.brand) {
    if (input.brand.locale !== input.locale && !(input.locale === "zh-HK" && input.brand.locale === "zh-Hant-HK"))
      throw new Problem(422, "DESIGN_BRAND_LOCALE", "Use the same locale as the selected brand");
    const brand = await prepareBrandProduction(tx, storage, project, input.brand, scenes.flatMap(s => s.layers.flatMap(l => l.kind === "text" ? [{ text: l.text }] : [])));
    if (brand.row.body.font_bindings[0]?.source?.builtin !== "noto-sans-tc")
      throw new Problem(422, "DESIGN_BRAND_FONT_UNSUPPORTED", "Editable SVG/PPTX use the authorized Noto Sans TC brand font");
  }
  for (const scene of scenes) {
    const brandLogos: any[] = [];
    for (const layer of scene.layers) {
      if (layer.kind !== "image" && layer.kind !== "chart") continue;
      const id = layer.kind === "image" ? layer.asset_version_id : layer.source_version_id;
      let entry = versions.get(id);
      if (!entry) { entry = await readEditableAsset(tx, storage, project, id, layer.sha256); versions.set(id, entry); }
      if (entry.v.sha256 !== layer.sha256) throw new Problem(409, "DESIGN_SOURCE_CHANGED", "One fixed source cannot have two different digests");
      if (layer.kind === "image") {
        if (entry.v.mime_type !== "image/png") throw new Problem(422, "DESIGN_IMAGE_INVALID", "Choose an actual fixed PNG version");
        decodePNG(entry.bytes); resources.images.set(id, entry.bytes);
        brandLogos.push({ type: "image", asset_id: entry.v.asset_id, version: entry.v.version, x: layer.x, y: layer.y, width: layer.w, height: layer.h });
      } else {
        let snapshot = evidence.get(id);
        if (!snapshot) {
          if (entry.v.mime_type !== "application/json" || entry.bytes.length > 4 * 1024 ** 2)
            throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "Choose a bounded structured chart source");
          let data: any; try { data = JSON.parse(entry.bytes.toString("utf8")); } catch { throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "Chart evidence is not valid JSON"); }
          if (data.schema === "copypaste-imported-design-evidence-1") {
            if (entry.v.metadata.design_evidence_provenance !== "user_attested_import") throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "The imported snapshot has no recorded provenance");
            snapshot = { rows: importedDesignEvidence.parse(data).rows, imported: true };
          } else {
            if (data.schema !== "copypaste-analysis-delivery-1" || entry.v.metadata.analysis_role_schema !== data.schema
              || data.calculation_sha256 !== entry.v.metadata.calculation_sha256 || calculationDigest(data.calculation) !== data.calculation_sha256)
              throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "The current analysis source does not match its saved calculation");
            snapshot = { imported: false, rows: data.calculation.evidence.map((r: any) => { const scope = JSON.parse(r.scope); return designEvidenceRecord.parse({
              id: r.id, metric_id: r.metric_id, label: String(scope.campaign ?? scope.channel ?? scope.entity_id ?? scope.currency ?? r.metric_id),
              value: r.value, unit: r.unit, null_reason: r.null_reason, scope: r.scope,
            }); }) };
          }
          evidence.set(id, snapshot!);
        }
        resources.charts.set(designChartKey(layer), selectDesignEvidence(snapshot!.rows, layer.evidence_ids));
      }
    }
    if (input.brand && brandLogos.length) await renderProjectPoster(tx, storage, project, {
      width: scene.width, height: scene.height, background: scene.background, brand: input.brand, layers: brandLogos,
    });
  }
  if ([...resources.images.values()].reduce((n, v) => n + v.length, 0) > 24 * 1024 ** 2)
    throw new Problem(413, "DESIGN_IMAGES_LIMIT", "Keep the distinct image total below 24 MiB");
  return { resources, versions, evidence, source_versions: [...versions.keys()].sort(), imported_evidence: [...evidence.values()].some(v => v.imported) };
}
