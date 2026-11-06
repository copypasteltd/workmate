import type { CanvasLayer, CanvasScene } from "./design-editor-model";

export function resizedDesign(input: any, kind: string, width: number, height: number) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 256 && n <= 1920)) throw Error("DESIGN_SIZE_RANGE");
  const result = structuredClone(input), scenes: CanvasScene[] = kind === "vector" ? [result.scene] : result.slides.map((p: any) => p.scene);
  for (const scene of scenes) {
    const sx = width / scene.width, sy = height / scene.height, scale = Math.min(sx, sy);
    for (const l of scene.layers) {
      l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy;
      if (l.kind === "text") {
        l.font_size *= scale;
        if (l.font_size < 12 || l.font_size > 180) throw Error("DESIGN_TEXT_SIZE");
      }
      if (l.stroke) { l.stroke_width = (l.stroke_width ?? 0) * scale; if (l.stroke_width > 24) throw Error("DESIGN_STROKE_SIZE"); }
      if (l.kind === "rect") l.radius = Math.min((l.radius ?? 0) * scale, 200, l.w / 2, l.h / 2);
      if (l.kind === "chart" && (l.w < 360 || l.h < 230)) throw Error("DESIGN_CHART_SIZE");
      const edge = l.stroke ? l.stroke_width! / 2 : 0;
      // Proportional stroke placement can differ on a changed aspect ratio.
      // Inset without clipping any edge; reject rather than partially apply.
      if (l.w + edge * 2 > width || l.h + edge * 2 > height) throw Error("DESIGN_LAYER_SIZE");
      l.x = Math.min(width - l.w - edge, Math.max(edge, l.x)); l.y = Math.min(height - l.h - edge, Math.max(edge, l.y));
    }
    scene.width = width; scene.height = height;
  }
  return result;
}
export function blankDesignSlide(scene: CanvasScene, id: string, title: string) {
  return { id, title, notes: "", scene: { width: scene.width, height: scene.height, background: scene.background,
    layers: [{ id: "headline", kind: "text", x: 24, y: 24, w: scene.width - 48, h: Math.min(160, scene.height - 48),
      text: title, font_size: 24, weight: 700, color: "#282724", align: "left", line_height: 1.4 }] } };
}
export function designResourceLayer(scene: CanvasScene, resource: any, id: string, title: string, evidence: any[] = []): CanvasLayer {
  const base = { id, x: 24, y: 24 };
  if (resource.kind === "image") {
    const scale = Math.min((scene.width - 48) / resource.width, (scene.height - 48) / resource.height, 480 / resource.width);
    return { ...base, kind: "image", w: Math.max(1, resource.width * scale), h: Math.max(1, resource.height * scale),
      asset_version_id: resource.source_version_id, sha256: resource.sha256, alt: title, fit: "contain" };
  }
  if (scene.width < 408 || scene.height < 278) throw Error("DESIGN_CHART_SIZE");
  if (!evidence.length || evidence.length > 8 || new Set(evidence.map(r => r.id)).size !== evidence.length
    || new Set(evidence.map(r => r.series_key)).size !== 1) throw Error("DESIGN_CHART_SCOPE");
  return { ...base, kind: "chart", w: Math.min(640, scene.width - 48), h: Math.min(360, scene.height - 48),
    source_version_id: resource.source_version_id, sha256: resource.sha256, title,
    evidence_ids: evidence.map(r => r.id), color: "#b55f36" };
}
