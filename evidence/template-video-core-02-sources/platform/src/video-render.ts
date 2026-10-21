import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile, link, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { PNG } from "pngjs";
import { canonical, hash, Problem } from "./lib.js";
import { loadVideoFont } from "./video-font.js";
import { videoDefinition, videoReferences, videoSeconds, videoSubtitlesVtt, type VideoDefinition, type VideoAssetRef } from "./video-project-model.js";

const exec = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_BIN ?? "ffmpeg";
const ffprobe = () => process.env.FFPROBE_BIN ?? "ffprobe";
const maxOutputBytes = 100_000_000;
export type VideoSource = VideoAssetRef & { sha256: string; mime_type: string; bytes: Buffer };
const identity = (ref: VideoAssetRef) => `${ref.asset_id}:${ref.version}`;
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Problem(409, "VIDEO_CANCELLED", "Video rendering was cancelled");
}
async function processFile(binary: string, args: string[], signal?: AbortSignal, timeout = 120000) {
  aborted(signal);
  try {
    return await exec(binary, args, { windowsHide: true, timeout, maxBuffer: 2_000_000, signal });
  } catch (e: any) {
    aborted(signal);
    if (e.code === "ENOENT") throw new Problem(503, "VIDEO_ENCODER_UNAVAILABLE", "The native video encoder is unavailable");
    throw new Problem(422, "VIDEO_MEDIA_INVALID", "The native media operation failed", { reason: e.killed ? "timeout" : "media_or_encoder_error" });
  }
}
export async function videoRendererProfile(signal?: AbortSignal) {
  const font = await loadVideoFont();
  const encoder = await processFile(ffmpeg(), ["-version"], signal, 10000);
  const probe = await processFile(ffprobe(), ["-version"], signal, 10000);
  return { renderer: "copypaste-campaign-cuts-1", font_id: font.font_id, font_sha256: font.sha256,
    ffmpeg_sha256: hash(encoder.stdout), ffprobe_sha256: hash(probe.stdout),
    video_codec: "h264", pixel_format: "yuv420p", audio_codec: "aac", audio_sample_rate: 48000 };
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function checkedImage(source: VideoSource) {
  const bytes = source.bytes;
  if (source.mime_type !== "image/png" || bytes.length < 57 || bytes.length > 8_000_000 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) > 2048)
    throw new Problem(422, "VIDEO_IMAGE_INVALID", "Use a project PNG up to 8 MB and 2048 pixels per side");
  try { PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new Problem(422, "VIDEO_IMAGE_INVALID", "The fixed PNG cannot be decoded"); }
}
function textLines(ctx: SKRSContext2D, text: string, width: number) {
  const lines: string[] = [];
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const { segment } of segments.segment(paragraph)) {
      if (ctx.measureText(line + segment).width > width && line) { lines.push(line); line = segment; }
      else line += segment;
      if (ctx.measureText(line).width > width) throw new Problem(422, "VIDEO_TEXT_OVERFLOW", "A text grapheme cannot fit inside its safe area");
    }
    lines.push(line);
  }
  return lines;
}
function drawText(ctx: SKRSContext2D, value: string, box: { x: number; y: number; width: number; height: number }, family: string, size: number, minimum: number, color: string, weight = 400) {
  if (!value) return;
  let lines: string[] = [], selected = Math.max(size, minimum);
  for (; selected >= minimum; selected--) {
    ctx.font = `${weight} ${selected}px "${family}"`;
    lines = textLines(ctx, value, box.width);
    if (lines.length * selected * 1.45 <= box.height) break;
  }
  if (selected < minimum) throw new Problem(422, "VIDEO_TEXT_OVERFLOW", "Shorten the copy to fit the template safe area");
  ctx.fillStyle = color; ctx.textBaseline = "top";
  for (const [index, line] of lines.entries()) ctx.fillText(line, box.x, box.y + index * selected * 1.45);
}
function contained(ctx: SKRSContext2D, image: Image, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale);
}
function drawFrame(definition: VideoDefinition, frame: number, family: string, images: Map<string, Image>) {
  const { width: w, height: h, brand } = definition, canvas = createCanvas(w, h), ctx = canvas.getContext("2d");
  const scene = definition.storyboard.find((s) => frame >= s.start_frame && frame < s.end_frame)!;
  const cue = definition.subtitles.find((s) => frame >= s.start_frame && frame < s.end_frame);
  const pad = w * .08, unit = Math.min(w, h), min = Math.max(10, Math.floor(unit * .024));
  ctx.fillStyle = brand.background; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = brand.accent; ctx.fillRect(pad, h * .08, unit * .045, unit * .045);
  drawText(ctx, brand.label, { x: pad + unit * .065, y: h * .08, width: w * .61, height: h * .07 }, family, Math.floor(unit * .031), min, brand.ink, 600);
  if (brand.logo) contained(ctx, images.get(identity(brand.logo))!, w * .77, h * .07, w * .15, h * .08);
  drawText(ctx, scene.headline, { x: pad, y: h * .21, width: w - 2 * pad, height: h * .19 }, family, Math.floor(unit * .073), min + 2, brand.ink, 700);
  drawText(ctx, scene.body, { x: pad, y: h * .43, width: w - 2 * pad, height: h * (scene.image ? .11 : .23) }, family, Math.floor(unit * .036), min, brand.ink);
  if (scene.image) contained(ctx, images.get(identity(scene.image))!, pad, h * .56, w - 2 * pad, h * .16);
  if (scene.end_frame === definition.duration_frames) drawText(ctx, definition.script.call_to_action, { x: pad, y: h * .72, width: w - 2 * pad, height: h * .05 }, family, Math.floor(unit * .031), min, brand.ink, 600);
  if (cue) {
    ctx.fillStyle = "#101622"; ctx.fillRect(w * .06, h * .8, w * .88, h * .12);
    drawText(ctx, cue.text, { x: pad, y: h * .814, width: w - 2 * pad, height: h * .095 }, family, Math.floor(unit * .04), min, "#ffffff", 500);
  }
  return canvas.toBuffer("image/png");
}
export async function renderVideoProject(input: VideoDefinition, sources: VideoSource[], options: { dataDir: string; signal?: AbortSignal; expectedProfile?: unknown }) {
  const definition = videoDefinition.parse(input), signal = options.signal;
  const font = await loadVideoFont([definition.brand.label, definition.script.call_to_action,
    ...definition.storyboard.flatMap((s) => [s.headline, s.body]), ...definition.subtitles.map((s) => s.text)]);
  const profile = await videoRendererProfile(signal);
  if (options.expectedProfile && canonical(options.expectedProfile) !== canonical(profile)) throw new Problem(409, "VIDEO_RENDERER_CHANGED", "The saved renderer profile changed; create a new project revision");
  const light = [luminance(definition.brand.background), luminance(definition.brand.ink)].sort((a, b) => b - a);
  if ((light[0] + .05) / (light[1] + .05) < 4.5) throw new Problem(422, "VIDEO_TEXT_CONTRAST", "Brand text needs at least 4.5:1 contrast against its background");
  const refs = videoReferences(definition), sourceMap = new Map(sources.map((s) => [identity(s), s]));
  for (const ref of refs) {
    const source = sourceMap.get(identity(ref));
    if (!source) throw new Problem(422, "VIDEO_SOURCE_UNAVAILABLE", "A fixed source version is unavailable");
    if (hash(source.bytes) !== source.sha256) throw new Problem(422, "VIDEO_SOURCE_INTEGRITY", "A fixed source failed its byte check");
  }
  const images = new Map<string, Image>();
  for (const ref of [definition.brand.logo, ...definition.storyboard.map((s) => s.image)]) {
    if (!ref || images.has(identity(ref))) continue;
    const source = sourceMap.get(identity(ref))!; checkedImage(source); images.set(identity(ref), await loadImage(source.bytes));
  }
  const root = path.resolve(options.dataDir, "video-render"); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "job-")), actualRoot = await realpath(root);
  const out = path.join(directory, "creative.mp4");
  try {
    const bounds = [...new Set([0, definition.duration_frames, ...definition.storyboard.flatMap((s) => [s.start_frame, s.end_frame]), ...definition.subtitles.flatMap((s) => [s.start_frame, s.end_frame])])].sort((a, b) => a - b);
    let intermediateBytes = 0, firstFrame: Buffer | undefined, lastFrame: Buffer | undefined;
    for (let index = 0; index < bounds.length - 1; index++) {
      aborted(signal);
      const image = drawFrame(definition, bounds[index], font.family, images);
      intermediateBytes += image.length;
      if (intermediateBytes > 256_000_000) throw new Problem(422, "VIDEO_RENDER_BUDGET", "Intermediate frames exceed the render budget");
      firstFrame ??= image; lastFrame = image;
      const source = path.join(directory, `interval-${index}.png`); await writeFile(source, image);
      // Owned same-volume hard links keep a long still interval from duplicating pixels on disk.
      for (let frame = bounds[index]; frame < bounds[index + 1]; frame++) { aborted(signal); await link(source, path.join(directory, `frame-${String(frame).padStart(6, "0")}.png`)); }
    }
    const duration = videoSeconds(definition), fps = `${definition.frame_rate.numerator}/${definition.frame_rate.denominator}`;
    let audioProbe: any = null;
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-max_alloc", "67108864", "-threads", "2", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-framerate", fps, "-i", path.join(directory, "frame-%06d.png")];
    if (definition.audio) {
      const source = sourceMap.get(identity(definition.audio.source))!, bytes = source.bytes;
      const wave = source.mime_type === "audio/wav" && bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
      const mpeg = source.mime_type === "audio/mpeg" && bytes.length > 10 && (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224));
      if ((!wave && !mpeg) || bytes.length > 30_000_000) throw new Problem(422, "VIDEO_AUDIO_INVALID", "Use a fixed WAV or MP3 source up to 30 MB");
      const audioFile = path.join(directory, wave ? "audio.wav" : "audio.mp3"), demuxer = wave ? "wav" : "mp3";
      await writeFile(audioFile, bytes);
      const p = await processFile(ffprobe(), ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", demuxer, "-show_streams", "-show_format", "-of", "json", audioFile], signal, 15000);
      const info = JSON.parse(p.stdout), stream = info.streams?.find((s: any) => s.codec_type === "audio");
      const offset = videoSeconds(definition, definition.audio.source_in_frame);
      if (!stream || info.streams.length !== 1 || !Number.isFinite(Number(info.format?.duration)) || Number(info.format.duration) + .001 < offset + duration || Number(stream.channels) > 2)
        throw new Problem(422, "VIDEO_AUDIO_TOO_SHORT", "The audio must have one mono or stereo stream covering the complete selected range");
      args.push("-protocol_whitelist", "file,pipe", "-f", demuxer, "-ss", String(offset), "-i", audioFile);
      args.push("-map", "0:v:0", "-map", "1:a:0", "-af", `volume=${definition.audio.gain_db}dB`, "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k");
      audioProbe = { role: definition.audio.role, generated: false, source_sha256: source.sha256, source_in_frame: definition.audio.source_in_frame, gain_db: definition.audio.gain_db, rights_basis: definition.audio.rights_basis, rights_reference: definition.audio.rights_reference };
    } else args.push("-map", "0:v:0", "-an");
    args.push("-frames:v", String(definition.duration_frames), "-t", String(duration), "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-threads", "2", "-map_metadata", "-1", "-movflags", "+faststart", "-fs", String(maxOutputBytes), "-y", out);
    await processFile(ffmpeg(), args, signal);
    const p = await processFile(ffprobe(), ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", out], signal, 30000);
    const info = JSON.parse(p.stdout), v = info.streams?.find((s: any) => s.codec_type === "video"), a = info.streams?.find((s: any) => s.codec_type === "audio");
    if (v?.codec_name !== "h264" || v.pix_fmt !== "yuv420p" || v.width !== definition.width || v.height !== definition.height || v.r_frame_rate !== fps || Number(v.nb_read_frames) !== definition.duration_frames || Math.abs(Number(v.duration) - duration) > 1 / Number(definition.frame_rate.numerator) || Math.abs(Number(info.format?.duration) - duration) > .1 || (!!a !== !!definition.audio) || (a && (a.codec_name !== "aac" || a.sample_rate !== "48000")))
      throw new Problem(422, "VIDEO_PROBE_MISMATCH", "The encoded file does not match the frozen timeline");
    // Probe metadata alone is insufficient: decode every frame and audio packet.
    await processFile(ffmpeg(), ["-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-threads", "2", "-i", out, "-f", "null", "-"], signal, 60000);
    if (audioProbe) {
      const measured = await processFile(ffmpeg(), ["-hide_banner", "-loglevel", "info", "-nostdin", "-threads", "2", "-i", out, "-vn", "-af", "volumedetect", "-f", "null", "-"], signal, 30000);
      const mean = measured.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?|-inf) dB/);
      if (!mean) throw new Problem(422, "VIDEO_AUDIO_PROBE", "The encoded audio could not be measured");
      audioProbe.mean_volume_db = mean[1] === "-inf" ? null : Number(mean[1]);
      audioProbe.silent = mean[1] === "-inf" || Number(mean[1]) <= -90;
      audioProbe.measured_after_encode = true;
    }
    const bytes = await readFile(out); aborted(signal);
    if (bytes.length >= maxOutputBytes) throw new Problem(422, "VIDEO_RENDER_BUDGET", "The output exceeds the bounded video budget");
    const probe = { width: v.width, height: v.height, frame_rate: fps, duration_frames: Number(v.nb_read_frames), duration_seconds: Number(v.duration), video_codec: v.codec_name, pixel_format: v.pix_fmt, audio_codec: a?.codec_name ?? null, audio_sample_rate: a?.sample_rate ?? null, audio: audioProbe, subtitles: { burned_in: definition.subtitles.length > 0, cues: definition.subtitles.length, source: "provided_text", safe_area: { left: .08, right: .08, top: .8, bottom: .08 } }, fully_decoded: true, sha256: hash(bytes), bytes: bytes.length, renderer_profile: profile };
    const manifest = { schema_version: "copypaste-video-export-1", definition, renderer_profile: profile, sources: refs.map((ref) => { const source = sourceMap.get(identity(ref))!; return { ...ref, sha256: source.sha256, mime_type: source.mime_type, bytes: source.bytes.length }; }), reproduction: "Fixed project asset versions and the recorded native renderer are required. Source media is not embedded.", ai_cost_micros: "0", cost_source: "local_composition_no_ai" };
    const script = `# ${definition.script.title}\n\n## Brief\n${definition.script.brief}\n\n## Provided narration text\n${definition.script.narration}\n\n## Call to action\n${definition.script.call_to_action}\n\nNarration text is not synthesized audio.\n`;
    return { bytes, probe, manifest, script, storyboard: definition.storyboard, subtitles: videoSubtitlesVtt(definition), firstFrame: firstFrame!, lastFrame: lastFrame! };
  } finally {
    const actualDirectory = await realpath(directory);
    if (path.dirname(actualDirectory) !== actualRoot || !path.basename(actualDirectory).startsWith("job-")) throw new Error("Video cleanup escaped its owned job directory");
    await rm(actualDirectory, { recursive: true, force: true });
  }
}
