import { z } from "zod";
import { name, uuid } from "./lib.js";

const text = (max: number) => z.string().max(max).refine(
  (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),
  "Control characters are not supported",
);
const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const videoAssetRef = z.object({ asset_id: uuid, version: z.number().int().positive() }).strict();
const frame = z.number().int().min(0).max(1800);
export const videoScene = z.object({
  key,
  start_frame: frame,
  end_frame: frame,
  direction: text(1000),
  headline: text(240).refine((s) => s.trim().length > 0),
  body: text(500),
  image: videoAssetRef.nullable(),
}).strict();
export const videoSubtitle = z.object({ key, start_frame: frame, end_frame: frame, text: text(240).refine((s) => s.trim().length > 0) }).strict();
export const videoDefinition = z.object({
  schema_version: z.literal("copypaste-video-1"),
  template: z.literal("campaign-cuts-1"),
  locale: z.enum(["zh-HK", "en"]),
  width: z.number().int().min(256).max(1920),
  height: z.number().int().min(256).max(1920),
  frame_rate: z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).strict(),
  duration_frames: z.number().int().min(72).max(1800),
  script: z.object({ title: name, brief: text(2000), narration: text(6000), call_to_action: text(100) }).strict(),
  brand: z.object({ label: text(80), background: color, ink: color, accent: color, logo: videoAssetRef.nullable() }).strict(),
  storyboard: z.array(videoScene).min(1).max(20),
  subtitles: z.array(videoSubtitle).max(80),
  audio: z.object({
    source: videoAssetRef,
    source_in_frame: z.number().int().min(0).max(108000),
    gain_db: z.number().min(-36).max(0),
    role: z.enum(["music", "provided_voice"]),
    rights_basis: z.enum(["owned", "licensed"]),
    rights_reference: text(500).refine((s) => s.trim().length >= 3),
  }).strict().nullable(),
}).strict().superRefine((b, ctx) => {
  const fail = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
  if (!["24/1", "25/1", "30/1", "30000/1001"].includes(`${b.frame_rate.numerator}/${b.frame_rate.denominator}`)) fail("Choose a supported rational frame rate", ["frame_rate"]);
  const duration = b.duration_frames * b.frame_rate.denominator / b.frame_rate.numerator;
  if (duration < 3 || duration > 60) fail("Video duration must be between 3 and 60 seconds", ["duration_frames"]);
  if (b.width % 2 || b.height % 2) fail("Video dimensions must be even");
  if (b.width * b.height * b.duration_frames > 2_100_000_000) fail("This resolution and duration exceed the bounded render budget");
  let cursor = 0;
  for (const [i, scene] of b.storyboard.entries()) {
    if (scene.start_frame !== cursor || scene.end_frame <= scene.start_frame || scene.end_frame > b.duration_frames) fail("Scenes must be ordered, contiguous and cover the complete timeline", ["storyboard", i]);
    cursor = scene.end_frame;
  }
  if (cursor !== b.duration_frames) fail("The final scene must end at the last video frame", ["storyboard"]);
  cursor = 0;
  for (const [i, cue] of b.subtitles.entries()) {
    if (cue.start_frame < cursor || cue.end_frame <= cue.start_frame || cue.end_frame > b.duration_frames) fail("Subtitles must be ordered, non-overlapping and inside the timeline", ["subtitles", i]);
    cursor = cue.end_frame;
  }
  for (const [field, values] of [["storyboard", b.storyboard], ["subtitles", b.subtitles]] as const)
    if (new Set(values.map((s) => s.key)).size !== values.length) fail("Duplicate timeline key", [field]);
});
export type VideoDefinition = z.infer<typeof videoDefinition>;
export type VideoAssetRef = z.infer<typeof videoAssetRef>;
export const videoCreate = z.object({ name, definition: videoDefinition }).strict();
export const videoEdit = videoCreate.extend({ expected_version: z.number().int().positive() }).strict();
export const videoRenderRequest = z.object({ expected_version: z.number().int().positive() }).strict();
export const videoCancelRequest = z.object({ expected_revision: z.number().int().positive() }).strict();

export function videoSeconds(definition: VideoDefinition, frames = definition.duration_frames) {
  return frames * definition.frame_rate.denominator / definition.frame_rate.numerator;
}
export function videoReferences(definition: VideoDefinition): VideoAssetRef[] {
  const refs = [definition.brand.logo, ...definition.storyboard.map((s) => s.image), definition.audio?.source].filter((s): s is VideoAssetRef => !!s);
  return [...new Map(refs.map((s) => [s.asset_id + ":" + s.version, s])).values()];
}
export function videoSubtitlesVtt(definition: VideoDefinition) {
  const timestamp = (frame: number) => {
    const ms = Math.round(videoSeconds(definition, frame) * 1000);
    return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":") + "." + String(ms % 1000).padStart(3, "0");
  };
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return "WEBVTT\n\n" + definition.subtitles.map((cue) => `${cue.key}\n${timestamp(cue.start_frame)} --> ${timestamp(cue.end_frame)}\n${escape(cue.text)}\n`).join("\n");
}
