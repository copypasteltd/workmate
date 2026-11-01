import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config, ModelConnectionIdentity } from "./config.js";
import type { Database, Tx } from "./db.js";
import { canonical, hmac, Problem, seal, unseal, uuid } from "./lib.js";
import { modelConnectionFetch } from "./model-connection-http.js";

export const modelUpstream = z
  .object({
    id: uuid,
    base_url: z.string().url().max(2048),
    key_configured: z.literal(true),
    allow_private_network: z.boolean(),
  })
  .strict();
export const modelConnectionInput = z
  .object({
    base_url: z.string().trim().url().max(2048),
    api_key: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .regex(/^[^\r\n\x00-\x1f\x7f]+$/)
      .optional(),
    reuse_from_release_id: uuid.optional(),
    allow_private_network: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => Boolean(v.api_key) !== Boolean(v.reuse_from_release_id),
    "Provide a new API key or explicitly retain the source configuration key",
  );
export type ModelConnectionInput = z.infer<typeof modelConnectionInput>;

export function normalizedModelURL(
  c: Config,
  input: string,
  _allowPrivate: boolean,
) {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /\/(responses|chat\/completions|models|images\/generations)\/?$/i.test(
      url.pathname,
    ) ||
    /%2f|%5c|%2e|\\/i.test(url.pathname)
  )
    throw new Problem(
      422,
      "MODEL_BASE_URL_INVALID",
      "Enter the API base URL, such as https://gateway.example/v1, without credentials, query or an operation suffix",
    );
  if (
    [c.API_ORIGIN, c.WEB_ORIGIN, c.ADMIN_ORIGIN].some(
      (v) => new URL(v).origin === url.origin,
    )
  )
    throw new Problem(
      422,
      "MODEL_CONNECTION_SELF_REFERENCE",
      "Use the upstream model service, rather than this application's own address",
    );
  return url.toString().replace(/\/+$/, "");
}

/** Secret material is never passed to operation payloads, audit bodies or DTOs. */
export function connectionCommand(c: Config, input: ModelConnectionInput) {
  return {
    base_url: normalizedModelURL(
      c,
      input.base_url,
      input.allow_private_network,
    ),
    allow_private_network: input.allow_private_network,
    ...(input.api_key
      ? { credential_digest: hmac(c.MASTER_KEY!, input.api_key) }
      : { reuse_from_release_id: input.reuse_from_release_id }),
  };
}
export async function storeModelConnection(
  tx: Tx,
  c: Config,
  id: string,
  input: ModelConnectionInput,
) {
  const base = normalizedModelURL(
    c,
    input.base_url,
    input.allow_private_network,
  );
  let encrypted = input.api_key
    ? seal(c.MASTER_KEY!, input.api_key)
    : undefined;
  if (!encrypted) {
    const source = (
      await tx.query(
        "SELECT * FROM capability_model_connections WHERE release_id=$1",
        [input.reuse_from_release_id],
      )
    ).rows[0];
    if (
      !source ||
      source.base_url !== base ||
      source.allow_private_network !== input.allow_private_network
    )
      throw new Problem(
        422,
        "MODEL_KEY_REQUIRED",
        "Provide a new API key when changing the upstream address or network scope",
      );
    encrypted = source.encrypted_api_key;
  }
  await tx.query(
    "INSERT INTO capability_model_connections(release_id,base_url,encrypted_api_key,allow_private_network) VALUES($1,$2,$3,$4)",
    [id, base, encrypted, input.allow_private_network],
  );
  return {
    id,
    base_url: base,
    key_configured: true as const,
    allow_private_network: input.allow_private_network,
  };
}

