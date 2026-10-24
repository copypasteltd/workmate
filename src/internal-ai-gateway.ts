import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import type { Config } from "./config.js";
import { hash } from "./lib.js";
import { listenLoopbackHTTP } from "./loopback-http.js";
import { desktopToolDeclarations, desktopCustomTool, type DesktopCompanyToolSchema } from "./desktop-tool-policy.js";

export type AIOperation =
  | "responses"
  | "responses.input_tokens"
  | "images.generate"
  | "images.edit"
  | "videos.create"
  | "videos.retrieve"
  | "videos.lookup"
  | "videos.cancel"
  | "videos.content";
export interface VideoRequestResource {
  videoId?: string;
  operationId?: string;
}
export interface AIRequestIdentity {
  taskId: string;
  tenantId?: string;
  projectId?: string;
  actorId?: string;
  capabilityVersionId?: string;
  attempt?: number;
  fencingToken?: string;
}
export interface AIRequestInfo extends AIRequestIdentity {
  requestId: string;
  operation: AIOperation;
  model: string;
  requestBytes: number;
  requestHash: string;
  generationOperationId?: string;
  generationHash?: string;
  inputCountId?: string;
  maxOutputTokens?: number;
}
export interface AIRequestAuthority extends AIRequestIdentity {
  budgeted?: true;
  authorize(request: AIRequestInfo): Promise<AIRequestPermit | void>;
}
export type AIRequestOutcome =
  | {
      state: "completed";
      inputTokens?: number;
      outputTokens?: number;
      imageUnits?: 1;
      countedInputTokens?: number;
      httpStatus?: number;
    }
  | { state: "unknown" | "cancelled"; code: string; httpStatus?: number };
export interface AIRequestPermit {
  readonly requestId?: string;
  dispatch(): Promise<void>;
  finish(outcome: AIRequestOutcome): Promise<void>;
}
const requestPermits = new WeakMap<Response, AIRequestPermit>();
/** Only a validated complete response may release a dispatched provider slot. */
export async function finishInternalAIRequest(
  response: Response | undefined,
  outcome: AIRequestOutcome,
) {
  if (response) await requestPermits.get(response)?.finish(outcome);
}
interface ToolPolicyFacts {
  tool_count: number;
  registered_tool_count: number;
  namespace_present: boolean;
  builtin_tools: string[];
}
export class AIRequestFailure extends Error {
  toolPolicy?: ToolPolicyFacts;
  retryAfterSeconds?: number;
  constructor(
    public code: string,
    public status: number,
    public dispatched = false,
  ) {
    super(code);
  }
}
const denied = (code: string, status = 400) =>
  new AIRequestFailure(code, status);

function endpoint(c: Config, operation: AIOperation, resource?: VideoRequestResource) {
  if (!c.AI_BASE_URL || !c.AI_API_KEY) throw denied("AI_SETUP_REQUIRED", 503);
  const u = new URL(c.AI_BASE_URL);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    (c.NODE_ENV === "production" && u.protocol !== "https:") ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !c.AI_ALLOWED_HOSTS.split(",")
      .map((v) => v.trim())
      .includes(u.hostname)
  )
    throw denied("AI_GATEWAY_NOT_ALLOWED", 403);
  const suffixes: Partial<Record<AIOperation, string>> = {
    responses: "/responses",
    "responses.input_tokens": "/responses/input_tokens",
    "images.generate": "/images/generations",
    "images.edit": "/images/edits",
    "videos.create": "/videos",
  };
  let suffix = suffixes[operation];
  if (operation.startsWith("videos.")) {
    if (!["videos.create", "videos.retrieve", "videos.lookup", "videos.cancel", "videos.content"].includes(operation))
      throw denied("AI_OPERATION_NOT_ALLOWED", 403);
    if (operation === "videos.create") {
      if (resource && Object.keys(resource).length) throw denied("AI_VIDEO_SCOPE_INVALID");
    } else if (operation === "videos.lookup") {
      if (!resource || Object.keys(resource).some((key) => key !== "operationId")
        || !/^[a-zA-Z0-9_:-]{16,128}$/.test(resource.operationId ?? ""))
        throw denied("AI_VIDEO_SCOPE_INVALID");
      // This route is a versioned company extension, not a public OpenAI API.
      suffix = "/videos/operations/" + encodeURIComponent(resource.operationId!);
    } else {
      if (!resource || Object.keys(resource).some((key) => key !== "videoId")
        || !/^[a-zA-Z0-9_-]{1,160}$/.test(resource.videoId ?? ""))
        throw denied("AI_VIDEO_SCOPE_INVALID");
      suffix = "/videos/" + encodeURIComponent(resource.videoId!)
        + (operation === "videos.content" ? "/content" : operation === "videos.cancel" ? "/cancel" : "");
    }
  } else if (resource !== undefined) throw denied("AI_VIDEO_SCOPE_INVALID");
  if (!suffix) throw denied("AI_OPERATION_NOT_ALLOWED", 403);
  return c.AI_BASE_URL.replace(/\/$/, "") + suffix;
}

