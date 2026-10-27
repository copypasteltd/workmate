import {
  GlobalFonts,
  createCanvas,
  convertSVGTextToPath,
  type FontKey,
} from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { zipSync, unzipSync, type Zippable } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { loadVideoFont } from "./video-font.js";
import { canonical, csvCell, hash, Problem } from "./lib.js";
import {
  editableDesignSchema,
  type DesignScene,
  type DesignLayer,
  type SlidesInput,
  type VectorInput,
} from "./editable-design-model.js";

export type DesignEvidence = {
  id: string;
  label: string;
  value: string | null;
  unit: string;
  null_reason: string | null;
  scope: string;
};
export type DesignResources = {
  images: Map<string, Buffer>;
  charts: Map<string, DesignEvidence[]>;
};
export type DesignFile = { name: string; mime: string; bytes: Buffer };
type TextLayer = Extract<DesignLayer, { kind: "text" }>;
type FontFamilies = Record<400 | 700, string>;
const editableFontFamily = "CopyPaste Sans TC";
const staticFontFaces = [
  {
    file: "CopyPasteSansTC-Regular.ttf",
    weight: 400 as const,
    sha256: "f12f41d51287b45b636d9b1232e50c1ee03118c1ab65d713f8fe3468e88bf391",
  },
  {
    file: "CopyPasteSansTC-Bold.ttf",
    weight: 700 as const,
    sha256: "a06b8d91e4211d2a8ed90e70a50425ed3423f154fb691d08451f422b5a80feb1",
  },
];
type PreparedPage = {
  scene: DesignScene;
  lines: Map<string, string[]>;
  svg: string;
  outlined: string;
  png: Buffer;
};
const xml = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const round = (n: number) => Number(n.toFixed(4));
const unavailable = (message: string) =>
  new Problem(422, "DESIGN_LAYOUT_INVALID", message);
// PptxGenJS 4 publishes CommonJS declarations with a default class. Resolve its
// documented CommonJS entry explicitly under NodeNext without weakening types.
const PptxGenJS = createRequire(import.meta.url)(
  "pptxgenjs",
) as typeof import("pptxgenjs").default;
export const designChartKey = (
  layer: Extract<DesignLayer, { kind: "chart" }>,
) => hash(canonical(layer));

