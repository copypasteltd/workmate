import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { hash, Problem } from "./lib.js";

const exec = promisify(execFile);
/** Bound container/decoded duration before delivering or pricing actual audio. */
export async function validateProductionAudio(c: Config, bytes: Buffer, mime: string, signal?: AbortSignal) {
  if (!bytes.length || bytes.length > 25_000_000 || !["audio/wav", "audio/mpeg"].includes(mime)
    || mime === "audio/wav" && (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE"))
    throw new Problem(422, "AUDIO_FILE_INVALID", "Use a bounded WAV or MP3 audio file");
  const parent = path.resolve(c.DATA_DIR, "audio-production-validation");
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(path.join(parent, "check-"));
  try {
    const file = path.join(work, mime === "audio/wav" ? "source.wav" : "source.mp3");
    await writeFile(file, bytes, { flag: "wx" });
    const options = { windowsHide: true, timeout: 120000, maxBuffer: 1_000_000, signal };
    const { stdout } = await exec(process.env.FFPROBE_BIN ?? "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], options);
    const probe = JSON.parse(stdout), stream = probe.streams?.[0], seconds = Number(probe.format?.duration);
    if (probe.streams?.length !== 1 || stream.codec_type !== "audio" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600
      || !Number.isSafeInteger(Number(stream.sample_rate)) || Number(stream.sample_rate) < 8000 || Number(stream.sample_rate) > 192000
      || !Number.isInteger(stream.channels) || stream.channels < 1 || stream.channels > 2
      || (mime === "audio/wav" ? !["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"].includes(stream.codec_name) : stream.codec_name !== "mp3"))
      throw new Problem(422, "AUDIO_FILE_INVALID", "Use a supported single audio stream with a duration of at most ten minutes");
    await exec(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-xerror", "-err_detect", "explode", "-i", file,
      "-map", "0:a:0", "-t", "600.1", "-f", "null", "-"], options);
    return { duration_ms: Math.ceil(seconds * 1000), codec: stream.codec_name, sample_rate: Number(stream.sample_rate),
      channels: stream.channels, bytes: bytes.length, sha256: hash(bytes), fully_decoded: true };
  } catch (error: any) {
    if (error instanceof Problem) throw error;
    if (signal?.aborted) throw new Problem(409, "AUDIO_VALIDATION_CANCELLED", "Audio validation was cancelled");
    throw new Problem(error?.code === "ENOENT" ? 503 : 422, error?.code === "ENOENT" ? "AUDIO_VERIFIER_UNAVAILABLE" : "AUDIO_DECODE_FAILED", "The native audio verifier could not decode this file");
  } finally {
    if (path.dirname(path.resolve(work)) !== parent || !path.basename(work).startsWith("check-")) throw new Error("Audio cleanup escaped its owned directory");
    await rm(work, { recursive: true, force: true });
  }
}
