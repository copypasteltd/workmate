import { z } from "zod";
import type { Config } from "./config.js";
import type { Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { RuntimeSelection } from "./runtime.js";
import { canonical, hash, Problem } from "./lib.js";
import { desktopRuntime, desktopRuntimeFingerprint, desktopRuntimeId } from "./desktop-runtime.js";
import { videoJobLimits, videoJobOperations, videoJobProtocol } from "./video-job-protocol.js";
import { speechProtocol, transcriptionProtocol, speechLimits, transcriptionLimits } from "./audio-production-model.js";

const effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
const rate = z.number().int().nonnegative().safe();
const definition = z
  .object({
    schema_version: z.literal(2),
    profile_key: z.enum([
      "internal-text-v1",
      "internal-image2-v1",
      "internal-video-v1",
      "internal-speech-v1",
      "internal-transcription-v1",
    ]),
    model_alias: z.string().min(1).max(200).nullable(),
    ready: z.boolean(),
    rates: z.array(rate.nullable()).max(2),
    gateway_policy: z.literal("company_internal_only"),
    gateway_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    data_mode: z.enum(["simulated", "configured_services"]),
    wire_protocol: z.enum(["responses", "images", "unimplemented", videoJobProtocol, speechProtocol, transcriptionProtocol]),
    reasoning_effort: effort.nullable(),
    supported_operations: z
      .array(z.enum(["responses", "images.generate", "images.edit", ...videoJobOperations, "audio.speech", "audio.transcriptions"]))
      .max(8),
    limits: z.record(z.string(), z.unknown()),
  })
  .strict();
type Definition = z.infer<typeof definition>;
export const capabilityDefinition = definition;
type Capability = {
  id: string;
  body: Definition;
  ready: boolean;
  revoked: boolean;
};
export type TaskCapabilities = {
  runtimeProfileId: string;
  runtimeVersion: string;
  versionIds: string[];
  text: Capability & {
    body: Definition & {
      model_alias: string;
      reasoning_effort: z.infer<typeof effort>;
      rates: number[];
    };
  };
  image?: Capability & {
    body: Definition & { model_alias: string; rates: number[] };
  };
  video?: Capability & {
    body: Definition & { model_alias: string; rates: number[] };
  };
  speech?: Capability & { body: Definition & { model_alias: string; rates: number[] } };
  transcription?: Capability & { body: Definition & { model_alias: string; rates: number[] } };
};

export function gatewayFingerprint(c: Config) {
  return hash(
    c.DEMO_MODE ? "synthetic-local-gateway-v1" : (c.AI_BASE_URL ?? ""),
  );
}
const invalid = (code = "TASK_CAPABILITY_BINDING_UNAVAILABLE") =>
  new Problem(
    409,
    code,
    "The task's confirmed internal model or pricing version is unavailable; do not silently replace it",
  );

async function resolve(
  tx: Tx,
  c: Config,
  task: any,
  catalog: Catalog,
  runtimeId: string,
  ids: string[],
  usable: boolean,
): Promise<TaskCapabilities> {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 8 ||
    new Set(ids).size !== ids.length
  )
    throw invalid();
  if (usable)
    await tx.query("SELECT lock_task_capability_versions($1,$2::uuid[])", [
      runtimeId,
      ids,
    ]);
  const profile = (
    await tx.query("SELECT * FROM codex_runtime_profiles WHERE id=$1", [
      runtimeId,
    ])
  ).rows[0];
  if (
    !profile ||
    profile.kernel !== "codex" ||
    profile.transport !== "stdio" ||
    profile.gateway_policy !== "company_internal_only" ||
    profile.automatic_fallback ||
    (usable &&
      (profile.state !== "enabled" ||
        (task.execution_location === "desktop"
          ? profile.fingerprint !== desktopRuntimeFingerprint || profile.pinned_version !== desktopRuntime.pinned_version
          : profile.pinned_version !== c.CODEX_VERSION)))
  )
    throw invalid("TASK_RUNTIME_PROFILE_UNAVAILABLE");
  const rows = (
    await tx.query(
      "SELECT * FROM internal_capability_versions WHERE id=ANY($1::uuid[]) ORDER BY id",
      [ids],
    )
  ).rows;
  if (rows.length !== ids.length) throw invalid();
  const capabilities = new Map<string, Capability>();
  for (const row of rows) {
    const parsed = definition.safeParse(row.body);
    if (
      !parsed.success ||
      hash(canonical(row.body)) !== row.fingerprint ||
      parsed.data.profile_key !== row.profile_key ||
      parsed.data.data_mode !== row.data_mode ||
      parsed.data.ready !== row.ready ||
      row.data_mode !== task.data_mode ||
      capabilities.has(row.profile_key) ||
      (usable && row.revoked)
    )
      throw invalid();
    capabilities.set(row.profile_key, {
      id: row.id,
      body: parsed.data,
      ready: row.ready,
      revoked: row.revoked,
    });
    if (
      usable &&
      (row.data_mode !== (c.DEMO_MODE ? "simulated" : "configured_services") ||
        parsed.data.gateway_fingerprint !== gatewayFingerprint(c))
    )
      throw invalid("TASK_GATEWAY_CHANGED");
  }
  const text = capabilities.get("internal-text-v1");
  if (
    !text?.ready ||
    !text.body.model_alias ||
    !text.body.reasoning_effort ||
    text.body.wire_protocol !== "responses" ||
    text.body.rates.length !== 2 ||
    text.body.rates.some((v) => v === null) ||
    canonical(text.body.supported_operations) !== canonical(["responses"]) ||
    canonical(text.body.limits) !== canonical({ max_prompt_chars: 60000 })
  )
    throw invalid();
  const image = capabilities.get("internal-image2-v1");
  const video = capabilities.get("internal-video-v1");
  const speech = capabilities.get("internal-speech-v1"), transcription = capabilities.get("internal-transcription-v1");
  for (const [audio, protocol, operation, limits] of [
    [speech, speechProtocol, "audio.speech", speechLimits({ ...c,
      AI_SPEECH_LOCALES: Array.isArray(speech?.body.limits.locales) ? (speech.body.limits.locales as string[]).join(",") : "",
      AI_SPEECH_VOICES: Array.isArray(speech?.body.limits.voices) ? (speech.body.limits.voices as string[]).join(",") : "" })],
    [transcription, transcriptionProtocol, "audio.transcriptions", transcriptionLimits({ ...c,
      AI_TRANSCRIPTION_LOCALES: Array.isArray(transcription?.body.limits.locales) ? (transcription.body.limits.locales as string[]).join(",") : "",
      AI_TRANSCRIPTION_TIMESTAMPS: Array.isArray(transcription?.body.limits.response_formats)
      && transcription.body.limits.response_formats.includes("verbose_json") })],
  ] as const) {
    if (audio?.ready && (!Array.isArray(audio.body.limits.locales) || !audio.body.limits.locales.length
      || audio.body.limits.locales.length > 3 || new Set(audio.body.limits.locales).size !== audio.body.limits.locales.length
      || audio.body.limits.locales.some(value => !["en", "zh-HK", "yue-HK"].includes(String(value))))) throw invalid();
    if (audio?.ready && (!audio.body.model_alias || audio.body.wire_protocol !== protocol
      || audio.body.reasoning_effort !== null || audio.body.rates.length !== 1 || !audio.body.rates[0]
      || audio.body.rates[0] > 1000000000 || canonical(audio.body.supported_operations) !== canonical([operation])
      || canonical(audio.body.limits) !== canonical(limits))) throw invalid();
  }
  if (speech?.ready && (!Array.isArray(speech.body.limits.voices) || !speech.body.limits.voices.length
    || speech.body.limits.voices.length > 32 || new Set(speech.body.limits.voices).size !== speech.body.limits.voices.length
    || speech.body.limits.voices.some(value => typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)))) throw invalid();
  if (video?.ready && (!video.body.model_alias || video.body.wire_protocol !== videoJobProtocol
    || video.body.reasoning_effort !== null || video.body.rates.length !== 1 || !video.body.rates[0]
    || canonical(video.body.supported_operations) !== canonical(videoJobOperations)
    || canonical(video.body.limits) !== canonical(videoJobLimits))) throw invalid();
  const usesImage =
    usable &&
    task.mode === "execute" &&
    catalog
      .forTask(task)
      .model_bindings.some(
        (binding: any) => binding.profile_key === "internal-image2-v1",
      );
  if (
    image?.ready &&
    (!image.body.model_alias ||
      image.body.wire_protocol !== "images" ||
      image.body.reasoning_effort !== null ||
      image.body.rates.length !== 1 ||
      !image.body.rates[0] ||
      canonical(image.body.supported_operations) !==
        canonical(["images.generate", "images.edit"]) ||
      canonical(image.body.limits) !==
        canonical({
          max_prompt_chars: 12000,
          size: "1024x1024",
          quality: "high",
          output_format: "png",
        }))
  )
    throw invalid();
  const published =
    usable && (!c.AI_VERIFIED || (usesImage && !c.AI_IMAGE_VERIFIED) || (video?.ready && !c.AI_VIDEO_VERIFIED)
      || (speech?.ready && !c.AI_SPEECH_VERIFIED) || (transcription?.ready && !c.AI_TRANSCRIPTION_VERIFIED))
      ? new Set(
          (
            await tx.query(
              "SELECT id FROM published_capability_versions WHERE id=ANY($1::uuid[]) AND data_mode=$2",
              [ids, task.data_mode],
            )
          ).rows.map((row) => row.id),
        )
      : new Set<string>();
  if (
    usable &&
    (!c.AI_BASE_URL ||
      !c.AI_API_KEY ||
      (!c.AI_VERIFIED && !published.has(text.id)) ||
      (usesImage &&
        (!image?.ready || (!c.AI_IMAGE_VERIFIED && !published.has(image.id)))))
  )
    throw invalid();
  return {
    runtimeProfileId: profile.id,
    runtimeVersion: profile.pinned_version,
    versionIds: [...ids],
    text: text as TaskCapabilities["text"],
    ...(image?.ready ? { image: image as TaskCapabilities["image"] } : {}),
    ...(video?.ready && (!usable || c.AI_VIDEO_VERIFIED || published.has(video.id)) ? { video: video as TaskCapabilities["video"] } : {}),
    ...(speech?.ready && (!usable || c.AI_SPEECH_VERIFIED || published.has(speech.id)) ? { speech: speech as TaskCapabilities["speech"] } : {}),
    ...(transcription?.ready && (!usable || c.AI_TRANSCRIPTION_VERIFIED || published.has(transcription.id)) ? { transcription: transcription as TaskCapabilities["transcription"] } : {}),
  };
}

