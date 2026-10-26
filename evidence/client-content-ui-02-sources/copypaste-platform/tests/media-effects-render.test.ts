import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { Catalog } from "../src/catalog.js";
import { canonical, hash } from "../src/lib.js";
import {
  effectsCatalog,
  effectDigest,
  parseEffect,
} from "../src/media-effects-model.js";
import {
  renderMediaEffect,
  preflightMediaEffect,
  type EffectSource,
} from "../src/media-effects-render.js";
import {
  effectDemoSources,
  demoEffectRequest,
} from "../src/media-effects-demo.js";
const exec = promisify(execFile);
function image(
  index: number,
  pixel: (x: number, y: number) => number[],
): EffectSource {
  const png = new PNG({ width: 640, height: 360 });
  for (let y = 0; y < 360; y++)
    for (let x = 0; x < 640; x++)
      png.data.set([...pixel(x, y), 255], (y * 640 + x) * 4);
  const bytes = PNG.sync.write(png);
  return {
    asset_version_id: `95000000-0000-4000-8000-00000000000${index}`,
    sha256: hash(bytes),
    bytes,
    mime_type: "image/png",
  };
}
function request(id: string, sources: EffectSource[], parameters?: any) {
  const base = demoEffectRequest(id);
  return parseEffect({
    ...base,
    sources: sources.map(({ asset_version_id, sha256 }) => ({
      asset_version_id,
      sha256,
    })),
    ...(parameters ? { parameters } : {}),
  });
}
async function temp<T>(fn: (dir: string) => Promise<T>) {
  const root = path.resolve(".data/media-effects-tests");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(root, { recursive: true }),
  );
  const dir = await mkdtemp(path.join(root, "case-"));
  try {
    return await fn(dir);
  } finally {
    assert.equal(path.dirname(dir), root);
    await rm(dir, { recursive: true, force: true });
  }
}
async function frame(dir: string, bytes: Buffer, index: number) {
  const file = path.join(dir, "probe.mp4");
  await writeFile(file, bytes);
  const output = await exec(
    process.env.FFMPEG_BIN ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-threads",
      "2",
      "-i",
      file,
      "-vf",
      `select=eq(n\\,${index})`,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "-",
    ],
    { windowsHide: true, encoding: "buffer", maxBuffer: 6_000_000 },
  );
  return PNG.sync.read(output.stdout);
}
const at = (p: PNG, x: number, y: number) => [
  ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
];
const red = (p: number[]) => p[0] > 180 && p[1] < 60 && p[2] < 60;
const blue = (p: number[]) => p[2] > 180 && p[0] < 60 && p[1] < 60;
const whiteCount = (p: PNG) => {
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4)
    if (p.data[i] > 180 && p.data[i + 1] > 180 && p.data[i + 2] > 180) n++;
  return n;
};

test("ten independently versioned schemas reject arbitrary fields, altered versions, source counts and impossible transition timing", () => {
  const c = effectsCatalog();
  assert.equal(c.items.length, 10);
  assert.equal(new Set(c.items.map((e) => e.id)).size, 10);
  assert.equal(new Set(c.items.map((e) => e.category)).size, 4);
  assert.equal(c.catalog_sha256, hash(canonical(c.items)));
  for (const e of c.items) {
    const r = demoEffectRequest(e.id);
    assert.equal(effectDigest(r), effectDigest(structuredClone(r)));
    assert.throws(() =>
      parseEffect({ ...r, url: "https://example.invalid/media" }),
    );
    assert.throws(() => parseEffect({ ...r, version: "9.9.9" }));
    assert.throws(() => parseEffect({ ...r, sources: [] }));
    assert.throws(() =>
      parseEffect({
        ...r,
        parameters: {
          ...r.parameters,
          filter: "movie=https://example.invalid",
        },
      }),
    );
  }
  assert.throws(
    () =>
      parseEffect({
        ...demoEffectRequest("transition.crossfade"),
        output: { size: "640x360", seconds: 2 },
        parameters: { transition_seconds: "2" },
      }),
    (e: any) => e.code === "EFFECT_TIMING_INVALID",
  );
});