function chartLayers(
  layer: Extract<DesignLayer, { kind: "chart" }>,
  resources: DesignResources,
): DesignLayer[] {
  const rows = resources.charts.get(designChartKey(layer));
  if (!rows || rows.length !== layer.evidence_ids.length)
    throw unavailable("Read and select actual chart evidence before rendering");
  const values = rows
    .filter((r) => r.value !== null)
    .map((r) => Number(r.value));
  if (values.some((n) => !Number.isFinite(n) || n < 0 || n > 1e12))
    throw unavailable(
      "This chart requires bounded, nonnegative values; retain the exact CSV for larger values",
    );
  const max = Math.max(1, ...values),
    rowH = (layer.h - 70) / rows.length;
  if (rowH < 30)
    throw unavailable("Enlarge this chart or select fewer evidence rows");
  const text = (
    id: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size = 16,
  ): DesignLayer => ({
    kind: "text",
    id: layer.id + "_" + id,
    text,
    x,
    y,
    w,
    h,
    font_size: size,
    weight: 400,
    color: "#333B48",
    align: "left",
    line_height: 1.35,
  });
  const out: DesignLayer[] = [
    text("title", layer.title, layer.x, layer.y, layer.w, 38, 23),
  ];
  rows.forEach((r, i) => {
    const y = layer.y + 48 + i * rowH;
    out.push(
      text("label" + i, r.label, layer.x, y, layer.w * 0.34, rowH - 3, 14),
    );
    if (r.value !== null && Number(r.value) > 0)
      out.push({
        kind: "rect",
        id: layer.id + "_bar" + i,
        x: layer.x + layer.w * 0.36,
        y: y + 3,
        w: Math.max(0.5, (layer.w * 0.39 * Number(r.value)) / max),
        h: Math.min(22, rowH - 8),
        fill: layer.color,
        stroke: null,
        stroke_width: 0,
        radius: 0,
      });
    out.push(
      text(
        "value" + i,
        r.value === null ? "N/A" : r.value + " " + r.unit,
        layer.x + layer.w * 0.78,
        y,
        layer.w * 0.22,
        rowH - 3,
        14,
      ),
    );
  });
  return out;
}
function wrap(layer: TextLayer, family: string) {
  const context = createCanvas(1, 1).getContext("2d");
  context.font = `${layer.weight} ${layer.font_size}px "${family}"`;
  const lines: string[] = [];
  for (const paragraph of layer.text.replace(/\r\n?/g, "\n").split("\n")) {
    let current = "";
    for (const part of new Intl.Segmenter("zh-HK", {
      granularity: "grapheme",
    }).segment(paragraph)) {
      if (context.measureText(current + part.segment).width > layer.w) {
        if (!current)
          throw unavailable(
            `Text ${layer.id} contains a glyph wider than its box`,
          );
        lines.push(current);
        current = part.segment;
      } else current += part.segment;
    }
    lines.push(current);
  }
  const required =
    layer.font_size * 1.08 +
    (lines.length - 1) * layer.font_size * layer.line_height +
    layer.font_size * 0.26;
  if (required > layer.h)
    throw new Problem(
      422,
      "DESIGN_TEXT_OVERFLOW",
      "Enlarge this text box, reduce copy or split the slide; text is never silently cut off",
      {
        layer_id: layer.id,
        required_height: Math.ceil(required),
        available_height: layer.h,
      },
    );
  return lines;
}
function pathData(l: Extract<DesignLayer, { kind: "path" }>) {
  const x = (n: number) => round(l.x + (l.w * n) / 1000),
    y = (n: number) => round(l.y + (l.h * n) / 1000);
  return l.commands
    .map((p) =>
      p.op === "Z"
        ? "Z"
        : p.op === "M" || p.op === "L"
          ? `${p.op}${x(p.x)} ${y(p.y)}`
          : p.op === "Q"
            ? `Q${x(p.x1)} ${y(p.y1)} ${x(p.x)} ${y(p.y)}`
            : `C${x(p.x1)} ${y(p.y1)} ${x(p.x2)} ${y(p.y2)} ${x(p.x)} ${y(p.y)}`,
    )
    .join(" ");
}
function pageSVG(
  scene: DesignScene,
  lines: Map<string, string[]>,
  families: FontFamilies,
  resources: DesignResources,
) {
  const body = scene.layers
    .map((l) => {
      const identity = `data-layer-id="${xml(l.id)}"`;
      if (l.kind === "text") {
        const x =
          l.align === "center"
            ? l.x + l.w / 2
            : l.align === "right"
              ? l.x + l.w
              : l.x;
        return `<text ${identity} x="${x}" fill="${l.color}" font-family="${families[l.weight]}" font-size="${l.font_size}" font-weight="${l.weight}" text-anchor="${l.align === "left" ? "start" : l.align === "center" ? "middle" : "end"}">${lines
          .get(l.id)!
          .map(
            (line, i) =>
              `<tspan x="${x}" y="${round(l.y + l.font_size * 1.08 + i * l.font_size * l.line_height)}">${xml(line)}</tspan>`,
          )
          .join("")}</text>`;
      }
      if (l.kind === "image")
        return `<image ${identity} x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" href="data:image/png;base64,${resources.images.get(l.asset_version_id)!.toString("base64")}" preserveAspectRatio="xMidYMid ${l.fit === "cover" ? "slice" : "meet"}"/>`;
      if (l.kind === "chart")
        throw new Error("Resolve chart evidence before rendering");
      const paint = `fill="${l.fill ?? "none"}" stroke="${l.stroke ?? "none"}" stroke-width="${l.stroke_width}"`;
      if (l.kind === "rect")
        return `<rect ${identity} x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.radius}" ${paint}/>`;
      if (l.kind === "ellipse")
        return `<ellipse ${identity} cx="${l.x + l.w / 2}" cy="${l.y + l.h / 2}" rx="${l.w / 2}" ry="${l.h / 2}" ${paint}/>`;
      return `<path ${identity} d="${pathData(l)}" ${paint}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><rect width="100%" height="100%" fill="${scene.background}"/>${body}</svg>`;
}
async function fontFiles(texts: string[]) {
  const metadata = await loadVideoFont(texts);
  let dir = path.resolve(import.meta.dirname, "../assets/fonts/noto-sans-tc");
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(dir, "NotoSansTC-VF.ttf"));
  } catch {
    dir = path.resolve(import.meta.dirname, "../../assets/fonts/noto-sans-tc");
    bytes = await readFile(path.join(dir, "NotoSansTC-VF.ttf"));
  }
  if (hash(bytes) !== metadata.sha256) throw new Error("DESIGN_FONT_INTEGRITY");
  const faces = [];
  for (const face of staticFontFaces) {
    const value = await readFile(
      path.resolve(dir, "../copypaste-sans-tc", face.file),
    );
    if (hash(value) !== face.sha256)
      throw new Error("DESIGN_STATIC_FONT_INTEGRITY");
    faces.push({ ...face, bytes: value });
  }
  return {
    metadata,
    bytes,
    license: await readFile(path.join(dir, "OFL.txt")),
    faces,
  };
}
function htmlReview(
  title: string,
  pages: PreparedPage[],
  titles: string[],
  locale: string,
  dataMode: string,
) {
  const css = `:root{font:16px system-ui,sans-serif;color:#15171a;background:#f6f6f4}*{box-sizing:border-box}body{margin:0}header,main,nav{max-width:1200px;margin:auto;padding:24px}header{border-bottom:1px solid #ddd}h1{font-size:clamp(24px,4vw,40px);overflow-wrap:anywhere}.tag{color:#1f5eff;font-size:12px}figure{margin:20px 0;background:white;border:1px solid #e3e4e5;border-radius:12px;overflow:hidden}img{width:100%;display:block}figcaption{padding:16px;font-size:14px}button{background:#1f5eff;color:white;border:0;border-radius:24px;padding:12px 20px;cursor:pointer}nav{display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}.transcript{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;line-height:1.7}details{background:white;border:1px solid #ddd;border-radius:8px;padding:18px}button:focus-visible{outline:3px solid #15171a;outline-offset:4px}button:disabled{opacity:.45;cursor:default}@media(max-width:500px){header,main,nav{padding:16px}}`;
  const script = `(()=>{const p=[...document.querySelectorAll('figure')],s=document.querySelector('[data-position]');let n=0;function show(i){n=Math.max(0,Math.min(p.length-1,i));p.forEach((e,k)=>e.hidden=k!==n);s.textContent=(n+1)+' / '+p.length;document.querySelector('[data-prev]').disabled=n===0;document.querySelector('[data-next]').disabled=n===p.length-1}document.querySelector('[data-prev]').onclick=()=>show(n-1);document.querySelector('[data-next]').onclick=()=>show(n+1);document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){show(n+1);e.preventDefault()}if(e.key==='ArrowLeft'){show(n-1);e.preventDefault()}});show(0)})()`;
  const csp = `default-src 'none'; img-src data:; style-src 'sha256-${hashBase64(css)}'; script-src 'sha256-${hashBase64(script)}'; base-uri 'none'; form-action 'none'`;
  const zh = locale === "zh-HK";
  return `<!doctype html><html lang="${zh ? "zh-Hant-HK" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${xml(csp)}"><title>${xml(title)}</title><style>${css}</style></head><body><header><p class="tag">COPYPASTE / WORKMATE · ${xml(dataMode)}</p><h1>${xml(title)}</h1><p>${zh ? "由固定源稿產生的逐頁核對稿；PowerPoint／其他編輯器的實際字體排版仍需開啟檔案核對。" : "Page review generated from the fixed source; open the editable file to check the actual layout in PowerPoint or your editor."}</p></header><main>${pages.map((p, i) => `<figure ${i ? "hidden" : ""}><img src="data:image/png;base64,${p.png.toString("base64")}" alt="${xml(titles[i])}"><figcaption>${i + 1}. ${xml(titles[i])}</figcaption></figure>`).join("")}<details><summary>${zh ? "閱讀文字內容" : "Read the text transcript"}</summary><div class="transcript">${pages
    .map((p, i) =>
      xml(
        `${i + 1}. ${titles[i]}\n` +
          p.scene.layers
            .filter((l) => l.kind === "text")
            .map((l) => (l as TextLayer).text)
            .join("\n"),
      ),
    )
    .join(
      "\n\n",
    )}</div></details></main><nav aria-label="${zh ? "頁面導覽" : "Page navigation"}"><button type="button" data-prev>${zh ? "上一頁" : "Previous"}</button><output data-position aria-live="polite"></output><button type="button" data-next>${zh ? "下一頁" : "Next"}</button></nav><script>${script}</script></body></html>`;
}
function hashBase64(text: string) {
  return Buffer.from(hash(text), "hex").toString("base64");
}

