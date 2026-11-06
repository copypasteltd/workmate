import { test } from "node:test";
import assert from "node:assert/strict";
import { resizedDesign, blankDesignSlide, designResourceLayer } from "../renderer/src/design-production-model.ts";
import { rememberDesign, travelDesign } from "../renderer/src/design-editor-model.ts";
const scene = { width: 1600, height: 900, background: "#f6f3ed", layers: [
  { id: "text", kind: "text", x: 100, y: 100, w: 900, h: 200, font_size: 60, text: "Keep actual content", color: "#282724" },
  { id: "chart", kind: "chart", x: 100, y: 400, w: 640, h: 360, source_version_id: "fixed", sha256: "same", evidence_ids: ["original"] },
] };
test("whole-document adaptation is atomic, preserves fixed facts and is exactly undoable", () => {
  const input = { title: "Actual brief", slides: [{ id: "first", scene }, { id: "second", scene: structuredClone(scene) }] }, before = structuredClone(input);
  const next = resizedDesign(input, "presentation", 1200, 800);
  assert.deepEqual(input, before); assert.equal(next.slides[1].scene.width, 1200); assert.equal(next.slides[0].scene.layers[1].w, 480);
  assert.equal(next.slides[0].scene.layers[1].source_version_id, "fixed"); assert.deepEqual(next.slides[0].scene.layers[1].evidence_ids, ["original"]);
  const current = { name: "Brief", input }, edited = { name: "Brief", input: next }, history = rememberDesign({ past: [], future: [] }, current);
  assert.deepEqual(travelDesign(history, edited, "undo")!.snapshot, current);
  for (const [w, h] of [[256,256],[1600,256],[Infinity,900],[1200.5,800],[2000,900]]) { assert.throws(() => resizedDesign(input, "presentation", w, h)); assert.deepEqual(input, before); }
});
test("new pages preserve document dimensions without copying another page's source authority", () => {
  const page = blankDesignSlide(scene, "new_page", "New page"); assert.equal(page.scene.width, 1600); assert.equal(page.scene.height, 900);
  assert.equal(page.scene.layers.length, 1); assert.equal(page.scene.layers[0].text, "New page"); assert.equal(JSON.stringify(page).includes("source_version_id"), false);
});
test("images retain original hashes and dimensions while charts reject mixed scopes and undersized canvases", () => {
  const image = designResourceLayer(scene, { kind: "image", width: 2400, height: 1200, source_version_id: "original", sha256: "original-digest" }, "image", "Actual product");
  assert.equal(image.w, 480); assert.equal(image.h, 240); assert.equal(image.sha256, "original-digest"); assert.equal(image.asset_version_id, "original");
  const source = { kind: "chart", source_version_id: "calculated", sha256: "frozen" }, values = [{ id: "a", series_key: "HKD" }, { id: "b", series_key: "HKD" }];
  assert.deepEqual(designResourceLayer(scene, source, "chart", "Spend", values).evidence_ids, ["a", "b"]);
  assert.throws(() => designResourceLayer(scene, source, "chart", "Spend", [...values, { id: "c", series_key: "USD" }]));
  assert.throws(() => designResourceLayer(scene, source, "chart", "Spend", [values[0], values[0]]));
  assert.throws(() => designResourceLayer({ ...scene, width: 300 }, source, "chart", "Spend", values));
});
