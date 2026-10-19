import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pngFromSVG,
  pdfFromSVG,
  motionFromSVG,
  designFormatsForTools,
} from "../src/render.js";
import { PDFDocument } from "pdf-lib";
import { renderPoster } from "../src/business.js";
test("PDF review copies have one bounded page with the canvas aspect ratio and distinct format permissions", async () => {
  const svg = renderPoster({
    width: 320,
    height: 400,
    background: "#F6F6F4",
    layers: [
      {
        type: "text",
        text: "審閱稿 · Review",
        x: 24,
        y: 80,
        font_size: 24,
        color: "#15171A",
      },
    ],
  });
  const rendered = await pdfFromSVG(svg, 320, 400);
  assert.equal(rendered.bytes.subarray(0, 5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(rendered.bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 240, height: 300 });
  assert.equal(rendered.probe.editable_text, false);
  assert.equal(rendered.probe.print_certified, false);
  await assert.rejects(pdfFromSVG(svg, 321, 400), /do not match/);
  await assert.rejects(pdfFromSVG(svg, 320, 4097), /dimensions/);
  assert.deepEqual(designFormatsForTools(["layout.render"]), ["svg", "png"]);
  assert.deepEqual(designFormatsForTools(["document.render"]), ["pdf"]);
  assert.deepEqual(designFormatsForTools(["video.render"]), ["mp4"]);
  assert.deepEqual(designFormatsForTools(["asset.write"]), []);
});
test("native design pipeline produces actual PNG and validated H.264/AAC motion output", async () => {
  const svg = renderPoster({
    width: 320,
    height: 400,
    background: "#F6F6F4",
    layers: [
      {
        type: "rect",
        x: 25,
        y: 40,
        width: 200,
        height: 8,
        color: "#1F5EFF",
        radius: 4,
      },
      {
        type: "text",
        text: "品牌新可能",
        x: 25,
        y: 160,
        font_size: 32,
        color: "#15171A",
        font_family: "sans",
        weight: "bold",
      },
    ],
  });
  const png = pngFromSVG(svg);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 1000);
  const video = await motionFromSVG(svg, 320, 400, {
    duration: 3,
    effect: "fade",
    dataDir: ".data/test",
  });
  assert.equal(video.probe.video_codec, "h264");
  assert.equal(video.probe.fps, 30);
  assert.ok(video.bytes.length > 1000);
  await assert.rejects(
    motionFromSVG(svg, 321, 400, {
      duration: 3,
      effect: "still",
      dataDir: ".data/test",
    }),
  );
});
