import { z } from "zod";
import { uuid, name } from "./lib.js";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),
      "Control characters are not supported",
    );
export const matrixCopy = z
  .object({
    brand_line: text(80),
    headline: text(240).refine((s) => s.trim().length > 0),
    body: text(800),
    action: text(100),
  })
  .strict();
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const matrixTheme = z
  .object({ background: color, ink: color, accent: color })
  .strict();
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const matrixSize = z
  .object({
    key: slug,
    name,
    width: z.number().int().min(256).max(2048),
    height: z.number().int().min(256).max(2048),
  })
  .strict();
export const matrixCreate = z
  .object({
    name,
    locales: z
      .array(z.enum(["zh-HK", "en"]))
      .min(1)
      .max(2),
    sizes: z.array(matrixSize).min(1).max(10),
    creatives: z
      .array(
        z
          .object({
            key: slug,
            name,
            theme: matrixTheme,
            image: z
              .object({ asset_id: uuid, version: z.number().int().positive() })
              .strict()
              .nullable(),
            copy: z
              .array(
                z
                  .object({ locale: z.enum(["zh-HK", "en"]), text: matrixCopy })
                  .strict(),
              )
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((b, c) => {
    for (const [label, values] of [
      ["locales", b.locales],
      ["sizes", b.sizes.map((s) => s.key)],
      ["creatives", b.creatives.map((s) => s.key)],
    ] as const)
      if (new Set(values).size !== values.length)
        c.addIssue({
          code: "custom",
          message: "Duplicate " + label,
          path: [label],
        });
    if (b.locales.length * b.sizes.length * b.creatives.length > 60)
      c.addIssue({
        code: "custom",
        message: "A batch supports at most 60 units",
        path: ["creatives"],
      });
    b.creatives.forEach((creative, i) => {
      const languages = creative.copy.map((x) => x.locale);
      if (
        languages.length !== b.locales.length ||
        new Set(languages).size !== languages.length ||
        b.locales.some((l) => !languages.includes(l))
      )
        c.addIssue({
          code: "custom",
          message: "Provide exactly one copy for each selected language",
          path: ["creatives", i, "copy"],
        });
    });
  });
export type MatrixCreate = z.infer<typeof matrixCreate>;
export const matrixInput = z
  .object({
    renderer: z.literal("copypaste-layout-1"),
    locale: z.enum(["zh-HK", "en"]),
    creative_key: slug,
    creative_name: name,
    size: matrixSize,
    theme: matrixTheme,
    copy: matrixCopy,
    image: z
      .object({
        asset_id: uuid,
        version: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MatrixInput = z.infer<typeof matrixInput>;
export const matrixEdit = z
  .object({
    expected_revision: z.number().int().positive(),
    copy: matrixCopy,
    image: z
      .object({ asset_id: uuid, version: z.number().int().positive() })
      .strict()
      .nullable()
      .optional(),
    theme: matrixTheme.optional(),
  })
  .strict();
export const matrixRetry = z
  .object({ expected_revision: z.number().int().positive() })
  .strict();
export const matrixCancel = z
  .object({ expected_version: z.number().int().positive() })
  .strict();

// Public JSON contracts. Database dates become ISO strings at the HTTP boundary.
const instant = z.iso.datetime(),
  positive = z.number().int().positive(),
  count = z.number().int().nonnegative();
const unitState = z.enum([
  "queued",
  "rendering",
  "succeeded",
  "failed",
  "cancelled",
]);
export const matrixCreated = z.object({ id: uuid }).strict();
export const matrixUpdated = z
  .object({
    id: uuid,
    unit_id: uuid,
    revision: positive,
    state: z.literal("queued"),
  })
  .strict();
export const matrixCancelled = z
  .object({ id: uuid, cancelled: z.literal(true) })
  .strict();
export const matrixList = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid,
            name,
            version: positive,
            created_at: instant,
            cancelled: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    next_cursor: uuid.nullable(),
  })
  .strict();
export const matrixAttempt = z
  .object({
    id: uuid,
    unit_id: uuid,
    revision: positive,
    state: z.enum(["rendering", "succeeded", "failed", "cancelled"]),
    error_code: z.string().nullable(),
    png_asset_id: uuid.nullable(),
    svg_asset_id: uuid.nullable(),
    source_asset_id: uuid.nullable(),
    ai_cost_micros: z.literal("0"),
    cost_source: z.literal("local_composition_no_ai"),
    elapsed_ms: count.nullable(),
    output_bytes: z.string().regex(/^\d+$/).nullable(),
    started_at: instant,
    finished_at: instant.nullable(),
    output_available: z.boolean(),
  })
  .strict();
export const matrixDetail = z
  .object({
    id: uuid,
    name,
    version: positive,
    data_mode: z.enum(["simulated", "configured_services"]),
    cancelled: z.boolean(),
    state: z.enum([
      "running",
      "succeeded",
      "partially_succeeded",
      "failed",
      "cancelled",
    ]),
    counts: z
      .object({
        queued: count,
        rendering: count,
        succeeded: count,
        failed: count,
        cancelled: count,
      })
      .strict(),
    cost: z
      .object({
        ai_cost_micros: z.literal("0"),
        source: z.literal("local_composition_no_ai"),
        currency: z.literal("HKD"),
      })
      .strict(),
    units: z
      .array(
        z
          .object({
            id: uuid,
            creative_key: slug,
            locale: z.enum(["zh-HK", "en"]),
            size_key: slug,
            revision: positive,
            state: unitState,
            error_code: z.string().nullable(),
            created_at: instant,
            updated_at: instant,
            input: matrixInput,
            input_hash: z.string().regex(/^[a-f0-9]{64}$/),
            source_available: z.boolean(),
            attempts: z.array(matrixAttempt).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();
