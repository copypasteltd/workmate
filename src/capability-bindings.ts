import { z } from "zod";
import type { Config } from "./config.js";
import type { Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { RuntimeSelection } from "./runtime.js";
import { canonical, hash, Problem } from "./lib.js";

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
    ]),
    model_alias: z.string().min(1).max(200).nullable(),
    ready: z.boolean(),
    rates: z.array(rate.nullable()).max(2),
    gateway_policy: z.literal("company_internal_only"),
    gateway_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    data_mode: z.enum(["simulated", "configured_services"]),
    wire_protocol: z.enum(["responses", "images", "unimplemented"]),
    reasoning_effort: effort.nullable(),
    supported_operations: z
      .array(z.enum(["responses", "images.generate", "images.edit"]))
      .max(3),
    limits: z.record(z.string(), z.unknown()),
  })
  .strict();
type Definition = z.infer<typeof definition>;
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
        profile.pinned_version !== c.CODEX_VERSION))
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
  const usesImage =
    usable &&
    task.mode === "execute" &&
    catalog
      .role(task.role_key)
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
  if (
    usable &&
    (!c.AI_BASE_URL ||
      !c.AI_API_KEY ||
      !c.AI_VERIFIED ||
      (usesImage && (!image?.ready || !c.AI_IMAGE_VERIFIED)))
  )
    throw invalid();
  return {
    runtimeProfileId: profile.id,
    runtimeVersion: profile.pinned_version,
    versionIds: [...ids],
    text: text as TaskCapabilities["text"],
    ...(image?.ready ? { image: image as TaskCapabilities["image"] } : {}),
  };
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
    ids = catalog
      .role(task.role_key)
      .model_bindings.map(
        (b: any) => catalog.capabilityVersions.get(b.profile_key)?.id,
      )
      .filter((id: unknown): id is string => typeof id === "string");
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