/** Reuse the actual task protocol/rate/gateway checks before confirming an agent. */
export async function confirmedAgentCapabilities(
  tx: Tx,
  c: Config,
  catalog: Catalog,
  body: any,
) {
  return resolve(
    tx,
    c,
    {
      mode: "ask",
      role_key: body.role_key,
      role_hash: body.role_hash,
      data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
    },
    catalog,
    body.runtime_profile_id,
    body.capability_version_ids,
    true,
  );
}

/** A task can never adopt today's prices or model while executing or settling. */
export async function taskCapabilities(
  tx: Tx,
  c: Config,
  catalog: Catalog,
  task: any,
  usable = true,
): Promise<TaskCapabilities> {
  const binding = (
    await tx.query(
      "SELECT * FROM task_runtime_bindings WHERE task_id=$1 AND tenant_id=$2",
      [task.id, task.tenant_id],
    )
  ).rows[0];
  if (!binding) throw invalid("TASK_CAPABILITY_BINDING_REQUIRED");
  return resolve(
    tx,
    c,
    task,
    catalog,
    binding.runtime_profile_id,
    binding.capability_version_ids,
    usable,
  );
}

/** Invoked in the same transaction as task creation and its budget reservation. */
export async function freezeTaskCapabilities(
  tx: Tx,
  c: Config,
  catalog: Catalog,
  task: any,
) {
  let runtimeId = catalog.runtimeProfile.id;
  let ids: string[];
  if (task.parent_id) {
    const parent = (
      await tx.query(
        "SELECT * FROM task_runtime_bindings WHERE task_id=$1 AND tenant_id=$2",
        [task.parent_id, task.tenant_id],
      )
    ).rows[0];
    if (!parent) throw invalid("PARENT_CAPABILITY_BINDING_REQUIRED");
    runtimeId = parent.runtime_profile_id;
    ids = parent.capability_version_ids;
  } else if (task.input_context?.agent_id) {
    const agent = (
      await tx.query(
        "SELECT v.runtime_profile_id,v.body FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=$3 WHERE a.id=$1 AND a.project_id=$2 AND a.content_state='active'",
        [
          task.input_context.agent_id,
          task.project_id,
          task.input_context.agent_version,
        ],
      )
    ).rows[0];
    if (
      !agent ||
      !agent.runtime_profile_id ||
      !Array.isArray(agent.body.capability_version_ids)
    )
      throw invalid();
    runtimeId = agent.runtime_profile_id;
    ids = agent.body.capability_version_ids;
  } else {
    const current = await catalog.currentCapabilities(tx);
    ids = catalog
      .forTask(task)
      .model_bindings.map((b: any) => current.get(b.profile_key)?.id)
      .filter((id: unknown): id is string => typeof id === "string");
  }
  if (task.execution_location === "desktop") {
    runtimeId = await desktopRuntimeId(tx);
  }
  const selected = await resolve(tx, c, task, catalog, runtimeId, ids, true);
  await tx.query(
    "INSERT INTO task_runtime_bindings(task_id,tenant_id,runtime_profile_id,capability_version_ids) VALUES($1,$2,$3,$4)",
    [task.id, task.tenant_id, runtimeId, ids],
  );
  await tx.query(
    "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'capabilities.bound',$3)",
    [
      task.tenant_id,
      task.id,
      {
        runtime_profile_id: runtimeId,
        capability_version_ids: ids,
        data_mode: task.data_mode,
      },
    ],
  );
  return selected;
}

