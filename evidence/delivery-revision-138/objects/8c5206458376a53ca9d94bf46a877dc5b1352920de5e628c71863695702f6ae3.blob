import { z } from "zod";
import type { Config } from "./config.js";
import { hash, hmac, Problem } from "./lib.js";
import { providerIdentifier, publicationDigest, remotePublicationIdentifier } from "./publication-model.js";
import type { PublicationWrite, PublicationProgress } from "./publication-plan.js";

export const publicationScopes = ["pages_show_list", "pages_read_engagement", "pages_manage_posts",
  "instagram_basic", "instagram_content_publish"] as const;
const facebookScopes = publicationScopes.slice(0, 3);
const credential = z.object({
  access_token: z.string().min(1).max(8192),
  expires_at: z.string().datetime(),
  scopes: z.array(z.string().min(1).max(100)).max(100),
  user_id: providerIdentifier,
}).strict();
export type PublicationCredential = z.infer<typeof credential>;
export const parsePublicationCredential = (input: unknown) => credential.parse(input);
export interface PublicationDiscoveredTarget {
  kind: "facebook_page" | "instagram_professional";
  external_id: string;
  page_id: string;
  name: string;
  access_token: string;
  capabilities: { formats: string[]; story_business_account_required: boolean };
}

export function publicationSettings(c: Config) {
  const fixture = !!c.PUBLICATION_FIXTURE_ORIGIN && c.DEMO_MODE && c.NODE_ENV !== "production";
  const available = fixture || !!(c.META_PUBLICATION_APP_ID && c.META_PUBLICATION_APP_SECRET && c.META_GRAPH_VERSION &&
    new URL(c.API_ORIGIN).protocol === "https:");
  return {
    available, fixture,
    app_id: fixture ? "125000" : c.META_PUBLICATION_APP_ID,
    app_secret: fixture ? c.PUBLICATION_FIXTURE_KEY : c.META_PUBLICATION_APP_SECRET,
    graph_version: fixture ? "v26.0" : c.META_GRAPH_VERSION,
    callback: c.API_ORIGIN + "/v1/publication/callback",
    configuration_sha256: publicationDigest({
      mode: c.DEMO_MODE ? "simulated" : "configured_services",
      app_id: c.META_PUBLICATION_APP_ID ?? (fixture ? "125000" : null),
      app_secret_hash: hash(fixture ? c.PUBLICATION_FIXTURE_KEY ?? "" : c.META_PUBLICATION_APP_SECRET ?? ""),
      graph_version: fixture ? "v26.0" : c.META_GRAPH_VERSION ?? null,
      callback: c.API_ORIGIN + "/v1/publication/callback",
      fixture: fixture ? c.PUBLICATION_FIXTURE_ORIGIN : null,
    }),
  };
}
export class PublicationProviderFailure extends Problem {
  constructor(public outcome: "rejected" | "unknown", code: string, public reauthorize = false) {
    super(502, code, outcome === "unknown" ? "The provider outcome needs reconciliation" :
      reauthorize ? "Reconnect the publishing account" : "The provider rejected this exact request");
  }
}
function invalid(): never { throw new PublicationProviderFailure("unknown", "PUBLICATION_PROVIDER_RESPONSE_INVALID"); }

