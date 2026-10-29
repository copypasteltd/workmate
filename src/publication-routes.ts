import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Principal } from "./auth.js";
import { requireUser } from "./auth.js";
import { key, replay } from "./access.js";
import { hash, Problem, uuid } from "./lib.js";
import { Storage } from "./storage.js";
import {
  publicationPolicyInput, publicationPrepareInput, publicationDecisionInput, publicationRevisionInput,
  publicationState, publicationSpecification,
} from "./publication-model.js";
import { publicationMode, publicationContext, publicationProjectAuthority, currentPublicationPolicy, assertPublicationSources, assertPublicationTask, assertPublicationContentAvailable } from "./publication-authority.js";
import { Publications, publicationMetadata, publicationContent, publicationOperation } from "./publication-service.js";
import { checkPublicationBytes } from "./publication-media.js";
import { observePublication, closeUnknownPublication } from "./publication-reconciliation.js";

const base = "/v1/tenants/:tenant/projects/:project/publications";
const scope = (req: FastifyRequest) => z.object({ tenant: uuid, project: uuid }).passthrough().parse(req.params);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as any).id);
export function publicationRange(value: string | undefined, size: number) {
  if (value === undefined) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || !match[1] && !match[2]) throw new Problem(416, "PUBLICATION_RANGE_INVALID", "Choose one valid media byte range");
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Problem(416, "PUBLICATION_RANGE_INVALID", "Choose a positive media suffix");
    start = Math.max(0, size - suffix); end = size - 1;
  } else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size)
    throw new Problem(416, "PUBLICATION_RANGE_INVALID", "The media range is outside the approved file");
  return { start, end };
}
export async function sendMedia(storage: Storage, reply: FastifyReply, req: FastifyRequest,
  media: { storage_key: string; sha256: string; bytes: number; mime: string }, verify: () => Promise<void>) {
  let range: ReturnType<typeof publicationRange>;
  try { range = publicationRange(req.headers.range, media.bytes); }
  catch (error) { reply.header("content-range", `bytes */${media.bytes}`); throw error; }
  await checkPublicationBytes(storage, media.storage_key, media.bytes, media.sha256);
  const stream = range ? await storage.range(media.storage_key, range.start, range.end, media.bytes) : await storage.stream(media.storage_key);
  try { await verify(); } catch (error) { stream.destroy(); throw error; }
  reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff").header("accept-ranges", "bytes")
    .header("x-content-sha256", media.sha256).header("content-disposition", "inline").type(media.mime);
  if (range) reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${media.bytes}`);
  reply.header("content-length", range ? range.end - range.start + 1 : media.bytes);
  if (req.method === "HEAD") { stream.destroy(); return reply.send(); }
  return reply.send(stream);
}
export function registerPublications(app: FastifyInstance, db: Database, storage: Storage) {
  const service = new Publications(db, storage);
  app.get(base + "/policy", { preHandler: requireUser(db) }, async (req, reply) => {
    const s = scope(req), q = z.object({ target_id: uuid }).strict().parse(req.query);
    reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "read");
      if (!(await tx.query(`SELECT 1 FROM publication_targets t JOIN publication_connection_projects g ON g.connection_id=t.connection_id
        WHERE t.id=$1 AND t.tenant_id=$2 AND g.project_id=$3`, [q.target_id, s.tenant, s.project])).rowCount)
        throw new Problem(404, "NOT_FOUND", "Publishing account not found");
      const current = await currentPublicationPolicy(tx, s.project, q.target_id);
      return { policy: current ? { id: current.id, version: current.version, policy: current.body, payload_sha256: current.payload_sha256 } : null };
    }, s.tenant, true, req.principal.id);
  });
  app.put(base + "/policy/:id", { preHandler: requireUser(db) }, async req => {
    const s = scope(req), id = idOf(req), b = publicationPolicyInput.parse(req.body), requestKey = key(req);
    return db.tx(async tx => {
      // Check current management authority before returning a saved response.
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "manage");
      return replay(tx, req.principal.id, `publication.policy:${s.project}:${id}`, requestKey, b,
        () => service.savePolicy(tx, req.principal, s.tenant, s.project, id, b));
    }, s.tenant, true, req.principal.id);
  });
  app.post(base + "/previews", { preHandler: requireUser(db) }, async (req, reply) => {
    const s = scope(req); reply.header("cache-control", "private, no-store");
    return service.preview(req.principal, s.tenant, s.project, req.body);
  });
  app.post(base + "/operations", { preHandler: requireUser(db) }, async req => {
    const s = scope(req), b = publicationPrepareInput.parse(req.body), requestKey = key(req);
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "write");
      return replay(tx, req.principal.id, `publication.prepare:${s.project}`, requestKey, b,
        () => service.prepare(tx, req.principal, s.tenant, s.project, b));
    }, s.tenant, true, req.principal.id);
  });
  app.post(base + "/operations/:id/decision", { preHandler: requireUser(db) }, async req => {
    const s = scope(req), id = idOf(req), b = publicationDecisionInput.parse(req.body), requestKey = key(req);
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "write");
      return replay(tx, req.principal.id, `publication.decision:${s.project}:${id}`, requestKey, b,
        () => service.decide(tx, req.principal, s.tenant, s.project, id, b));
    }, s.tenant, true, req.principal.id);
  });
  app.post(base + "/operations/:id/cancel", { preHandler: requireUser(db) }, async req => {
    const s = scope(req), id = idOf(req), b = publicationRevisionInput.parse(req.body), requestKey = key(req);
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "write");
      return replay(tx, req.principal.id, `publication.cancel:${s.project}:${id}`, requestKey, b,
        () => service.cancel(tx, req.principal, s.tenant, s.project, id, b.expected_version));
    }, s.tenant, true, req.principal.id);
  });
  app.post(base + "/operations/:id/observe", { preHandler: requireUser(db) }, async req => {
    const s = scope(req); return observePublication(db, req.principal, s.tenant, s.project, idOf(req), req.body);
  });
  app.post(base + "/operations/:id/close-unknown", { preHandler: requireUser(db) }, async req => {
    const s = scope(req), id = idOf(req), requestKey = key(req);
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "write");
      return replay(tx, req.principal.id, `publication.close:${s.project}:${id}`, requestKey, req.body,
        () => closeUnknownPublication(db, tx, req.principal, s.tenant, s.project, id, req.body));
    }, s.tenant, true, req.principal.id);
  });
  app.get(base + "/operations", { preHandler: requireUser(db) }, async (req, reply) => {
    const s = scope(req), q = z.object({ state: publicationState.optional(), cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict().parse(req.query);
    reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "read");
      const role = (await tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2", [s.tenant, req.principal.id])).rows[0];
      const manager = ["owner", "admin"].includes(role.role), rows = (await tx.query(`SELECT * FROM publication_operations WHERE tenant_id=$1 AND project_id=$2 AND data_mode=$3
        AND ($4::boolean OR actor_id=$5) AND ($6::text IS NULL OR state=$6) AND ($7::uuid IS NULL OR id>$7) ORDER BY id LIMIT $8`,
        [s.tenant, s.project, publicationMode(db), manager, req.principal.id, q.state ?? null, q.cursor ?? null, q.limit + 1])).rows;
      return { items: rows.slice(0, q.limit).map(publicationMetadata), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null, data_mode: publicationMode(db) };
    }, s.tenant, true, req.principal.id);
  });
  app.get(base + "/operations/:id", { preHandler: requireUser(db) }, async (req, reply) => {
    const s = scope(req), id = idOf(req); reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "read");
      const row = await publicationOperation(tx, s.tenant, s.project, id);
      if (row.data_mode !== publicationMode(db)) throw new Problem(404, "NOT_FOUND", "Publication not found");
      const canRead = row.actor_id === req.principal.id;
      if (!canRead) await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "manage");
      let contentAvailable = canRead && !row.erased_at;
      if (contentAvailable) try { await assertPublicationContentAvailable(tx, row); }
      catch (error) { if (!(error instanceof Problem) || error.status >= 500) throw error; contentAvailable = false; }
      const effects = (await tx.query("SELECT id,step_key,state,request_sha256,remote_id,result,error_code,dispatched_at,finished_at FROM publication_effects WHERE operation_id=$1 ORDER BY created_at,id", [id])).rows;
      const events = (await tx.query("SELECT version,state,created_at,details FROM publication_events WHERE operation_id=$1 ORDER BY version", [id])).rows;
      return { ...publicationMetadata(row), can_view_content: contentAvailable,
        content: contentAvailable ? publicationContent(publicationSpecification.parse(row.specification)) : null,
        effects, events, result: row.result, observation: row.observation,
        resolution: row.resolution ? Object.fromEntries(Object.entries(row.resolution).filter(([name]) => canRead || name !== "reason")) : null,
      };
    }, s.tenant, true, req.principal.id);
  });
  app.get(base + "/requests/:requestKey", { preHandler: requireUser(db) }, async (req, reply) => {
    const s = scope(req), requestKey = z.string().regex(/^[\w:-]{16,128}$/).parse((req.params as any).requestKey);
    const q = z.object({ operation_id: uuid.optional() }).strict().parse(req.query);
    reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "read");
      const result = (await tx.query(`SELECT action,response,revoked_at FROM request_replays WHERE actor_id=$1 AND key=$2
        AND action IN($3,$4,$5,$6)`, [req.principal.id, requestKey, `publication.prepare:${s.project}`, `publication.decision:${s.project}:${q.operation_id ?? ""}`,
          `publication.cancel:${s.project}:${q.operation_id ?? ""}`, `publication.close:${s.project}:${q.operation_id ?? ""}`])).rows[0];
      if (!result) throw new Problem(404, "NOT_FOUND", "The original publication request has not committed");
      if (result.revoked_at) throw new Problem(410, "REQUEST_RESULT_REMOVED", "The saved result was removed; it will not be replayed");
      return { result: result.response };
    }, s.tenant, true, req.principal.id);
  });
  for (const kind of ["previews", "operations"] as const) {
    const mediaPath = base + `/${kind}/:id/media/:ordinal`;
    const authorize = async (req: FastifyRequest) => {
      const s = scope(req), id = idOf(req), ordinal = z.coerce.number().int().min(0).max(9).parse((req.params as any).ordinal);
      return db.tx(async tx => {
      await publicationProjectAuthority(tx, req.principal, s.tenant, s.project, "read");
      const row = (await tx.query(`SELECT * FROM ${kind === "previews" ? "publication_previews" : "publication_operations"}
        WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND actor_id=$4`, [id, s.tenant, s.project, req.principal.id])).rows[0];
      if (!row || row.erased_at || kind === "previews" && row.expires_at.valueOf() <= Date.now()) throw new Problem(404, "NOT_FOUND", "Publication media not found");
      const specification = publicationSpecification.parse(row.specification);
      await assertPublicationTask(tx, row);
      await assertPublicationSources(tx, req.principal, s.tenant, s.project, specification);
      const source = specification.sources[ordinal];
      if (!source) throw new Problem(404, "NOT_FOUND", "Publication media not found");
      return source;
      }, s.tenant, true, req.principal.id);
    };
    app.get(mediaPath, { preHandler: requireUser(db) }, async (req, reply) => {
      const media = await authorize(req); return sendMedia(storage, reply, req, media, async () => { await authorize(req); });
    });
    app.get(mediaPath + "/info", { preHandler: requireUser(db) }, async (req, reply) => {
      const media = await authorize(req); reply.header("cache-control", "private, no-store");
      return { mime: media.mime, bytes: media.bytes, sha256: media.sha256, width: media.width, height: media.height, duration_ms: media.duration_ms };
    });
  }
  app.route({ method: ["GET", "HEAD"], url: "/v1/publication-media/:opaque", config: { rateLimit: { max: 1200, timeWindow: 60000 } }, handler: async (req, reply) => {
    const opaque = z.string().regex(/^[\w-]{43}$/).parse((req.params as any).opaque);
    const authorize = async () => db.tx(async tx => {
      const grant = (await tx.query("SELECT * FROM publication_media_grants WHERE token_sha256=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()", [hash(opaque)])).rows[0];
      if (!grant) throw new Problem(404, "NOT_FOUND", "Publication media not found");
      const row = (await tx.query("SELECT * FROM publication_operations WHERE id=$1 AND erased_at IS NULL", [grant.operation_id])).rows[0];
      if (!row || !row.confirmed_by || !["preparing", "waiting_media", "publishing", "processing", "unknown"].includes(row.state))
        throw new Problem(404, "NOT_FOUND", "Publication media not found");
      const user = (await tx.query("SELECT id,name,email FROM users WHERE id=$1", [row.actor_id])).rows[0];
      const p: Principal = { ...user, audience: "user", authVersion: row.actor_auth_version, sessionId: "", sessionHash: "" };
      const specification = publicationSpecification.parse(row.specification);
      await publicationContext(db, tx, p, row.tenant_id, row.project_id, row.target_id, "write", specification);
      await assertPublicationTask(tx, row);
      await assertPublicationSources(tx, p, row.tenant_id, row.project_id, specification);
      const source = (await tx.query("SELECT * FROM publication_sources WHERE operation_id=$1 AND ordinal=$2 AND erased_at IS NULL", [row.id, grant.ordinal])).rows[0];
      if (!source || source.rendition_key !== specification.sources[grant.ordinal]?.storage_key)
        throw new Problem(404, "NOT_FOUND", "Publication media not found");
      return specification.sources[grant.ordinal];
    }, undefined, true);
    const media = await authorize(); return sendMedia(storage, reply, req, media, async () => { await authorize(); });
  } });
}