async function powerpoint(
  input: SlidesInput,
  pages: PreparedPage[],
  resources: DesignResources,
) {
  const pptx = new PptxGenJS();
  const { width, height } = pages[0].scene;
  pptx.defineLayout({
    name: "COPYPASTE",
    width: width / 96,
    height: height / 96,
  });
  pptx.layout = "COPYPASTE";
  pptx.author = "CopyPaste Workmate";
  pptx.subject = input.decision;
  pptx.title = input.title;
  pptx.company = "CopyPaste";
  pptx.theme = {
    headFontFace: editableFontFamily,
    bodyFontFace: editableFontFamily,
  };
  pages.forEach((page, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: page.scene.background.slice(1) };
    slide.addNotes(input.slides[index].notes);
    for (const l of page.scene.layers) {
      const pos = {
        x: l.x / 96,
        y: l.y / 96,
        w: l.w / 96,
        h: l.h / 96,
        objectName: l.id,
      };
      if (l.kind === "text") {
        slide.addText(page.lines.get(l.id)!.join("\n"), {
          ...pos,
          fontFace: editableFontFamily,
          fontSize: l.font_size * 0.75,
          bold: l.weight === 700,
          color: l.color.slice(1),
          margin: 0,
          align: l.align,
          valign: "top",
          fit: "none",
          lineSpacingMultiple: l.line_height,
          breakLine: false,
          lang: input.locale === "zh-HK" ? "zh-TW" : "en-HK",
        });
        continue;
      }
      if (l.kind === "image") {
        const data =
          "image/png;base64," +
          resources.images.get(l.asset_version_id)!.toString("base64");
        slide.addImage({
          ...pos,
          sizing: { type: l.fit, w: pos.w, h: pos.h },
          data,
          altText: l.alt,
        });
        continue;
      }
      if (l.kind === "chart") throw new Error("Unresolved chart");
      const options: NonNullable<Parameters<typeof slide.addShape>[1]> = {
        ...pos,
        fill: l.fill
          ? { color: l.fill.slice(1) }
          : { color: "FFFFFF", transparency: 100 },
        line: l.stroke
          ? { color: l.stroke.slice(1), width: l.stroke_width * 0.75 }
          : { color: "FFFFFF", transparency: 100, width: 0 },
      };
      if (l.kind === "path") {
        options.points = l.commands.map((p) => {
          if (p.op === "Z") return { close: true };
          const v = { x: (l.w * p.x) / 1000 / 96, y: (l.h * p.y) / 1000 / 96 };
          if (p.op === "M") return { ...v, moveTo: true };
          if (p.op === "L") return v;
          if (p.op === "Q")
            return {
              ...v,
              curve: {
                type: "quadratic" as const,
                x1: (l.w * p.x1) / 1000 / 96,
                y1: (l.h * p.y1) / 1000 / 96,
              },
            };
          return {
            ...v,
            curve: {
              type: "cubic" as const,
              x1: (l.w * p.x1) / 1000 / 96,
              y1: (l.h * p.y1) / 1000 / 96,
              x2: (l.w * p.x2) / 1000 / 96,
              y2: (l.h * p.y2) / 1000 / 96,
            },
          };
        });
        slide.addShape(
          "custGeom" as Parameters<typeof slide.addShape>[0],
          options,
        );
      } else
        slide.addShape(
          l.kind === "ellipse"
            ? pptx.ShapeType.ellipse
            : l.radius
              ? pptx.ShapeType.roundRect
              : pptx.ShapeType.rect,
          {
            ...options,
            ...(l.kind === "rect"
              ? { rectRadius: l.radius / Math.min(l.w, l.h) }
              : {}),
          },
        );
    }
  });
  const bytes = Buffer.from(
    (await pptx.write({
      outputType: "nodebuffer",
      compression: true,
    })) as Buffer,
  );
  validateEditablePPTX(bytes, pages.length);
  return bytes;
}
export function validateEditablePPTX(bytes: Buffer, pages: number) {
  if (bytes.length > 32 * 1024 * 1024)
    throw unavailable("Reduce images or split the presentation below 32 MiB");
  const entries = unzipSync(bytes);
  const slides = Object.keys(entries).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n),
  );
  if (
    slides.length !== pages ||
    !entries["[Content_Types].xml"] ||
    !entries["ppt/presentation.xml"]
  )
    throw new Error("PPTX_PARTS_INVALID");
  for (const [name, b] of Object.entries(entries))
    if (/\.(xml|rels)$/.test(name)) {
      const xmlText = Buffer.from(b).toString("utf8");
      if (
        XMLValidator.validate(xmlText) !== true ||
        /<!DOCTYPE|<!ENTITY|TargetMode="External"/i.test(xmlText)
      )
        throw new Error("PPTX_XML_INVALID:" + name);
    }
}