function videoFields(body: Record<string, unknown>, model: string) {
  if (Object.keys(body).some((key) => !["model", "prompt", "size", "seconds"].includes(key))
    || body.model !== model || typeof body.prompt !== "string" || !body.prompt.trim()
    || body.prompt.length > 12000 || !["720x1280", "1280x720", "1024x1024"].includes(String(body.size))
    || !["4", "8", "12", "16", "20"].includes(String(body.seconds)))
    throw denied("AI_VIDEO_SPECIFICATION_CHANGED");
}

function imageFields(body: Record<string, unknown>, model: string) {
  const names = ["model", "prompt", "n", "size", "quality", "output_format"];
  if (
    Object.keys(body).some((k) => !names.includes(k)) ||
    body.model !== model ||
    typeof body.prompt !== "string" ||
    !body.prompt.length ||
    body.prompt.length > 12000 ||
    body.n !== 1 ||
    body.size !== "1024x1024" ||
    body.quality !== "high" ||
    body.output_format !== "png"
  )
    throw denied("AI_IMAGE_SPECIFICATION_CHANGED");
}

function responseFields(
  c: Config,
  body: Record<string, unknown>,
  model: string,
  effort: string | undefined,
  tools: readonly string[],
  stripKernelQuestionTool: boolean,
  nativeDesktop = false,
  nativeCompanyTools: readonly DesktopCompanyToolSchema[] = [],
) {
  const reasoning = body.reasoning as Record<string, unknown> | undefined;
  if (
    body.model !== model ||
    !reasoning ||
    reasoning.effort !== effort ||
    (reasoning.mode !== undefined && reasoning.mode !== "standard")
  )
    throw denied("AI_MODEL_SELECTION_CHANGED");
  if (
    body.stream !== true ||
    (body.background !== undefined && body.background !== false) ||
    body.previous_response_id != null ||
    body.conversation != null ||
    ["base_url", "api_key", "endpoint", "provider", "headers"].some(
      (k) => k in body,
    )
  )
    throw denied("AI_PROTOCOL_NOT_ALLOWED");
  if (body.tools !== undefined && !Array.isArray(body.tools))
    throw denied("AI_TOOL_NOT_ALLOWED");
  // This pinned Codex always declares a question control tool even when no
  // interactive client is attached. It is not a business capability. Remove
  // this one known declaration; all other unregistered tools are rejected.
  const declaredTools = ((body.tools ?? []) as any[]).filter(
    (tool) =>
      !(
        !nativeDesktop && stripKernelQuestionTool &&
        tool?.type === "function" &&
        tool.name === "request_user_input"
      ),
  );
  if (nativeDesktop && !desktopToolDeclarations(declaredTools, nativeCompanyTools)) throw denied("AI_DESKTOP_TOOL_NOT_ALLOWED");
  for (const tool of declaredTools) {
    if (nativeDesktop) continue;
    if (!tool || tool.type !== "function" || !tools.includes(tool.name)) {
      const failure = denied("AI_TOOL_NOT_ALLOWED");
      // Fixed builtin labels and counts only; never model-supplied names,
      // descriptions, arguments or the complete provider payload.
      const declared = body.tools as any[];
      const builtins = [
        "update_plan",
        "request_user_input",
        "view_image",
        "apply_patch",
        "exec_command",
        "shell_command",
        "write_stdin",
        "sleep",
        "curr_time",
      ];
      failure.toolPolicy = {
        tool_count: declared.length,
        registered_tool_count: declared.filter(
          (t) => t?.type === "function" && tools.includes(t.name),
        ).length,
        namespace_present: declared.some((t) => t?.type === "namespace"),
        builtin_tools: builtins.filter((name) =>
          declared.some((t) => t?.name === name),
        ),
      };
      throw failure;
    }
  }
  if (
    body.max_output_tokens !== undefined &&
    (!Number.isSafeInteger(body.max_output_tokens) ||
      Number(body.max_output_tokens) < 16 ||
      Number(body.max_output_tokens) > c.AI_MAX_OUTPUT_TOKENS)
  )
    throw denied("AI_OUTPUT_LIMIT_EXCEEDED");
  // A platform ceiling is explicit and applies to reasoning and visible output.
  // It does not substitute another model or another reasoning effort.
  return {
    ...body,
    tools: declaredTools,
    max_output_tokens: body.max_output_tokens ?? c.AI_MAX_OUTPUT_TOKENS,
  };
}

