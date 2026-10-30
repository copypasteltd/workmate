import { z } from "zod";
import { poster } from "./business.js";
import { videoDefinition, videoReferences } from "./video-project-model.js";
import { name, Problem, uuid } from "./lib.js";
import { brandBinding } from "./brand-production.js";
import { cleanEditableInput, editableScenes, type EditableKind } from "./editable-project-source.js";

export const creativePackageLimit = 100 * 1024 ** 2;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const brandKey = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/);
export const packageBrandRequirements = z.object({
  source_name: name, source_sha256: digest,
  texts: z.array(z.object({ layer: z.number().int().min(0).max(1599), font_key: brandKey,
    fact_key: brandKey.optional(), fact_kind: z.enum(["product", "price", "promotion"]).optional(),
    resolved_text: z.string().max(6000) }).strict()).max(1600),
  logos: z.array(z.object({ layer: z.number().int().min(0).max(1599), key: brandKey }).strict()).max(1600),
}).strict();
const keyMap = z.array(z.object({ source_key: brandKey, target_key: brandKey }).strict());
export const packageBrandTarget = z.object({ binding: brandBinding,
  fonts: keyMap.max(12), facts: keyMap.max(100), logos: keyMap.max(12),
  colors: z.array(z.object({ from: z.string().regex(/^#[a-f0-9]{6}$/i), to: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict()).max(5000),
}).strict();
export type PackageBrandTarget = z.infer<typeof packageBrandTarget>;
export type PackageBrandRequirements = z.infer<typeof packageBrandRequirements>;
const memberPath = z.string().regex(/^(?:project\.json|preview\.svg|previews\/page-(?:0[1-9]|1\d|20)\.png|fonts\/(?:NotoSansTC-VF\.ttf|CopyPasteSansTC-(?:Regular|Bold)\.ttf|OFL\.txt)|media\/[0-9]{3,4}\.(?:png|wav|mp3|json))$/);
export const packageManifest = z.object({
  schema_version: z.literal("copypaste-creative-package-1"),
  kind: z.enum(["poster", "video", "vector", "presentation"]), name,
  origin: z.object({ project_id: uuid, creative_id: uuid, version: z.number().int().positive() }).strict(),
  renderer_profile: z.record(z.string(), z.unknown()),
  brand_requirements: packageBrandRequirements.optional(),
  files: z.array(z.object({ path: memberPath, bytes: z.number().int().min(1).max(30 * 1024 ** 2), sha256: digest }).strict()).min(1).max(1640),
  media: z.array(z.object({ asset_id: uuid, version: z.number().int().positive(), path: memberPath,
    source_version_id: uuid.optional(), source_sha256: digest.optional(),
    mime_type: z.enum(["image/png", "audio/wav", "audio/mpeg", "application/json"]) }).strict()).max(1600),
  limitations: z.array(z.string().max(2000)).max(10),
}).strict();
export const packageSelection = z.object({ asset_id: uuid, version: z.number().int().positive(), sha256: digest }).strict();
export const packageRestore = packageSelection.extend({ name, preview_hash: digest,
  confirm_project_sharing: z.literal(true), confirm_media_rights: z.literal(true),
  confirm_imported_evidence: z.literal(true).optional(),
  brand_target: packageBrandTarget.optional(), brand_review_hash: digest.optional(), confirm_brand_review: z.literal(true).optional() }).strict();
export type CreativePackageManifest = z.infer<typeof packageManifest>;

export type CreativeKind = "poster" | "video" | EditableKind;
export type CreativeReference = { asset_id?: string; version?: number; source_version_id?: string; sha256?: string; role?: "image" | "evidence" };
export type CreativeRemap = { asset_id: string; version: number; asset_version_id?: string; sha256?: string; evidence_ids?: Record<string, string> };
export const creativeReferenceKey = (r: CreativeReference) => r.source_version_id ?? r.asset_id + ":" + r.version;
export function parseCreativeSource(kind: CreativeKind, input: unknown) {
  if (kind === "vector" || kind === "presentation") return cleanEditableInput(kind, input);
  const parsed = kind === "poster" ? poster.parse(input) : videoDefinition.parse(input);
  if (kind === "poster" && "layers" in parsed && !parsed.brand && parsed.layers.some(l => l.type === "text" && (l.font_key || l.fact_key)))
    throw new Problem(422, "PACKAGE_BRAND_REBIND_REQUIRED", "Font and fact references require an explicit source brand binding");
  return parsed;
}
export function creativeReferences(kind: CreativeKind, input: unknown): CreativeReference[] {
  if (kind === "vector" || kind === "presentation") {
    const refs = editableScenes(kind, cleanEditableInput(kind, input)).flatMap(s => s.layers.flatMap<CreativeReference>(l =>
      l.kind === "image" ? [{ source_version_id: l.asset_version_id, sha256: l.sha256, role: "image" as const }]
      : l.kind === "chart" ? [{ source_version_id: l.source_version_id, sha256: l.sha256, role: "evidence" as const }] : []));
    const unique = new Map<string, CreativeReference>();
    for (const r of refs) { const prior = unique.get(r.source_version_id!);
      if (prior && (prior.sha256 !== r.sha256 || prior.role !== r.role)) throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "A fixed source has inconsistent roles or digests");
      unique.set(r.source_version_id!, r); }
    return [...unique.values()];
  }
  if (kind === "video") return videoReferences(videoDefinition.parse(input));
  const refs = poster.parse(input).layers.filter(l => l.type === "image").map(l => ({ asset_id: l.asset_id, version: l.version }));
  return [...new Map(refs.map(r => [r.asset_id + ":" + r.version, r])).values()];
}
/** Only validated content is rebased. IDs in archive metadata never become authority. */
export function remapCreativeSource(kind: CreativeKind, source: unknown, mapping: Map<string, CreativeRemap>) {
  if (kind === "vector" || kind === "presentation") {
    const body = cleanEditableInput(kind, source), scenes = editableScenes(kind, body);
    for (const scene of scenes) scene.layers = scene.layers.map(l => {
      if (l.kind !== "image" && l.kind !== "chart") return l;
      const id = l.kind === "image" ? l.asset_version_id : l.source_version_id, next = mapping.get(id);
      if (!next?.asset_version_id || !next.sha256) throw new Problem(422, "PACKAGE_MEDIA_MISSING", "The editable project has an unresolved fixed source");
      if (l.kind === "image") return { ...l, asset_version_id: next.asset_version_id, sha256: next.sha256 };
      const evidence_ids = l.evidence_ids.map(id => next.evidence_ids?.[id]);
      if (evidence_ids.some(id => !id)) throw new Problem(422, "PACKAGE_MEDIA_MISSING", "A chart has unresolved imported evidence");
      return { ...l, source_version_id: next.asset_version_id, sha256: next.sha256, evidence_ids: evidence_ids as string[] };
    });
    return cleanEditableInput(kind, body);
  }
  const ref = (r: { asset_id: string; version: number }) => {
    const next = mapping.get(r.asset_id + ":" + r.version);
    if (!next) throw new Problem(422, "PACKAGE_MEDIA_MISSING", "The project has an unresolved media version");
    // Poster/video references use the public asset/version pair. Fixed-source
    // identifiers belong only to the editable vector/presentation schema above.
    return { asset_id: next.asset_id, version: next.version };
  };
  if (kind === "poster") {
    const body = poster.parse(source);
    return poster.parse({ ...body, layers: body.layers.map(l => l.type === "image" ? { ...l, ...ref(l) } : l) });
  }
  const body = videoDefinition.parse(source);
  return videoDefinition.parse({ ...body, brand: { ...body.brand, logo: body.brand.logo ? ref(body.brand.logo) : null },
    storyboard: body.storyboard.map(s => ({ ...s, image: s.image ? ref(s.image) : null })),
    audio: body.audio ? { ...body.audio, source: ref(body.audio.source) } : null });
}
