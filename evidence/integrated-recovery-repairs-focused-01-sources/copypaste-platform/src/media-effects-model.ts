import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";

export const effectsSchema = "copypaste-media-effect-1";
export const effectsVersion = "1.0.0";
const source = z
  .object({
    asset_version_id: uuid,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const output = z
  .object({
    size: z.enum([
      "640x360",
      "360x640",
      "640x640",
      "1280x720",
      "720x1280",
      "720x720",
    ]),
    seconds: z.number().int().min(2).max(12),
  })
  .strict();
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const timing = z.enum(["0.5", "1", "1.5", "2"]);
function base<T extends string, P extends z.ZodRawShape>(
  id: T,
  parameters: P,
  count = 1,
) {
  return z
    .object({
      schema: z.literal(effectsSchema),
      effect_id: z.literal(id),
      version: z.literal(effectsVersion),
      sources: z.array(source).length(count),
      output,
      parameters: z.object(parameters).strict(),
    })
    .strict();
}
const text = {
  text: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(
      (s) => !/[\u0000-\u001f\u007f]/u.test(s),
      "Use one line of printable text",
    ),
  color,
  font_size: z.number().int().min(24).max(120),
  position: z.enum(["center", "lower_third"]),
  entrance_seconds: timing,
};
export const effectSchemas = [
  base("transition.crossfade", { transition_seconds: timing }, 2),
  base("transition.slide-left", { transition_seconds: timing }, 2),
  base("transition.wipe-right", { transition_seconds: timing }, 2),
  base("transition.dip-black", { transition_seconds: timing }, 2),
  base("text.fade-in", text),
  base("text.slide-up", text),
  base("key.chroma", {
    key_color: color,
    similarity: z.number().min(0.05).max(0.5),
    blend: z.number().min(0).max(0.25),
    background: color,
  }),
  base("cleanup.denoise", { strength: z.number().min(0.5).max(8) }),
  base("cleanup.sharpen", { amount: z.number().min(0.1).max(1.5) }),
  base("cleanup.exposure", {
    brightness: z.number().min(-0.25).max(0.25),
    contrast: z.number().min(0.5).max(1.5),
    gamma: z.number().min(0.5).max(2),
  }),
] as const;
export const effectRequest = z.discriminatedUnion("effect_id", effectSchemas);
export type EffectRequest = z.infer<typeof effectRequest>;
export const effectRenderInput = z.object({ request: effectRequest }).strict();
export const effectSourcesInput = z
  .object({
    after_id: uuid.optional(),
    limit: z.number().int().min(1).max(30).default(20),
  })
  .strict();
export const effectsTaskInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    budget_micros: z.number().int().min(1_000_000).max(10_000_000_000),
    request: effectRequest,
  })
  .strict();
const names = [
  [
    "交叉淡化",
    "Crossfade",
    "transition",
    "Two sources blend through the reviewed transition interval.",
    { transition_seconds: "1" },
  ],
  [
    "向左滑動",
    "Slide left",
    "transition",
    "The second source pushes the first source to the left.",
    { transition_seconds: "1" },
  ],
  [
    "向右擦除",
    "Wipe right",
    "transition",
    "The second source is revealed from left to right.",
    { transition_seconds: "1" },
  ],
  [
    "黑場轉接",
    "Dip to black",
    "transition",
    "The first source fades to black before the second appears.",
    { transition_seconds: "1" },
  ],
  [
    "文字淡入",
    "Text fade in",
    "text",
    "A fixed licensed Traditional Chinese font fades into the source.",
    {
      text: "讓好點子動起來",
      color: "#FFFFFF",
      font_size: 48,
      position: "lower_third",
      entrance_seconds: "1",
    },
  ],
  [
    "文字上移",
    "Text slide up",
    "text",
    "The approved text moves up from below the frame.",
    {
      text: "讓好點子動起來",
      color: "#FFFFFF",
      font_size: 48,
      position: "lower_third",
      entrance_seconds: "1",
    },
  ],
  [
    "色鍵合成",
    "Chroma key",
    "key",
    "Remove one reviewed RGB key color and composite onto a solid background.",
    {
      key_color: "#00FF00",
      similarity: 0.15,
      blend: 0.05,
      background: "#1F5EFF",
    },
  ],
  [
    "基礎降噪",
    "Denoise",
    "cleanup",
    "Spatial and temporal filtering; it may soften fine detail.",
    { strength: 3 },
  ],
  [
    "基礎銳化",
    "Sharpen",
    "cleanup",
    "A bounded unsharp filter increases edge contrast; it does not recover lost detail.",
    { amount: 0.7 },
  ],
  [
    "曝光校正",
    "Exposure",
    "cleanup",
    "Adjust brightness, contrast and gamma; clipped source information cannot be recovered.",
    { brightness: 0.05, contrast: 1.05, gamma: 1 },
  ],
] as const;
export function effectsCatalog() {
  const items = effectSchemas.map((schema, i) => {
    const [name_zh, name_en, category, description, defaults] = names[i];
    const definition = {
      id: schema.shape.effect_id.value,
      version: effectsVersion,
      name_zh,
      name_en,
      category,
      description,
      defaults,
      source_count: category === "transition" ? 2 : 1,
      input_schema: z.toJSONSchema(schema),
    };
    return { ...definition, definition_sha256: hash(canonical(definition)) };
  });
  return {
    schema: effectsSchema,
    version: effectsVersion,
    fps: 24,
    audio: "omitted",
    source_policy:
      "Exact authorized PNG/H.264 MP4 versions, at most 32 MiB each, 1920 pixels per side, 60 seconds; video must cover its required interval. Original files stay intact.",
    output_sizes: output.shape.size.options,
    max_seconds: 12,
    items,
    catalog_sha256: hash(canonical(items)),
  };
}
export function parseEffect(value: unknown): EffectRequest {
  const input = effectRequest.parse(value);
  if (
    "transition_seconds" in input.parameters &&
    Number(input.parameters.transition_seconds) > input.output.seconds / 2
  )
    throw new Problem(
      422,
      "EFFECT_TIMING_INVALID",
      "The transition cannot exceed half the output duration",
    );
  if (
    "entrance_seconds" in input.parameters &&
    Number(input.parameters.entrance_seconds) > input.output.seconds
  )
    throw new Problem(
      422,
      "EFFECT_TIMING_INVALID",
      "The entrance cannot exceed the output duration",
    );
  return input;
}
export function effectDigest(input: EffectRequest) {
  return hash(canonical(parseEffect(input)));
}
export function frozenEffect(t: any): EffectRequest | null {
  const frozen = t.input_context?.media_effect;
  if (!frozen) return null;
  const input = parseEffect(frozen.request);
  if (
    frozen.request_sha256 !== effectDigest(input) ||
    frozen.catalog_sha256 !== effectsCatalog().catalog_sha256
  )
    throw new Problem(
      409,
      "EFFECT_BINDING_CHANGED",
      "The reviewed effect definition is unavailable",
    );
  return input;
}
