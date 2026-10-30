import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { brandVersion } from "./brand-production.js";

/** Resolve the customer's exact revision, never the brand's latest revision. */
export async function fixedBrandVersion(tx: Tx, project: string, versionId: string) {
  const row = (await tx.query(
    "SELECT brand_id,version FROM brand_profile_versions WHERE id=$1 AND project_id=$2 AND erased_at IS NULL",
    [versionId, project],
  )).rows[0];
  if (!row) throw new Problem(409, "BRAND_VERSION_UNAVAILABLE", "Choose an available brand version in this project");
  await brandVersion(tx, project, row.brand_id, row.version);
  return { id: row.brand_id as string, version: row.version as number };
}

export function registerBrandVersionOptions(app: FastifyInstance, db: Database) {
  app.get("/v1/brand-version-options", { preHandler: requireUser(db) }, async req => {
    const tenant = uuid.parse(req.headers["x-tenant-id"]), q = z.object({
      project_id: uuid, cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
    }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, q.project_id);
      if (q.cursor && !(await tx.query(
        "SELECT 1 FROM brand_profile_versions v JOIN brand_profiles b ON b.id=v.brand_id WHERE v.id=$1 AND v.project_id=$2 AND v.erased_at IS NULL AND b.content_state='active'",
        [q.cursor, q.project_id],
      )).rowCount) throw new Problem(410, "CURSOR_UNAVAILABLE", "Refresh the brand version list");
      const rows = (await tx.query(
        `SELECT v.id,v.brand_id,v.version,v.name,v.sha256,(v.version=b.version) AS current,
         brand_version_available(v.brand_id,v.version) AS available
         FROM brand_profile_versions v JOIN brand_profiles b ON b.id=v.brand_id
         WHERE v.project_id=$1 AND v.erased_at IS NULL AND b.content_state='active'
         AND ($2::uuid IS NULL OR v.id>$2) ORDER BY v.id LIMIT $3`,
        [q.project_id, q.cursor ?? null, q.limit + 1],
      )).rows;
      return { items: rows.slice(0, q.limit), next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
    }, tenant);
  });
}