/** No retries. Timeouts, malformed receipts, 429 and 5xx writes are uncertain. */
export async function publicationJSON(c: Config, official: URL, options: RequestInit = {}, signal?: AbortSignal) {
  const endpoint = new URL(official);
  if (endpoint.protocol !== "https:" || !["graph.facebook.com", "graph-video.facebook.com"].includes(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || endpoint.hash)
    throw new Problem(500, "PUBLICATION_ENDPOINT_DENIED", "Unregistered publishing endpoint");
  const headers = new Headers(options.headers);
  if (c.DEMO_MODE && !c.PUBLICATION_FIXTURE_ORIGIN)
    throw new Problem(503, "PUBLICATION_FIXTURE_REQUIRED", "Synthetic publishing cannot contact a real provider");
  if (c.PUBLICATION_FIXTURE_ORIGIN) {
    const fixture = new URL(c.PUBLICATION_FIXTURE_ORIGIN);
    if (!c.DEMO_MODE || c.NODE_ENV === "production" || fixture.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(fixture.hostname) ||
        fixture.origin !== c.PUBLICATION_FIXTURE_ORIGIN || !c.PUBLICATION_FIXTURE_KEY)
      throw new Problem(500, "PUBLICATION_FIXTURE_DENIED", "Synthetic transport is unavailable");
    fixture.pathname = `/provider/${endpoint.hostname}${endpoint.pathname}`;
    fixture.search = endpoint.search;
    endpoint.href = fixture.href;
    headers.set("x-copypaste-publication-fixture", c.PUBLICATION_FIXTURE_KEY);
  }
  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers, redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
  } catch { throw new PublicationProviderFailure("unknown", "PUBLICATION_TRANSPORT_UNKNOWN"); }
  const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (reader) for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); invalid(); }
      chunks.push(part.value);
    }
  } catch { throw new PublicationProviderFailure("unknown", "PUBLICATION_RESPONSE_INCOMPLETE"); }
  finally { reader?.releaseLock(); }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { invalid(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  if (!response.ok || body.error) {
    const errorCode = body.error?.code;
    const definite = [400, 401, 403].includes(response.status) && Number.isSafeInteger(errorCode) &&
      [10, 100, 102, 190, 200, 2500, 368].includes(errorCode) && body.error?.is_transient !== true;
    throw new PublicationProviderFailure(definite ? "rejected" : "unknown",
      definite ? [102, 190].includes(errorCode) ? "PUBLICATION_AUTH_EXPIRED" : "PUBLICATION_PROVIDER_REJECTED" :
        "PUBLICATION_PROVIDER_OUTCOME_UNKNOWN", [102, 190].includes(errorCode));
  }
  return { body, sha256: hash(Buffer.concat(chunks)), bytes };
}
function graph(c: Config, path: string, parameters: Record<string, string> = {}) {
  const settings = publicationSettings(c);
  if (!settings.available) throw new Problem(503, "PUBLICATION_NOT_CONFIGURED", "Publishing is not configured");
  const u = new URL(`https://graph.facebook.com/${settings.graph_version}/${path}`);
  for (const [key, value] of Object.entries(parameters)) u.searchParams.set(key, value);
  return u;
}
function authorization(c: Config, accessToken: string) {
  const proof = hmac(publicationSettings(c).app_secret!, accessToken);
  return { headers: { authorization: `Bearer ${accessToken}` }, proof };
}
export function publicationAuthorizationURL(c: Config, state: string) {
  const settings = publicationSettings(c);
  if (!settings.available) throw new Problem(503, "PUBLICATION_NOT_CONFIGURED", "Publishing is not configured");
  const u = new URL(settings.fixture ? c.PUBLICATION_FIXTURE_ORIGIN + "/consent" :
    `https://www.facebook.com/${settings.graph_version}/dialog/oauth`);
  for (const [key, value] of Object.entries({ client_id: settings.app_id!, redirect_uri: settings.callback,
    state, response_type: "code", scope: publicationScopes.join(","), auth_type: "rerequest" }))
    u.searchParams.set(key, value);
  return u.href;
}
export async function exchangePublicationCode(c: Config, code: string, signal?: AbortSignal): Promise<PublicationCredential> {
  const settings = publicationSettings(c);
  const exchanged = await publicationJSON(c, graph(c, "oauth/access_token", {
    client_id: settings.app_id!, client_secret: settings.app_secret!, redirect_uri: settings.callback, code,
  }), {}, signal);
  const tokenResult = z.object({ access_token: z.string().min(1).max(8192) }).safeParse(exchanged.body);
  if (!tokenResult.success) invalid();
  const access = tokenResult.data.access_token;
  const checked = await publicationJSON(c, graph(c, "debug_token", { input_token: access }), {
    headers: { authorization: `Bearer ${settings.app_id}|${settings.app_secret}` },
  }, signal);
  const proof = z.object({ data: z.object({ is_valid: z.literal(true), app_id: z.string(), user_id: providerIdentifier,
    expires_at: z.number().int().positive(), scopes: z.array(z.string()).max(100),
  }) }).safeParse(checked.body);
  if (!proof.success || proof.data.data.app_id !== settings.app_id || proof.data.data.expires_at * 1000 < Date.now() + 60_000)
    throw new Problem(409, "PUBLICATION_TOKEN_INVALID", "The publishing credential is not valid for this application");
  if (!facebookScopes.every(scope => proof.data.data.scopes.includes(scope)))
    throw new Problem(403, "PUBLICATION_SCOPE_REQUIRED", "Grant the separate Page publishing permissions");
  return credential.parse({ access_token: access, user_id: proof.data.data.user_id,
    expires_at: new Date(proof.data.data.expires_at * 1000).toISOString(), scopes: proof.data.data.scopes });
}
export async function discoverPublicationTargets(c: Config, secret: PublicationCredential, signal?: AbortSignal) {
  credential.parse(secret);
  const result: PublicationDiscoveredTarget[] = [], seen = new Set<string>(), cursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const auth = authorization(c, secret.access_token);
    const response = await publicationJSON(c, graph(c, "me/accounts", {
      fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: "50",
      appsecret_proof: auth.proof, ...(after ? { after } : {}),
    }), { headers: auth.headers }, signal);
    const parsed = z.object({ data: z.array(z.object({ id: providerIdentifier, name: z.string().min(1).max(1000),
      access_token: z.string().min(1).max(8192), tasks: z.array(z.string()).max(100),
      instagram_business_account: z.object({ id: providerIdentifier, username: z.string().max(1000).optional() }).optional(),
    })).max(50), paging: z.object({ cursors: z.object({ after: z.string().max(2048) }).optional(), next: z.string().max(12000).optional() }).optional(),
    }).safeParse(response.body);
    if (!parsed.success) invalid();
    for (const item of parsed.data.data) {
      if (seen.has(item.id)) invalid();
      seen.add(item.id);
      if (!item.tasks.some(task => ["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_CREATE_CONTENT"].includes(task))) continue;
      result.push({ kind: "facebook_page", external_id: item.id, page_id: item.id, name: item.name,
        access_token: item.access_token, capabilities: {
          formats: ["facebook_post", "facebook_photo", "facebook_gallery", "facebook_video"], story_business_account_required: false,
        } });
      if (item.instagram_business_account && ["instagram_basic", "instagram_content_publish"].every(s => secret.scopes.includes(s)))
        result.push({ kind: "instagram_professional", external_id: item.instagram_business_account.id,
          page_id: item.id, name: item.instagram_business_account.username ?? item.name, access_token: item.access_token,
          capabilities: { formats: ["instagram_photo", "instagram_reel", "instagram_carousel", "instagram_story"], story_business_account_required: true } });
      if (result.length > 100) throw new Problem(422, "PUBLICATION_ACCOUNT_LIMIT", "Use a connection with at most 100 publishing targets");
    }
    if (!parsed.data.paging?.next) return result;
    const cursor = parsed.data.paging.cursors?.after;
    if (!cursor || cursors.has(cursor)) invalid();
    cursors.add(cursor); after = cursor;
  }
  throw new Problem(422, "PUBLICATION_DISCOVERY_LIMIT", "Account discovery exceeded its bounded pages");
}
export async function executePublicationWrite(c: Config, accessToken: string, command: PublicationWrite, signal?: AbortSignal) {
  providerIdentifier.parse(command.owner_id);
  const auth = authorization(c, accessToken), u = graph(c, `${command.owner_id}/${command.edge}`, { appsecret_proof: auth.proof });
  if (command.edge === "videos") u.hostname = "graph-video.facebook.com";
  const response = await publicationJSON(c, u, { method: "POST", headers: {
    ...auth.headers, "content-type": "application/x-www-form-urlencoded",
  }, body: new URLSearchParams(command.parameters) }, signal);
  const parsed = (command.edge === "feed" ? remotePublicationIdentifier : providerIdentifier).safeParse(response.body.id);
  if (!parsed.success) invalid();
  return { remote_id: parsed.data, provider_body_sha256: response.sha256 };
}
export async function observePublicationProvider(c: Config, accessToken: string,
  purpose: "container" | "quota" | "video", remote_id: string, signal?: AbortSignal): Promise<PublicationProgress> {
  providerIdentifier.parse(remote_id);
  const auth = authorization(c, accessToken), response = await publicationJSON(c,
    graph(c, purpose === "quota" ? `${remote_id}/content_publishing_limit` : remote_id, {
      fields: purpose === "quota" ? "quota_usage,config" : purpose === "container" ? "status_code,status" : "published,status",
      appsecret_proof: auth.proof,
    }), { headers: auth.headers }, signal);
  const checked_at = new Date().toISOString();
  if (purpose === "container") {
    const status = z.enum(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]).safeParse(response.body.status_code);
    if (!status.success) invalid();
    return { containers: { [remote_id]: { status: status.data, checked_at } } };
  }
  if (purpose === "quota") {
    const quota = z.object({ data: z.array(z.object({ quota_usage: z.number().int().nonnegative(), config: z.object({
      quota_total: z.number().int().positive(),
    }) })).length(1) }).safeParse(response.body);
    if (!quota.success) invalid();
    return { quota: { usage: quota.data.data[0].quota_usage, total: quota.data.data[0].config.quota_total, checked_at } };
  }
  const video = z.object({ published: z.boolean(), status: z.object({ video_status: z.string().min(1).max(100) }) }).safeParse(response.body);
  if (!video.success) invalid();
  return { video: { published: video.data.published, status: video.data.status.video_status, checked_at } };
}