/** Native rendering only. No shell, external URL, model request or Office process. */
export async function renderEditableDesign(
  kind: "vector" | "presentation",
  input: VectorInput | SlidesInput,
  resources: DesignResources,
  dataMode: string,
) {
  const scenes =
    kind === "vector"
      ? [(input as VectorInput).scene]
      : (input as SlidesInput).slides.map((s) => s.scene);
  const titles =
    kind === "vector"
      ? [input.title]
      : (input as SlidesInput).slides.map((s) => s.title);
  const expanded = scenes.map((scene) => ({
    ...scene,
    layers: scene.layers.flatMap((l) =>
      l.kind === "chart" ? chartLayers(l, resources) : [l],
    ),
  }));
  const texts = expanded
    .flatMap((s) => s.layers)
    .filter((l) => l.kind === "text")
    .map((l) => (l as TextLayer).text);
  const font = await fontFiles(texts);
  const alias = "CPEditable_" + randomUUID().replaceAll("-", "");
  const registered: FontKey[] = [];
  const families: FontFamilies = {
    400: alias + "_Regular",
    700: alias + "_Bold",
  };
  const pages: PreparedPage[] = [];
  try {
    // The pinned SVG outliner uses a variable font's default instance for all
    // requested weights. Distinct checked static faces preserve 400/700 in the
    // measured layout, outlines and the editable file's installable family.
    for (const face of font.faces) {
      const key = GlobalFonts.register(face.bytes, families[face.weight]);
      if (!key)
        throw unavailable("The bundled static layout font could not load");
      registered.push(key);
    }
    for (const scene of expanded) {
      if (new Set(scene.layers.map((l) => l.id)).size !== scene.layers.length)
        throw unavailable(
          "A chart-generated layer ID collides with another layer",
        );
      const lines = new Map<string, string[]>();
      for (const l of scene.layers)
        if (l.kind === "text") lines.set(l.id, wrap(l, families[l.weight]));
      const svg = pageSVG(scene, lines, families, resources);
      const outlined = convertSVGTextToPath(svg).toString("utf8");
      const png = Buffer.from(
        new Resvg(outlined, { font: { loadSystemFonts: false } })
          .render()
          .asPng(),
      );
      pages.push({
        scene,
        lines,
        svg: svg
          .replaceAll(families[400], editableFontFamily)
          .replaceAll(families[700], editableFontFamily),
        outlined,
        png,
      });
    }
  } finally {
    GlobalFonts.removeBatch(registered);
  }
  const files: DesignFile[] = [],
    pdf = await PDFDocument.create();
  for (const [i, p] of pages.entries()) {
    const stem =
      kind === "vector"
        ? "brand-vector"
        : "slide-" + String(i + 1).padStart(2, "0");
    files.push(
      { name: stem + ".svg", mime: "image/svg+xml", bytes: Buffer.from(p.svg) },
      { name: stem + ".png", mime: "image/png", bytes: p.png },
    );
    if (kind === "vector")
      files.push({
        name: stem + ".outlined.svg",
        mime: "image/svg+xml",
        bytes: Buffer.from(p.outlined),
      });
    const image = await pdf.embedPng(p.png),
      page = pdf.addPage([p.scene.width * 0.75, p.scene.height * 0.75]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: p.scene.width * 0.75,
      height: p.scene.height * 0.75,
    });
  }
  pdf.setTitle(input.title);
  pdf.setProducer("CopyPaste source-based page review");
  pdf.setSubject(
    "Raster review generated from the fixed source; not a render by Microsoft PowerPoint.",
  );
  if (kind === "presentation")
    files.unshift({
      name: "presentation.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: await powerpoint(input as SlidesInput, pages, resources),
    });
  files.push(
    {
      name: "review.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(await pdf.save()),
    },
    {
      name: "review.html",
      mime: "text/html",
      bytes: Buffer.from(
        htmlReview(input.title, pages, titles, input.locale, dataMode),
      ),
    },
  );
  const evidence = [...resources.charts.values()].flat();
  const csv =
    [
      "evidence_id,label,exact_value,unit,null_reason,scope",
      ...evidence.map((e) =>
        [e.id, e.label, e.value ?? "", e.unit, e.null_reason ?? "", e.scope]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n";
  files.push({
    name: "evidence.csv",
    mime: "text/csv",
    bytes: Buffer.from("\ufeff" + csv),
  });
  const limits = [
    "PDF, PNG and HTML are rendered from the fixed source, not by PowerPoint; verify actual editor typography before final publication.",
    "PPTX text, primitive shapes, custom paths and chart bars/labels are editable native objects. Chart data is retained in exact CSV/source, not an embedded Excel chart.",
    "Install the included CopyPaste Sans TC Regular/Bold static faces, derived from the fixed Noto Sans TC source under OFL; fonts are not embedded in the PPTX.",
    "Raster image inputs remain raster; this tool does not infer ownership or print certification.",
  ];
  const readme = `# ${input.title}\n\n${kind === "presentation" ? "Open presentation.pptx in a compatible editor. Text, shapes, paths and chart bars remain editable." : "Edit brand-vector.svg or the structured source. brand-vector.outlined.svg preserves font-independent vector appearance."}\n\nInstall fonts/CopyPasteSansTC-Regular.ttf and fonts/CopyPasteSansTC-Bold.ttf under the included OFL license. The exact original Noto Sans TC variable font is retained for provenance. Review all pages in review.html or review.pdf; these are source-based reviews.\n\nData mode: ${dataMode}\n\n${limits.map((v) => "- " + v).join("\n")}\n`;
  files.push({
    name: "README.md",
    mime: "text/markdown",
    bytes: Buffer.from(readme),
  });
  const total = files.reduce(
    (n, f) => n + f.bytes.length,
    font.bytes.length + font.faces.reduce((n, f) => n + f.bytes.length, 0),
  );
  if (total > 48 * 1024 * 1024)
    throw unavailable(
      "Reduce page count or image dimensions to keep this delivery below 48 MiB",
    );
  return {
    files,
    pages: pages.map((p, i) => ({
      page: i + 1,
      title: titles[i],
      width: p.scene.width,
      height: p.scene.height,
      layers: p.scene.layers.length,
      text_layers: p.lines.size,
    })),
    font: {
      ...font.metadata,
      family: editableFontFamily,
      source_family: "Noto Sans TC",
      static_faces: font.faces.map((f) => ({
        file: f.file,
        weight: f.weight,
        sha256: f.sha256,
        bytes: f.bytes.length,
      })),
      embedded_in_pptx: false,
    },
    fontBytes: font.bytes,
    fontLicense: font.license,
    staticFontFiles: font.faces.map((f) => ({
      name: "fonts/" + f.file,
      mime: "font/ttf",
      bytes: f.bytes,
    })),
    limitations: limits,
  };
}

export function packageEditableDesign(
  files: DesignFile[],
  fontBytes: Buffer,
  fontLicense: Buffer,
  manifest: unknown,
  staticFonts: DesignFile[] = [],
) {
  const all = [
    ...files,
    {
      name: "manifest.json",
      mime: "application/json",
      bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    },
  ];
  const entries: Zippable = Object.fromEntries(
    all.map((f) => [
      f.name,
      [f.bytes, { mtime: new Date("2000-01-01T00:00:00Z") }],
    ]),
  );
  for (const font of staticFonts)
    entries[font.name] = [
      font.bytes,
      { mtime: new Date("2000-01-01T00:00:00Z") },
    ];
  entries["fonts/NotoSansTC-VF.ttf"] = [
    fontBytes,
    { mtime: new Date("2000-01-01T00:00:00Z") },
  ];
  entries["fonts/OFL.txt"] = [
    fontLicense,
    { mtime: new Date("2000-01-01T00:00:00Z") },
  ];
  all.push({
    name: "editable-design.zip",
    mime: "application/zip",
    bytes: Buffer.from(zipSync(entries, { level: 6 })),
  });
  return all;
}
