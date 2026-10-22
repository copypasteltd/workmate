import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const exec = promisify(execFile);
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export type Capture = () => Promise<Buffer>;
export class WorkmateRecording {
  private running = false;
  private loop: Promise<void> = Promise.resolve();
  private frames: { file: string; at: number; sha256: string }[] = [];
  private errors: string[] = [];
  private raw = "";
  private started = 0;
  private finished = 0;
  constructor(
    public readonly repository: string,
    public readonly name: string,
    public readonly attempt: string,
    private capture: Capture,
    private source: string,
    private root?: string,
  ) {}
  private resolve(...parts: string[]) { return path.resolve(this.root ?? process.cwd(), ...parts); }
  async start() {
    this.raw = this.resolve(".data/workmate-media", randomUUID());
    await mkdir(this.raw, { recursive: true });
    this.started = Date.now();
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const before = Date.now();
        try {
          const bytes = await this.capture();
          const file = "frame-" + String(this.frames.length).padStart(6, "0") + ".jpg";
          await writeFile(path.join(this.raw, file), bytes, { flag: "wx" });
          this.frames.push({ file, at: Date.now(), sha256: hash(bytes) });
        } catch (e) {
          this.errors.push(String(e));
        }
        const delay = Math.max(0, 170 - (Date.now() - before));
        if (delay && this.running) await new Promise(r => setTimeout(r, delay));
      }
    })();
    await new Promise(r => setTimeout(r, 800));
  }
  async stop() {
    if (!this.running) return null;
    await new Promise(r => setTimeout(r, 900));
    this.running = false;
    await this.loop;
    this.finished = Date.now();
    assert.ok(this.frames.length >= 5, "Actual recording must contain at least five observed frames");
    assert.ok(new Set(this.frames.map(f => f.sha256)).size >= 2, "An interaction recording must change");
    const folder = this.resolve("../copypaste-" + this.repository, "assets/screenshots");
    await mkdir(folder, { recursive: true });
    const stem = "workmate-" + this.attempt + "-" + this.name;
    const video = path.join(folder, stem + ".mp4"), gif = path.join(folder, stem + ".gif");
    for (const f of [video, gif]) await assert.rejects(access(f), (e: any) => e.code === "ENOENT");
    const lines = ["ffconcat version 1.0"];
    for (let i = 0; i < this.frames.length; i++) {
      lines.push("file '" + this.frames[i].file + "'");
      const next = this.frames[i + 1]?.at ?? this.finished;
      lines.push("duration " + Math.max(0.02, (next - this.frames[i].at) / 1000).toFixed(4));
    }
    lines.push("file '" + this.frames.at(-1)!.file + "'");
    await writeFile(path.join(this.raw, "capture.ffconcat"), lines.join("\n") + "\n", { flag: "wx" });
    const encode = await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-n", "-f", "concat", "-safe", "0",
      "-i", "capture.ffconcat", "-an", "-vf",
      "scale=w='trunc(min(1280,iw)/2)*2':h=-2:flags=lanczos,fps=10",
      "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", video,
    ], { cwd: this.raw, windowsHide: true, maxBuffer: 2_000_000 });
    assert.equal(encode.stderr, "");
    await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-n", "-i", video, "-an", "-vf",
      "fps=6,scale=w='trunc(min(1000,iw)/2)*2':h=-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop", "0", gif,
    ], { windowsHide: true, maxBuffer: 2_000_000 });
    const probe = JSON.parse((await exec("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", video,
    ], { windowsHide: true })).stdout);
    assert.ok(Number(probe.format.duration) > 0.5);
    const stream = probe.streams.find((s: any) => s.codec_type === "video");
    assert.equal(stream.codec_name, "h264");
    assert.ok(stream.width > 250 && stream.height > 250);
    const files = [];
    for (const file of [video, gif]) {
      const bytes = await readFile(file);
      files.push({ path: path.relative(this.resolve(".."), file).replaceAll("\\", "/"), bytes: bytes.length, sha256: hash(bytes) });
    }
    return {
      component: this.repository, name: this.name, source: this.source,
      started_at: new Date(this.started).toISOString(), finished_at: new Date(this.finished).toISOString(),
      capture_timing: "Actual wall-clock capture intervals; no accelerated or invented response frames",
      observed_frames: this.frames.length, distinct_frames: new Set(this.frames.map(f => f.sha256)).size,
      skipped_capture_errors: this.errors.length, seconds: Number(probe.format.duration),
      width: stream.width, height: stream.height, files,
      frame_manifest_sha256: hash(Buffer.from(JSON.stringify(this.frames))),
      raw_capture_directory: path.relative(this.resolve(".."), this.raw).replaceAll("\\", "/"),
    };
  }
}

export async function saveWorkmateScreenshot(repository: string, attempt: string, name: string, bytes: Buffer, source: string, root = process.cwd()) {
  const file = path.resolve(root, "../copypaste-" + repository, "assets/screenshots/workmate-" + attempt + "-" + name + ".png");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: "wx" });
  return { path: path.relative(path.resolve(root, ".."), file).replaceAll("\\", "/"), sha256: hash(bytes), source, edited: false };
}
