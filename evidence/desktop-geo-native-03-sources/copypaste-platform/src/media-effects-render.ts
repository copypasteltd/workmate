import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PNG } from "pngjs";
import { canonical, hash, Problem } from "./lib.js";
import { loadVideoFont } from "./video-font.js";
import {
  effectsCatalog,
  effectDigest,
  parseEffect,
  type EffectRequest,
} from "./media-effects-model.js";

const exec = promisify(execFile);
export type EffectSource = {
  asset_version_id: string;
  sha256: string;
  mime_type: string;
  bytes: Buffer;
};
export function checkEffectsCancellation(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new Problem(
      409,
      "EFFECT_CANCELLED",
      "Effect rendering was cancelled",
    );
}
async function run(
  binary: string,
  args: string[],
  signal?: AbortSignal,
  timeout = 60000,
) {
  checkEffectsCancellation(signal);
  let closed: Promise<unknown> | undefined;
  try {
    const operation = exec(binary, args, {
      signal,
      timeout,
      maxBuffer: 2_000_000,
      windowsHide: true,
    });
    closed = new Promise((resolve) => operation.child.once("close", resolve));
    return await operation;
  } catch (error: any) {
    // Abort reports before Windows necessarily releases output handles. Wait
    // for this exact owned process to close before removing its directory.
    await closed;
    checkEffectsCancellation(signal);
    if (error.code === "ENOENT")
      throw new Problem(
        503,
        "EFFECT_ENCODER_UNAVAILABLE",
        "The native media encoder is unavailable",
      );
    throw new Problem(
      422,
      "EFFECT_MEDIA_INVALID",
      "The bounded native media operation failed",
      { reason: error.killed ? "timeout" : "media_or_encoder_error" },
    );
  }
}
const encoder = () => process.env.FFMPEG_BIN ?? "ffmpeg";
const probe = () => process.env.FFPROBE_BIN ?? "ffprobe";
export async function effectsRendererProfile(signal?: AbortSignal) {
  const font = await loadVideoFont();
  const e = await run(encoder(), ["-version"], signal, 10000),
    p = await run(probe(), ["-version"], signal, 10000);
  return {
    renderer: "copypaste-media-effects-1",
    font_id: font.font_id,
    font_sha256: font.sha256,
    ffmpeg_sha256: hash(e.stdout),
    ffprobe_sha256: hash(p.stdout),
    video_codec: "h264",
    pixel_format: "yuv420p",
    fps: 24,
    audio: "omitted",
  };
}
async function mediaInfo(file: string, signal?: AbortSignal) {
  return JSON.parse(
    (
      await run(
        probe(),
        [
          "-v",
          "error",
          "-max_alloc",
          "268435456",
          "-protocol_whitelist",
          "file,pipe",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          file,
        ],
        signal,
        15000,
      )
    ).stdout,
  );
}
function png(source: EffectSource) {
  const b = source.bytes;
  if (b.length < 57 || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Problem(422, "EFFECT_SOURCE_INVALID", "Use a complete PNG image");
  const w = b.readUInt32BE(16),
    h = b.readUInt32BE(20);
  if (!w || !h || w > 1920 || h > 1920)
    throw new Problem(
      422,
      "EFFECT_SOURCE_LIMIT",
      "Images must be at most 1920 pixels per side",
    );
  let pos = 8,
    ended = false;
  while (pos < b.length) {
    if (pos + 12 > b.length)
      throw new Problem(422, "EFFECT_SOURCE_INVALID", "Truncated PNG");
    const n = b.readUInt32BE(pos),
      type = b.toString("ascii", pos + 4, pos + 8);
    if (pos + n + 12 > b.length || ["acTL", "fcTL", "fdAT"].includes(type))
      throw new Problem(
        422,
        "EFFECT_SOURCE_INVALID",
        "Use one intact still PNG frame",
      );
    pos += n + 12;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || pos !== b.length)
    throw new Problem(
      422,
      "EFFECT_SOURCE_INVALID",
      "PNG must end at its complete IEND chunk",
    );
  try {
    PNG.sync.read(b, { checkCRC: true });
  } catch {
    throw new Problem(
      422,
      "EFFECT_SOURCE_INVALID",
      "The PNG cannot be decoded",
    );
  }
  return { width: w, height: h, kind: "still" };
}
async function validate(
  source: EffectSource,
  file: string,
  required: number,
  signal?: AbortSignal,
) {
  if (!source.bytes.length || source.bytes.length > 32 * 1024 * 1024)
    throw new Problem(
      413,
      "EFFECT_SOURCE_LIMIT",
      "Each source must be at most 32 MiB",
    );
  if (hash(source.bytes) !== source.sha256)
    throw new Problem(
      409,
      "EFFECT_SOURCE_INTEGRITY",
      "Source bytes must match their fixed digest",
    );
  if (source.mime_type === "image/png") return png(source);
  if (
    source.mime_type !== "video/mp4" ||
    source.bytes.toString("ascii", 4, 8) !== "ftyp"
  )
    throw new Problem(422, "EFFECT_SOURCE_INVALID", "Use PNG or an H.264 MP4");
  const info = await mediaInfo(file, signal),
    streams = info.streams ?? [],
    videos = streams.filter((s: any) => s.codec_type === "video"),
    v = videos[0];
  const duration = Number(v?.duration ?? info.format?.duration),
    [a, b] = String(v?.avg_frame_rate ?? "0/1")
      .split("/")
      .map(Number),
    fps = a / b;
  if (
    videos.length !== 1 ||
    streams.length > 2 ||
    streams.some(
      (s: any) =>
        !["video", "audio"].includes(s.codec_type) ||
        (s.codec_type === "audio" && s.codec_name !== "aac"),
    ) ||
    v?.codec_name !== "h264" ||
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    v.width < 1 ||
    v.height < 1 ||
    v.width > 1920 ||
    v.height > 1920 ||
    !Number.isFinite(duration) ||
    duration > 60 ||
    duration + 1 / 24 < required ||
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60
  )
    throw new Problem(
      422,
      "EFFECT_SOURCE_LIMIT",
      "Use one H.264 video up to 1920 pixels, 60 fps and 60 seconds, covering the requested interval; optional AAC audio is omitted",
    );
  return {
    width: v.width,
    height: v.height,
    kind: "video",
    duration,
    source_audio: streams.some((s: any) => s.codec_type === "audio"),
  };
}
function caption(
  input: EffectRequest,
  width: number,
  height: number,
  family: string,
) {
  if (!("text" in input.parameters)) return null;
  const p = input.parameters,
    canvas = createCanvas(width, height),
    ctx = canvas.getContext("2d");
  ctx.font = `600 ${p.font_size}px "${family}"`;
  const lines: string[] = [];
  let line = "";
  for (const character of p.text) {
    if (ctx.measureText(line + character).width > width * 0.86) {
      lines.push(line);
      line = character;
    } else line += character;
  }
  if (line) lines.push(line);
  if (
    !lines.length ||
    lines.length > 2 ||
    lines.some((s) => !s || ctx.measureText(s).width > width * 0.86) ||
    lines.length * p.font_size * 1.3 > height * 0.4
  )
    throw new Problem(
      422,
      "EFFECT_TEXT_OVERFLOW",
      "Use shorter text or a smaller font; this preset supports two lines within its safe area",
    );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.color;
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = 8;
  const y = p.position === "center" ? height * 0.5 : height * 0.78;
  lines.forEach((s, i) =>
    ctx.fillText(
      s,
      width / 2,
      y + (i - (lines.length - 1) / 2) * p.font_size * 1.3,
    ),
  );
  return canvas.toBuffer("image/png");
}
function sourceInterval(input: EffectRequest) {
  return "transition_seconds" in input.parameters
    ? input.effect_id === "transition.dip-black"
      ? input.output.seconds / 2
      : (input.output.seconds + Number(input.parameters.transition_seconds)) / 2
    : input.output.seconds;
}
/** Validate actual media, glyphs, text fit and encoder availability before
 * paid task admission. This never renders or fabricates a model read. */
export async function preflightMediaEffect(
  value: EffectRequest,
  sources: EffectSource[],
  dataDir: string,
  signal?: AbortSignal,
) {
  const input = parseEffect(value),
    [width, height] = input.output.size.split("x").map(Number);
  if (
    sources.length !== input.sources.length ||
    sources.some(
      (s, i) =>
        s.asset_version_id !== input.sources[i].asset_version_id ||
        s.sha256 !== input.sources[i].sha256,
    )
  )
    throw new Problem(
      409,
      "EFFECT_SOURCE_CHANGED",
      "Use exact ordered source versions",
    );
  const font = await loadVideoFont(
      "text" in input.parameters ? [input.parameters.text] : [],
    ),
    profile = await effectsRendererProfile(signal);
  caption(input, width, height, font.family);
  const root = path.resolve(dataDir, "media-effects-preflight");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "check-"));
  try {
    for (const [i, source] of sources.entries()) {
      const file = path.join(
        dir,
        `source-${i}.${source.mime_type === "image/png" ? "png" : "mp4"}`,
      );
      await writeFile(file, source.bytes);
      await validate(source, file, sourceInterval(input), signal);
    }
    checkEffectsCancellation(signal);
    return profile;
  } finally {
    if (path.dirname(dir) !== root)
      throw new Error("Effect preflight cleanup escaped its owned directory");
    await rm(dir, { recursive: true, force: true });
  }
}
export async function renderMediaEffect(
  value: EffectRequest,
  sources: EffectSource[],
  dataDir: string,
  signal?: AbortSignal,
  expectedProfile?: unknown,
) {
  const input = parseEffect(value),
    [width, height] = input.output.size.split("x").map(Number),
    seconds = input.output.seconds;
  if (
    sources.length !== input.sources.length ||
    sources.some(
      (s, i) =>
        s.asset_version_id !== input.sources[i].asset_version_id ||
        s.sha256 !== input.sources[i].sha256,
    )
  )
    throw new Problem(
      409,
      "EFFECT_SOURCE_CHANGED",
      "Supply the exact ordered source versions",
    );
  checkEffectsCancellation(signal);
  const font = await loadVideoFont(
      "text" in input.parameters ? [input.parameters.text] : [],
    ),
    profile = await effectsRendererProfile(signal);
  if (expectedProfile && canonical(profile) !== canonical(expectedProfile))
    throw new Problem(
      409,
      "EFFECT_RENDERER_CHANGED",
      "The reviewed renderer profile changed; review a new request",
    );
  const root = path.resolve(dataDir, "media-effects");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "render-"));
  try {
    const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-max_alloc",
        "268435456",
        "-filter_complex_threads",
        "1",
      ],
      graphs: string[] = [],
      sourceInfo = [];
    const transition =
      "transition_seconds" in input.parameters
        ? Number(input.parameters.transition_seconds)
        : null;
    const interval = sourceInterval(input);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i],
        file = path.join(
          dir,
          `source-${i}.${s.mime_type === "image/png" ? "png" : "mp4"}`,
        );
      await writeFile(file, s.bytes);
      sourceInfo.push(await validate(s, file, interval, signal));
      args.push(
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-noautorotate",
      );
      if (s.mime_type === "image/png")
        args.push(
          "-f",
          "image2",
          "-pattern_type",
          "none",
          "-loop",
          "1",
          "-framerate",
          "24",
          "-c:v",
          "png",
        );
      else args.push("-f", "mov");
      args.push("-i", file);
      graphs.push(
        `[${i}:v]trim=start=0:duration=${interval},setpts=PTS-STARTPTS,fps=24,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,settb=AVTB[s${i}]`,
      );
    }
    if (transition !== null && input.effect_id === "transition.dip-black") {
      graphs.push(
        `[s0]fade=t=out:st=${interval - transition / 2}:d=${transition / 2}[fadeout]`,
      );
      graphs.push(`[s1]fade=t=in:st=0:d=${transition / 2}[fadein]`);
      graphs.push("[fadeout][fadein]concat=n=2:v=1:a=0,format=yuv420p[out]");
    } else if (transition !== null) {
      const type = {
        "transition.crossfade": "fade",
        "transition.slide-left": "slideleft",
        "transition.wipe-right": "wiperight",
        "transition.dip-black": "fadeblack",
      }[input.effect_id as "transition.crossfade"];
      graphs.push(
        `[s0][s1]xfade=transition=${type}:duration=${transition}:offset=${interval - transition},format=yuv420p[out]`,
      );
    } else if ("text" in input.parameters) {
      const overlay = path.join(dir, "caption.png");
      await writeFile(overlay, caption(input, width, height, font.family)!);
      args.push(
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-loop",
        "1",
        "-framerate",
        "24",
        "-i",
        overlay,
      );
      const duration = Number(input.parameters.entrance_seconds);
      if (input.effect_id === "text.fade-in") {
        graphs.push(
          `[1:v]format=rgba,fade=t=in:st=0:d=${duration}:alpha=1[txt]`,
        );
        graphs.push("[s0][txt]overlay=0:0:shortest=1,format=yuv420p[out]");
      } else
        graphs.push(
          `[s0][1:v]overlay=x=0:y='H*(1-min(t/${duration},1))':shortest=1,format=yuv420p[out]`,
        );
    } else if (input.effect_id === "key.chroma") {
      const p = input.parameters;
      graphs.push(
        `[s0]format=rgba,colorkey=0x${p.key_color.slice(1)}:${p.similarity}:${p.blend}[keyed]`,
      );
      graphs.push(
        `color=c=0x${p.background.slice(1)}:s=${width}x${height}:r=24:d=${seconds}[bg]`,
      );
      graphs.push(
        "[bg][keyed]overlay=shortest=1:format=auto,format=yuv420p[out]",
      );
    } else if (input.effect_id === "cleanup.denoise") {
      const n = input.parameters.strength;
      graphs.push(`[s0]hqdn3d=${n * 2}:${n * 1.5}:${n * 3}:${n * 2.25}[out]`);
    } else if (input.effect_id === "cleanup.sharpen")
      graphs.push(`[s0]unsharp=5:5:${input.parameters.amount}:5:5:0[out]`);
    else if (input.effect_id === "cleanup.exposure") {
      const p = input.parameters;
      graphs.push(
        `[s0]eq=brightness=${p.brightness}:contrast=${p.contrast}:gamma=${p.gamma}[out]`,
      );
    } else
      throw new Problem(
        422,
        "EFFECT_UNAVAILABLE",
        "Choose an installed effect",
      );
    const file = path.join(dir, "effect.mp4");
    args.push(
      "-filter_complex",
      graphs.join(";"),
      "-map",
      "[out]",
      "-an",
      "-t",
      String(seconds),
      "-r",
      "24",
      "-frames:v",
      String(seconds * 24),
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-flags:v",
      "+bitexact",
      "-movflags",
      "+faststart",
      "-y",
      file,
    );
    await run(encoder(), args, signal, 120000);
    const info = await mediaInfo(file, signal),
      v = info.streams?.[0];
    if (
      info.streams?.length !== 1 ||
      v?.codec_name !== "h264" ||
      v.width !== width ||
      v.height !== height ||
      v.pix_fmt !== "yuv420p" ||
      Number(v.nb_frames) !== seconds * 24 ||
      v.r_frame_rate !== "24/1" ||
      Math.abs(Number(info.format.duration) - seconds) > 1 / 24
    )
      throw new Problem(
        422,
        "EFFECT_OUTPUT_INVALID",
        "The effect output failed its exact media contract",
      );
    await run(
      encoder(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-xerror",
        "-nostdin",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
      ],
      signal,
    );
    const previewFile = path.join(dir, "preview.png");
    await run(
      encoder(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        file,
        "-vf",
        `select=eq(n\\,${Math.floor(seconds * 12)})`,
        "-frames:v",
        "1",
        "-y",
        previewFile,
      ],
      signal,
    );
    const video = await readFile(file),
      preview = await readFile(previewFile);
    if (video.length > 48 * 1024 * 1024)
      throw new Problem(
        413,
        "EFFECT_OUTPUT_LIMIT",
        "The output exceeds its 48 MiB limit",
      );
    const decoded = PNG.sync.read(preview, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height)
      throw new Problem(
        422,
        "EFFECT_PREVIEW_INVALID",
        "Preview dimensions do not match the output",
      );
    checkEffectsCancellation(signal);
    return {
      video,
      preview,
      request_sha256: effectDigest(input),
      catalog_sha256: effectsCatalog().catalog_sha256,
      profile,
      source_info: sourceInfo,
      probe: {
        width,
        height,
        seconds,
        frames: seconds * 24,
        fps: 24,
        video_codec: "h264",
        audio: "omitted",
        full_decode: true,
      },
      output_sha256: hash(video),
      preview_sha256: hash(preview),
    };
  } finally {
    if (path.dirname(dir) !== root)
      throw new Error("Effect cleanup escaped its owned directory");
    await rm(dir, { recursive: true, force: true });
  }
}
