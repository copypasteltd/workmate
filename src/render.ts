import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
export const designFormats = ["svg", "png", "pdf", "mp4"] as const;
export type DesignFormat = (typeof designFormats)[number];
export function designFormatsForTools(
  toolIds: readonly string[],
): DesignFormat[] {
  return designFormats.filter((format) =>
    toolIds.includes(
      format === "pdf"
        ? "document.render"
        : format === "mp4"
          ? "video.render"
          : "layout.render",
    ),
  );
}
export function pngFromSVG(svg: string) {
  return new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Microsoft JhengHei" },
    fitTo: { mode: "original" },
  })
    .render()
    .asPng();
}
/** A raster review copy. Editable text and layers stay in the saved source. */
export async function pdfFromSVG(svg: string, width: number, height: number) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 256 && n <= 4096)
  )
    throw new Error(
      "PDF canvas dimensions must be integers from 256 to 4096 pixels",
    );
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(pngFromSVG(svg));
  if (image.width !== width || image.height !== height)
    throw new Error("PDF image dimensions do not match the saved canvas");
  // CSS pixels use 96 dpi; PDF page dimensions use 72 points per inch.
  const pageWidth = width * 0.75,
    pageHeight = height * 0.75;
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  pdf.setProducer("CopyPaste native design renderer");
  pdf.setSubject(
    "Raster review copy; edit text and layers in the saved source project.",
  );
  return {
    bytes: Buffer.from(await pdf.save()),
    probe: {
      pages: 1,
      page_width_pt: pageWidth,
      page_height_pt: pageHeight,
      raster_width: width,
      raster_height: height,
      purpose: "raster_review",
      editable_text: false,
      print_certified: false,
    },
  };
}
export async function motionFromSVG(
  svg: string,
  width: number,
  height: number,
  options: {
    duration: number;
    effect: "fade" | "zoom" | "still";
    dataDir: string;
  },
) {
  if (width > 1920 || height > 1920 || width % 2 || height % 2)
    throw new Error("Video dimensions must be even and at most 1920 pixels");
  const root = path.resolve(options.dataDir, "render");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "job-"));
  const out = path.join(dir, "creative.mp4");
  try {
    await writeFile(path.join(dir, "frame.png"), pngFromSVG(svg));
    const frames = options.duration * 30;
    const effect =
      options.effect === "zoom"
        ? `zoompan=z='min(zoom+0.0005,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30`
        : options.effect === "fade"
          ? `fade=t=in:st=0:d=0.5,fade=t=out:st=${options.duration - 0.5}:d=0.5`
          : "null";
    await exec(
      process.env.FFMPEG_BIN ?? "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-loop",
        "1",
        "-i",
        path.join(dir, "frame.png"),
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-vf",
        effect,
        "-t",
        String(options.duration),
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-threads",
        "2",
        "-y",
        out,
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 1000000 },
    );
    const p = await exec(
      process.env.FFPROBE_BIN ?? "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", out],
      { windowsHide: true, timeout: 15000, maxBuffer: 1000000 },
    );
    const info = JSON.parse(p.stdout),
      v = info.streams.find((s: any) => s.codec_type === "video"),
      a = info.streams.find((s: any) => s.codec_type === "audio");
    if (
      v?.codec_name !== "h264" ||
      v.width !== width ||
      v.height !== height ||
      v.r_frame_rate !== "30/1" ||
      a?.codec_name !== "aac" ||
      Math.abs(Number(info.format.duration) - options.duration) > 0.15
    )
      throw new Error("Rendered video failed media validation");
    return {
      bytes: await readFile(out),
      probe: {
        width,
        height,
        fps: 30,
        duration: Number(info.format.duration),
        video_codec: v.codec_name,
        audio_codec: a.codec_name,
        audio: "silent_stereo",
      },
    };
  } finally {
    if (path.dirname(dir) !== root)
      throw new Error("Render cleanup escaped its directory");
    await rm(dir, { recursive: true, force: true });
  }
}
