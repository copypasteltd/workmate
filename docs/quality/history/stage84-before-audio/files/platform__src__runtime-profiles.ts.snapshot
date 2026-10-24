import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { canonical, hash, Problem } from "./lib.js";
import { videoJobLimits, videoJobOperations, videoJobProtocol } from "./video-job-protocol.js";

export async function seedRuntimeProfile(db: Database, catalog: Catalog) {
  const definition = {
      profile_key: "codex-internal-v1",
      kernel: "codex",
      pinned_version: db.config.CODEX_VERSION,
      transport: "stdio",
      gateway_policy: "company_internal_only",
      automatic_fallback: false,
    },
    fingerprint = hash(canonical(definition));
  catalog.runtimeProfile = await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('codex-runtime-profile-seed',0))",
      );
      await tx.query(
        "INSERT INTO codex_runtime_profiles(fingerprint,profile_key,kernel,pinned_version,transport,gateway_policy,automatic_fallback) VALUES($1,$2,'codex',$3,'stdio','company_internal_only',false) ON CONFLICT(fingerprint) DO NOTHING",
        [fingerprint, definition.profile_key, definition.pinned_version],
      );
      const capabilities = [
        {
          profile_key: "internal-text-v1",
          model_alias: db.config.AI_MODEL ?? null,
          ready: !!(
            db.config.AI_BASE_URL &&
            db.config.AI_API_KEY &&
            db.config.AI_VERIFIED &&
            db.config.AI_MODEL &&
            db.config.AI_INPUT_HKD_MICROS_PER_MILLION !== undefined &&
            db.config.AI_OUTPUT_HKD_MICROS_PER_MILLION !== undefined
          ),
          rates: [
            db.config.AI_INPUT_HKD_MICROS_PER_MILLION ?? null,
            db.config.AI_OUTPUT_HKD_MICROS_PER_MILLION ?? null,
          ],
        },
        {
          profile_key: "internal-image2-v1",
          model_alias: db.config.AI_IMAGE_MODEL ?? null,
          ready: !!(
            db.config.AI_BASE_URL &&
            db.config.AI_API_KEY &&
            db.config.AI_IMAGE_VERIFIED &&
            db.config.AI_IMAGE_MODEL &&
            db.config.AI_IMAGE_HKD_MICROS_PER_IMAGE !== undefined
          ),
          rates: [db.config.AI_IMAGE_HKD_MICROS_PER_IMAGE ?? null],
        },
        {
          profile_key: "internal-video-v1",
          model_alias: db.config.AI_VIDEO_MODEL ?? null,
          ready: !!(db.config.AI_BASE_URL && db.config.AI_API_KEY && db.config.AI_VIDEO_MODEL
            && db.config.AI_VIDEO_VERIFIED && db.config.AI_VIDEO_HKD_MICROS_PER_SECOND !== undefined),
          rates: db.config.AI_VIDEO_HKD_MICROS_PER_SECOND === undefined ? [] : [db.config.AI_VIDEO_HKD_MICROS_PER_SECOND],
        },
        {
          profile_key: "internal-speech-v1",
          model_alias: null,
          ready: false,
          rates: [],
        },
      ];
      for (const capability of capabilities) {
        const body = {
            ...capability,
            schema_version: 2,
            wire_protocol:
              capability.profile_key === "internal-text-v1"
                ? "responses"
                : capability.profile_key === "internal-image2-v1"
                  ? "images"
                  : capability.profile_key === "internal-video-v1" && capability.ready
                    ? videoJobProtocol
                  : "unimplemented",
            reasoning_effort:
              capability.profile_key === "internal-text-v1"
                ? db.config.AI_REASONING_EFFORT
                : null,
            supported_operations:
              capability.profile_key === "internal-text-v1"
                ? ["responses"]
                : capability.profile_key === "internal-image2-v1"
                  ? ["images.generate", "images.edit"]
                  : capability.profile_key === "internal-video-v1" && capability.ready
                    ? [...videoJobOperations]
                  : [],
            limits:
              capability.profile_key === "internal-text-v1"
                ? { max_prompt_chars: 60000 }
                : capability.profile_key === "internal-image2-v1"
                  ? {
                      max_prompt_chars: 12000,
                      size: "1024x1024",
                      quality: "high",
                      output_format: "png",
                    }
                  : capability.profile_key === "internal-video-v1" && capability.ready
                    ? videoJobLimits
                  : {},
            gateway_policy: "company_internal_only",
            gateway_fingerprint: hash(
              db.config.DEMO_MODE
                ? "synthetic-local-gateway-v1"
                : (db.config.AI_BASE_URL ?? ""),
            ),
            data_mode: db.config.DEMO_MODE
              ? "simulated"
              : "configured_services",
          },
          digest = hash(canonical(body));
        await tx.query(
          "INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,$5) ON CONFLICT(fingerprint) DO NOTHING",
          [digest, body.profile_key, body.data_mode, body, body.ready],
        );
        catalog.capabilityVersions.set(
          body.profile_key,
          (
            await tx.query(
              "SELECT * FROM internal_capability_versions WHERE fingerprint=$1",
              [digest],
            )
          ).rows[0],
        );
      }
      return (
        await tx.query(
          "SELECT * FROM codex_runtime_profiles WHERE fingerprint=$1",
          [fingerprint],
        )
      ).rows[0];
    },
    undefined,
    true,
  );
}
export async function activeRuntimeProfile(tx: Tx, catalog: Catalog) {
  const row = (
    await tx.query("SELECT * FROM codex_runtime_profiles WHERE id=$1", [
      catalog.runtimeProfile.id,
    ])
  ).rows[0];
  if (
    !row ||
    row.state !== "enabled" ||
    row.kernel !== "codex" ||
    row.transport !== "stdio" ||
    row.automatic_fallback ||
    row.pinned_version !== catalog.runtimeProfile.pinned_version
  )
    throw new Problem(
      403,
      "RUNTIME_PROFILE_UNAVAILABLE",
      "The pinned Codex runtime profile is unavailable",
    );
  return row;
}
export async function assertAgentRuntime(
  tx: Tx,
  agent: any,
  expectedVersion?: string,
  currentCapabilities?: string[],
) {
  // Historical versions have no claimed profile identity. Their original body
  // stays intact; newly created versions are required to bind a real profile.
  if (!agent.runtime_profile_id && !agent.body.runtime_profile_id) return null;
  const row = (
    await tx.query("SELECT * FROM codex_runtime_profiles WHERE id=$1", [
      agent.runtime_profile_id,
    ])
  ).rows[0];
  if (
    !row ||
    row.id !== agent.body.runtime_profile_id ||
    row.state !== "enabled" ||
    row.kernel !== "codex" ||
    row.transport !== "stdio" ||
    row.automatic_fallback ||
    row.pinned_version !== agent.body.runtime_version ||
    (expectedVersion && row.pinned_version !== expectedVersion)
  )
    throw new Problem(
      409,
      "RUNTIME_PROFILE_UNAVAILABLE",
      "The bound Codex version is unavailable; explicitly adopt a supported specialist version",
    );
  const ids: string[] = agent.body.capability_version_ids ?? [];
  const versions = (
    await tx.query(
      "SELECT id,revoked FROM internal_capability_versions WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  if (
    versions.length !== ids.length ||
    versions.some((v) => v.revoked) ||
    (currentCapabilities && ids.some((id) => !currentCapabilities.includes(id)))
  )
    throw new Problem(
      409,
      "CAPABILITY_VERSION_UNAVAILABLE",
      "The specialist's pinned internal capability changed; explicitly adopt a supported version",
    );
  return row;
}
