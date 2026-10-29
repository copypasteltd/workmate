import type { Config } from "./config.js";
import { internalAIRequest, finishInternalAIRequest, AIRequestFailure, type AIRequestAuthority, type AIOperation } from "./internal-ai-gateway.js";
import { parseVideoJobObservation } from "./video-job-protocol.js";
import { Problem } from "./lib.js";

export type VideoGatewayJob = {
  operation_id: string; provider_id: string | null; model_alias: string;
  seconds: 4 | 8 | 12 | 16 | 20; size: "720x1280" | "1280x720" | "1024x1024";
  specification: { prompt?: string };
};

/** Resource-only access through the central company gateway, never provider URLs. */
export async function callVideoGateway(c: Config, job: VideoGatewayJob,
  operation: Extract<AIOperation, `videos.${string}`>, authority: AIRequestAuthority,
  signal: AbortSignal, reference?: { bytes: Buffer; mime: string }) {
  let body: FormData | Record<string, unknown> = {};
  if (operation === "videos.create") {
    if (!job.specification.prompt) throw new Problem(409, "VIDEO_PROMPT_UNAVAILABLE", "An erased video specification cannot be submitted");
    body = new FormData();
    for (const [name, value] of Object.entries({ model: job.model_alias, prompt: job.specification.prompt, size: job.size, seconds: String(job.seconds) })) body.set(name, value);
    if (reference) body.set("input_reference", new Blob([new Uint8Array(reference.bytes)], { type: reference.mime }), "reference." + (reference.mime === "image/png" ? "png" : "jpg"));
  }
  const resource = operation === "videos.create" ? undefined : operation === "videos.lookup"
    ? { operationId: job.operation_id } : { videoId: job.provider_id ?? "" };
  let response: Response | undefined;
  try {
    response = await internalAIRequest(c, { operation, model: job.model_alias, body, videoResource: resource,
      authority, signal, ...(operation === "videos.create" || operation === "videos.cancel" ? { operationId: job.operation_id } : {}) });
    if (!response.ok) {
      await response.body?.cancel();
      // A failed lookup, including 404, does not prove the original submit was free.
      throw new Problem(502, response.status === 404 ? "VIDEO_OPERATION_NOT_CONFIRMED" : "VIDEO_SERVICE_UNAVAILABLE", "The internal video service has not confirmed this operation");
    }
    if (operation === "videos.content") {
      if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "video/mp4")
        throw new Problem(502, "VIDEO_CONTENT_TYPE_INVALID", "The internal video service did not return an MP4 file");
      return { bytes: Buffer.from(await response.arrayBuffer()) };
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
      throw new Problem(502, "VIDEO_PROTOCOL_INVALID", "The internal video service did not return a job observation");
    const raw = await response.json();
    return parseVideoJobObservation(raw, { operationId: job.operation_id, model: job.model_alias, size: job.size, seconds: job.seconds, ...(job.provider_id ? { videoId: job.provider_id } : {}) });
  } catch (error) {
    await response?.body?.cancel().catch(() => {});
    await finishInternalAIRequest(response, { state: "unknown", code: "VIDEO_OBSERVATION_UNCERTAIN", httpStatus: response?.status }).catch(() => {});
    if (error instanceof Problem || error instanceof AIRequestFailure) throw error;
    throw new Problem(502, "VIDEO_PROTOCOL_INVALID", "The internal video service response could not be validated");
  }
}
