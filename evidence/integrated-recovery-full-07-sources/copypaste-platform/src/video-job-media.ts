import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import type { VideoJobSpecification } from "./video-job-protocol.js";
import { hash, Problem } from "./lib.js";
import { loadImage } from "@napi-rs/canvas";

const exec = promisify(execFile);

/** Do not call a status object a video: validate and decode the actual fixed bytes. */
export async function validateGeneratedVideo(c: Config, bytes: Buffer, spec: Pick<VideoJobSpecification, "size" | "seconds">,
  expected: { sha256: string; bytes: number }, signal?: AbortSignal) {
  if (bytes.length !== expected.bytes || bytes.length > 100_000_000 || bytes.length < 12
    || bytes.toString("ascii", 4, 8) !== "ftyp" || hash(bytes) !== expected.sha256)
    throw new Problem(422, "GENERATED_VIDEO_INTEGRITY_FAILED", "The generated video does not match its immutable content identity");
  const parent = path.resolve(c.DATA_DIR, "generated-video-validation");
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(path.join(parent, "check-"));
  try {
    const file = path.join(work, "result.mp4");
    await writeFile(file, bytes, { flag: "wx" });
    const options = { windowsHide: true, timeout: 120000, maxBuffer: 2_000_000, signal };
    const { stdout } = await exec(process.env.FFPROBE_BIN ?? "ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], options);
    const probe = JSON.parse(stdout);
    const video = probe.streams?.filter((stream: any) => stream.codec_type === "video") ?? [];
    const audio = probe.streams?.filter((stream: any) => stream.codec_type === "audio") ?? [];
    const [width, height] = spec.size.split("x").map(Number);
    const duration = Number(probe.format?.duration);
    if (video.length !== 1 || video[0].codec_name !== "h264" || video[0].width !== width || video[0].height !== height
      || !Number.isFinite(duration) || Math.abs(duration - spec.seconds) > 0.25
      || !Number.isSafeInteger(Number(video[0].nb_read_frames)) || Number(video[0].nb_read_frames) <= 0
      || audio.length > 1 || audio.some((stream: any) => stream.codec_name !== "aac")
      || probe.streams.length !== video.length + audio.length)
      throw new Problem(422, "GENERATED_VIDEO_SPECIFICATION_MISMATCH", "The actual video does not match its frozen delivery specification");
    await exec(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-xerror", "-err_detect", "explode", "-i", file, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"], options);
    return { container: "mp4", video_codec: "h264", width, height, duration_seconds: duration,
      decoded_video_frames: Number(video[0].nb_read_frames), audio_codec: audio.length ? "aac" : null,
      sha256: expected.sha256, bytes: bytes.length, fully_decoded: true };
  } catch (error: any) {
    if (error instanceof Problem) throw error;
    if (signal?.aborted) throw new Problem(409, "GENERATED_VIDEO_VALIDATION_CANCELLED", "Video validation was cancelled");
    throw new Problem(error?.code === "ENOENT" ? 503 : 422, error?.code === "ENOENT" ? "VIDEO_ENCODER_UNAVAILABLE" : "GENERATED_VIDEO_DECODE_FAILED", "The native video verifier could not validate the generated clip");
  } finally {
    // Only the fresh direct child created above is eligible for recursive cleanup.
    if (path.dirname(path.resolve(work)) !== parent || !path.basename(work).startsWith("check-")) throw new Error("Video validation cleanup escaped its owned directory");
    await rm(work, { recursive: true, force: true });
  }
}
/** Establish dimensions before the native image decoder allocates pixels. */
export async function validateVideoReference(bytes: Buffer, mime: string) {
  const invalid = () => new Problem(422, "VIDEO_REFERENCE_INVALID", "Use a bounded, decodable PNG or JPEG reference");
  let width = 0, height = 0;
  if (!bytes.length || bytes.length > 10_000_000) throw invalid();
  if (mime === "image/png") {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw invalid();
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mime === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw invalid();
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || [0, 216, 217, 218].includes(marker)) throw invalid();
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 8 || bytes[offset + 2] !== 8) throw invalid();
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else throw invalid();
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw invalid();
  try {
    const decoded = await loadImage(bytes);
    if (decoded.width !== width || decoded.height !== height) throw invalid();
  } catch { throw invalid(); }
  return { width, height };
}
