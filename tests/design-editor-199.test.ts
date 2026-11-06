import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLayer, alignedLayer, gestureLayer, rememberDesign, travelDesign, type CanvasLayer } from "../renderer/src/design-editor-model.ts";
import { readDesignDraft, keepDesignDraft, forgetDesignDraft, clearDesignDrafts, designDraftPrefix } from "../renderer/src/design-draft-state.ts";
const layer: CanvasLayer = { id: "box", kind: "rect", x: 30, y: 40, w: 200, h: 100, stroke: "#15171a", stroke_width: 10, radius: 40 }, scene = { width: 800, height: 600, background: "#fff", layers: [layer] };
test("drag/resize and every alignment preserve complete stroke bounds, chart readability and source identity", () => {
  for (const x of [-2000, -1, 0, 30, 400, 800, 2000]) for (const y of [-2000, 0, 40, 600, 2000]) for (const resize of [false, true]) {
    const n = gestureLayer(scene, layer, x, y, resize); assert.ok(n.x >= 5 && n.y >= 5 && n.x + n.w <= 795 && n.y + n.h <= 595); assert.ok(n.radius! <= Math.min(n.w, n.h) / 2); assert.equal(n.id, layer.id);
  }
  for (const a of ["left", "center", "right", "top", "middle", "bottom"] as const) { const n = alignedLayer(scene, layer, a); assert.ok(n.x >= 5 && n.y >= 5 && n.x + n.w <= 795 && n.y + n.h <= 595); }
  const chart = { ...layer, kind: "chart", w: 400, h: 300, source_version_id: "fixed", sha256: "digest" }, n = gestureLayer(scene, chart, -9999, -9999, true);
  assert.equal(n.w, 360); assert.equal(n.h, 230); assert.equal(n.source_version_id, "fixed"); assert.equal(n.sha256, "digest"); assert.deepEqual(fitLayer(scene, layer, { x: NaN, y: Infinity }), layer);
});
test("history restores content/name exactly, cuts the redo branch and caps history", () => {
  const first = { name: "Original", input: { scene } }, second = { name: "Edited", input: { text: "new" } };
  let h = rememberDesign({ past: [], future: [] }, first); first.name = "mutated outside";
  const undo = travelDesign(h, second, "undo")!; assert.equal(undo.snapshot.name, "Original"); assert.deepEqual(travelDesign(undo.history, undo.snapshot, "redo")!.snapshot, second);
  h = rememberDesign(undo.history, second); assert.deepEqual(h.future, []); for (let i = 0; i < 60; i++) h = rememberDesign(h, second); assert.equal(h.past.length, 30);
});
const rows = new Map<string, string>(); const storage = { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null, getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v); }, removeItem: (k: string) => { rows.delete(k); } };
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
const draft = { base_version: 1, head_version: 2, name: "Unfinished", input: { title: "Customer draft" } };
test("drafts recover only in exact user/tenant/project/work scopes and clear on sign-out", () => {
  rows.clear(); rows.set("unrelated", "keep"); assert.equal(keepDesignDraft("user:tenant:project", "work", draft), true);
  assert.equal(readDesignDraft("different-user:tenant:project", "work"), null); assert.equal(readDesignDraft("user:tenant:other-project", "work"), null); assert.equal(readDesignDraft("user:tenant:project", "other-work"), null);
  assert.deepEqual(readDesignDraft("user:tenant:project", "work")!.input, draft.input); clearDesignDrafts(); assert.deepEqual([...rows], [["unrelated", "keep"]]);
});
test("expired, oversized, corrupt and storage-denied drafts never silently recover", () => {
  rows.clear(); keepDesignDraft("scope", "work", draft); const k = [...rows.keys()][0], v = JSON.parse(rows.get(k)!); rows.set(k, JSON.stringify({ ...v, at: Date.now() - 9 * 3600000 })); assert.equal(readDesignDraft("scope", "work"), null);
  rows.set(k, "{corrupt"); assert.equal(readDesignDraft("scope", "work"), null); assert.equal(keepDesignDraft("scope", "work", { ...draft, input: { text: "a".repeat(2_000_001) } }), false);
  for (let i = 0; i < 8; i++) assert.equal(keepDesignDraft("scope", String(i), draft), true); assert.equal(keepDesignDraft("scope", "9", draft), false); assert.equal([...rows.keys()].filter(k => k.startsWith(designDraftPrefix)).length, 8); forgetDesignDraft("scope", "1"); assert.equal(keepDesignDraft("scope", "9", draft), true);
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } } }); assert.equal(keepDesignDraft("scope", "work", draft), false); assert.equal(readDesignDraft("scope", "work"), null); clearDesignDrafts(); Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
});
