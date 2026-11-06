export type Box = { x: number; y: number; w: number; h: number };
export type CanvasLayer = Box & { id: string; kind: string; stroke?: string | null; stroke_width?: number; radius?: number; [key: string]: any };
export type CanvasScene = { width: number; height: number; background: string; layers: CanvasLayer[] };
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const finite = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n) ? n : fallback;
export function fitLayer(scene: CanvasScene, source: CanvasLayer, patch: Partial<CanvasLayer>): CanvasLayer {
  const next = { ...source, ...patch }, edge = next.stroke ? clamp(finite(next.stroke_width, 0), 0, 24) / 2 : 0;
  const minW = next.kind === "chart" ? 360 : 1, minH = next.kind === "chart" ? 230 : 1;
  next.w = clamp(finite(next.w, source.w), minW, scene.width - edge * 2);
  next.h = clamp(finite(next.h, source.h), minH, scene.height - edge * 2);
  next.x = clamp(finite(next.x, source.x), edge, scene.width - next.w - edge);
  next.y = clamp(finite(next.y, source.y), edge, scene.height - next.h - edge);
  if (next.kind === "rect") next.radius = clamp(finite(next.radius, 0), 0, Math.min(200, next.w / 2, next.h / 2));
  return next;
}
export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export function alignedLayer(scene: CanvasScene, layer: CanvasLayer, alignment: Alignment) {
  const edge = layer.stroke ? (layer.stroke_width ?? 0) / 2 : 0;
  const value = alignment === "left" ? { x: edge } : alignment === "center" ? { x: (scene.width - layer.w) / 2 }
    : alignment === "right" ? { x: scene.width - layer.w - edge } : alignment === "top" ? { y: edge }
    : alignment === "middle" ? { y: (scene.height - layer.h) / 2 } : { y: scene.height - layer.h - edge };
  return fitLayer(scene, layer, value);
}
export function gestureLayer(scene: CanvasScene, layer: CanvasLayer, dx: number, dy: number, resize: boolean) {
  if (!resize) return fitLayer(scene, layer, { x: layer.x + dx, y: layer.y + dy });
  const edge = layer.stroke ? (layer.stroke_width ?? 0) / 2 : 0;
  return fitLayer(scene, layer, { w: Math.min(layer.w + dx, scene.width - layer.x - edge), h: Math.min(layer.h + dy, scene.height - layer.y - edge) });
}
export type DesignSnapshot = { name: string; input: any };
export type DesignHistory = { past: DesignSnapshot[]; future: DesignSnapshot[] };
export function rememberDesign(history: DesignHistory, previous: DesignSnapshot): DesignHistory {
  const past = [...history.past, structuredClone(previous)];
  while (past.length > 30 || past.length > 1 && JSON.stringify(past).length > 2_000_000) past.shift();
  return { past, future: [] };
}
export function travelDesign(history: DesignHistory, current: DesignSnapshot, direction: "undo" | "redo") {
  const from = direction === "undo" ? history.past : history.future, next = from.at(-1);
  if (!next) return null;
  return { snapshot: structuredClone(next), history: direction === "undo"
    ? { past: from.slice(0, -1), future: [...history.future, structuredClone(current)] }
    : { past: [...history.past, structuredClone(current)], future: from.slice(0, -1) } };
}
