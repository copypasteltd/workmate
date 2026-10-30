import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireAdmin, audit } from "./auth.js";
import { lockAdminAccess, permit, requireSensitiveAdmin } from "./admin-access.js";
import { readScope } from "./admin-directory.js";
import { key, replay } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { Storage } from "./storage.js";
import { publicationPolicyInput, publicationRevisionInput, publicationState, publicationSpecification } from "./publication-model.js";
import { currentPublicationPolicy, publicationMode, assertPublicationContentAvailable } from "./publication-authority.js";
import { Publications, publicationMetadata, publicationContent, publicationOperation } from "./publication-service.js";
import { closeUnknownPublication, observePublication } from "./publication-reconciliation.js";
import { sendMedia } from "./publication-routes.js";

const permission = { read: "admin.publication.read", policy: "admin.publication.policy.write", resolve: "admin.publication.resolve" };
const root = "/v1/admin/tenants/:tenant/projects/:project/publications";
const scope = (req: FastifyRequest) => z.object({ tenant: uuid, project: uuid }).passthrough().parse(req.params);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as any).id);
const query = z.object({ tenant_id: uuid.optional(), project_id: uuid.optional(), target_id: uuid.optional(),
  state: publicationState.optional(), cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();

export function registerPublicationAdmin(app: FastifyInstance, db: Database, storage: Storage) {
  const service = new Publications(db, storage);
  const authorize = (req: FastifyRequest, required: string) => async (tx: Tx) => {
    const s = scope(req); await lockAdminAccess(tx); await requireSensitiveAdmin(tx, req.principal);
    await permit(tx, req.principal, required, s);
    if (!(await tx.query(`SELECT 1 FROM projects p JOIN tenants t ON t.id=p.tenant_id
      WHERE p.id=$1 AND p.tenant_id=$2 AND t.data_mode=$3`, [s.project, s.tenant, publicationMode(db)])).rowCount)
      throw new Problem(404, "NOT_FOUND", "Project not found");
  };
  app.get("/v1/admin/publications/operations", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const q = query.parse(req.query); reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, permission.read);
      let where = s.scope(permission.read, "o.tenant_id", "o.project_id");
      for (const name of ["tenant_id", "project_id", "target_id", "state"] as const) if (q[name]) where += ` AND o.${name}=${s.arg(q[name])}`;
      if (q.cursor) where += ` AND o.id>${s.arg(q.cursor)}::uuid`;
      const rows = (await tx.query(`SELECT o.* FROM publication_operations o WHERE ${where} AND o.data_mode=${s.arg(publicationMode(db))}
        ORDER BY o.id LIMIT ${s.arg(q.limit + 1)}`, s.values)).rows;
      await audit(tx, req.principal, permission.read, undefined, "succeeded", { count: Math.min(rows.length, q.limit) });
      return { items: rows.slice(0, q.limit).map(publicationMetadata), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null, data_mode: publicationMode(db) };
    }, undefined, true, req.principal.id);
  });
  app.get(root + "/connections", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const s = scope(req); reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await authorize(req, permission.read)(tx);
      const rows = (await tx.query(`SELECT t.id,t.kind,t.external_id,t.page_id,t.name,t.enabled,t.capabilities,c.id AS connection_id,
        c.version AS connection_version,c.state AS connection_state,c.created_by FROM publication_targets t
        JOIN publication_connections c ON c.id=t.connection_id JOIN publication_connection_projects g ON g.connection_id=c.id
        WHERE g.project_id=$1 AND g.tenant_id=$2 AND c.data_mode=$3 ORDER BY t.kind,t.name,t.id LIMIT 100`, [s.project, s.tenant, publicationMode(db)])).rows;
      await audit(tx, req.principal, permission.read, s.project, "succeeded", { resource: "publication_targets", count: rows.length }, s.tenant);
      return { items: rows, data_mode: publicationMode(db) };
    }, s.tenant, true, req.principal.id);
  });
  app.get(root + "/policy", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const s = scope(req), q = z.object({ target_id: uuid }).strict().parse(req.query); reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await authorize(req, permission.read)(tx);
      if (!(await tx.query(`SELECT 1 FROM publication_targets t JOIN publication_connection_projects g ON g.connection_id=t.connection_id
        WHERE t.id=$1 AND t.tenant_id=$2 AND g.project_id=$3 AND g.tenant_id=$2`, [q.target_id, s.tenant, s.project])).rowCount)
        throw new Problem(404, "NOT_FOUND", "Publishing account not found");
      const current = await currentPublicationPolicy(tx, s.project, q.target_id);
      await audit(tx, req.principal, permission.read, q.target_id, "succeeded", { resource: "publication_policy" }, s.tenant);
      return { policy: current ? { id: current.id, version: current.version, policy: current.body, payload_sha256: current.payload_sha256 } : null };
    }, s.tenant, true, req.principal.id);
  });
  app.put(root + "/policy/:id", { preHandler: requireAdmin(db) }, async req => {
    const s = scope(req), id = idOf(req), body = publicationPolicyInput.parse(req.body), requestKey = key(req), guard = authorize(req, permission.policy);
    return db.tx(async tx => {
      await guard(tx);
      await permit(tx, req.principal, permission.policy, s, { hours: body.policy.enabled ? Math.ceil((Date.parse(body.policy.expires_at) - Date.now()) / 3_600_000) : 0 });
      return replay(tx, req.principal.id, `admin.publication.policy:${s.project}:${id}`, requestKey, body,
        () => service.savePolicy(tx, req.principal, s.tenant, s.project, id, body, guard));
    }, s.tenant, true, req.principal.id);
  });
  app.get(root + "/operations/:id", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const s = scope(req), id = idOf(req), q = z.object({ include_content: z.enum(["true", "false"]).default("false") }).strict().parse(req.query);
    reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await authorize(req, permission.read)(tx);
      const row = await publicationOperation(tx, s.tenant, s.project, id);
      if (row.data_mode !== publicationMode(db)) throw new Problem(404, "NOT_FOUND", "Publication not found");
      const body = q.include_content === "true";
      if (body) await permit(tx, req.principal, "admin.content.body.read", s);
      if (body && !row.erased_at) await assertPublicationContentAvailable(tx, row);
      const effects = (await tx.query("SELECT id,step_key,state,remote_id,request_sha256,result,error_code,dispatched_at,finished_at FROM publication_effects WHERE operation_id=$1 ORDER BY created_at,id", [id])).rows;
      const events = (await tx.query("SELECT version,state,details,created_at FROM publication_events WHERE operation_id=$1 ORDER BY version", [id])).rows;
      await audit(tx, req.principal, body ? "admin.content.body.read" : permission.read, id, "succeeded", { resource: "publication", project_id: s.project }, s.tenant);
      return { ...publicationMetadata(row), can_view_content: body && !row.erased_at,
        content: body && !row.erased_at ? publicationContent(publicationSpecification.parse(row.specification)) : null,
        effects, events, result: row.result, observation: row.observation,
        resolution: row.resolution ? Object.fromEntries(Object.entries(row.resolution).filter(([name]) => body || name !== "reason")) : null };
    }, s.tenant, true, req.principal.id);
  });
  const mediaPath = root + "/operations/:id/media/:ordinal";
  const authorizeMedia = async (req: FastifyRequest) => {
    const s = scope(req), id = idOf(req), ordinal = z.coerce.number().int().min(0).max(9).parse((req.params as any).ordinal);
    return db.tx(async tx => {
      await authorize(req, permission.read)(tx);
      await permit(tx, req.principal, "admin.content.body.read", s);
      const row = await publicationOperation(tx, s.tenant, s.project, id);
      if (row.erased_at || row.data_mode !== publicationMode(db)) throw new Problem(404, "NOT_FOUND", "Publication media not found");
      await assertPublicationContentAvailable(tx, row);
      const media = publicationSpecification.parse(row.specification).sources[ordinal];
      if (!media) throw new Problem(404, "NOT_FOUND", "Publication media not found");
      await audit(tx, req.principal, "admin.content.body.read", id, "succeeded", { resource: "publication_media", project_id: s.project, ordinal }, s.tenant);
      return media;
    }, s.tenant, true, req.principal.id);
  };
  app.get(mediaPath, { preHandler: requireAdmin(db) }, async (req, reply) => {
    const media = await authorizeMedia(req);
    return sendMedia(storage, reply, req, media, async () => { await authorizeMedia(req); });
  });
  app.get(mediaPath + "/info", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const media = await authorizeMedia(req); reply.header("cache-control", "private, no-store");
    return { mime: media.mime, bytes: media.bytes, sha256: media.sha256, width: media.width, height: media.height, duration_ms: media.duration_ms };
  });
  app.get(root + "/requests/:requestKey", { preHandler: requireAdmin(db) }, async (req, reply) => {
    const s = scope(req), requestKey = z.string().uuid().parse((req.params as any).requestKey);
    const q = z.object({ action: z.enum(["policy", "cancel", "close-unknown"]), resource_id: uuid }).strict().parse(req.query);
    reply.header("cache-control", "private, no-store");
    return db.tx(async tx => {
      await authorize(req, permission.read)(tx);
      await permit(tx, req.principal, q.action === "policy" ? permission.policy : permission.resolve, s);
      if (q.action === "policy") {
        if (!(await tx.query(`SELECT 1 FROM publication_targets t JOIN publication_connections c ON c.id=t.connection_id
          JOIN publication_connection_projects g ON g.connection_id=c.id
          WHERE t.id=$1 AND t.tenant_id=$2 AND g.project_id=$3 AND g.tenant_id=$2 AND c.data_mode=$4`,
          [q.resource_id, s.tenant, s.project, publicationMode(db)])).rowCount) throw new Problem(404, "NOT_FOUND", "Publishing account not found");
      } else {
        const row = await publicationOperation(tx, s.tenant, s.project, q.resource_id);
        if (row.data_mode !== publicationMode(db)) throw new Problem(404, "NOT_FOUND", "Publication not found");
      }
      const action = `admin.publication.${q.action}:${s.project}:${q.resource_id}`;
      const row = (await tx.query("SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3", [req.principal.id, action, requestKey])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "The original administrative request has not committed");
      if (row.revoked_at) throw new Problem(410, "REQUEST_RESULT_REMOVED", "The saved result was removed");
      await audit(tx, req.principal, permission.read, q.resource_id, "succeeded", { resource: "publication_request", project_id: s.project, action: q.action }, s.tenant);
      return { result: row.response };
    }, s.tenant, true, req.principal.id);
  });
  app.post(root + "/operations/:id/observe", { preHandler: requireAdmin(db) }, async req => {
    const s = scope(req); return observePublication(db, req.principal, s.tenant, s.project, idOf(req), req.body, authorize(req, permission.resolve));
  });
  for (const action of ["cancel", "close-unknown"] as const) app.post(root + `/operations/:id/${action}`, { preHandler: requireAdmin(db) }, async req => {
    const s = scope(req), id = idOf(req), requestKey = key(req), guard = authorize(req, permission.resolve);
    return db.tx(async tx => {
      await guard(tx);
      return replay(tx, req.principal.id, `admin.publication.${action}:${s.project}:${id}`, requestKey, req.body, () => action === "cancel"
        ? service.cancel(tx, req.principal, s.tenant, s.project, id, publicationRevisionInput.parse(req.body).expected_version, true, guard)
        : closeUnknownPublication(db, tx, req.principal, s.tenant, s.project, id, req.body, guard));
    }, s.tenant, true, req.principal.id);
  });
}
