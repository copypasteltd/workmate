import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderMediaEffect } from "../src/media-effects-render.js";
import { effectsCatalog } from "../src/media-effects-model.js";
import {
  effectDemoSources,
  demoEffectRequest,
} from "../src/media-effects-demo.js";
import { hash } from "../src/lib.js";
import { execFileSync } from "node:child_process";
const folder = path.resolve("../copypaste-web/public/effects/1.0.0"),
  sources = effectDemoSources(),
  examples = [];
const replace = process.argv[2] === "--replace-unpublished-fixtures";
if (
  replace &&
  execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "ls-files",
      "--",
      "public/effects/1.0.0",
    ],
    {
      cwd: path.resolve("../copypaste-web"),
      encoding: "utf8",
      windowsHide: true,
    },
  ).trim()
)
  throw new Error("Never overwrite published examples; create a new version");
const flag = replace ? "w" : "wx";
await mkdir(folder, { recursive: true });
for (const [i, source] of sources.entries())
  await writeFile(path.join(folder, `source-${i + 1}.png`), source.bytes, {
    flag,
  });
for (const definition of effectsCatalog().items) {
  const request = demoEffectRequest(definition.id),
    input = request.sources.map(
      (ref) =>
        sources.find((s) => s.asset_version_id === ref.asset_version_id)!,
    );
  const result = await renderMediaEffect(
    request,
    input,
    ".data/effect-examples",
  );
  const stem = definition.id.replaceAll(".", "-"),
    video = stem + ".mp4",
    preview = stem + ".png";
  await writeFile(path.join(folder, video), result.video, { flag });
  await writeFile(path.join(folder, preview), result.preview, { flag });
  examples.push({
    effect_id: definition.id,
    request,
    request_sha256: result.request_sha256,
    definition_sha256: definition.definition_sha256,
    video,
    video_sha256: hash(result.video),
    preview,
    preview_sha256: hash(result.preview),
    probe: result.probe,
    profile: result.profile,
  });
  console.log("Rendered and fully decoded " + definition.id);
}
await writeFile(
  path.join(folder, "examples.json"),
  JSON.stringify(
    {
      schema: "copypaste-effect-examples-1",
      catalog_sha256: effectsCatalog().catalog_sha256,
      artwork:
        "Original procedural fixture artwork; synthetic version IDs are examples only, not user assets. No model/provider request.",
      sources: sources.map((s, i) => ({
        asset_version_id: s.asset_version_id,
        sha256: s.sha256,
        file: `source-${i + 1}.png`,
      })),
      examples,
    },
    null,
    2,
  ) + "\n",
  { flag },
);
