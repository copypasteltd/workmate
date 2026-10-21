import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { hash, Problem } from "./lib.js";

const expectedFont = "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f";
let registered: string | undefined;
let glyphs: ((codepoint: number) => boolean) | undefined;

// Inspect the actual bundled cmap. Missing glyphs fail instead of using an
// unrecorded system fallback or silently changing Traditional Chinese copy.
function characterMap(bytes: Buffer) {
  const tables = bytes.readUInt16BE(4);
  let offset = 0;
  for (let i = 0; i < tables; i++) {
    const p = 12 + i * 16;
    if (bytes.toString("ascii", p, p + 4) === "cmap") offset = bytes.readUInt32BE(p + 8);
  }
  if (!offset) throw new Error("Bundled font has no character map");
  const maps: ((n: number) => boolean)[] = [];
  for (let i = 0; i < bytes.readUInt16BE(offset + 2); i++) {
    const record = offset + 4 + i * 8, platform = bytes.readUInt16BE(record), encoding = bytes.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const p = offset + bytes.readUInt32BE(record + 4), format = bytes.readUInt16BE(p);
    if (format === 12) {
      const count = bytes.readUInt32BE(p + 12);
      const groups = Array.from({ length: count }, (_, k) => [bytes.readUInt32BE(p + 16 + k * 12), bytes.readUInt32BE(p + 20 + k * 12), bytes.readUInt32BE(p + 24 + k * 12)]);
      maps.push((n) => {
        let lo = 0, hi = groups.length - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1, [start, end, glyph] = groups[m]; if (n < start) hi = m - 1; else if (n > end) lo = m + 1; else return glyph + n - start !== 0; }
        return false;
      });
    } else if (format === 4) {
      const count = bytes.readUInt16BE(p + 6) / 2, ends = p + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
      maps.push((n) => {
        if (n > 0xffff) return false;
        for (let j = 0; j < count; j++) {
          const end = bytes.readUInt16BE(ends + j * 2), start = bytes.readUInt16BE(starts + j * 2);
          if (n < start || n > end) continue;
          const delta = bytes.readInt16BE(deltas + j * 2), range = bytes.readUInt16BE(ranges + j * 2);
          const value = range ? bytes.readUInt16BE(ranges + j * 2 + range + (n - start) * 2) : n;
          return value !== 0 && ((value + delta) & 0xffff) !== 0;
        }
        return false;
      });
    }
  }
  if (!maps.length) throw new Error("Bundled font has no Unicode character map");
  return (n: number) => maps.some((f) => f(n));
}

export async function loadVideoFont(texts: string[] = []) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  let directory = path.resolve(moduleDirectory, "../assets/fonts/noto-sans-tc");
  let manifest: any;
  try { manifest = JSON.parse(await readFile(path.join(directory, "source.json"), "utf8")); }
  catch { directory = path.resolve(moduleDirectory, "../../assets/fonts/noto-sans-tc"); manifest = JSON.parse(await readFile(path.join(directory, "source.json"), "utf8")); }
  const bytes = await readFile(path.join(directory, "NotoSansTC-VF.ttf")), digest = hash(bytes), entry = manifest.files.find((f: any) => f.file === "NotoSansTC-VF.ttf");
  if (digest !== expectedFont || digest !== entry?.sha256) throw new Problem(503, "VIDEO_FONT_INTEGRITY", "The fixed video font is unavailable or changed");
  const license = await readFile(path.join(directory, "OFL.txt"));
  if (hash(license) !== manifest.files.find((f: any) => f.file === "OFL.txt")?.sha256) throw new Problem(503, "VIDEO_FONT_INTEGRITY", "The bundled font license changed");
  if (!registered) {
    registered = "CopyPasteVideo_" + digest.slice(0, 16);
    if (!GlobalFonts.registerFromPath(path.join(directory, "NotoSansTC-VF.ttf"), registered)) throw new Problem(503, "VIDEO_FONT_UNAVAILABLE", "Unable to load the fixed video font");
    glyphs = characterMap(bytes);
  }
  const missing = [...new Set(texts.flatMap((s) => [...s]).filter((s) => !/\s/u.test(s) && !glyphs!(s.codePointAt(0)!)))];
  if (missing.length) throw new Problem(422, "VIDEO_GLYPH_MISSING", "Some characters are not present in the fixed video font", { codepoints: missing.slice(0, 20).map((s) => "U+" + s.codePointAt(0)!.toString(16).toUpperCase()) });
  return { family: registered, font_id: manifest.font_id as string, sha256: digest, license: manifest.license as string, source_commit: manifest.source_commit as string };
}
