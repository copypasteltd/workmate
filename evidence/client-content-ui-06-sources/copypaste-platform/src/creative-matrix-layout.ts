import {
  createCanvas,
  loadImage,
  GlobalFonts,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { matrixInput, type MatrixInput } from "./creative-matrix-model.js";
import { Problem } from "./lib.js";

type Box = { x: number; y: number; width: number; height: number };
type TextNode = {
  type: "text";
  field: string;
  text: string;
  x: number;
  y: number;
  font_size: number;
  font_family: string;
  weight: "normal" | "bold";
  color: string;
};
const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (v) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[v]!,
  );
function fonts() {
  const candidates = [
    "Microsoft JhengHei",
    "Noto Sans CJK TC",
    "Noto Sans TC",
    "Arial",
    "DejaVu Sans",
  ];
  const family = candidates.find((n) => GlobalFonts.has(n));
  if (!family)
    throw new Problem(
      422,
      "FONT_UNAVAILABLE",
      "Install a supported server font before rendering",
    );
  return family;
}
function wrap(ctx: SKRSContext2D, text: string, width: number, locale: string) {
  const lines: string[] = [];
  const fits = (s: string) => {
    const m = ctx.measureText(s);
    return (
      Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight) <=
      width - 2
    );
  };
  for (const paragraph of text.split("\n")) {
    let line = "";
    const pieces = [
      ...new Intl.Segmenter(locale, { granularity: "word" }).segment(paragraph),
    ].map((s) => s.segment);
    for (const word of pieces) {
      if (fits(line + word)) {
        line += word;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (fits(word)) {
        line = word.trimStart();
        continue;
      }
      for (const { segment } of new Intl.Segmenter(locale, {
        granularity: "grapheme",
      }).segment(word)) {
        if (line && !fits(line + segment)) {
          lines.push(line);
          line = "";
        }
        if (!fits(segment)) return null;
        line += segment;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function block(
  ctx: SKRSContext2D,
  input: MatrixInput,
  field: keyof MatrixInput["copy"],
  box: Box,
  preferred: number,
  minimum: number,
  maxLines: number,
  family: string,
): TextNode[] {
  const text = input.copy[field];
  if (!text) return [];
  const weight = field === "headline" || field === "action" ? "bold" : "normal";
  for (let size = Math.floor(preferred); size >= minimum; size--) {
    ctx.font = `${weight} ${size}px "${family}"`;
    const lines = wrap(ctx, text, box.width, input.locale);
    if (
      !lines ||
      lines.length > maxLines ||
      lines.length * size * 1.3 > box.height
    )
      continue;
    const nodes = lines.map(
      (text, i): TextNode => ({
        type: "text",
        field,
        text,
        x: box.x + 1,
        y: box.y + size * 1.06 + i * size * 1.3,
        font_size: size,
        font_family: family,
        weight,
        color: input.theme.ink,
      }),
    );
    if (
      nodes.some((node) => {
        const m = ctx.measureText(node.text);
        return (
          node.x - m.actualBoundingBoxLeft < box.x - 0.5 ||
          node.x + m.actualBoundingBoxRight > box.x + box.width + 0.5 ||
          node.y - m.actualBoundingBoxAscent < box.y - 0.5 ||
          node.y + m.actualBoundingBoxDescent > box.y + box.height + 0.5
        );
      })
    )
      continue;
    return nodes;
  }
  throw new Problem(
    422,
    "TEXT_OVERFLOW",
    `Shorten the ${field} for this size; text cannot fit above the minimum font size`,
    { field },
  );
}
/** Only local, authorized PNG bytes reach this renderer; no URL or arbitrary SVG. */
export async function renderMatrixUnit(raw: MatrixInput, imageBytes?: Buffer) {
  const input = matrixInput.parse(raw),
    { width, height } = input.size;
  const family = fonts(),
    canvas = createCanvas(width, height),
    ctx = canvas.getContext("2d");
  const margin = Math.max(16, Math.round(Math.min(width, height) * 0.065)),
    gap = Math.max(8, Math.round(Math.min(width, height) * 0.024));
  const inside: Box = {
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
  };
  const actionHeight = Math.max(22, Math.round(inside.height * 0.085));
  const actionBox: Box = {
    ...inside,
    y: height - margin - actionHeight,
    height: actionHeight,
  };
  let textBox: Box = {
      ...inside,
      y: margin + gap,
      height: inside.height - actionHeight - gap * 3,
    },
    imageBox: Box | null = null;
  const arrangement =
    width / height >= 1.3
      ? "landscape"
      : height / width >= 1.18
        ? "portrait"
        : "square";
  if (input.image) {
    if (!imageBytes)
      throw new Problem(
        422,
        "IMAGE_SOURCE_UNAVAILABLE",
        "The fixed source image is unavailable",
      );
    if (arrangement === "landscape") {
      textBox.width = Math.floor((inside.width - gap) * 0.43);
      imageBox = {
        x: margin + textBox.width + gap,
        y: margin,
        width: inside.width - textBox.width - gap,
        height: inside.height - actionHeight - gap,
      };
    } else {
      textBox.height = Math.floor(
        textBox.height * (arrangement === "portrait" ? 0.44 : 0.48),
      );
      imageBox = {
        x: margin,
        y: textBox.y + textBox.height + gap,
        width: inside.width,
        height: actionBox.y - textBox.y - textBox.height - gap * 2,
      };
    }
  }
  const brandHeight = Math.max(18, textBox.height * 0.13),
    headlineHeight = textBox.height * 0.48;
  const headlineBox = {
    ...textBox,
    y: textBox.y + brandHeight + gap * 0.5,
    height: headlineHeight,
  };
  const bodyBox = {
    ...textBox,
    y: headlineBox.y + headlineHeight + gap * 0.5,
    height: Math.max(15, textBox.height - brandHeight - headlineHeight - gap),
  };
  const nodes = [
    ...block(
      ctx,
      input,
      "brand_line",
      { ...textBox, height: brandHeight },
      Math.min(28, width * 0.026),
      9,
      2,
      family,
    ),
    ...block(
      ctx,
      input,
      "headline",
      headlineBox,
      Math.min(110, textBox.width * 0.12, headlineHeight * 0.5),
      12,
      6,
      family,
    ),
    ...block(
      ctx,
      input,
      "body",
      bodyBox,
      Math.min(38, textBox.width * 0.049, bodyBox.height * 0.32),
      10,
      12,
      family,
    ),
    ...block(
      ctx,
      input,
      "action",
      actionBox,
      Math.min(30, width * 0.03),
      10,
      2,
      family,
    ),
  ];
  ctx.fillStyle = input.theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = input.theme.accent;
  ctx.fillRect(
    margin,
    margin,
    Math.round(inside.width * 0.12),
    Math.max(2, gap * 0.16),
  );
  let svgImage = "";
  if (imageBox && imageBytes) {
    const image = await loadImage(imageBytes);
    const scale = Math.min(
      imageBox.width / image.width,
      imageBox.height / image.height,
    );
    const draw = {
      x: imageBox.x + (imageBox.width - image.width * scale) / 2,
      y: imageBox.y + (imageBox.height - image.height * scale) / 2,
      width: image.width * scale,
      height: image.height * scale,
    };
    ctx.drawImage(image, draw.x, draw.y, draw.width, draw.height);
    svgImage = `<image x="${draw.x}" y="${draw.y}" width="${draw.width}" height="${draw.height}" href="data:image/png;base64,${imageBytes.toString("base64")}"/>`;
  }
  for (const node of nodes) {
    ctx.font = `${node.weight} ${node.font_size}px "${family}"`;
    ctx.fillStyle = node.color;
    ctx.fillText(node.text, node.x, node.y);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${input.theme.background}"/><rect x="${margin}" y="${margin}" width="${Math.round(inside.width * 0.12)}" height="${Math.max(2, gap * 0.16)}" fill="${input.theme.accent}"/>${svgImage}${nodes.map((n) => `<text xml:space="preserve" x="${n.x}" y="${n.y}" font-family="${esc(n.font_family)}" font-size="${n.font_size}" font-weight="${n.weight}" fill="${n.color}">${esc(n.text)}</text>`).join("")}</svg>`;
  const png = await canvas.encode("png");
  return {
    png,
    svg: Buffer.from(svg),
    layout: {
      schema_version: "1.0",
      renderer: input.renderer,
      arrangement,
      width,
      height,
      safe_margin: margin,
      image_box: imageBox,
      text_boxes: {
        brand_line: { ...textBox, height: brandHeight },
        headline: headlineBox,
        body: bodyBox,
        action: actionBox,
      },
      text_layers: nodes,
      input,
      font_resolution: {
        family,
        embedding: "not_embedded",
        source: "server_system_font",
      },
    },
  };
}