export function installModelConnectionResolver(
  c: Config,
  db: Database,
): Config {
  return {
    ...c,
    MODEL_CONNECTION_RESOLVER: async (identity: ModelConnectionIdentity) => {
      const rows = identity.capabilityVersionId
        ? (
            await db.control.query(
              `SELECT r.definition,c.* FROM internal_capability_versions v
          JOIN capability_model_connections c ON c.release_id::text=v.body->>'model_connection_id'
          JOIN capability_releases r ON r.id=c.release_id WHERE v.id=$1`,
              [identity.capabilityVersionId],
            )
          ).rows
        : (
            await db.control.query(
              `SELECT r.definition,c.* FROM capability_validations v
          JOIN capability_releases r ON r.id=v.release_id
          JOIN capability_model_connections c ON c.release_id=r.id WHERE v.id=$1`,
              [identity.taskId],
            )
          ).rows;
      const row = rows[0];
      if (!row) {
        // An explicitly bound version must never silently use the environment key.
        if (identity.capabilityVersionId) {
          const version = (
            await db.control.query(
              "SELECT body FROM internal_capability_versions WHERE id=$1",
              [identity.capabilityVersionId],
            )
          ).rows[0];
          if (version?.body.model_connection_id)
            throw new Problem(
              409,
              "MODEL_CONNECTION_UNAVAILABLE",
              "The model's original connection is unavailable",
            );
        } else {
          const validation = (
            await db.control.query(
              "SELECT r.definition FROM capability_validations v JOIN capability_releases r ON r.id=v.release_id WHERE v.id=$1",
              [identity.taskId],
            )
          ).rows[0];
          if (validation?.definition.upstream)
            throw new Problem(
              409,
              "MODEL_CONNECTION_UNAVAILABLE",
              "The validation's original connection is unavailable",
            );
        }
        return undefined;
      }
      const expectedOperation = (
        {
          "internal-text-v1": "responses",
          "internal-image2-v1": "images.",
          "internal-video-v1": "videos.",
          "internal-speech-v1": "audio.speech",
          "internal-transcription-v1": "audio.transcriptions",
        } as Record<string, string>
      )[row.definition.profile_key];
      if (
        row.definition.model_alias !== identity.model ||
        !identity.operation.startsWith(expectedOperation ?? "invalid") ||
        canonical(row.definition.upstream) !==
          canonical({
            id: row.release_id,
            base_url: row.base_url,
            key_configured: true,
            allow_private_network: row.allow_private_network,
          })
      )
        throw new Problem(
          409,
          "MODEL_CONNECTION_BINDING_CHANGED",
          "The requested model differs from its original connection",
        );
      return {
        id: row.release_id,
        baseURL: row.base_url,
        apiKey: unseal(c.MASTER_KEY!, row.encrypted_api_key),
        allowPrivateNetwork: row.allow_private_network,
      };
    },
  };
}

export async function checkModelConnection(
  tx: Tx,
  c: Config,
  id: string,
  principalId: string,
) {
  const row = (
    await tx.query(
      `SELECT r.definition,c.* FROM capability_model_connections c
    JOIN capability_releases r ON r.id=c.release_id WHERE c.release_id=$1`,
      [id],
    )
  ).rows[0];
  if (!row)
    throw new Problem(
      409,
      "MODEL_CONNECTION_NOT_CONFIGURED",
      "This model has no independently configured upstream",
    );
  let result: {
    reachable: boolean;
    model_available: boolean | null;
    models_count?: number;
    error_code?: string;
    checked_at: string;
  };
  try {
    const response = await modelConnectionFetch(
      new URL(row.base_url + "/models"),
      {
        method: "GET",
        headers: {
          Authorization:
            "Bearer " + unseal(c.MASTER_KEY!, row.encrypted_api_key),
          Accept: "application/json",
        },
        allowPrivate: row.allow_private_network,
        test: c.NODE_ENV === "test",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      result = {
        reachable: false,
        model_available: null,
        error_code:
          response.status === 401 || response.status === 403
            ? "MODEL_AUTHENTICATION_FAILED"
            : response.status === 404 || response.status === 405
              ? "MODEL_LIST_UNSUPPORTED"
              : "MODEL_UPSTREAM_FAILED",
        checked_at: new Date().toISOString(),
      };
    } else {
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!reader) throw new Error("EMPTY_RESPONSE");
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024) throw new Error("RESPONSE_LIMIT");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(body.data) || body.data.length > 10000)
        throw new Error("INVALID_MODEL_LIST");
      result = {
        reachable: true,
        model_available: body.data.some(
          (v: any) => v?.id === row.definition.model_alias,
        ),
        models_count: body.data.length,
        checked_at: new Date().toISOString(),
      };
    }
  } catch (error) {
    result = {
      reachable: false,
      model_available: null,
      error_code:
        error instanceof Problem ? error.code : "MODEL_CONNECTION_FAILED",
      checked_at: new Date().toISOString(),
    };
  }
  await tx.query(
    "INSERT INTO capability_connection_checks(id,release_id,principal_id,result) VALUES($1,$2,$3,$4)",
    [randomUUID(), id, principalId, result],
  );
  return result;
}
