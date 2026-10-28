import { z } from "zod";
import { canonical, hash, Problem } from "./lib.js";

export const videoJobProtocol = "company-video-jobs-v1" as const;
export const videoJobOperations = ["videos.create", "videos.retrieve", "videos.lookup", "videos.cancel", "videos.content"] as const;
export const videoJobLimits = {
  max_prompt_chars: 12000,
  sizes: ["720x1280", "1280x720", "1024x1024"],
  seconds: [4, 8, 12, 16, 20],
  max_reference_bytes: 10_000_000,
  max_content_bytes: 100_000_000,
  container: "mp4",
  video_codec: "h264",
  optional_audio_codec: "aac",
  operation_lookup: true,
  cancellation: "request_then_observe",
  final_usage: "billable_seconds",
};
export const videoJobSpecification = z.object({
  prompt: z.string().trim().min(1).max(12000),
  size: z.enum(["720x1280", "1280x720", "1024x1024"]),
  seconds: z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(16), z.literal(20)]),
  reference: z.object({ asset_id: z.uuid(), version: z.number().int().positive().safe() }).strict().optional(),
}).strict();
export type VideoJobSpecification = z.infer<typeof videoJobSpecification>;

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const videoJobObservation = z.object({
  protocol: z.literal(videoJobProtocol),
  object: z.literal("video"),
  id: identifier,
  operation_id: z.string().regex(/^[a-zA-Z0-9_:-]{16,128}$/),
  event_id: z.uuid(),
  sequence: z.number().int().nonnegative().safe(),
  model: z.string().min(1).max(200),
  size: videoJobSpecification.shape.size,
  seconds: videoJobSpecification.shape.seconds,
  status: z.enum(["queued", "in_progress", "completed", "failed", "cancelled"]),
  progress: z.number().int().min(0).max(100).nullable(),
  usage: z.object({ billable_seconds: z.number().int().nonnegative().safe() }).strict().nullable(),
  content: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(100_000_000) }).strict().nullable(),
  error: z.object({ code: z.string().regex(/^[A-Z0-9_]{1,100}$/) }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status !== "completed" && value.content !== null)
    ctx.addIssue({ code: "custom", message: "Only completed video has content" });
  if (value.status === "completed" && value.content === null)
    ctx.addIssue({ code: "custom", message: "Completed video must identify its immutable content" });
  if (!["completed", "failed", "cancelled"].includes(value.status) && value.usage !== null)
    ctx.addIssue({ code: "custom", message: "Nonterminal usage does not confirm final cost" });
  if (["queued", "in_progress", "completed"].includes(value.status) && value.error !== null)
    ctx.addIssue({ code: "custom", message: "Successful state cannot include a failure" });
});
export type VideoJobObservation = z.infer<typeof videoJobObservation>;

export function parseVideoJobObservation(raw: unknown, expected: {
  operationId: string; model: string; size: VideoJobSpecification["size"]; seconds: VideoJobSpecification["seconds"]; videoId?: string;
}) {
  const parsed = videoJobObservation.safeParse(raw);
  if (!parsed.success) throw new Problem(502, "VIDEO_PROTOCOL_INVALID", "The internal video service returned an invalid observation");
  const value = parsed.data;
  if (value.operation_id !== expected.operationId || value.model !== expected.model
    || value.size !== expected.size || value.seconds !== expected.seconds
    || (expected.videoId !== undefined && value.id !== expected.videoId))
    throw new Problem(502, "VIDEO_OPERATION_MISMATCH", "The internal video result does not match the frozen operation");
  return { value, hash: hash(canonical(value)), terminal: ["completed", "failed", "cancelled"].includes(value.status) };
}

export function videoJobCharge(seconds: number, rateMicros: number) {
  if (![seconds, rateMicros].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Problem(502, "VIDEO_USAGE_INVALID", "The internal video usage or frozen rate is invalid");
  const amount = BigInt(seconds) * BigInt(rateMicros);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Problem(502, "VIDEO_USAGE_OUT_OF_RANGE", "The observed video cost exceeds supported billing amounts");
  return Number(amount);
}
