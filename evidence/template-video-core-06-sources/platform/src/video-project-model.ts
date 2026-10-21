import { z } from "zod";
import { name, uuid } from "./lib.js";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),
      "Control characters are not supported",
    );
const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const videoAssetRef = z
  .object({ asset_id: uuid, version: z.number().int().positive() })
  .strict();
const frame = z.number().int().min(0).max(1800);
export const videoScene = z
  .object({
    key,
    start_frame: frame,
    end_frame: frame,
    direction: text(1000),
    headline: text(240).refine((s) => s.trim().length > 0),
    body: text(500),
    image: videoAssetRef.nullable(),
  })
  .strict();
export const videoSubtitle = z
  .object({
    key,
    start_frame: frame,
    end_frame: frame,
    text: text(240).refine((s) => s.trim().length > 0),
  })
  .strict();
export const videoDefinition = z
  .object({
    schema_version: z.literal("copypaste-video-1"),
    template: z.literal("campaign-cuts-1"),
    locale: z.enum(["zh-HK", "en"]),
    width: z.number().int().min(256).max(1920),
    height: z.number().int().min(256).max(1920),
    frame_rate: z
      .object({
        numerator: z.number().int().positive(),
        denominator: z.number().int().positive(),
      })
      .strict(),
    duration_frames: z.number().int().min(72).max(1800),
    script: z
      .object({
        title: name,
        brief: text(2000),
        narration: text(6000),
        call_to_action: text(100),
      })
      .strict(),
    brand: z
      .object({
        label: text(80),
        background: color,
        ink: color,
        accent: color,
        logo: videoAssetRef.nullable(),
      })
      .strict(),
    storyboard: z.array(videoScene).min(1).max(20),
    subtitles: z.array(videoSubtitle).max(80),
    audio: z
      .object({
        source: videoAssetRef,
        source_in_frame: z.number().int().min(0).max(108000),
        gain_db: z.number().min(-36).max(0),
        role: z.enum(["music", "provided_voice"]),
        rights_basis: z.enum(["owned", "licensed"]),
        rights_reference: text(500).refine((s) => s.trim().length >= 3),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    if (
      !["24/1", "25/1", "30/1", "30000/1001"].includes(
        `${b.frame_rate.numerator}/${b.frame_rate.denominator}`,
      )
    )
      fail("Choose a supported rational frame rate", ["frame_rate"]);
    const duration =
      (b.duration_frames * b.frame_rate.denominator) / b.frame_rate.numerator;
    if (duration < 3 || duration > 60)
      fail("Video duration must be between 3 and 60 seconds", [
        "duration_frames",
      ]);
    if (b.width % 2 || b.height % 2) fail("Video dimensions must be even");
    if (b.width * b.height * b.duration_frames > 2_100_000_000)
      fail("This resolution and duration exceed the bounded render budget");
    let cursor = 0;
    for (const [i, scene] of b.storyboard.entries()) {
      if (
        scene.start_frame !== cursor ||
        scene.end_frame <= scene.start_frame ||
        scene.end_frame > b.duration_frames
      )
        fail(
          "Scenes must be ordered, contiguous and cover the complete timeline",
          ["storyboard", i],
        );
      cursor = scene.end_frame;
    }
    if (cursor !== b.duration_frames)
      fail("The final scene must end at the last video frame", ["storyboard"]);
    cursor = 0;
    for (const [i, cue] of b.subtitles.entries()) {
      if (
        cue.start_frame < cursor ||
        cue.end_frame <= cue.start_frame ||
        cue.end_frame > b.duration_frames
      )
        fail(
          "Subtitles must be ordered, non-overlapping and inside the timeline",
          ["subtitles", i],
        );
      cursor = cue.end_frame;
    }
    for (const [field, values] of [
      ["storyboard", b.storyboard],
      ["subtitles", b.subtitles],
    ] as const)
      if (new Set(values.map((s) => s.key)).size !== values.length)
        fail("Duplicate timeline key", [field]);
  });
export type VideoDefinition = z.infer<typeof videoDefinition>;
export type VideoAssetRef = z.infer<typeof videoAssetRef>;
export const videoCreate = z
  .object({ name, definition: videoDefinition })
  .strict();
export const videoEdit = videoCreate
  .extend({ expected_version: z.number().int().positive() })
  .strict();
export const videoRenderRequest = z
  .object({ expected_version: z.number().int().positive() })
  .strict();
export const videoCancelRequest = z
  .object({ expected_revision: z.number().int().positive() })
  .strict();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const videoProfile = z
  .object({
    renderer: z.literal("copypaste-campaign-cuts-1"),
    font_id: z.string(),
    font_sha256: sha256,
    ffmpeg_sha256: sha256,
    ffprobe_sha256: sha256,
    video_codec: z.literal("h264"),
    pixel_format: z.literal("yuv420p"),
    audio_codec: z.literal("aac"),
    audio_sample_rate: z.literal(48000),
  })
  .strict();
const date = z.string().datetime({ offset: true });
const version = z.number().int().positive();
export const videoCreated = z.object({ id: uuid, version }).strict();
export const videoQueued = z
  .object({
    video_id: uuid,
    id: uuid,
    revision: version,
    state: z.literal("queued"),
  })
  .strict();
export const videoCancelled = z
  .object({ id: uuid, revision: version, state: z.literal("cancelled") })
  .strict();
export const videoList = z
  .object({
    items: z
      .array(z.object({ id: uuid, name, version, created_at: date }).strict())
      .max(20),
    next_cursor: uuid.nullable(),
  })
  .strict();
export const videoRenderDto = z
  .object({
    id: uuid,
    video_id: uuid,
    version,
    revision: version,
    state: z.enum(["queued", "rendering", "succeeded", "failed", "cancelled"]),
    error_code: z.string().nullable(),
    mp4_asset_id: uuid.nullable(),
    project_asset_id: uuid.nullable(),
    script_asset_id: uuid.nullable(),
    storyboard_asset_id: uuid.nullable(),
    subtitles_asset_id: uuid.nullable(),
    probe_asset_id: uuid.nullable(),
    probe: z.record(z.string(), z.unknown()),
    ai_cost_micros: z.literal("0"),
    cost_source: z.literal("local_composition_no_ai"),
    elapsed_ms: z.number().int().nonnegative().nullable(),
    output_bytes: z.string().regex(/^\d+$/).nullable(),
    created_at: date,
    started_at: date.nullable(),
    finished_at: date.nullable(),
    output_available: z.boolean(),
  })
  .strict();
export const videoDetail = z
  .object({
    id: uuid,
    name,
    version,
    data_mode: z.enum(["simulated", "configured_services"]),
    definition: videoDefinition,
    renderer_profile: videoProfile,
    input_hash: sha256,
    versions: z
      .array(
        z
          .object({
            version,
            input_hash: sha256,
            renderer_profile: videoProfile,
            actor_id: uuid,
            created_at: date,
          })
          .strict(),
      )
      .max(50),
    renders: z.array(videoRenderDto).max(100),
    cost: z
      .object({
        ai_cost_micros: z.literal("0"),
        source: z.literal("local_composition_no_ai"),
        currency: z.literal("HKD"),
      })
      .strict(),
  })
  .strict();
export const videoPreview = z
  .object({
    content_type: z.literal("video/mp4"),
    base64: z
      .string()
      .max(26_666_668)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    bytes: z.number().int().positive().max(20_000_000),
    sha256,
  })
  .strict();

export function videoSeconds(
  definition: VideoDefinition,
  frames = definition.duration_frames,
) {
  return (
    (frames * definition.frame_rate.denominator) /
    definition.frame_rate.numerator
  );
}
export function videoReferences(definition: VideoDefinition): VideoAssetRef[] {
  const refs = [
    definition.brand.logo,
    ...definition.storyboard.map((s) => s.image),
    definition.audio?.source,
  ].filter((s): s is VideoAssetRef => !!s);
  return [
    ...new Map(refs.map((s) => [s.asset_id + ":" + s.version, s])).values(),
  ];
}
export function videoSubtitlesVtt(definition: VideoDefinition) {
  const timestamp = (frame: number) => {
    const ms = Math.round(videoSeconds(definition, frame) * 1000);
    return (
      [
        Math.floor(ms / 3600000),
        Math.floor(ms / 60000) % 60,
        Math.floor(ms / 1000) % 60,
      ]
        .map((n) => String(n).padStart(2, "0"))
        .join(":") +
      "." +
      String(ms % 1000).padStart(3, "0")
    );
  };
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return (
    "WEBVTT\n\n" +
    definition.subtitles
      .map(
        (cue) =>
          `${cue.key}\n${timestamp(cue.start_frame)} --> ${timestamp(cue.end_frame)}\n${escape(cue.text)}\n`,
      )
      .join("\n")
  );
}
