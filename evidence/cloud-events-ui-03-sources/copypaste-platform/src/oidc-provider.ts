import * as oidc from "openid-client";
import { createPublicKey } from "node:crypto";
import type { Config } from "./config.js";
import { Problem, unseal } from "./lib.js";

export function callbackOrigin(c: Config) {
  return c.SSO_CALLBACK_ORIGIN ?? c.WEB_ORIGIN;
}
export function callbackUri(c: Config) {
  return callbackOrigin(c) + "/v1/auth/sso/callback";
}
export function oidcUrl(c: Config, value: string, issuer = false) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Problem(400, "SSO_URL_INVALID", "Invalid identity-provider URL");
  }
  const local =
    c.NODE_ENV !== "production" &&
    c.SSO_ALLOW_LOCALHOST &&
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
    u.protocol === "http:";
  const allowed = c.SSO_ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    u.username ||
    u.password ||
    u.hash ||
    (issuer && u.search) ||
    (!local && (u.protocol !== "https:" || !allowed.includes(u.origin)))
  )
    throw new Problem(
      400,
      "SSO_NETWORK_DENIED",
      "The identity-provider origin must be approved in the server deployment",
    );
  return u;
}
export function safeNext(c: Config, value = "/app") {
  if (
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    throw new Problem(400, "SSO_RETURN_INVALID", "Invalid sign-in return path");
  const u = new URL(value, c.WEB_ORIGIN);
  if (
    u.origin !== c.WEB_ORIGIN ||
    !/^\/(?:app(?:\/|$)|authorize$|invite$|welcome$)/.test(u.pathname)
  )
    throw new Problem(400, "SSO_RETURN_INVALID", "Invalid sign-in return path");
  return u.pathname + u.search + u.hash;
}

/** Every discovery/token/JWKS request has the same origin, redirect and size boundary. */
function boundedFetch(c: Config): oidc.CustomFetch {
  return async (input, options) => {
    const url = oidcUrl(c, String(input));
    const deadline = AbortSignal.timeout(10000);
    const response = await fetch(url, {
      ...options,
      body:
        options.body instanceof Uint8Array
          ? new Uint8Array(options.body).buffer
          : options.body,
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
    });
    const max = 1024 * 1024;
    if (Number(response.headers.get("content-length")) > max) {
      await response.body?.cancel();
      throw new Problem(
        502,
        "SSO_RESPONSE_TOO_LARGE",
        "Identity response exceeded its size limit",
      );
    }
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let total = 0;
    try {
      if (reader)
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > max)
            throw new Problem(
              502,
              "SSO_RESPONSE_TOO_LARGE",
              "Identity response exceeded its size limit",
            );
          chunks.push(part.value);
        }
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throw error;
    } finally {
      reader?.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(
      [204, 205, 304].includes(response.status) ? null : bytes,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
}
function metadata(c: Config, input: oidc.ServerMetadata, alg: string) {
  for (const k of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ] as const) {
    if (!input[k])
      throw new Problem(
        400,
        "SSO_METADATA_INVALID",
        "Identity metadata is missing a required endpoint",
      );
    oidcUrl(c, input[k]);
  }
  if (
    !input.response_types_supported?.includes("code") ||
    !input.code_challenge_methods_supported?.includes("S256") ||
    !input.id_token_signing_alg_values_supported?.includes(alg)
  )
    throw new Problem(
      400,
      "SSO_METADATA_UNSUPPORTED",
      "The provider must support authorization codes, PKCE S256 and the selected signature algorithm",
    );
  const keep = [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
    "response_types_supported",
    "grant_types_supported",
    "token_endpoint_auth_methods_supported",
    "id_token_signing_alg_values_supported",
    "code_challenge_methods_supported",
    "authorization_response_iss_parameter_supported",
  ];
  return Object.fromEntries(
    Object.entries(input).filter(([k]) => keep.includes(k)),
  ) as oidc.ServerMetadata;
}
function configure(c: Config, p: any, md: oidc.ServerMetadata) {
  const secret = unseal(c.MASTER_KEY!, p.client_secret);
  const configuration = new oidc.Configuration(
    md,
    p.client_id,
    {
      client_secret: secret,
      id_token_signed_response_alg: p.signing_alg,
    },
    p.token_auth_method === "client_secret_basic"
      ? oidc.ClientSecretBasic(secret)
      : oidc.ClientSecretPost(secret),
  );
  configuration[oidc.customFetch] = boundedFetch(c);
  configuration.timeout = 10;
  if (c.NODE_ENV !== "production" && c.SSO_ALLOW_LOCALHOST)
    oidc.allowInsecureRequests(configuration);
  // Validate the asymmetric ID-token signature, including keys obtained from the frozen JWKS URL.
  oidc.enableNonRepudiationChecks(configuration);
  return configuration;
}
export async function probeProvider(c: Config, p: any) {
  const discovery = await oidc.discovery(
    oidcUrl(c, p.issuer, true),
    p.client_id,
    { id_token_signed_response_alg: p.signing_alg },
    oidc.None(),
    {
      [oidc.customFetch]: boundedFetch(c),
      timeout: 10,
      execute:
        c.NODE_ENV !== "production" && c.SSO_ALLOW_LOCALHOST
          ? [oidc.allowInsecureRequests]
          : [],
    },
  );
  const md = metadata(c, discovery.serverMetadata(), p.signing_alg);
  if (
    md.token_endpoint_auth_methods_supported &&
    !md.token_endpoint_auth_methods_supported.includes(p.token_auth_method)
  )
    throw new Problem(
      400,
      "SSO_AUTH_METHOD_UNSUPPORTED",
      "The provider does not support the configured client authentication",
    );
  const response = await boundedFetch(c)(String(md.jwks_uri), {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
    body: undefined,
  });
  if (!response.ok)
    throw new Problem(
      502,
      "SSO_KEYS_UNAVAILABLE",
      "Identity-provider keys are unavailable",
    );
  const keys = (await response.json()) as any;
  if (
    !Array.isArray(keys.keys) ||
    keys.keys.length < 1 ||
    keys.keys.length > 100 ||
    keys.keys.some((k: any) => k.d || k.p || k.q || k.k) ||
    !keys.keys.some((k: any) => {
      if ((k.use && k.use !== "sig") || (k.alg && k.alg !== p.signing_alg))
        return false;
      try {
        const key = createPublicKey({ key: k, format: "jwk" });
        return p.signing_alg === "RS256"
          ? key.asymmetricKeyType === "rsa" &&
              (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
          : key.asymmetricKeyType === "ec" && k.crv === "P-256";
      } catch {
        return false;
      }
    })
  )
    throw new Problem(
      400,
      "SSO_KEYS_INVALID",
      "The provider must publish suitable public signing keys",
    );
  return md;
}
export function providerClient(c: Config, p: any) {
  if (!p.metadata || p.verified_revision !== p.revision)
    throw new Problem(
      503,
      "SSO_NOT_VERIFIED",
      "The identity connection must be checked before sign-in",
    );
  oidcUrl(c, p.issuer, true);
  if (p.metadata.issuer !== p.issuer)
    throw new Problem(
      503,
      "SSO_NOT_VERIFIED",
      "The stored issuer does not match the verified identity metadata",
    );
  return configure(c, p, metadata(c, p.metadata, p.signing_alg));
}
export { oidc };
