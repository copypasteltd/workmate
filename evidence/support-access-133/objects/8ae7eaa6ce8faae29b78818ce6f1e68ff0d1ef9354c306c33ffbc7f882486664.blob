import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Config } from "./config.js";
import { Storage } from "./storage.js";
import { hash, Problem } from "./lib.js";
import { validateVideoReference } from "./video-job-media.js";
import { publicationMedia, publicationSourceInput, type PublicationFormat } from "./publication-model.js";
import type { z } from "zod";

const exec = promisify(execFile);
export interface PublicationSourceRow {
  id: string; asset_id: string; version: number; name: string; storage_key: string;
  sha256: string; mime_type: string; bytes: string | number;
}
const invalid = (code: string, message: string) => new Problem(422, code, message);

export async function checkPublicationBytes(storage: Storage, key: string, size: number, expected: string, signal?: AbortSignal) {
  const stream = await storage.stream(key), digest = createHash("sha256");
  let bytes = 0;
  try {
    for await (const part of stream) {
      signal?.throwIfAborted(); const chunk = Buffer.from(part); bytes += chunk.length;
      if (bytes > size) throw invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved media bytes changed");
      digest.update(chunk);
    }
    if (bytes !== size || digest.digest("hex") !== expected)
      throw invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved media bytes changed");
  } finally { stream.destroy(); }
}

async function video(c: Config, storage: Storage, row: PublicationSourceRow, format: PublicationFormat, signal?: AbortSignal) {
  const parent = path.resolve(c.DATA_DIR, "publication-validation"), id = randomUUID(), directory = path.join(parent, id);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "approved.mp4"), digest = createHash("sha256");
  let bytes = 0;
  let source: Awaited<ReturnType<Storage["stream"]>> | undefined;
  try {
    source = await storage.stream(row.storage_key);
    await pipeline(source, new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > Number(row.bytes)) { callback(invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved video bytes changed")); return; }
      digest.update(chunk); callback(null, chunk);
    } }), createWriteStream(file, { flags: "wx" }), { signal });
    if (bytes !== Number(row.bytes) || digest.digest("hex") !== row.sha256)
      throw invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved video bytes changed");
    const handle = await open(file, "r");
    try { const header = Buffer.alloc(12); await handle.read(header, 0, 12, 0);
      if (header.toString("ascii", 4, 8) !== "ftyp") throw invalid("PUBLICATION_VIDEO_INVALID", "Choose a decodable MP4 video");
    } finally { await handle.close(); }
    const options = { windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000, signal };
    const { stdout } = await exec(process.env.FFPROBE_BIN ?? "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_streams", "-show_format", "-of", "json", file], options);
    const probe = JSON.parse(stdout), streams = probe.streams ?? [], videos = streams.filter((s: any) => s.codec_type === "video"),
      audio = streams.filter((s: any) => s.codec_type === "audio"), duration = Number(probe.format?.duration);
    const selected = videos[0], width = Number(selected?.width), height = Number(selected?.height);
    const maximum = format === "facebook_video" ? 900 : format === "instagram_reel" ? 180 : 60;
    if (videos.length !== 1 || selected.codec_name !== "h264" || !Number.isFinite(duration) || duration <= 0 || duration > maximum ||
        !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 320 || height < 320 || width > 3840 || height > 3840 || width * height > 8_294_400 ||
        audio.length > 1 || audio.some((s: any) => s.codec_name !== "aac") || streams.length !== videos.length + audio.length ||
        selected.tags?.rotate && Number(selected.tags.rotate) !== 0 || selected.side_data_list?.some((s: any) => s.rotation && Number(s.rotation) !== 0))
      throw invalid("PUBLICATION_VIDEO_SPECIFICATION", "Use H.264/AAC MP4 within the displayed duration and dimensions");
    if (format !== "facebook_video" && (width > 1080 || height > 1920))
      throw invalid("PUBLICATION_VIDEO_DIMENSIONS", "Export the approved Instagram video at up to 1080 by 1920 pixels");
    if (["instagram_reel", "instagram_story"].includes(format) && Math.abs(width / height - 9 / 16) > 0.01)
      throw invalid("PUBLICATION_VIDEO_ASPECT", "Choose a 9:16 video for this publishing preset");
    await exec(process.env.FFMPEG_BIN ?? "ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
      "-protocol_whitelist", "file,pipe", "-i", file, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"], options);
    return { width, height, duration_ms: Math.round(duration * 1000) };
  } catch (error: any) {
    if (error instanceof Problem) throw error;
    if (signal?.aborted) throw new Problem(409, "PUBLICATION_VALIDATION_CANCELLED", "Media validation stopped");
    throw new Problem(error?.code === "ENOENT" ? 503 : 422,
      error?.code === "ENOENT" ? "PUBLICATION_VIDEO_VERIFIER_UNAVAILABLE" : "PUBLICATION_VIDEO_DECODE_FAILED",
      "The native video verifier could not validate this exact file");
  } finally {
    source?.destroy();
    if (path.dirname(path.resolve(directory)) !== parent || path.basename(directory) !== id)
      throw new Error("PUBLICATION_VALIDATION_CLEANUP_DENIED");
    await rm(directory, { recursive: true, force: true });
  }
}