/** Availability of existing work follows its validated binding, including a
 * superseded publication. Today's default must not gate an unchanged task. */
export async function boundTaskAvailability(
  tx: Tx,
  c: Config,
  catalog: Catalog,
  task: any,
) {
  const binding = await taskCapabilities(tx, c, catalog, task);
  const versions = new Map<string, any>([["internal-text-v1", binding.text]]);
  if (binding.image) versions.set("internal-image2-v1", binding.image);
  if (binding.video) versions.set("internal-video-v1", binding.video);
  if (binding.speech) versions.set("internal-speech-v1", binding.speech);
  if (binding.transcription) versions.set("internal-transcription-v1", binding.transcription);
  return {
    binding,
    availability: catalog.available(
      { ...c, AI_VERIFIED: true, AI_IMAGE_VERIFIED: !!binding.image },
      catalog.forTask(task),
      task.mode,
      versions,
    ),
  };
}

export function runtimeSelection(binding: TaskCapabilities): RuntimeSelection {
  return {
    capabilityVersionId: binding.text.id,
    runtimeVersion: binding.runtimeVersion,
    gatewayFingerprint: binding.text.body.gateway_fingerprint,
    dataMode: binding.text.body.data_mode,
    model: binding.text.body.model_alias,
    reasoningEffort: binding.text.body.reasoning_effort,
    inputRate: binding.text.body.rates[0],
    outputRate: binding.text.body.rates[1],
  };
}
