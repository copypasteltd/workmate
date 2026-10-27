import { z } from "zod";
import { uuid } from "./lib.js";
import { brandBinding } from "./brand-production.js";

export const editableDesignSchema = "copypaste-editable-design-1";
export const designDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const designText = z
  .string()
  .max(6000)
  .refine(
    (v) =>
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff\p{Surrogate}]/u.test(
        v,
      ),
    "Use printable, well-formed Unicode text",
  );
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const coordinate = z.number().finite().min(0).max(4096);
const size = z.number().finite().min(1).max(4096);
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const box = { id, x: coordinate, y: coordinate, w: size, h: size };
const paint = {
  fill: color.nullable(),
  stroke: color.nullable().default(null),
  stroke_width: z.number().min(0).max(24).default(0),
};
const point = z.number().finite().min(0).max(1000);
const command = z.discriminatedUnion("op", [
  z.object({ op: z.literal("M"), x: point, y: point }).strict(),
  z.object({ op: z.literal("L"), x: point, y: point }).strict(),
  z
    .object({ op: z.literal("Q"), x1: point, y1: point, x: point, y: point })
    .strict(),
  z
    .object({
      op: z.literal("C"),
      x1: point,
      y1: point,
      x2: point,
      y2: point,
      x: point,
      y: point,
    })
    .strict(),
  z.object({ op: z.literal("Z") }).strict(),
]);
export const designLayer = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      ...box,
      text: designText.min(1),
      font_size: z.number().min(12).max(180),
      weight: z.union([z.literal(400), z.literal(700)]).default(400),
      color,
      align: z.enum(["left", "center", "right"]).default("left"),
      line_height: z.number().min(1.1).max(2).default(1.4),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rect"),
      ...box,
      ...paint,
      radius: z.number().min(0).max(200).default(0),
    })
    .strict(),
  z.object({ kind: z.literal("ellipse"), ...box, ...paint }).strict(),
  z
    .object({
      kind: z.literal("path"),
      ...box,
      ...paint,
      commands: z.array(command).min(2).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal("image"),
      ...box,
      asset_version_id: uuid,
      sha256: designDigest,
      alt: designText.min(1).max(500),
      fit: z.enum(["contain", "cover"]).default("contain"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chart"),
      ...box,
      source_version_id: uuid,
      sha256: designDigest,
      title: designText.min(1).max(120),
      evidence_ids: z.array(uuid).min(1).max(8),
      color,
    })
    .strict(),
]);
export const designScene = z
  .object({
    width: z.number().int().min(256).max(1920),
    height: z.number().int().min(256).max(1920),
    background: color,
    layers: z.array(designLayer).min(1).max(80),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const ids = new Set<string>();
    scene.layers.forEach((layer, index) => {
      if (ids.has(layer.id))
        ctx.addIssue({
          code: "custom",
          path: ["layers", index, "id"],
          message: "Layer IDs must be unique on a page",
        });
      ids.add(layer.id);
      const stroke =
        "stroke_width" in layer && layer.stroke ? layer.stroke_width / 2 : 0;
      if (
        layer.x < stroke ||
        layer.y < stroke ||
        layer.x + layer.w + stroke > scene.width ||
        layer.y + layer.h + stroke > scene.height
      )
        ctx.addIssue({
          code: "custom",
          path: ["layers", index],
          message: "Keep the complete layer and stroke inside the page",
        });
      if (layer.kind === "path" && layer.commands[0].op !== "M")
        ctx.addIssue({
          code: "custom",
          path: ["layers", index, "commands"],
          message: "A path must start with an explicit move",
        });
      if (
        layer.kind === "rect" &&
        layer.radius > Math.min(layer.w, layer.h) / 2
      )
        ctx.addIssue({
          code: "custom",
          path: ["layers", index, "radius"],
          message: "Corner radius exceeds the shape",
        });
      if (
        layer.kind === "chart" &&
        (new Set(layer.evidence_ids).size !== layer.evidence_ids.length ||
          layer.w < 360 ||
          layer.h < 230)
      )
        ctx.addIssue({
          code: "custom",
          path: ["layers", index],
          message:
            "Charts require distinct evidence and a readable area of at least 360 by 230 pixels",
        });
    });
  });
const base = {
  title: designText.min(1).max(150),
  locale: z.enum(["zh-HK", "en-HK"]),
  brand: brandBinding.optional(),
};
export const revisionRef = z
  .object({ source_version_id: uuid, sha256: designDigest })
  .strict();
export const vectorInput = z
  .object({
    ...base,
    purpose: designText.min(1).max(2000),
    scene: designScene,
    revision_of: revisionRef.optional(),
  })
  .strict();
export const slidesInput = z
  .object({
    ...base,
    audience: designText.min(1).max(1000),
    decision: designText.min(1).max(2000),
    slides: z
      .array(
        z
          .object({
            id,
            title: designText.min(1).max(150),
            notes: designText.max(6000).default(""),
            scene: designScene,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    revision_of: revisionRef.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (new Set(input.slides.map((s) => s.id)).size !== input.slides.length)
      ctx.addIssue({
        code: "custom",
        path: ["slides"],
        message: "Slide IDs must be distinct",
      });
    const { width, height } = input.slides[0].scene;
    if (
      input.slides.some(
        (s) => s.scene.width !== width || s.scene.height !== height,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["slides"],
        message: "All slides must use the same page dimensions",
      });
    if (
      input.slides
        .flatMap((s) => s.scene.layers)
        .reduce((n, l) => n + (l.kind === "text" ? l.text.length : 0), 0) >
      40000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Split presentations containing more than 40,000 displayed characters",
      });
  });
export const sourceReadInput = z.object({ source_version_id: uuid }).strict();
export const slidesRenderInput = z
  .object({ source_version_id: uuid, sha256: designDigest })
  .strict();
export const designSourcesInput = z
  .object({
    kind: z.enum(["images", "analysis"]).default("images"),
    after_id: uuid.optional(),
    limit: z.number().int().min(1).max(20).default(12),
  })
  .strict();
export const chartReadInput = z
  .object({
    source_version_id: uuid,
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type DesignScene = z.infer<typeof designScene>;
export type DesignLayer = z.infer<typeof designLayer>;
export type VectorInput = z.infer<typeof vectorInput>;
export type SlidesInput = z.infer<typeof slidesInput>;