/** Read-only reconciliation. A user-supplied ID is identity evidence, never causal attribution. */
export async function inspectPublicationEvidence(c: Config, accessToken: string, input: {
  kind: "container" | "facebook_video" | "facebook_post" | "instagram_media";
  remote_id: string; expected_owner: string;
}, signal?: AbortSignal) {
  remotePublicationIdentifier.parse(input.remote_id); providerIdentifier.parse(input.expected_owner);
  if (input.kind !== "facebook_post") providerIdentifier.parse(input.remote_id);
  const auth = authorization(c, accessToken), fields = {
    container: "id,status_code,status", facebook_video: "id,from{id},published,status",
    facebook_post: "id,from{id},is_published", instagram_media: "id,owner{id},media_type",
  }[input.kind];
  const response = await publicationJSON(c, graph(c, input.remote_id, { fields, appsecret_proof: auth.proof }), { headers: auth.headers }, signal);
  const identity = remotePublicationIdentifier.safeParse(response.body.id);
  if (!identity.success || identity.data !== input.remote_id) invalid();
  const base = { remote_id: identity.data, provider_body_sha256: response.sha256, checked_at: new Date().toISOString() };
  if (input.kind === "container") {
    const status = z.enum(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]).safeParse(response.body.status_code);
    if (!status.success) invalid();
    return { ...base, container_status: status.data };
  }
  const owner = providerIdentifier.safeParse(input.kind === "instagram_media" ? response.body.owner?.id : response.body.from?.id);
  if (!owner.success) invalid();
  if (input.kind === "facebook_video") {
    const result = z.object({ published: z.boolean(), status: z.object({ video_status: z.string().min(1).max(100) }) }).safeParse(response.body);
    if (!result.success) invalid();
    return { ...base, owner_matches: owner.data === input.expected_owner, published: result.data.published, video_status: result.data.status.video_status };
  }
  return { ...base, owner_matches: owner.data === input.expected_owner };
}
