import { test } from "node:test";
import assert from "node:assert/strict";
import { pngFromSVG, motionFromSVG } from "../src/render.js";
import { renderPoster } from "../src/business.js";
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
