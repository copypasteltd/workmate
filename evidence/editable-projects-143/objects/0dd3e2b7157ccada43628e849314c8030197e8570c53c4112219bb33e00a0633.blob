import { readFile } from "node:fs/promises";
import type { Tx, Database } from "./db.js";
import type { Storage } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import { brandDefinition, brandVersion, prepareBrandProduction } from "./brand-production.js";
import { renderProjectPoster } from "./business.js";
import { editableFontFiles, renderEditableDesign } from "./editable-design-render.js";
import { cleanEditableInput, editableRendererProfile, editableScenes, loadEditableResources, readEditableAsset,
  type EditableKind, type EditableInput } from "./editable-project-source.js";
import { packageManifest, packageBrandRequirements, creativePackageLimit,
  type PackageBrandRequirements, type PackageBrandTarget, type CreativeRemap } from "./creative-package-model.js";
import { importedDesignEvidence } from "./portable-design-evidence.js";
import type { readCreativePackage } from "./creative-package-reader.js";

type ArchiveFile = { path: string; name: string; bytes: number; sha256: string; mime_type: string; storage_key?: string; content?: Buffer };
const flat = (kind: EditableKind, input: EditableInput) => editableScenes(kind, input).flatMap((s, page) => s.layers.map(l => ({ l, page })));
export function editableDesignColors(kind: EditableKind, source: unknown) {
  const input = cleanEditableInput(kind, source);
  return [...new Set(editableScenes(kind, input).flatMap(s => [s.background, ...s.layers.flatMap(l => l.kind === "image" ? []
    : l.kind === "text" || l.kind === "chart" ? [l.color] : [l.fill, l.stroke].filter((v): v is string => !!v))]).map(v => v.toLowerCase()))];
}
export function validateEditablePackageBrand(kind: EditableKind, source: unknown, requirements?: PackageBrandRequirements) {
  const input = cleanEditableInput(kind, source), layers = flat(kind, input);
  if (!!input.brand !== !!requirements) throw new Problem(422, "PACKAGE_BRAND_REBIND_REQUIRED", "Branded editable projects require an explicit destination binding review");
  if (!requirements) return;
  const texts = layers.flatMap(({ l }, layer) => l.kind === "text" ? [{ l, layer }] : []);
  if (requirements.texts.length !== texts.length || new Set(requirements.texts.map(r => r.layer)).size !== texts.length
    || requirements.texts.some(r => { const l = layers[r.layer]?.l; return !l || l.kind !== "text" || l.text !== r.resolved_text || r.fact_key || r.fact_kind; })
    || new Set(requirements.texts.map(r => r.font_key)).size > 1
    || new Set(requirements.logos.map(r => r.layer)).size !== requirements.logos.length
    || requirements.logos.some(r => layers[r.layer]?.l.kind !== "image"))
    throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "The editable brand declarations do not match the source pages");
}
async function describeBrand(tx: Tx, storage: Storage, project: string, kind: EditableKind, input: EditableInput, versions: Map<string, any>) {
  if (!input.brand) return undefined;
  const layers = flat(kind, input), texts = layers.flatMap(({ l }, layer) => l.kind === "text" ? [{ l, layer }] : []);
  const prepared = await prepareBrandProduction(tx, storage, project, input.brand, texts.map(v => ({ text: v.l.text })));
  const b = brandDefinition.parse(prepared.row.body);
  return packageBrandRequirements.parse({ source_name: prepared.row.name, source_sha256: prepared.row.sha256,
    texts: texts.map(({ l, layer }) => ({ layer, font_key: b.font_bindings[0].key, resolved_text: l.text })),
    logos: layers.flatMap(({ l }, layer) => { if (l.kind !== "image") return [];
      const v = versions.get(l.asset_version_id).v, logo = b.logos.find(r => r.asset_id === v.asset_id && r.version === v.version);
      return logo ? [{ layer, key: logo.key }] : [];
    }) });
}
function exactMap(rows: { source_key: string; target_key: string }[], required: string[], allowed: string[]) {
  const keys = new Set(required), map = new Map(rows.map(r => [r.source_key, r.target_key]));
  if (map.size !== rows.length || map.size !== keys.size || rows.some(r => !keys.has(r.source_key) || !allowed.includes(r.target_key)))
    throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "Map every required field once to an available destination field");
  return map;
}
export async function prepareEditablePackageBrand(tx: Tx, storage: Storage, project: string, kind: EditableKind, source: unknown,
  requirements: PackageBrandRequirements, target: PackageBrandTarget, archiveHash: string, previewHash: string) {
  validateEditablePackageBrand(kind, source, requirements);
  const input = cleanEditableInput(kind, source), row = await brandVersion(tx, project, target.binding.id, target.binding.version), b = brandDefinition.parse(row.body);
  const fonts = exactMap(target.fonts, requirements.texts.map(r => r.font_key), [b.font_bindings[0].key]);
  exactMap(target.facts, [], []);
  const logos = exactMap(target.logos, requirements.logos.map(r => r.key), b.logos.map(r => r.key));
  if (!("builtin" in b.font_bindings[0].source) || b.font_bindings[0].source.builtin !== "noto-sans-tc") throw new Problem(422, "DESIGN_BRAND_FONT_UNSUPPORTED", "Editable SVG/PPTX need the destination brand's first fixed Noto Sans TC font");
  const sourceColors = new Set(editableDesignColors(kind, input)), colors = new Map(target.colors.map(r => [r.from.toLowerCase(), r.to]));
  if (colors.size !== target.colors.length || target.colors.some(r => !sourceColors.has(r.from.toLowerCase()) || !b.colors.some(c => c.toLowerCase() === r.to.toLowerCase())))
    throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "Use source colors and approved destination brand colors");
  const color = (v: string) => colors.get(v.toLowerCase()) ?? v;
  input.brand = target.binding;
  const scenes = editableScenes(kind, input);
  for (const s of scenes) { s.background = color(s.background); s.layers = s.layers.map(l => l.kind === "image" ? l
    : l.kind === "text" || l.kind === "chart" ? { ...l, color: color(l.color) }
    : { ...l, fill: l.fill ? color(l.fill) : null, stroke: l.stroke ? color(l.stroke) : null }); }
  const layers = flat(kind, input), texts = requirements.texts.map(r => ({ text: r.resolved_text, font_key: fonts.get(r.font_key)! }));
  if (input.locale !== target.binding.locale && !(input.locale === "zh-HK" && target.binding.locale === "zh-Hant-HK"))
    throw new Problem(422, "DESIGN_BRAND_LOCALE", "Choose the same locale as the editable source");
  await prepareBrandProduction(tx, storage, project, target.binding, texts);
  const overrides = new Map<string, CreativeRemap>(), logoChanges: any[] = [], pageLogos = new Map<number, any[]>();
  for (const declared of requirements.logos) {
    const { l, page } = layers[declared.layer]; if (l.kind !== "image") throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "A Logo is not an image layer");
    const logo = b.logos.find(r => r.key === logos.get(declared.key))!;
    const selected = (await tx.query("SELECT id,sha256 FROM asset_versions WHERE asset_id=$1 AND version=$2", [logo.asset_id, logo.version])).rows[0];
    if (!selected) throw new Problem(422, "PACKAGE_SOURCE_UNAVAILABLE", "The destination Logo version is unavailable");
    const verified = await readEditableAsset(tx, storage, project, selected.id, selected.sha256);
    if (verified.v.mime_type !== "image/png") throw new Problem(422, "DESIGN_IMAGE_INVALID", "Use a destination PNG Logo");
    const next = { asset_id: logo.asset_id, version: logo.version, asset_version_id: selected.id, sha256: selected.sha256 };
    if (overrides.has(l.asset_version_id) && canonical(overrides.get(l.asset_version_id)) !== canonical(next))
      throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "One fixed Logo cannot map to two different destination versions");
    overrides.set(l.asset_version_id, next);
    pageLogos.set(page, [...(pageLogos.get(page) ?? []), { type: "image", asset_id: logo.asset_id, version: logo.version, x: l.x, y: l.y, width: l.w, height: l.h }]);
    logoChanges.push({ layer: declared.layer, source_key: declared.key, target_key: logo.key });
  }
  for (const [page, ls] of pageLogos) await renderProjectPoster(tx, storage, project, {
    width: scenes[page].width, height: scenes[page].height, background: scenes[page].background, brand: target.binding, layers: ls,
  });
  const review = { source_name: requirements.source_name, target_name: row.name, target_brand: target.binding, target_sha256: row.sha256,
    texts: requirements.texts.map(r => ({ layer: r.layer, before: r.resolved_text, after: r.resolved_text,
      source_font_key: r.font_key, target_font_key: fonts.get(r.font_key)!, font_label: b.font_bindings[0].label,
      source_fact_key: null, target_fact_key: null })), logos: logoChanges, colors: target.colors,
    retains_unmapped_copy_and_colors: true, rights_status: "customer_declared", ai_cost_micros: "0" };
  return { definition: input, assetOverrides: overrides, review, review_hash: hash(canonical({ archiveHash, previewHash, target, review })) };
}
export async function selectEditablePackage(tx: Tx, storage: Storage, db: Database, project: string, p: any) {
  if (p.body.data_mode !== (db.config.DEMO_MODE ? "simulated" : "configured_services")) throw new Problem(404, "NOT_FOUND", "The project is unavailable in this service mode");
  const kind = p.kind as EditableKind, input = cleanEditableInput(kind, p.body.input), profile = await editableRendererProfile();
  if (canonical(profile) !== canonical(p.body.renderer_profile)) throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "The current project needs a different fixed font or renderer");
  const checked = await loadEditableResources(tx, storage, project, kind, input), files: ArchiveFile[] = [], media: any[] = [];
  const content = (name: string, bytes: Buffer, mime: string) => {
    if (mime === "application/json" && bytes.length > 4 * 1024 ** 2)
      throw new Problem(413, "CREATIVE_PACKAGE_SOURCE_LIMIT", "Reduce the editable source or chart snapshot below 4 MiB before packaging");
    files.push({ path: name, name, content: bytes, bytes: bytes.length, sha256: hash(bytes), mime_type: mime });
  };
  content("project.json", Buffer.from(JSON.stringify(input, null, 2) + "\n"), "application/json");
  for (const [id, entry] of checked.versions) {
    const isEvidence = checked.evidence.has(id), path = `media/${String(media.length + 1).padStart(3, "0")}.${isEvidence ? "json" : "png"}`;
    if (isEvidence) {
      const ids = new Set(editableScenes(kind, input).flatMap(s => s.layers.flatMap(l => l.kind === "chart" && l.source_version_id === id ? l.evidence_ids : [])));
      const rows = checked.evidence.get(id)!.rows.filter(r => ids.has(r.id));
      content(path, Buffer.from(JSON.stringify(importedDesignEvidence.parse({ schema: "copypaste-imported-design-evidence-1", provenance: "user_attested_import", rows }), null, 2) + "\n"), "application/json");
    } else files.push({ path, name: path, bytes: Number(entry.v.bytes), sha256: entry.v.sha256, mime_type: "image/png", storage_key: entry.v.storage_key });
    media.push({ asset_id: entry.v.asset_id, version: entry.v.version, source_version_id: id, source_sha256: entry.v.sha256, path, mime_type: isEvidence ? "application/json" : "image/png" });
  }
  const font = await editableFontFiles();
  content("fonts/NotoSansTC-VF.ttf", font.bytes, "font/ttf"); content("fonts/OFL.txt", font.license, "text/plain");
  for (const face of font.faces) content("fonts/" + face.file, face.bytes, "font/ttf");
  const rendered = await renderEditableDesign(kind, input, checked.resources, checked.imported_evidence ? "user_attested_import" : p.body.data_mode);
  rendered.files.filter(f => f.mime === "image/png").forEach((f, i) => content(`previews/page-${String(i + 1).padStart(2, "0")}.png`, f.bytes, f.mime));
  const brand = await describeBrand(tx, storage, project, kind, input, checked.versions);
  const manifest = packageManifest.parse({ schema_version: "copypaste-creative-package-1", kind, name: p.name,
    origin: { project_id: project, creative_id: p.id, version: p.version }, renderer_profile: profile,
    ...(brand ? { brand_requirements: brand } : {}), files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), media,
    limitations: ["Import keeps editable pages, shapes, images and exact chart values. Imported chart snapshots are user-attested data, not verified connector reports; review values and source rights before publication.",
      "The pinned variable/static Noto Sans TC fonts and OFL license are included. PowerPoint typography still requires checking in the actual editor.",
      ...(brand ? ["Choose and review a current destination brand. Literal copy and chart facts stay unchanged unless edited; source brand authority is never imported."] : [])] });
  if (files.reduce((n, v) => n + v.bytes, 0) + 1024 ** 2 > creativePackageLimit) throw new Problem(413, "CREATIVE_PACKAGE_TOO_LARGE", "The editable project exceeds 100 MiB");
  return { p, files, manifest };
}
export async function verifyEditablePackageFonts(loaded: Awaited<ReturnType<typeof readCreativePackage>>) {
  const profile = await editableRendererProfile();
  if (canonical(profile) !== canonical(loaded.manifest.renderer_profile)) throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "The editable renderer profile is incompatible");
  const f = await editableFontFiles(), expected: [string, Buffer][] = [["fonts/NotoSansTC-VF.ttf", f.bytes], ["fonts/OFL.txt", f.license], ...f.faces.map(v => ["fonts/" + v.file, v.bytes] as [string, Buffer])];
  for (const [name, bytes] of expected) if (loaded.members.get(name)?.sha256 !== hash(bytes)) throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "A bundled editable font or license differs from the pinned renderer");
  // Read the exact members; only the application's own verified fonts are registered.
  for (const [name, bytes] of expected) if (!bytes.equals(await readFile(loaded.members.get(name)!.file))) throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "The bundled font failed verification");
}