export interface InternalAIRequest {
  operation: AIOperation;
  model: string;
  reasoningEffort?: string;
  tools?: readonly string[];
  body: Record<string, unknown> | FormData;
  /** Validated resource identifiers only; callers cannot supply an endpoint. */
  videoResource?: VideoRequestResource;
  authority: AIRequestAuthority;
  signal: AbortSignal;
  operationId?: string;
  generationOperationId?: string;
  generationHash?: string;
  onDispatch?(): void;
  stripKernelQuestionTool?: boolean;
  /** Trusted server placement, never selected by a provider payload. */
  nativeDesktop?: boolean;
  nativeCompanyTools?: readonly DesktopCompanyToolSchema[];
}

/** The only provider fetch entry point: no caller-supplied URL or headers. */
export async function internalAIRequest(c: Config, request: InternalAIRequest) {
  const url = endpoint(c, request.operation, request.videoResource);
  const video = request.operation.startsWith("videos.");
  if (video && (!request.model.trim() || request.model.length > 200)) throw denied("AI_VIDEO_SPECIFICATION_CHANGED");
  const method = ["videos.retrieve", "videos.lookup", "videos.content"].includes(request.operation) ? "GET" : "POST";
  let normalized: Record<string, unknown> | undefined;
  let bytes: Buffer, contentType: string;
  if (request.body instanceof FormData) {
    if (request.operation !== "images.edit" && request.operation !== "videos.create")
      throw denied("AI_PROTOCOL_NOT_ALLOWED");
    const fields: Record<string, unknown> = {};
    let image: Blob | undefined;
    for (const [name, value] of request.body.entries()) {
      if (name === (video ? "input_reference" : "image") && value instanceof Blob && !image) image = value;
      else if (typeof value === "string" && !(name in fields))
        fields[name] = name === "n" && value === "1" ? 1 : value;
      else throw denied("AI_IMAGE_SPECIFICATION_CHANGED");
    }
    if (video) videoFields(fields, request.model);
    else imageFields(fields, request.model);
    if (
      (!video && !image) || (image && ((video && !image.size) || image.size > 10_000_000 ||
      !(video ? ["image/png", "image/jpeg"] : ["image/png", "image/jpeg", "image/webp"]).includes(image.type)))
    )
      throw denied(video ? "AI_VIDEO_SPECIFICATION_CHANGED" : "AI_IMAGE_SPECIFICATION_CHANGED");
    const encoded = new Response(request.body);
    contentType = encoded.headers.get("content-type")!;
    bytes = Buffer.from(await encoded.arrayBuffer());
  } else {
    if (request.operation === "images.edit" || request.operation === "videos.create")
      throw denied("AI_PROTOCOL_NOT_ALLOWED");
    if (video && Object.keys(request.body).length) throw denied("AI_VIDEO_SPECIFICATION_CHANGED");
    const body =
      request.operation === "responses"
        ? responseFields(
            c,
            request.body,
            request.model,
            request.reasoningEffort,
            request.tools ?? [],
            request.stripKernelQuestionTool ?? false,
            request.nativeDesktop ?? false,
            request.nativeCompanyTools ?? [],
          )
        : request.operation === "responses.input_tokens"
          ? request.body
          : video ? request.body : (imageFields(request.body, request.model), request.body);
    normalized = body;
    bytes = Buffer.from(JSON.stringify(body));
    contentType = "application/json";
  }
  if (bytes.length > c.AI_MAX_REQUEST_BYTES)
    throw denied("AI_REQUEST_TOO_LARGE", 413);
  const { authorize, budgeted, ...identity } = request.authority;
  const info: AIRequestInfo = {
    ...identity,
    requestId: request.operationId ?? randomUUID(),
    operation: request.operation,
    model: request.model,
    requestBytes: bytes.length,
    requestHash: video ? hash(Buffer.concat([Buffer.from(JSON.stringify({ operation: request.operation, resource: request.videoResource ?? {} })), bytes])) : hash(bytes),
    generationOperationId: request.generationOperationId,
    generationHash: request.generationHash,
  };
  if (request.operation === "responses.input_tokens") {
    if (
      !budgeted ||
      !info.generationOperationId ||
      !info.generationHash ||
      normalized?.model !== request.model
    )
      throw denied("AI_INPUT_COUNT_SCOPE_INVALID", 403);
  }
  if (budgeted && request.operation === "responses") {
    // Count the exact normalized context, including tools, instructions and
    // structured output. Generation-only transport parameters are excluded.
    const countFields = new Set([
      "conversation",
      "input",
      "instructions",
      "model",
      "parallel_tool_calls",
      "personality",
      "previous_response_id",
      "reasoning",
      "text",
      "tool_choice",
      "tools",
      "truncation",
    ]);
    const generationFields = new Set([
      "stream",
      "stream_options",
      "background",
      "store",
      "metadata",
      "client_metadata",
      "include",
      "service_tier",
      "prompt_cache_key",
      "prompt_cache_retention",
      "safety_identifier",
      "user",
      "temperature",
      "top_p",
      "top_logprobs",
      "max_tool_calls",
      "max_output_tokens",
    ]);
    if (
      Object.keys(normalized!).some(
        (key) => !countFields.has(key) && !generationFields.has(key),
      )
    )
      throw denied("AI_INPUT_COUNT_CONTEXT_UNSUPPORTED", 403);
    const countResponse = await internalAIRequest(c, {
      operation: "responses.input_tokens",
      model: request.model,
      body: Object.fromEntries(
        Object.entries(normalized!).filter(([key]) => countFields.has(key)),
      ),
      authority: request.authority,
      signal: request.signal,
      generationOperationId: info.requestId,
      generationHash: info.requestHash,
    });
    try {
      if (!countResponse.ok)
        throw new AIRequestFailure("AI_INPUT_COUNT_FAILED", 502, true);
      const count = await countResponse.json();
      if (
        count?.object !== "response.input_tokens" ||
        !Number.isSafeInteger(count.input_tokens) ||
        count.input_tokens < 0
      )
        throw new AIRequestFailure("AI_INPUT_COUNT_INVALID", 502, true);
      const proof = requestPermits.get(countResponse)?.requestId;
      if (!proof)
        throw new AIRequestFailure("AI_INPUT_COUNT_PERMIT_MISSING", 502, true);
      await finishInternalAIRequest(countResponse, {
        state: "completed",
        countedInputTokens: count.input_tokens,
        httpStatus: countResponse.status,
      });
      info.inputCountId = proof;
      info.maxOutputTokens = Number(normalized!.max_output_tokens);
    } catch (error) {
      await countResponse.body?.cancel().catch(() => {});
      await finishInternalAIRequest(countResponse, {
        state: "unknown",
        code: "AI_INPUT_COUNT_FAILED",
        httpStatus: countResponse.status,
      });
      if (error instanceof AIRequestFailure) throw error;
      throw new AIRequestFailure("AI_INPUT_COUNT_INVALID", 502, true);
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    Authorization: `Bearer ${c.AI_API_KEY}`,
    "Idempotency-Key": info.requestId,
    "X-CopyPaste-Operation-Id": info.requestId,
    "X-CopyPaste-Data-Mode": c.DEMO_MODE ? "simulated" : "configured_services",
  };
  for (const [key, value] of Object.entries({
    "X-CopyPaste-Task-Id": info.taskId,
    "X-CopyPaste-Tenant-Id": info.tenantId,
    "X-CopyPaste-Project-Id": info.projectId,
    "X-CopyPaste-Actor-Id": info.actorId,
    "X-CopyPaste-Capability-Version-Id": info.capabilityVersionId,
    "X-CopyPaste-Attempt": info.attempt,
    "X-CopyPaste-Fencing-Token": info.fencingToken,
  })) {
    if (value === undefined) continue;
    if (!/^[a-zA-Z0-9_:-]{1,200}$/.test(String(value)))
      throw denied("AI_REQUEST_SCOPE_INVALID", 403);
    headers[key] = String(value);
  }
  if (!/^[\w:-]{16,128}$/.test(info.requestId))
    throw denied("AI_REQUEST_SCOPE_INVALID", 403);
  if (request.signal.aborted) throw denied("AI_REQUEST_CANCELLED", 409);
  let permit: AIRequestPermit | void;
  try {
    permit = await authorize(info);
    if (budgeted && !permit)
      throw denied("AI_REQUEST_BUDGET_PERMIT_REQUIRED", 403);
  } catch (error) {
    if (error instanceof AIRequestFailure) throw error;
    throw denied("AI_REQUEST_AUTHORIZATION_CHANGED", 403);
  }
  if (request.signal.aborted) {
    await permit?.finish({
      state: "cancelled",
      code: "CANCELLED_BEFORE_DISPATCH",
    });
    throw denied("AI_REQUEST_CANCELLED", 409);
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  let fetchInvoked = false,
    httpStatus: number | undefined;
  const observeAbort = () => {
    clear();
    void permit
      ?.finish({
        state: fetchInvoked ? "unknown" : "cancelled",
        code: "AI_REQUEST_ABORTED",
        httpStatus,
      })
      .catch(() => {});
  };
  const total = setTimeout(() => controller.abort(), c.AI_REQUEST_TIMEOUT_MS);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idle) clearTimeout(idle);
    if (signal.aborted) return;
    idle = setTimeout(() => controller.abort(), c.AI_STREAM_IDLE_TIMEOUT_MS);
  };
  const clear = () => {
    clearTimeout(total);
    if (idle) clearTimeout(idle);
    signal.removeEventListener("abort", observeAbort);
  };
  // A consumer may have stopped reading with a queued response chunk. Abort
  // must release timers even when no further stream pull or cancel happens.
  signal.addEventListener("abort", observeAbort, { once: true });
  try {
    await permit?.dispatch();
    if (signal.aborted) throw denied("AI_REQUEST_CANCELLED", 409);
    fetchInvoked = true;
    request.onDispatch?.();
    const response = await fetch(url, {
      method,
      headers,
      ...(method === "POST" ? { body: new Uint8Array(bytes) } : {}),
      redirect: "error",
      signal,
    });
    httpStatus = response.status;
    if (
      Number(response.headers.get("content-length")) > c.AI_MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel();
      throw new AIRequestFailure("AI_RESPONSE_TOO_LARGE", 502, true);
    }
    if (!response.body) {
      clear();
      if (permit) requestPermits.set(response, permit);
      return response;
    }
    const reader = response.body.getReader();
    let received = 0;
    resetIdle();
    const bounded = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const part = await reader.read();
          if (signal.aborted)
            throw new AIRequestFailure("AI_STREAM_INTERRUPTED", 502, true);
          if (part.done) {
            clear();
            out.close();
            return;
          }
          received += part.value.byteLength;
          if (received > c.AI_MAX_RESPONSE_BYTES)
            throw new AIRequestFailure("AI_RESPONSE_TOO_LARGE", 502, true);
          resetIdle();
          out.enqueue(part.value);
        } catch (error) {
          clear();
          controller.abort();
          await reader.cancel().catch(() => {});
          await permit
            ?.finish({
              state: "unknown",
              code: "AI_STREAM_INTERRUPTED",
              httpStatus,
            })
            .catch(() => {});
          out.error(
            error instanceof AIRequestFailure
              ? error
              : new AIRequestFailure("AI_STREAM_INTERRUPTED", 502, true),
          );
        }
      },
      async cancel() {
        clear();
        controller.abort();
        await reader.cancel().catch(() => {});
        await permit
          ?.finish({
            state: "unknown",
            code: "AI_RESPONSE_CANCELLED",
            httpStatus,
          })
          .catch(() => {});
      },
    });
    const exposed = new Response(bounded, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    if (permit) requestPermits.set(exposed, permit);
    return exposed;
  } catch (error) {
    clear();
    controller.abort();
    await permit
      ?.finish({
        state: fetchInvoked ? "unknown" : "cancelled",
        code:
          error instanceof AIRequestFailure
            ? error.code
            : "AI_GATEWAY_REQUEST_FAILED",
        httpStatus,
      })
      .catch(() => {});
    if (error instanceof AIRequestFailure) throw error;
    throw new AIRequestFailure(
      fetchInvoked
        ? "AI_UPSTREAM_UNCERTAIN"
        : "AI_REQUEST_AUTHORIZATION_CHANGED",
      fetchInvoked ? 502 : 403,
      fetchInvoked,
    );
  }
}

