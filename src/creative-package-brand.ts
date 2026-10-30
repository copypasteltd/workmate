import { z } from "zod";
import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { poster, renderProjectPoster } from "./business.js";
import { brandDefinition, brandVersion, prepareBrandProduction } from "./brand-production.js";
import { canonical, hash, Problem } from "./lib.js";
import { packageBrandRequirements, type PackageBrandRequirements, type PackageBrandTarget } from "./creative-package-model.js";

/** Archive declarations describe content; they never grant destination authority. */
export function validatePackageBrand(kind: "poster" | "video", source: unknown, requirements?: PackageBrandRequirements) {
  if (kind !== "poster") { if (requirements) throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "Video cannot declare canvas brand bindings"); return; }
  const p = poster.parse(source);
  if (!!p.brand !== !!requirements) throw new Problem(422, "PACKAGE_BRAND_REBIND_REQUIRED", "Brand canvases require a complete explicit binding description");
  if (!requirements) return;
  const texts = p.layers.flatMap((l, layer) => l.type === "text" ? [{ l, layer }] : []);
  if (texts.length !== requirements.texts.length || new Set(requirements.texts.map(t => t.layer)).size !== texts.length
    || requirements.texts.some(t => { const l = p.layers[t.layer]; return !l || l.type !== "text" || (l.font_key && l.font_key !== t.font_key)
      || l.fact_key !== t.fact_key || !!t.fact_key !== !!t.fact_kind; })
    || new Set(requirements.logos.map(l => l.layer)).size !== requirements.logos.length
    || requirements.logos.some(l => p.layers[l.layer]?.type !== "image"))
    throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "Brand layer declarations do not match this editable source");
}

export async function describePackageBrand(tx: Tx, storage: Storage, project: string, source: unknown) {
  const p = poster.parse(source); if (!p.brand) return undefined;
  const texts = p.layers.flatMap((l, layer) => l.type === "text" ? [{ l, layer }] : []);
  const prepared = await prepareBrandProduction(tx, storage, project, p.brand, texts.map(t => t.l));
  const b = brandDefinition.parse(prepared.row.body);
  return packageBrandRequirements.parse({ source_name: prepared.row.name, source_sha256: prepared.row.sha256,
    texts: texts.map(({ l, layer }, i) => ({ layer, font_key: l.font_key ?? b.font_bindings[0].key,
      ...(l.fact_key ? { fact_key: l.fact_key, fact_kind: b.facts.find(f => f.key === l.fact_key)!.kind } : {}), resolved_text: prepared.resolved[i].text })),
    logos: p.layers.flatMap((l, layer) => { const logo = l.type === "image" && b.logos.find(v => v.asset_id === l.asset_id && v.version === l.version);
      return logo ? [{ layer, key: logo.key }] : []; }) });
}

function exactMap(rows: { source_key: string; target_key: string }[], required: string[], available: string[], kind: string) {
  const keys = new Set(required), map = new Map(rows.map(r => [r.source_key, r.target_key]));
  if (map.size !== rows.length || map.size !== keys.size || rows.some(r => !keys.has(r.source_key) || !available.includes(r.target_key)))
    throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "Map every required brand field to one available target field", { kind });
  return map;
}

export async function preparePackageBrand(tx: Tx, storage: Storage, project: string, source: unknown,
  requirements: PackageBrandRequirements, target: PackageBrandTarget, archiveHash: string, previewHash: string) {
  validatePackageBrand("poster", source, requirements);
  const original = poster.parse(source), row = await brandVersion(tx, project, target.binding.id, target.binding.version), b = brandDefinition.parse(row.body);
  const fonts = exactMap(target.fonts, requirements.texts.map(t => t.font_key), b.font_bindings.map(f => f.key), "fonts"),
    facts = exactMap(target.facts, requirements.texts.flatMap(t => t.fact_key ? [t.fact_key] : []), b.facts.map(f => f.key), "facts"),
    logos = exactMap(target.logos, requirements.logos.map(l => l.key), b.logos.map(l => l.key), "logos");
  const palette = new Set([original.background, ...original.layers.flatMap(l => l.type === "image" ? [] : [l.color])].map(c => c.toLowerCase()));
  const colors = new Map(target.colors.map(c => [c.from.toLowerCase(), c.to]));
  if (colors.size !== target.colors.length || target.colors.some(c => !palette.has(c.from.toLowerCase()) || !b.colors.some(t => t.toLowerCase() === c.to.toLowerCase())))
    throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "Use source design colors and approved destination brand colors", { kind: "colors" });
  const color = (v: string) => colors.get(v.toLowerCase()) ?? v;
  const byLayer = new Map(requirements.texts.map(t => [t.layer, t]));
  const definition = poster.parse({ ...original, brand: target.binding, background: color(original.background), layers: original.layers.map((l, i) => {
    if (l.type === "image") return l;
    if (l.type === "rect") return { ...l, color: color(l.color) };
    const declared = byLayer.get(i)!;
    if (declared.fact_key && b.facts.find(f => f.key === facts.get(declared.fact_key!))!.kind !== declared.fact_kind)
      throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "Map each fact to the same product, price or promotion type", { kind: "facts" });
    return { ...l, color: color(l.color), font_key: fonts.get(declared.font_key)!, ...(declared.fact_key ? { fact_key: facts.get(declared.fact_key)! } : {}) };
  }) });
  const textLayers = definition.layers.flatMap((l, layer) => l.type === "text" ? [{ l, layer }] : []),
    prepared = await prepareBrandProduction(tx, storage, project, target.binding, textLayers.map(t => t.l));
  const assetOverrides = new Map<string, { asset_id: string; version: number }>(), logoChanges: object[] = [];
  const logoLayers = requirements.logos.map(({ layer, key }) => {
    const l = original.layers[layer]; if (l.type !== "image") throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "Logo layer is unavailable");
    const targetLogo = b.logos.find(v => v.key === logos.get(key))!;
    const sourceKey = l.asset_id + ":" + l.version, next = { asset_id: targetLogo.asset_id, version: targetLogo.version }, previous = assetOverrides.get(sourceKey);
    if (previous && canonical(previous) !== canonical(next)) throw new Problem(422, "PACKAGE_BRAND_MAPPING_INVALID", "One source Logo cannot map to two target source versions");
    assetOverrides.set(sourceKey, next); logoChanges.push({ layer, source_key: key, target_key: targetLogo.key });
    return { ...l, ...next };
  });
  // Validate exact destination Logo bytes, minimum size and clear space without importing source media first.
  if (logoLayers.length) await renderProjectPoster(tx, storage, project, { ...definition, layers: logoLayers });
  const changes = textLayers.map(({ l, layer }, i) => ({ layer, before: byLayer.get(layer)!.resolved_text,
    after: prepared.resolved[i].text, source_font_key: byLayer.get(layer)!.font_key, target_font_key: l.font_key!,
    source_fact_key: byLayer.get(layer)!.fact_key ?? null, target_fact_key: l.fact_key ?? null,
    font_label: b.font_bindings.find(f => f.key === l.font_key)!.label }));
  textLayers.forEach(({ layer }, i) => { const l = definition.layers[layer]; if (l.type === "text") l.text = prepared.resolved[i].text; });
  const review = { source_name: requirements.source_name, target_name: row.name, target_brand: target.binding, target_sha256: row.sha256,
    texts: changes, logos: logoChanges, colors: target.colors, retains_unmapped_copy_and_colors: true, rights_status: "customer_declared", ai_cost_micros: "0" };
  return { definition, assetOverrides, review, review_hash: hash(canonical({ archiveHash, previewHash, target, review })) };
}
