import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import { demoVectorInput, demoSlidesInput } from "../src/editable-design-demo.js";
import { designScene } from "../src/editable-design-model.js";
import { renderEditableDesign } from "../src/editable-design-render.js";
import { hash } from "../src/lib.js";

for (const kind of ["vector", "presentation"] as const) test(`${kind} preserves actual PNG pixels, image/shape z-order and outlined text through PNG/PDF and editable SVG/PPTX delivery`, async () => {
  const png = new PNG({ width: 32, height: 32 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 35; png.data[i + 1] = 82; png.data[i + 2] = 223; png.data[i + 3] = 255; }
  const bytes = PNG.sync.write(png), id = randomUUID(), scene = designScene.parse({ width: 256, height: 256, background: "#ffffff", layers: [
    { kind: "image", id: "product", x: 32, y: 32, w: 96, h: 96, asset_version_id: id, sha256: hash(bytes), alt: "Fixed blue source", fit: "contain" },
    { kind: "rect", id: "overlay", x: 70, y: 70, w: 40, h: 40, fill: "#ff0000" },
    { kind: "text", id: "title", x: 16, y: 160, w: 224, h: 60, text: "Actual image", font_size: 24, weight: 700, color: "#15171a" },
  ] });
  const input = kind === "vector" ? { ...demoVectorInput(), scene } : (() => { const p = demoSlidesInput(); return { ...p, slides: [{ ...p.slides[0], scene }] }; })();
  const rendered = await renderEditableDesign(kind, input as any, { images: new Map([[id, bytes]]), charts: new Map() }, "simulated");
  const file = (suffix: string) => { const f = rendered.files.find(v => v.name.endsWith(suffix)); assert.ok(f, suffix); return f.bytes; };
  const pixels = PNG.sync.read(file(".png")), pixel = (x: number, y: number) => [...pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)];
  assert.deepEqual(pixel(50, 50), [35, 82, 223, 255], "Actual source image pixels must survive font outlining");
  assert.deepEqual(pixel(85, 85), [255, 0, 0, 255], "The later rectangle must stay above the source image");
  assert.deepEqual(pixel(200, 50), [255, 255, 255, 255]);
  const editable = file(kind === "vector" ? "brand-vector.svg" : "slide-01.svg").toString(); assert.ok(editable.includes("<image")); assert.ok(editable.includes("<text"));
  if (kind === "vector") { const outline = file(".outlined.svg").toString(); assert.ok(outline.includes("<image")); assert.ok(!outline.includes("<text")); assert.ok(outline.includes("<path")); }
  else { const parts = unzipSync(file(".pptx")), media = Object.keys(parts).filter(v => /^ppt\/media\/.+\.png$/.test(v));
    assert.equal(media.length, 1); assert.deepEqual(Buffer.from(parts[media[0]]), bytes); assert.match(Buffer.from(parts["ppt/slides/slide1.xml"]).toString(), /<p:pic>/); }
  assert.equal((await PDFDocument.load(file("review.pdf"))).getPageCount(), 1);
});