/** Derive actual JPEG bytes before approval; no crop, transcode or hidden post-approval edit. */
export async function preparePublicationMedia(c: Config, storage: Storage, row: PublicationSourceRow,
  input: z.infer<typeof publicationSourceInput>, format: PublicationFormat, signal?: AbortSignal) {
  const selected = publicationSourceInput.parse(input), size = Number(row.bytes), isVideo = row.mime_type === "video/mp4";
  if (selected.asset_id !== row.asset_id || selected.version !== row.version || selected.expected_sha256 !== row.sha256 ||
      !Number.isSafeInteger(size) || size < 1 || size > 1_073_741_824)
    throw invalid("PUBLICATION_SOURCE_INTEGRITY", "Choose the unchanged approved asset version");
  if ((format === "facebook_video" || format === "instagram_reel") && !isVideo ||
      ["facebook_photo", "facebook_gallery", "instagram_photo"].includes(format) && isVideo)
    throw invalid("PUBLICATION_MEDIA_TYPE", "The selected file does not match this publishing format");
  if (isVideo && selected.alt_text)
    throw invalid("PUBLICATION_VIDEO_ALT_TEXT", "Use the video caption; image alternative text applies to images");
  const base = { asset_id: row.asset_id, asset_version_id: row.id, version: row.version, name: row.name,
    source_sha256: row.sha256, source_mime: row.mime_type, source_bytes: size, storage_key: row.storage_key,
    sha256: row.sha256, mime: row.mime_type, bytes: size, alt_text: selected.alt_text, jpeg_background: null,
  };
  if (isVideo) return { media: publicationMedia.parse({ ...base, ...await video(c, storage, row, format, signal) }), pending_bytes: null };
  if (!["image/png", "image/jpeg"].includes(row.mime_type) || size > 10_000_000)
    throw invalid("PUBLICATION_IMAGE_TYPE", "Choose a PNG or JPEG image up to 10 MB");
  const stream = await storage.stream(row.storage_key), chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const part of stream) {
      signal?.throwIfAborted(); const chunk = Buffer.from(part); received += chunk.length;
      if (received > size) throw invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved image bytes changed");
      chunks.push(chunk);
    }
  } finally { stream.destroy(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== size || hash(bytes) !== row.sha256)
    throw invalid("PUBLICATION_SOURCE_INTEGRITY", "The approved image bytes changed");
  const dimensions = await validateVideoReference(bytes, row.mime_type);
  if (format.startsWith("facebook_")) return { media: publicationMedia.parse({ ...base, ...dimensions, duration_ms: null }), pending_bytes: null };
  const ratio = dimensions.width / dimensions.height;
  if (format === "instagram_story" ? Math.abs(ratio - 9 / 16) > 0.01 : ratio < 0.8 || ratio > 1.91)
    throw invalid("PUBLICATION_IMAGE_ASPECT", "Choose a 9:16 Story or a 4:5 to 1.91:1 feed image");
  if (dimensions.width < 320) throw invalid("PUBLICATION_IMAGE_DIMENSIONS", "Choose an image at least 320 pixels wide");
  const scale = Math.min(1, 1080 / dimensions.width), width = Math.round(dimensions.width * scale), height = Math.round(dimensions.height * scale);
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.fillStyle = selected.jpeg_background; context.fillRect(0, 0, width, height);
  context.drawImage(await loadImage(bytes), 0, 0, width, height);
  const jpeg = await canvas.encode("jpeg", 92);
  if (jpeg.length > 8_000_000) throw invalid("PUBLICATION_IMAGE_SIZE", "The approved JPEG rendition must be at most 8 MB");
  // Hold bounded bytes in memory until the service has rechecked current
  // authority and locked tenant capacity. No unreserved durable rendition.
  return { media: publicationMedia.parse({ ...base, sha256: hash(jpeg), mime: "image/jpeg", bytes: jpeg.length,
    width, height, duration_ms: null, jpeg_background: selected.jpeg_background }), pending_bytes: jpeg };
}
