import { z } from "zod";
import { Problem, uuid } from "./lib.js";
import type { Config } from "./config.js";

export const speechProtocol = "openai-speech-wav-v1";
export const transcriptionProtocol = "openai-file-transcription-v1";
export const audioOperations = ["audio.speech", "audio.transcriptions"] as const;
const rights = z.object({
  authorized: z.literal(true),
  reference: z.string().trim().min(3).max(300),
  purpose: z.string().trim().min(3).max(1000),
}).strict();
const locale = z.enum(["en", "zh-HK", "yue-HK"]);
export const wellFormedAudioText = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
export const audioProductionRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("speech"),
    text: z.string().min(1).max(4096).refine(value => !!value.trim() && wellFormedAudioText(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)),
    locale,
    voice: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    speed: z.number().min(0.25).max(4),
    rights,
  }).strict(),
  z.object({
    kind: z.literal("transcription"),
    source: z.object({ asset_id: uuid, version: z.number().int().positive() }).strict(),
    locale,
    timestamps: z.boolean(),
    rights,
  }).strict(),
]);
export type AudioProductionRequest = z.infer<typeof audioProductionRequest>;
// The pinned native harness projects flat object schemas reliably. Per-kind
// required fields and forbidden fields are still enforced by the strict union
// above before any persisted intent, source read, budget or provider request.
export const audioProductionToolSchema = {
  type: "object", properties: {
    kind: { type: "string", enum: ["speech", "transcription"] },
    locale: { type: "string", enum: ["en", "zh-HK", "yue-HK"] },
    rights: { type: "object", properties: { authorized: { type: "boolean", enum: [true] },
      reference: { type: "string" }, purpose: { type: "string" } }, required: ["authorized", "reference", "purpose"], additionalProperties: false },
    text: { type: "string", description: "Speech only: exact customer-approved copy, at most 4096 characters." },
    voice: { type: "string", description: "Speech only: explicitly selected verified company voice." },
    speed: { type: "number", description: "Speech only: rate between 0.25 and 4." },
    source: { type: "object", properties: { asset_id: { type: "string" }, version: { type: "integer" } },
      required: ["asset_id", "version"], additionalProperties: false, description: "Transcription only: exact authorized WAV/MP3 asset version." },
    timestamps: { type: "boolean", description: "Transcription only: request actual segment times only when independently verified." },
  }, required: ["kind", "locale", "rights"], additionalProperties: false,
};
export function speechLimits(c: Config) {
  return { max_input_chars: 4096, response_format: "wav", speed_min: 0.25, speed_max: 4,
    voices: c.AI_SPEECH_VOICES.split(",").map(v => v.trim()).filter(Boolean).sort(),
    locales: c.AI_SPEECH_LOCALES.split(",").sort(),
    pricing_unit: "unicode_scalar", max_output_bytes: 25_000_000, max_duration_ms: 600_000 };
}
export function transcriptionLimits(c: Config) {
  return { max_input_bytes: 25_000_000, max_duration_ms: 600_000, mime_types: ["audio/wav", "audio/mpeg"],
    locales: c.AI_TRANSCRIPTION_LOCALES.split(",").sort(),
    response_formats: c.AI_TRANSCRIPTION_TIMESTAMPS ? ["json", "verbose_json"] : ["json"],
    pricing_unit: "input_millisecond" };
}
export const audioCue = z.object({ start_ms: z.number().int().min(0), end_ms: z.number().int().positive(),
  text: z.string().min(1).max(4000).refine(value => !!value.trim() && wellFormedAudioText(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) }).strict();
export const subtitleEdit = z.object({ expected_revision: z.number().int().positive(), text: z.string().max(200000)
  .refine(value => wellFormedAudioText(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)),
  cues: z.array(audioCue).max(2000), reason: z.string().trim().min(3).max(1000) }).strict();
export const audioListQuery = z.object({ task_id: uuid.optional(), cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

export function validateAudioCues(cues: z.infer<typeof audioCue>[], duration: number) {
  let end = 0;
  for (const cue of cues) {
    if (cue.start_ms < end || cue.end_ms <= cue.start_ms || cue.end_ms > duration)
      throw new Problem(422, "AUDIO_SUBTITLE_TIMING_INVALID", "Use ordered, non-overlapping subtitle times within the actual audio duration");
    end = cue.end_ms;
  }
  return cues;
}
export function parseAudioTranscription(raw: Buffer, duration: number, timestamps: boolean) {
  if (!raw.length || raw.length > 2_000_000) throw new Problem(422, "AUDIO_TRANSCRIPTION_INVALID", "A bounded complete transcription is required");
  let body: any;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new Problem(422, "AUDIO_TRANSCRIPTION_INVALID", "The transcription must be complete UTF-8 JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.text !== "string" || body.text.length > 200000
    || !wellFormedAudioText(body.text) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.text))
    throw new Problem(422, "AUDIO_TRANSCRIPTION_INVALID", "The transcription must contain its actual bounded text");
  const cues: z.infer<typeof audioCue>[] = [];
  if (timestamps) {
    if (!Array.isArray(body.segments) || body.segments.length > 2000 || (body.text.trim() && !body.segments.length))
      throw new Problem(422, "AUDIO_TRANSCRIPTION_TIMESTAMPS_MISSING", "This verified timestamp operation must return actual segments");
    for (const segment of body.segments) {
      if (typeof segment?.start !== "number" || typeof segment?.end !== "number" || !Number.isFinite(segment.start) || !Number.isFinite(segment.end))
        throw new Problem(422, "AUDIO_TRANSCRIPTION_INVALID", "The provider returned invalid segment times");
      cues.push(audioCue.parse({ start_ms: Math.round(segment.start * 1000), end_ms: Math.round(segment.end * 1000), text: segment.text }));
    }
    validateAudioCues(cues, duration);
  }
  return { schema_version: 1, text: body.text, cues, duration_ms: duration,
    timing_source: timestamps ? "provider_segments_rounded_to_millisecond" : "none" };
}
export function audioSubtitles(cues: z.infer<typeof audioCue>[], vtt: boolean) {
  const stamp = (ms: number) => {
    const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
    return [hours, minutes, seconds].map(v => String(v).padStart(2, "0")).join(":") + (vtt ? "." : ",") + String(ms % 1000).padStart(3, "0");
  };
  // Escape WebVTT markup so transcript text stays literal. SRT is plain text.
  const literal = (text: string) => vtt ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : text;
  return (vtt ? "WEBVTT\n\n" : "") + cues.map((cue, i) => `${i + 1}\n${stamp(cue.start_ms)} --> ${stamp(cue.end_ms)}\n${literal(cue.text)}\n`).join("\n");
}
