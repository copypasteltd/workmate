import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { canonical, hash, Problem } from "./lib.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import { CodexRuntimeAdapter, RuntimeFailure } from "./runtime.js";
import { tokenCharge } from "./billing.js";
import { removeOwnedUUIDDirectory } from "./owned-directory-cleanup.js";
import { validateVerificationPNG } from "./png-validation.js";

const rate = z.number().int().nonnegative().safe().max(1e12);
const common = {
  kernel: z.literal("codex"),
  gateway_policy: z.literal("company_internal_only"),
  model_alias: z.string().trim().min(1).max(200),
};
export const capabilityDocument = z.discriminatedUnion("profile_key", [
  z
    .object({
      ...common,
      profile_key: z.literal("internal-text-v1"),
      reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
      rates: z.tuple([rate, rate]),
    })
    .strict(),
  z
    .object({
      ...common,
      profile_key: z.literal("internal-image2-v1"),
      reasoning_effort: z.null(),
      rates: z.tuple([rate.positive()]),
    })
    .strict(),
]);
export function capabilityBody(
  c: Config,
  document: z.infer<typeof capabilityDocument>,
) {
  const text = document.profile_key === "internal-text-v1";
  return {
    profile_key: document.profile_key,
    model_alias: document.model_alias,
    ready: true,
    rates: document.rates,
    schema_version: 2,
    wire_protocol: text ? "responses" : "images",
    reasoning_effort: document.reasoning_effort,
    supported_operations: text
      ? ["responses"]
      : ["images.generate", "images.edit"],
    limits: text
      ? { max_prompt_chars: 60000 }
      : {
          max_prompt_chars: 12000,
          size: "1024x1024",
          quality: "high",
          output_format: "png",
        },
    gateway_policy: "company_internal_only",
    gateway_fingerprint: gatewayFingerprint(c),
    data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
  };
}
export async function codexBinaryHash(c: Config) {
  if (!path.isAbsolute(c.CODEX_BIN))
    throw new Problem(
      409,
      "CODEX_BINARY_PIN_REQUIRED",
      "Configure an absolute, pinned Codex executable before verification",
    );
  return hash(await readFile(c.CODEX_BIN));
}
export async function verifyCapability(
  c: Config,
  document: z.infer<typeof capabilityDocument>,
  validationId: string,
  signal: AbortSignal,
) {
  if (!c.AI_BASE_URL || !c.AI_API_KEY)
    throw new Problem(
      409,
      "AI_SETUP_REQUIRED",
      "Configure the internal server gateway before verification",
    );
  const body = capabilityBody(c, document),
    binaryHash = await codexBinaryHash(c),
    evidence: any = {
      definition_hash: hash(canonical(document)),
      gateway_fingerprint: gatewayFingerprint(c),
      data_mode: body.data_mode,
      codex_version: c.CODEX_VERSION,
      codex_binary_sha256: binaryHash,
      model_alias: document.model_alias,
      reasoning_effort: document.reasoning_effort,
      supported_operations: body.supported_operations,
      input_tokens: 0,
      output_tokens: 0,
      known_cost_micros: "0",
      accepted: false,
      usage_known: true,
      checks: [],
    };
  let state: "passed" | "failed" | "reconciling" = "failed";
  try {
    await new CodexRuntimeAdapter(c).version();
    if (document.profile_key === "internal-text-v1") {
      const nonce = randomUUID(),
        workspace = path.resolve(
          c.DATA_DIR,
          "capability-verification",
          validationId,
        );
      let toolCalls = 0;
      await mkdir(workspace, { recursive: true });
      try {
        const result = await new CodexRuntimeAdapter({
          ...c,
          AI_MODEL: document.model_alias,
          AI_REASONING_EFFORT: document.reasoning_effort,
          AI_VERIFIED: true,
          AI_INPUT_HKD_MICROS_PER_MILLION: document.rates[0],
          AI_OUTPUT_HKD_MICROS_PER_MILLION: document.rates[1],
        }).start({
          taskId: validationId,
          workspace,
          prompt: `Call capability_probe once with nonce ${nonce}, then summarize its returned result in one sentence. This is an internal protocol verification.`,
          skills: [],
          signal,
          onEvent: async () => {},
          tools: [
            {
              name: "capability_probe",
              description:
                "Return a fixed protocol-verification receipt. Call exactly once.",
              inputSchema: {
                type: "object",
                properties: { nonce: { type: "string", enum: [nonce] } },
                required: ["nonce"],
                additionalProperties: false,
              },
              run: async (args) => {
                z.object({ nonce: z.literal(nonce) })
                  .strict()
                  .parse(args);
                if (++toolCalls > 1)
                  throw new Error("Probe was called repeatedly");
                return { nonce, result: 5 };
              },
            },
          ],
        });
        evidence.accepted = result.accepted;
        evidence.usage_known = result.usageKnown;
        evidence.input_tokens = result.inputTokens;
        evidence.output_tokens = result.outputTokens;
        if (result.usageKnown)
          evidence.known_cost_micros = String(
            tokenCharge(
              result.inputTokens,
              result.outputTokens,
              ...document.rates,
            ),
          );
        if (
          result.status !== "completed" ||
          !result.usageKnown ||
          !result.text.trim() ||
          toolCalls !== 1
        )
          throw new Error("Protocol or usage verification incomplete");
        evidence.checks = [
          "pinned_codex",
          "requested_model_and_effort",
          "tool_call_and_result",
          "completed_output",
          "known_usage",
        ];
      } finally {
        const resolved = path.resolve(workspace),
          parent = path.resolve(c.DATA_DIR, "capability-verification");
        if (
          path.dirname(resolved) === parent &&
          path.basename(resolved) === validationId
        )
          try {
            await removeOwnedUUIDDirectory(parent, validationId, {
              retry: false,
            });
            evidence.workspace_cleanup_completed = true;
          } catch (cleanupError: any) {
            evidence.workspace_cleanup_completed = false;
            evidence.workspace_cleanup_error_code = [
              "EBUSY",
              "EPERM",
              "ENOTEMPTY",
              "EACCES",
            ].includes(cleanupError.code)
              ? cleanupError.code
              : "CLEANUP_FAILED";
            // Finalization durably queues reclamation. This records the
            // actual cleanup attempt without discarding completed protocol
            // checks or measured usage because of a Windows filesystem lock.
          }
      }
    } else {
      const pngs: Buffer[] = [];
      for (const operation of ["generate", "edit"]) {
        const form = new FormData();
        if (operation === "edit") {
          form.append("model", document.model_alias);
          form.append(
            "prompt",
            "Preserve the square layout and add one small blue square.",
          );
          form.append("n", "1");
          form.append("size", "1024x1024");
          form.append("quality", "high");
          form.append("output_format", "png");
          form.append(
            "image",
            new Blob([new Uint8Array(pngs[0])], { type: "image/png" }),
            "verification.png",
          );
        }
        evidence.accepted = true;
        evidence.usage_known = false;
        const response = await fetch(
          c.AI_BASE_URL.replace(/\/$/, "") +
            (operation === "edit" ? "/images/edits" : "/images/generations"),
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              Authorization: `Bearer ${c.AI_API_KEY}`,
              "Idempotency-Key": `${validationId}:${operation}`,
              ...(operation === "generate"
                ? { "Content-Type": "application/json" }
                : {}),
            },
            body:
              operation === "edit"
                ? form
                : JSON.stringify({
                    model: document.model_alias,
                    prompt:
                      "A square blue paper shape on a plain light background. Internal protocol verification.",
                    n: 1,
                    size: "1024x1024",
                    quality: "high",
                    output_format: "png",
                  }),
          },
        );
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500)
            evidence.usage_known = true;
          throw new Error("Image gateway rejected verification");
        }
        const declared = Number(response.headers.get("content-length"));
        if (declared > 70_000_000)
          throw new Error("Verification image exceeds the limit");
        const reader = response.body!.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 70_000_000)
              throw new Error("Verification image exceeds the limit");
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Array.isArray(payload.data) || payload.data.length !== 1)
          throw new Error("Exactly one inline verification image is required");
        const encoded = payload.data[0]?.b64_json;
        if (typeof encoded !== "string" || encoded.length > 70_000_000)
          throw new Error("A bounded inline image is required");
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded)
          throw new Error("Canonical PNG base64 is required");
        validateVerificationPNG(bytes);
        pngs.push(bytes);
        evidence.usage_known = true;
        evidence.known_cost_micros = String(
          BigInt(document.rates[0]) * BigInt(pngs.length),
        );
        evidence.checks.push(`images.${operation}`, hash(bytes));
      }
      evidence.checks.push("pinned_codex", "bounded_inline_png", "decoded_png");
    }
    if (binaryHash !== (await codexBinaryHash(c)))
      throw new Error("The runtime binary changed during verification");
    state = "passed";
  } catch (error) {
    if (error instanceof RuntimeFailure) {
      evidence.accepted = error.accepted;
      evidence.usage_known = error.usageKnown;
      evidence.input_tokens = error.inputTokens;
      evidence.output_tokens = error.outputTokens;
      if (error.usageKnown && document.profile_key === "internal-text-v1")
        evidence.known_cost_micros = String(
          tokenCharge(error.inputTokens, error.outputTokens, ...document.rates),
        );
      evidence.error_code = error.code;
    } else
      evidence.error_code =
        error instanceof Problem
          ? error.code
          : "CAPABILITY_VERIFICATION_FAILED";
    state =
      evidence.accepted && !evidence.usage_known ? "reconciling" : "failed";
  }
  return { state, evidence, body };
}
