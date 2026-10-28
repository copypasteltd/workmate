/** Original procedural test artwork, never customer media or an AI creation. */
import { createCanvas } from "@napi-rs/canvas";
import { hash } from "./lib.js";
import { effectsCatalog, parseEffect } from "./media-effects-model.js";
export function effectDemoSources() {
  const first = createCanvas(640, 360),
    second = createCanvas(640, 360),
    key = createCanvas(640, 360),
    noise = createCanvas(640, 360);
  for (const [canvas, bg, fg, x] of [
    [first, "#1F5EFF", "#F6F3EA", 80],
    [second, "#F6F3EA", "#1F5EFF", 320],
  ] as const) {
    const c = canvas.getContext("2d");
    c.fillStyle = bg;
    c.fillRect(0, 0, 640, 360);
    c.fillStyle = fg;
    c.beginPath();
    c.moveTo(x, 60);
    c.lineTo(x + 180, 100);
    c.lineTo(x + 140, 260);
    c.lineTo(x - 40, 220);
    c.closePath();
    c.fill();
    c.fillStyle = canvas === first ? "#92AEFF" : "#ABC2FF";
    c.fillRect(x + 20, 160, 130, 110);
  }
  const k = key.getContext("2d");
  k.fillStyle = "#00FF00";
  k.fillRect(0, 0, 640, 360);
  k.fillStyle = "#EF5CA3";
  k.fillRect(240, 80, 160, 240);
  k.fillStyle = "#FFFFFF";
  k.fillRect(260, 160, 120, 80);
  const n = noise.getContext("2d"),
    data = n.createImageData(640, 360);
  let state = 1234567;
  for (let i = 0; i < data.data.length; i += 4) {
    state = (1664525 * state + 1013904223) >>> 0;
    const value = 110 + (state % 51) - 25;
    data.data[i] = value;
    data.data[i + 1] = value;
    data.data[i + 2] = value;
    data.data[i + 3] = 255;
  }
  n.putImageData(data, 0, 0);
  return [first, second, key, noise].map((c, i) => {
    const bytes = c.toBuffer("image/png");
    return {
      asset_version_id: `95000000-0000-4000-8000-00000000000${i + 1}`,
      sha256: hash(bytes),
      mime_type: "image/png",
      bytes,
    };
  });
}
export function demoEffectRequest(id: string) {
  const definition = effectsCatalog().items.find((e) => e.id === id);
  if (!definition) throw new Error("Unknown demo effect");
  const sources = effectDemoSources(),
    source =
      definition.category === "key"
        ? sources[2]
        : id === "cleanup.denoise"
          ? sources[3]
          : sources[0];
  return parseEffect({
    schema: "copypaste-media-effect-1",
    effect_id: id,
    version: "1.0.0",
    output: { size: "640x360", seconds: 4 },
    sources: (definition.source_count === 2
      ? sources.slice(0, 2)
      : [source]
    ).map(({ asset_version_id, sha256 }) => ({ asset_version_id, sha256 })),
    parameters: definition.defaults,
  });
}
