import {
  GlobalFonts,
  convertSVGTextToPath,
  type FontKey,
} from "@napi-rs/canvas";
import { Problem } from "./lib.js";

/** Parse only bounded, standalone SFNT files. No native font parser sees a
 * customer file before the table directory and Unicode cmap are checked. */
export function inspectBrandFont(bytes: Buffer) {
  const invalid = (): never => {
    throw new Problem(
      422,
      "BRAND_FONT_INVALID",
      "Choose a valid standalone Unicode TTF or OTF up to 20 MB",
    );
  };
  const range = (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > bytes.length
    )
      invalid();
  };
  if (
    bytes.length < 12 ||
    bytes.length > 20_000_000 ||
    !["00010000", "4f54544f"].includes(bytes.subarray(0, 4).toString("hex"))
  )
    invalid();
  const count = bytes.readUInt16BE(4);
  if (!count || count > 128) invalid();
  range(12, count * 16);
  const tables = new Map<string, { offset: number; size: number }>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16,
      tag = bytes.toString("ascii", at, at + 4),
      offset = bytes.readUInt32BE(at + 8),
      size = bytes.readUInt32BE(at + 12);
    range(offset, size);
    if (tables.has(tag) || offset < 12 + count * 16) invalid();
    tables.set(tag, { offset, size });
  }
  const cmap = tables.get("cmap"),
    maxp = tables.get("maxp");
  if (!cmap || cmap.size < 4 || !maxp || maxp.size < 6) return invalid();
  const glyphCount = bytes.readUInt16BE(maxp.offset + 4),
    records = bytes.readUInt16BE(cmap.offset + 2);
  if (!glyphCount || !records || records > 128 || 4 + records * 8 > cmap.size)
    invalid();
  const maps4: ((cp: number) => number)[] = [],
    maps12: ((cp: number) => number)[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < records; i++) {
    const at = cmap.offset + 4 + i * 8,
      platform = bytes.readUInt16BE(at),
      encoding = bytes.readUInt16BE(at + 2),
      relative = bytes.readUInt32BE(at + 4);
    if (!(platform === 0 || (platform === 3 && [1, 10].includes(encoding))))
      continue;
    if (relative + 2 > cmap.size) invalid();
    const start = cmap.offset + relative,
      format = bytes.readUInt16BE(start);
    if (seen.has(start)) continue;
    seen.add(start);
    if (format === 12) {
      if (relative + 16 > cmap.size) invalid();
      const size = bytes.readUInt32BE(start + 4),
        groups = bytes.readUInt32BE(start + 12);
      if (
        size < 16 ||
        relative + size > cmap.size ||
        groups > 1_000_000 ||
        16 + groups * 12 > size
      )
        invalid();
      const rows: [number, number, number][] = [];
      let previous = -1;
      for (let j = 0; j < groups; j++) {
        const p = start + 16 + j * 12,
          first = bytes.readUInt32BE(p),
          last = bytes.readUInt32BE(p + 4),
          glyph = bytes.readUInt32BE(p + 8);
        if (
          first > last ||
          first <= previous ||
          last > 0x10ffff ||
          glyph + last - first >= glyphCount
        )
          invalid();
        rows.push([first, last, glyph]);
        previous = last;
      }
      maps12.push((cp) => {
        let lo = 0,
          hi = rows.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1,
            [first, last, glyph] = rows[mid];
          if (cp < first) hi = mid - 1;
          else if (cp > last) lo = mid + 1;
          else return glyph + cp - first;
        }
        return 0;
      });
    } else if (format === 4) {
      if (relative + 16 > cmap.size) invalid();
      const size = bytes.readUInt16BE(start + 2),
        segments = bytes.readUInt16BE(start + 6) / 2;
      if (
        !Number.isInteger(segments) ||
        !segments ||
        size < 16 + segments * 8 ||
        relative + size > cmap.size
      )
        invalid();
      const end = start + 14,
        first = end + segments * 2 + 2,
        delta = first + segments * 2,
        offset = delta + segments * 2;
      let previous = -1;
      for (let j = 0; j < segments; j++) {
        const a = bytes.readUInt16BE(first + j * 2),
          b = bytes.readUInt16BE(end + j * 2),
          distance = bytes.readUInt16BE(offset + j * 2);
        if (
          a > b ||
          b <= previous ||
          (distance &&
            (distance % 2 ||
              offset + j * 2 + distance < offset + segments * 2 ||
              offset + j * 2 + distance + (b - a) * 2 + 2 > start + size))
        )
          invalid();
        previous = b;
      }
      maps4.push((cp) => {
        if (cp > 0xffff) return 0;
        let lo = 0,
          hi = segments - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (bytes.readUInt16BE(end + mid * 2) < cp) lo = mid + 1;
          else hi = mid;
        }
        const a = bytes.readUInt16BE(first + lo * 2),
          b = bytes.readUInt16BE(end + lo * 2);
        if (cp < a || cp > b) return 0;
        const d = bytes.readInt16BE(delta + lo * 2),
          distance = bytes.readUInt16BE(offset + lo * 2);
        const glyph = distance
          ? bytes.readUInt16BE(offset + lo * 2 + distance + (cp - a) * 2)
          : cp;
        return distance && glyph === 0 ? 0 : (glyph + d) & 0xffff;
      });
    }
  }
  const maps = maps12.length ? maps12 : maps4;
  if (!maps.length) invalid();
  return (cp: number) =>
    maps.every((map) => {
      const glyph = map(cp);
      return glyph > 0 && glyph < glyphCount;
    });
}

export function assertBrandGlyphs(bytes: Buffer, text: string, font: string) {
  const has = inspectBrandFont(bytes),
    missing = [
      ...new Set(
        [...text].filter(
          (c) => !/[\r\n\t ]/u.test(c) && !has(c.codePointAt(0)!),
        ),
      ),
    ];
  if (missing.length)
    throw new Problem(
      422,
      "BRAND_GLYPH_MISSING",
      "The selected brand font does not contain all requested characters",
      {
        font_key: font,
        codepoints: missing
          .slice(0, 40)
          .map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()),
      },
    );
}

/** Registration, conversion and removal are synchronous; no await can expose
 * a temporary alias to another render or let one request remove another's font. */
export function outlineBrandSVG(
  svg: string,
  fonts: Map<string, { bytes: Buffer; alias: string }>,
) {
  const keys: FontKey[] = [];
  try {
    for (const { bytes, alias } of fonts.values()) {
      const key = GlobalFonts.register(bytes, alias);
      if (!key)
        throw new Problem(
          422,
          "BRAND_FONT_INVALID",
          "The selected font cannot be rendered",
        );
      keys.push(key);
    }
    return convertSVGTextToPath(svg).toString("utf8");
  } finally {
    GlobalFonts.removeBatch(keys);
  }
}
