import { z } from "zod";
import { videoJobSpecification } from "./video-job-protocol.js";

const id = z.uuid(), number = z.number().int().nonnegative().safe(), revision = number.positive();
const amount = z.string().regex(/^\d{1,40}$/), digest = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const code = z.string().max(160).nullable();
export const generatedVideoState = z.enum(["prepared", "submitting", "queued", "in_progress", "completed", "failed", "cancelled", "unknown"]);
export const generatedVideoDeliveryState = z.enum(["pending", "available", "blocked", "invalid", "unavailable"]);
export const generatedVideoPageQuery = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(30), task_id: id.optional() }).strict();
export const generatedVideoAdminQuery = generatedVideoPageQuery.extend({ tenant_id: id.optional(), project_id: id.optional() });
export const generatedVideoCancelRequest = z.object({ expected_revision: revision.describe("The public job revision returned to this actor; background leases and unchanged polling do not advance it. A changed outcome or explicit control command requires refresh.") }).strict();
export const generatedVideoRecheckRequest = generatedVideoCancelRequest.extend({ reason: z.string().trim().min(3).max(1000) });
export const generatedVideoProbe = z.object({ container: z.literal("mp4"), video_codec: z.literal("h264"), width: revision, height: revision,
  duration_seconds: z.number().positive(), decoded_video_frames: revision, audio_codec: z.literal("aac").nullable(),
  sha256: digest, bytes: revision.max(100_000_000), fully_decoded: z.literal(true) }).strict();
export const generatedVideoAsset = z.object({ id, name: z.string(), version: revision, mime_type: z.literal("video/mp4"), bytes: amount, sha256: digest }).strict();
export const generatedVideoMetadata = z.object({
  id, task_id: id, operation_id: id, revision, state: generatedVideoState, progress: number.max(100).nullable(),
  size: videoJobSpecification.shape.size, seconds: videoJobSpecification.shape.seconds, model_alias: z.string(), capability_version_id: id,
  data_mode: z.enum(["simulated", "configured_services"]), quoted_micros: amount, actual_micros: amount.nullable(),
  usage_state: z.enum(["confirmed", "awaiting_confirmation"]), billable_seconds: amount.nullable(), budget_violation: z.boolean(),
  cancel_requested: z.boolean(), error_code: code, delivery_error: code, delivery_state: generatedVideoDeliveryState,
  assets: z.array(generatedVideoAsset).max(1), observed_at: time.nullable(), next_poll_at: time, probe: generatedVideoProbe.nullable(), created_at: time, finished_at: time.nullable(),
}).strict();
export const generatedVideoList = z.object({ items: z.array(generatedVideoMetadata).max(100), next_cursor: id.nullable() }).strict();
export const generatedVideoPreview = z.object({ content_type: z.literal("video/mp4"), base64: z.string().min(1).max(26_666_668), bytes: revision.max(20_000_000), sha256: digest }).strict();
export const generatedVideoObservationReceipt = z.union([z.object({ duplicate: z.boolean() }).strict(), z.object({ stale: z.literal(true) }).strict()]);
export const generatedVideoAdminCost = z.object({ quoted_micros: amount, actual_micros: amount.nullable(), billable_seconds: amount.nullable(), rate_micros: amount, budget_violation: z.boolean() }).strict();
export const generatedVideoAdminJob = z.object({
  id, tenant_id: id, project_id: id, task_id: id, actor_id: id, data_mode: z.enum(["simulated", "configured_services"]), operation_id: id,
  state: generatedVideoState, progress: number.max(100).nullable(), model_alias: z.string(), capability_version_id: id, policy_version_id: id,
  created_at: time, observed_at: time.nullable(), next_poll_at: time, finished_at: time.nullable(), revision, usage_known: z.boolean(), cancel_requested_at: time.nullable(),
  error_code: code, delivery_state: generatedVideoDeliveryState, delivery_error: code, cost: generatedVideoAdminCost.nullable(),
}).strict();
export const generatedVideoAdminList = z.object({ items: z.array(generatedVideoAdminJob).max(100), next_cursor: id.nullable() }).strict();
export const generatedVideoRecheckReceipt = z.object({ id, revision, requested: z.literal("observe_existing_operation"), generation_submitted: z.literal(false) }).strict();