for (const id of [
  "transition.crossfade",
  "transition.slide-left",
  "transition.wipe-right",
  "transition.dip-black",
])
  test(
    id +
      " produces its actual independently checked temporal/spatial operation and exact silent MP4",
    async () =>
      temp(async (dir) => {
        const sources = [
          image(1, () => [240, 10, 10]),
          image(2, () => [10, 10, 240]),
        ];
        const result = await renderMediaEffect(
          request(id, sources),
          sources,
          dir,
        );
        const first = await frame(dir, result.video, 0),
          mid = await frame(dir, result.video, 48),
          last = await frame(dir, result.video, 84);
        assert.ok(red(at(first, 320, 180)));
        assert.ok(blue(at(last, 320, 180)));
        if (id === "transition.crossfade") {
          const p = at(mid, 320, 180);
          assert.ok(
            p[0] > 80 && p[0] < 170 && p[2] > 80 && p[2] < 170,
            String(p),
          );
        }
        if (id === "transition.slide-left") {
          assert.ok(red(at(mid, 80, 180)));
          assert.ok(blue(at(mid, 560, 180)));
        }
        if (id === "transition.wipe-right") {
          assert.ok(blue(at(mid, 80, 180)));
          assert.ok(red(at(mid, 560, 180)));
        }
        if (id === "transition.dip-black")
          assert.ok(at(mid, 320, 180).every((n) => n < 16));
        assert.deepEqual(result.probe, {
          width: 640,
          height: 360,
          seconds: 4,
          frames: 96,
          fps: 24,
          video_codec: "h264",
          audio: "omitted",
          full_decode: true,
        });
        assert.equal(result.output_sha256, hash(result.video));
        assert.equal(
          (await readdir(path.join(dir, "media-effects"))).length,
          0,
        );
      }),
  );

for (const id of ["text.fade-in", "text.slide-up"])
  test(
    id +
      " animates real licensed Traditional Chinese glyphs from an empty opening frame into the safe area",
    async () =>
      temp(async (dir) => {
        const sources = [image(1, () => [25, 25, 25])],
          input = request(id, sources, {
            text: "好點子",
            color: "#FFFFFF",
            font_size: 60,
            position: "center",
            entrance_seconds: "1",
          });
        const result = await renderMediaEffect(input, sources, dir),
          first = await frame(dir, result.video, 0),
          end = await frame(dir, result.video, 48);
        assert.ok(whiteCount(first) < 20);
        assert.ok(whiteCount(end) > 800);
        assert.equal(
          result.profile.font_sha256,
          "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f",
        );
      }),
  );

test("chroma key removes the green field, preserves the foreground and composites the approved RGB background", async () =>
  temp(async (dir) => {
    const sources = [effectDemoSources()[2]],
      result = await renderMediaEffect(
        request("key.chroma", sources),
        sources,
        dir,
      ),
      p = await frame(dir, result.video, 48);
    const background = at(p, 20, 20),
      subject = at(p, 250, 120);
    assert.ok(
      background[0] < 60 && background[1] < 140 && background[2] > 180,
      String(background),
    );
    assert.ok(
      subject[0] > 180 && subject[1] < 150 && subject[2] > 80,
      String(subject),
    );
  }));

test("cleanup operations measurably reduce flat-field variance, increase edge contrast and adjust actual luminance against neutral encoded controls", async () =>
  temp(async (dir) => {
    const noisy = [effectDemoSources()[3]],
      neutral = { brightness: 0, contrast: 1, gamma: 1 };
    const control = await renderMediaEffect(
        request("cleanup.exposure", noisy, neutral),
        noisy,
        dir,
      ),
      clean = await renderMediaEffect(
        request("cleanup.denoise", noisy, { strength: 8 }),
        noisy,
        dir,
      );
    const a = await frame(dir, control.video, 48),
      b = await frame(dir, clean.video, 48);
    const variance = (p: PNG) => {
      const values = [];
      for (let y = 80; y < 280; y += 2)
        for (let x = 100; x < 540; x += 2) values.push(at(p, x, y)[0]);
      const mean = values.reduce((a, b) => a + b) / values.length;
      return values.reduce((n, v) => n + (v - mean) ** 2, 0) / values.length;
    };
    assert.ok(
      variance(b) < variance(a) * 0.95,
      `${variance(a)} => ${variance(b)}`,
    );
    const soft = [
      image(1, (x) => {
        const n =
          x < 314
            ? 70
            : x > 326
              ? 180
              : Math.round(70 + ((x - 314) * 110) / 12);
        return [n, n, n];
      }),
    ];
    const base = await renderMediaEffect(
        request("cleanup.exposure", soft, neutral),
        soft,
        dir,
      ),
      sharpen = await renderMediaEffect(
        request("cleanup.sharpen", soft, { amount: 1.5 }),
        soft,
        dir,
      );
    const x = await frame(dir, base.video, 48),
      y = await frame(dir, sharpen.video, 48);
    const edge = (p: PNG) => {
      let max = 0;
      for (let i = 310; i < 332; i++)
        max = Math.max(max, Math.abs(at(p, i + 1, 180)[0] - at(p, i, 180)[0]));
      return max;
    };
    assert.ok(edge(y) > edge(x), `${edge(x)} => ${edge(y)}`);
    const brighter = await renderMediaEffect(
        request("cleanup.exposure", soft, { ...neutral, brightness: 0.15 }),
        soft,
        dir,
      ),
      p = await frame(dir, brighter.video, 48);
    assert.ok(at(p, 100, 180)[0] > at(x, 100, 180)[0] + 20);
  }));