/** One opaque, expiring capability for one native turn. Never exposes the master key. */
export async function startScopedInferenceGateway(
  c: Config,
  options: {
    model: string;
    reasoningEffort: string;
    tools: readonly string[];
    authority: AIRequestAuthority;
    signal: AbortSignal;
    nativeDesktop?: boolean;
    nativeCompanyTools?: readonly DesktopCompanyToolSchema[];
    onRejected?(event: {
      code: string;
      dispatched: boolean;
      tool_policy?: ToolPolicyFacts;
    }): Promise<void>;
  },
) {
  endpoint(c, "responses");
  const secret = randomBytes(32).toString("hex"),
    grant = randomUUID();
  const expected = Buffer.from(`Bearer ${secret}`);
  const stop = new AbortController(),
    expires = Date.now() + c.AI_SCOPE_TTL_MS;
  let busy = false,
    poisoned = false,
    forwarded = 0,
    closed = false,
    measured = 0,
    inputTokens = 0,
    outputTokens = 0;
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const json = (status: number, code: string) => {
      if (!res.headersSent)
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      res.end(JSON.stringify({ error: { code, message: code } }));
    };
    const presented = Buffer.from(String(req.headers.authorization ?? ""));
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    )
      return json(401, "AI_SCOPED_CREDENTIAL_REQUIRED");
    if (closed || poisoned || Date.now() >= expires || options.signal.aborted)
      return json(403, "AI_SCOPED_CREDENTIAL_EXPIRED");
    if (req.method !== "POST" || req.url !== `/run/${grant}/v1/responses`)
      return json(403, "AI_OPERATION_NOT_ALLOWED");
    if (
      req.headers.origin ||
      !/^application\/json(?:\s*;|$)/i.test(
        String(req.headers["content-type"] ?? ""),
      )
    )
      return json(415, "AI_PROTOCOL_NOT_ALLOWED");
    if (Number(req.headers["content-length"]) > c.AI_MAX_REQUEST_BYTES) {
      req.resume();
      return json(413, "AI_REQUEST_TOO_LARGE");
    }
    if (busy || forwarded >= c.AI_MAX_REQUESTS_PER_TURN)
      return json(429, "AI_SCOPED_REQUEST_LIMIT");
    busy = true;
    let dispatched = false;
    let upstream: Response | undefined;
    const disconnected = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) disconnected.abort();
    });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of req.iterator({ destroyOnReturn: false })) {
        size += part.length;
        if (size > c.AI_MAX_REQUEST_BYTES)
          throw denied("AI_REQUEST_TOO_LARGE", 413);
        chunks.push(Buffer.from(part));
      }
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw denied("AI_INVALID_JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw denied("AI_INVALID_JSON");
      const response = (upstream = await internalAIRequest(c, {
        operation: "responses",
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        tools: options.tools,
        stripKernelQuestionTool: true,
        nativeDesktop: options.nativeDesktop,
        nativeCompanyTools: options.nativeCompanyTools,
        authority: options.authority,
        body,
        signal: AbortSignal.any([
          options.signal,
          stop.signal,
          disconnected.signal,
        ]),
        onDispatch: () => {
          dispatched = true;
          forwarded++;
        },
      }));
      if (
        response.ok &&
        !/^text\/event-stream(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel().catch(() => {});
        throw new AIRequestFailure("AI_RESPONSE_PROTOCOL_INVALID", 502, true);
      }
      // Delay transmission until the first complete, validated frame. A bad
      // first event must still receive a structured 502 instead of a reset.
      res.statusCode = response.status;
      for (const [name, value] of Object.entries({
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        ...(response.headers.has("retry-after")
          ? { "Retry-After": response.headers.get("retry-after")! }
          : {}),
      }))
        res.setHeader(name, value);
      let terminal = false,
        usageKnown = false,
        pending = "",
        frameBytes = 0,
        measuredInput = 0,
        measuredOutput = 0;
      let frameLines: string[] = [];
      const terminalFrames: Buffer[] = [];
      let terminalBytes = 0;
      const knownCalls = new Set<string>();
      const inspectItem = (item: any) => {
        if (!item) return;
        if (
          (item.type === "function_call" || (options.nativeDesktop && item.type === "custom_tool_call" && desktopCustomTool(item.name))) &&
          options.tools.includes(options.nativeDesktop && item.namespace ? item.namespace + "." + item.name : item.name)
        ) {
          if (typeof item.id === "string") knownCalls.add(item.id);
          return;
        }
        if (!["message", "reasoning"].includes(item.type))
          throw new AIRequestFailure("AI_TOOL_CALL_NOT_ALLOWED", 502, true);
      };
      const inspectFrame = (wire: Buffer) => {
        const data = wire
          .toString("utf8")
          .split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data || data === "[DONE]") return;
        if (terminal)
          throw new AIRequestFailure("AI_RESPONSE_PROTOCOL_INVALID", 502, true);
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          throw new AIRequestFailure("AI_RESPONSE_PROTOCOL_INVALID", 502, true);
        }
        inspectItem(event.item);
        if (event.response?.output !== undefined) {
          if (!Array.isArray(event.response.output))
            throw new AIRequestFailure(
              "AI_RESPONSE_PROTOCOL_INVALID",
              502,
              true,
            );
          for (const item of event.response.output) inspectItem(item);
        }
        if (
          typeof event.type === "string" &&
          /^response\.(?:custom_tool|web_search|file_search|computer|image_generation|code_interpreter|tool_search|shell|apply_patch)_call/.test(
            event.type,
          ) && !(options.nativeDesktop && event.type.startsWith("response.custom_tool_call_input.") && knownCalls.has(event.item_id))
        )
          throw new AIRequestFailure("AI_TOOL_CALL_NOT_ALLOWED", 502, true);
        if (
          typeof event.type === "string" &&
          event.type.startsWith("response.function_call_arguments.") &&
          !knownCalls.has(event.item_id)
        )
          throw new AIRequestFailure("AI_TOOL_CALL_NOT_ALLOWED", 502, true);
        if (
          [
            "response.completed",
            "response.failed",
            "response.incomplete",
          ].includes(event.type)
        ) {
          terminal = true;
          const usage = event.response?.usage;
          usageKnown = [usage?.input_tokens, usage?.output_tokens].every(
            (value) => Number.isSafeInteger(value) && value >= 0,
          );
          if (usageKnown) {
            measuredInput = usage.input_tokens;
            measuredOutput = usage.output_tokens;
          }
        }
      };
      const write = async (bytes: Uint8Array) => {
        if (!res.write(bytes))
          await once(res, "drain", { signal: disconnected.signal });
      };
      const forwardFrames = async (final = false) => {
        // Latin-1 gives one character per byte, preserving the original UTF-8
        // and line endings. No tool event is exposed before its complete frame
        // has been checked, including across network-chunk boundaries.
        const lines = final
          ? /([^\r\n]*)(\r\n|\r|\n)/g
          : /([^\r\n]*)(\r\n|\n|\r(?!$))/g;
        let match: RegExpExecArray | null,
          consumed = 0;
        while ((match = lines.exec(pending))) {
          frameLines.push(match[0]);
          frameBytes += match[0].length;
          consumed = lines.lastIndex;
          if (frameBytes > c.AI_MAX_REQUEST_BYTES)
            throw new AIRequestFailure(
              "AI_RESPONSE_EVENT_TOO_LARGE",
              502,
              true,
            );
          if (match[1] === "") {
            const frame = Buffer.from(frameLines.join(""), "latin1");
            inspectFrame(frame);
            if (terminal) {
              // The kernel may start its next response as soon as it sees a
              // terminal event. Persist usage before exposing that handoff.
              terminalBytes += frame.length;
              if (terminalBytes > c.AI_MAX_REQUEST_BYTES)
                throw new AIRequestFailure(
                  "AI_RESPONSE_EVENT_TOO_LARGE",
                  502,
                  true,
                );
              terminalFrames.push(frame);
            } else await write(frame);
            frameLines = [];
            frameBytes = 0;
          }
        }
        pending = pending.slice(consumed);
        if (frameBytes + pending.length > c.AI_MAX_REQUEST_BYTES)
          throw new AIRequestFailure("AI_RESPONSE_EVENT_TOO_LARGE", 502, true);
      };
      const reader = response.body?.getReader();
      try {
        if (reader)
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            if (response.ok) {
              pending += Buffer.from(part.value).toString("latin1");
              await forwardFrames();
            } else await write(part.value);
          }
        if (response.ok) {
          await forwardFrames(true);
          if (pending.length || frameLines.length)
            throw new AIRequestFailure("AI_STREAM_INCOMPLETE", 502, true);
        }
      } finally {
        await reader?.cancel().catch(() => {});
      }
      if (response.status >= 500 || (response.ok && (!terminal || !usageKnown)))
        poisoned = true;
      if (response.ok && terminal && usageKnown) {
        await finishInternalAIRequest(response, {
          state: "completed",
          inputTokens: measuredInput,
          outputTokens: measuredOutput,
          httpStatus: response.status,
        });
        measured++;
        inputTokens += measuredInput;
        outputTokens += measuredOutput;
      } else
        await finishInternalAIRequest(response, {
          state: "unknown",
          code: "AI_RESPONSE_TERMINATION_UNKNOWN",
          httpStatus: response.status,
        });
      // One synchronous end leaves no asynchronous busy interval after the
      // terminal bytes become visible. Buffering is bounded above.
      res.end(Buffer.concat(terminalFrames));
    } catch (error) {
      req.resume();
      await finishInternalAIRequest(upstream, {
        state: "unknown",
        code:
          error instanceof AIRequestFailure ? error.code : "AI_GATEWAY_FAILED",
        httpStatus: upstream?.status,
      }).catch(() => {});
      if (dispatched) poisoned = true;
      await options
        .onRejected?.({
          code:
            error instanceof AIRequestFailure
              ? error.code
              : "AI_GATEWAY_FAILED",
          dispatched,
          ...(error instanceof AIRequestFailure && error.toolPolicy
            ? { tool_policy: error.toolPolicy }
            : {}),
        })
        .catch(() => {});
      if (!res.headersSent) {
        if (error instanceof AIRequestFailure && error.retryAfterSeconds)
          res.setHeader("Retry-After", String(error.retryAfterSeconds));
        json(
          error instanceof AIRequestFailure ? error.status : 502,
          error instanceof AIRequestFailure ? error.code : "AI_GATEWAY_FAILED",
        );
      } else res.destroy();
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = c.AI_REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(30000, c.AI_REQUEST_TIMEOUT_MS);
  const port = await listenLoopbackHTTP(server);
  const timer = setTimeout(() => stop.abort(), c.AI_SCOPE_TTL_MS);
  timer.unref();
  return {
    baseURL: `http://127.0.0.1:${port}/run/${grant}/v1`,
    credential: secret,
    get forwardedRequests() {
      return forwarded;
    },
    get measuredUsage() {
      return {
        allResponsesKnown:
          !busy &&
          forwarded > 0 &&
          measured === forwarded &&
          Number.isSafeInteger(inputTokens) &&
          Number.isSafeInteger(outputTokens),
        responses: measured,
        inputTokens,
        outputTokens,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      stop.abort();
      server.closeAllConnections();
      // An already closed server has no remaining grant to revoke.
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
