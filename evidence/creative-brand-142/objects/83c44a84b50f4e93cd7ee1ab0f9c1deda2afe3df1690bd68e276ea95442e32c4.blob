import { z } from "zod";
import { poster } from "./business.js";
import { videoDefinition, videoReferences } from "./video-project-model.js";
import { name, Problem, uuid } from "./lib.js";
import { brandBinding } from "./brand-production.js";

export const creativePackageLimit = 100 * 1024 ** 2;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const brandKey = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/);
export const packageBrandRequirements = z.object({
  source_name: name, source_sha256: digest,
  texts: z.array(z.object({ layer: z.number().int().min(0).max(99), font_key: brandKey,
    fact_key: brandKey.optional(), fact_kind: z.enum(["product", "price", "promotion"]).optional(),
    resolved_text: z.string().max(6000) }).strict()).max(100),
  logos: z.array(z.object({ layer: z.number().int().min(0).max(99), key: brandKey }).strict()).max(100),
}).strict();
const keyMap = z.array(z.object({ source_key: brandKey, target_key: brandKey }).strict());
export const packageBrandTarget = z.object({ binding: brandBinding,
  fonts: keyMap.max(12), facts: keyMap.max(100), logos: keyMap.max(12),
  colors: z.array(z.object({ from: z.string().regex(/^#[a-f0-9]{6}$/i), to: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict()).max(101),
}).strict();
export type PackageBrandTarget = z.infer<typeof packageBrandTarget>;
export type PackageBrandRequirements = z.infer<typeof packageBrandRequirements>;
const memberPath = z.string().regex(/^(?:project\.json|preview\.svg|fonts\/(?:NotoSansTC-VF\.ttf|OFL\.txt)|media\/[0-9]{3}\.(?:png|wav|mp3))$/);
export const packageManifest = z.object({
  schema_version: z.literal("copypaste-creative-package-1"),
  kind: z.enum(["poster", "video"]), name,
  origin: z.object({ project_id: uuid, creative_id: uuid, version: z.number().int().positive() }).strict(),
  renderer_profile: z.record(z.string(), z.unknown()),
  brand_requirements: packageBrandRequirements.optional(),
  files: z.array(z.object({ path: memberPath, bytes: z.number().int().min(1).max(30 * 1024 ** 2), sha256: digest }).strict()).min(1).max(105),
  media: z.array(z.object({ asset_id: uuid, version: z.number().int().positive(), path: memberPath,
    mime_type: z.enum(["image/png", "audio/wav", "audio/mpeg"]) }).strict()).max(100),
  limitations: z.array(z.string().max(2000)).max(10),
}).strict();
export const packageSelection = z.object({ asset_id: uuid, version: z.number().int().positive(), sha256: digest }).strict();
export const packageRestore = packageSelection.extend({ name, preview_hash: digest,
  confirm_project_sharing: z.literal(true), confirm_media_rights: z.literal(true),
  brand_target: packageBrandTarget.optional(), brand_review_hash: digest.optional(), confirm_brand_review: z.literal(true).optional() }).strict();
export type CreativePackageManifest = z.infer<typeof packageManifest>;

export function parseCreativeSource(kind: "poster" | "video", input: unknown) {
  const parsed = kind === "poster" ? poster.parse(input) : videoDefinition.parse(input);
  if (kind === "poster" && "layers" in parsed && !parsed.brand && parsed.layers.some(l => l.type === "text" && (l.font_key || l.fact_key)))
    throw new Problem(422, "PACKAGE_BRAND_REBIND_REQUIRED", "Font and fact references require an explicit source brand binding");
  return parsed;
}
export function creativeReferences(kind: "poster" | "video", input: unknown) {
  if (kind === "video") return videoReferences(videoDefinition.parse(input));
  const refs = poster.parse(input).layers.filter(l => l.type === "image").map(l => ({ asset_id: l.asset_id, version: l.version }));
  return [...new Map(refs.map(r => [r.asset_id + ":" + r.version, r])).values()];
}
/** Only validated content is rebased. IDs in archive metadata never become authority. */
export function remapCreativeSource(kind: "poster" | "video", source: unknown, mapping: Map<string, { asset_id: string; version: number }>) {
  const ref = (r: { asset_id: string; version: number }) => {
    const next = mapping.get(r.asset_id + ":" + r.version);
    if (!next) throw new Problem(422, "PACKAGE_MEDIA_MISSING", "The project has an unresolved media version");
    return next;
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
