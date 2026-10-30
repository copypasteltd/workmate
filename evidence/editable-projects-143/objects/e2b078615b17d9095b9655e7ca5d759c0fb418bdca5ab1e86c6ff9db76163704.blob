import type { Database, Tx } from "./db.js";
import { audit, type Principal } from "./auth.js";
import { Problem, hash } from "./lib.js";
import { publicationObserveInput, publicationCloseInput, publicationDigest } from "./publication-model.js";
import { publicationContext, publicationProjectAuthority, publicationMode, type PublicationAuthorizer } from "./publication-authority.js";
import { publicationMetadata, publicationOperation, updatePublication } from "./publication-service.js";
import { inspectPublicationEvidence } from "./publication-provider.js";
import { persistPublicationReceipt } from "./publication-receipts.js";

async function authorizeOperation(tx: Tx, p: Principal, tenant: string, project: string, id: string, authorize?: PublicationAuthorizer) {
  if (p.audience === "admin") {
    if (!authorize) throw new Problem(403, "PUBLICATION_ADMIN_AUTHORITY_REQUIRED", "Current scoped administrative authority is required");
    await authorize(tx);
  } else {
    await publicationProjectAuthority(tx, p, tenant, project, "write");
    const row = await publicationOperation(tx, tenant, project, id);
    if (row.actor_id !== p.id) await publicationProjectAuthority(tx, p, tenant, project, "manage");
  }
}
async function binding(tx: Tx, tenant: string, project: string, target: string) {
  const row = (await tx.query(`SELECT t.id,t.connection_id,t.auth_version AS target_auth_version,t.kind,t.external_id,
    t.enabled,c.auth_version AS connection_auth_version,c.configuration_sha256,c.state,c.data_mode,
    EXISTS(SELECT 1 FROM publication_connection_projects g WHERE g.connection_id=c.id AND g.tenant_id=$2 AND g.project_id=$3) AS project_granted
    FROM publication_targets t JOIN publication_connections c ON c.id=t.connection_id
    WHERE t.id=$1 AND t.tenant_id=$2 FOR SHARE OF t,c`, [target, tenant, project])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Publishing account not found");
  return row;
}
function freshUnknown(row: any, version: number, mode: string) {
  if (row.version !== version || row.data_mode !== mode || !["unknown", "processing"].includes(row.state))
    throw new Problem(409, "PUBLICATION_OBSERVATION_CHANGED", "Reload the current unresolved publication before observing");
}

/** Network reads occur outside transactions; authority and connection binding are rechecked before storing evidence. */
export async function observePublication(db: Database, p: Principal, tenant: string, project: string, id: string,
  input: unknown, authorize?: PublicationAuthorizer) {
  const b = publicationObserveInput.parse(input);
  const initial = await db.tx(async tx => {
    await authorizeOperation(tx, p, tenant, project, id, authorize);
    const row = await publicationOperation(tx, tenant, project, id); freshUnknown(row, b.expected_version, publicationMode(db));
    const account = await binding(tx, tenant, project, row.target_id);
    const effects = (await tx.query("SELECT * FROM publication_effects WHERE operation_id=$1 ORDER BY created_at,id", [id])).rows;
    let access: string | null = null;
    try { access = (await publicationContext(db, tx, p, tenant, project, row.target_id, "read", undefined, authorize)).access_token; }
    catch (error) { if (!(error instanceof Problem) || error.status >= 500 || error.status === 401) throw error; }
    return { row, account, effects, access };
  }, tenant, true, p.id);
  const published = initial.effects.find(effect => effect.step_key === "publish");
  const container = initial.effects.find(effect => effect.step_key === "container" && effect.state === "applied");
  const isInstagram = initial.row.format.startsWith("instagram_");
  // Prefer the causally bound container. A pasted remote ID can only add identity evidence.
  const remote = isInstagram && container?.remote_id ? container.remote_id : published?.remote_id ?? b.remote_id;
  const kind = isInstagram && container?.remote_id ? "container" : initial.row.format === "facebook_video" ? "facebook_video" : isInstagram ? "instagram_media" : "facebook_post";
  let evidence: Awaited<ReturnType<typeof inspectPublicationEvidence>> | null = null, lookup = "unavailable", errorCode: string | null = null;
  if (initial.access && remote) {
    try { evidence = await inspectPublicationEvidence(db.config, initial.access, {
      kind, remote_id: remote, expected_owner: initial.account.external_id,
    }); lookup = "observed"; }
    catch (error) { errorCode = error instanceof Problem && /^PUBLICATION_[A-Z0-9_]+$/.test(error.code) ? error.code : "PUBLICATION_OBSERVATION_UNAVAILABLE"; }
  } else if (initial.access) lookup = "no_attributed_remote_id";
  const boundPublished = evidence && "container_status" in evidence && evidence.container_status === "PUBLISHED" &&
    published && ["dispatched", "unknown"].includes(published.state) && container?.remote_id === remote;
  const videoPublished = evidence && "video_status" in evidence && evidence.owner_matches && evidence.published && evidence.video_status === "ready" &&
    published?.state === "applied" && published.remote_id === remote;
  const observation = { protocol: "marketing-publication-observation/1", observed_at: new Date().toISOString(),
    binding_sha256: publicationDigest(initial.account), lookup, error_code: errorCode, evidence,
    attribution: boundPublished ? "bound_container_status" : videoPublished ? "original_video_receipt_and_status" : "not_proven",
    submitted_remote_id: b.remote_id ?? null };
  const stored = { ...observation, sha256: publicationDigest(observation) };
  let updated = await db.tx(async tx => {
    await authorizeOperation(tx, p, tenant, project, id, authorize);
    const account = await binding(tx, tenant, project, initial.row.target_id);
    if (publicationDigest(account) !== observation.binding_sha256) throw new Problem(409, "PUBLICATION_OBSERVATION_CHANGED", "Observe again after account authorization changes");
    const row = await publicationOperation(tx, tenant, project, id, true); freshUnknown(row, b.expected_version, publicationMode(db));
    const changes: Record<string, unknown> = { observation: stored };
    if (videoPublished && evidence && "video_status" in evidence) Object.assign(changes, { state: "succeeded", finished_at: new Date(), error_code: null,
      progress: { ...row.progress, video: { published: true, status: "ready", checked_at: evidence.checked_at } },
      lease_token: null, lease_until: null, next_check_at: null });
    const result = await updatePublication(tx, row, changes);
    await audit(tx, p, "publication.observe", id, "succeeded", { observation_sha256: stored.sha256, attribution: observation.attribution }, tenant);
    return result;
  }, tenant, true, p.id);
  if (boundPublished && published && container && evidence) {
    await persistPublicationReceipt(db, updated, published, "applied", { request_sha256: published.request_sha256,
      attribution: "bound_container_status", container_id: container.remote_id, observed_status: "PUBLISHED", provider_body_sha256: evidence.provider_body_sha256 });
    updated = await db.tx(async tx => { await authorizeOperation(tx, p, tenant, project, id, authorize);
      return publicationOperation(tx, tenant, project, id); }, tenant, true, p.id);
  }
  return { ...publicationMetadata(updated), observation: updated.observation };
}

export async function closeUnknownPublication(db: Database, tx: Tx, p: Principal, tenant: string, project: string,
  id: string, input: unknown, authorize?: PublicationAuthorizer) {
  const b = publicationCloseInput.parse(input);
  await authorizeOperation(tx, p, tenant, project, id, authorize);
  const initial = await publicationOperation(tx, tenant, project, id), account = await binding(tx, tenant, project, initial.target_id);
  const row = await publicationOperation(tx, tenant, project, id, true), { sha256, ...observation } = row.observation ?? {};
  const at = Date.parse(observation.observed_at ?? "");
  if (row.state !== "unknown" || row.version !== b.expected_version || row.data_mode !== publicationMode(db) || !Number.isFinite(at) ||
      at > Date.now() + 1000 || at < Date.now() - 600_000 || sha256 !== b.observation_sha256 || publicationDigest(observation) !== sha256 ||
      observation.binding_sha256 !== publicationDigest(account) || observation.attribution !== "not_proven")
    throw new Problem(409, "PUBLICATION_CLOSURE_CHANGED", "Observe the unknown operation again before explicitly acknowledging closure");
  const resolution = { reason: b.reason.trim(), reason_sha256: hash(b.reason.trim()), resolved_by: p.id, resolved_by_audience: p.audience,
    resolved_at: new Date().toISOString(), acknowledge_unknown_attribution: true, observation_sha256: sha256 };
  const updated = await updatePublication(tx, row, { state: "closed_unknown", resolution, finished_at: new Date(),
    lease_token: null, lease_until: null, next_check_at: null });
  await tx.query("UPDATE publication_media_grants SET revoked_at=clock_timestamp(),encrypted_token=NULL WHERE operation_id=$1 AND revoked_at IS NULL", [id]);
  await audit(tx, p, "publication.close_unknown", id, "succeeded", { observation_sha256: sha256, reason_sha256: resolution.reason_sha256 }, tenant);
  return publicationMetadata(updated);
}