test("malformed, oversized, animated, mismatched and too-short sources fail without emitting a delivery", async () =>
  temp(async (dir) => {
    const sources = [image(1, () => [25, 25, 25])],
      r = request("cleanup.exposure", sources);
    await assert.rejects(
      renderMediaEffect(
        r,
        [{ ...sources[0], bytes: Buffer.from("broken") }],
        dir,
      ),
      (e: any) => e.code === "EFFECT_SOURCE_INTEGRITY",
    );
    for (const bytes of [
      sources[0].bytes.subarray(0, 40),
      Buffer.concat([sources[0].bytes, Buffer.from("trailing")]),
    ]) {
      const s = { ...sources[0], bytes, sha256: hash(bytes) };
      await assert.rejects(
        renderMediaEffect(request(r.effect_id, [s]), [s], dir),
        (e: any) => e.code === "EFFECT_SOURCE_INVALID",
      );
    }
    const short = await renderMediaEffect(
        parseEffect({ ...r, output: { size: "640x360", seconds: 2 } }),
        sources,
        dir,
      ),
      s = {
        ...sources[0],
        bytes: short.video,
        mime_type: "video/mp4",
        sha256: hash(short.video),
      };
    await assert.rejects(
      renderMediaEffect(request("cleanup.exposure", [s]), [s], dir),
      (e: any) => e.code === "EFFECT_SOURCE_LIMIT",
    );
    await assert.rejects(
      renderMediaEffect(
        request("text.fade-in", sources, {
          text: "W".repeat(80),
          color: "#FFFFFF",
          font_size: 120,
          position: "center",
          entrance_seconds: "1",
        }),
        sources,
        dir,
      ),
      (e: any) => e.code === "EFFECT_TEXT_OVERFLOW",
    );
    await assert.rejects(
      renderMediaEffect(
        request("text.fade-in", sources, {
          text: String.fromCodePoint(0x1f984),
          color: "#FFFFFF",
          font_size: 48,
          position: "center",
          entrance_seconds: "1",
        }),
        sources,
        dir,
      ),
      (e: any) => e.code === "VIDEO_GLYPH_MISSING",
    );
    assert.equal((await readdir(path.join(dir, "media-effects"))).length, 0);
  }));

test("aborting an actual in-flight native encode rejects the result and removes its owned temporary media", async () =>
  temp(async (dir) => {
    const sources = effectDemoSources().slice(0, 2),
      input = parseEffect({
        ...request("transition.crossfade", sources),
        output: { size: "1280x720", seconds: 12 },
      }),
      controller = new AbortController();
    const rendering = renderMediaEffect(input, sources, dir, controller.signal);
    let observed = false;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        for (const name of await readdir(path.join(dir, "media-effects")))
          if (
            (await readdir(path.join(dir, "media-effects", name))).includes(
              "effect.mp4",
            )
          )
            observed = true;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      if (observed) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    controller.abort();
    await assert.rejects(rendering, (e: any) => e.code === "EFFECT_CANCELLED");
    assert.equal(observed, true);
    assert.equal((await readdir(path.join(dir, "media-effects"))).length, 0);
  }));

test("free preflight checks real media and pins the encoder profile before paid admission; a changed encoder cannot execute the reviewed request", async () =>
  temp(async (dir) => {
    const sources = effectDemoSources().slice(0, 2),
      input = request("transition.crossfade", sources),
      profile = await preflightMediaEffect(input, sources, dir);
    assert.equal(profile.renderer, "copypaste-media-effects-1");
    assert.equal(
      (await readdir(path.join(dir, "media-effects-preflight"))).length,
      0,
    );
    await assert.rejects(
      renderMediaEffect(input, sources, dir, undefined, {
        ...profile,
        ffmpeg_sha256: "0".repeat(64),
      }),
      (e: any) => e.code === "EFFECT_RENDERER_CHANGED",
    );
  }));

test("the additive role release preserves the old digest, old tool/Skill bindings and all professionally unqualified states", async () => {
  const c = new Catalog();
  await c.load();
  const release = JSON.parse(
    await readFile("catalog/media-effects-release-v1.json", "utf8"),
  );
  assert.equal(c.roles.length, 18);
  assert.equal(c.skills.length, 40);
  assert.equal(c.role("video-motion").version, "1.5.0");
  const old = c.role("video-motion", release.previous_role_sha256);
  assert.equal(old.version, "1.4.0");
  assert.ok(
    !old.skill_bindings.some((b: any) => b.skill_key === "media-effects"),
  );
  assert.equal(c.digest(old), release.previous_role_sha256);
  assert.ok(
    (await c.boundSkills(c.role("video-motion"))).some(
      (s) => s.key === "media-effects",
    ),
  );
  assert.equal(
    c.role("video-motion").qualification_cases.execution_status,
    "not_run",
  );
});
