import { NativeSessionError } from "./native-session.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PublicationScope = { tenant: string; project: string; operation?: string };
export const publicationFormats = [
  "facebook_post", "facebook_photo", "facebook_gallery", "facebook_video",
  "instagram_photo", "instagram_reel", "instagram_carousel", "instagram_story",
] as const;
export const publicationStates = [
  "awaiting_confirmation", "queued", "preparing", "waiting_media", "publishing",
  "processing", "succeeded", "failed", "cancelled", "expired", "unknown", "closed_unknown",
] as const;
export type PublicationSummary = {
  id: string; tenant_id: string; project_id: string;
  state: typeof publicationStates[number]; format: typeof publicationFormats[number];
  version: number; payload_sha256: string; created_at: string; expires_at: string;
  data_mode: "simulated" | "configured_services";
};

export function publicationScope(input: unknown): PublicationScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid publishing scope");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["tenant", "project", "operation"].includes(key)) ||
      typeof value.tenant !== "string" || !uuid.test(value.tenant) ||
      typeof value.project !== "string" || !uuid.test(value.project) ||
      value.operation !== undefined && (typeof value.operation !== "string" || !uuid.test(value.operation)))
    throw new Error("Invalid publishing scope");
  return { tenant: value.tenant, project: value.project,
    ...(typeof value.operation === "string" ? { operation: value.operation } : {}) };
}

export function publicationSummary(value: unknown, scope: PublicationScope): PublicationSummary {
  if (!value || typeof value !== "object") throw new Error("Invalid publishing response");
  const row = value as PublicationSummary;
  if (!uuid.test(row.id) || row.tenant_id !== scope.tenant || row.project_id !== scope.project ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      !publicationStates.includes(row.state) || !publicationFormats.includes(row.format) ||
      typeof row.payload_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.payload_sha256) ||
      !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.expires_at)) ||
      !["simulated", "configured_services"].includes(row.data_mode))
    throw new Error("Publishing response does not match this workspace");
  return row;
}

/** Opens only the fixed company Web route, after current server and session checks. */
export async function openPublicationWorkspace(input: unknown, io: {
  webOrigin: string;
  identity: () => Promise<string | undefined>;
  request: (path: string, tenant: string) => Promise<unknown>;
  open: (url: string) => Promise<unknown>;
}) {
  const scope = publicationScope(input), origin = new URL(io.webOrigin);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      !(origin.protocol === "https:" || origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))
    throw new Error("Invalid company Web origin");
  const epoch = await io.identity();
  if (!epoch || !uuid.test(epoch)) throw new NativeSessionError("AUTH_CHANGED");
  const base = `/v1/tenants/${scope.tenant}/projects/${scope.project}/publications`;
  await io.request(base + "/settings", scope.tenant);
  if (scope.operation) {
    const operation = publicationSummary(await io.request(base + "/operations/" + scope.operation, scope.tenant), scope);
    if (operation.id !== scope.operation) throw new Error("Publishing response does not match the selected operation");
  }
  if (await io.identity() !== epoch) throw new NativeSessionError("AUTH_CHANGED");
  const url = new URL("/app/publications", origin);
  url.searchParams.set("tenant", scope.tenant);
  url.searchParams.set("project", scope.project);
  if (scope.operation) url.searchParams.set("operation", scope.operation);
  await io.open(url.href);
  return { ok: true };
}
