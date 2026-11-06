import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Storage } from "./storage.js";
import { requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
import { hash, Problem, uuid } from "./lib.js";
import { readEditableAsset } from "./editable-project-source.js";
import { checkedDesignEvidence } from "./design-evidence-source.js";
import { designEvidenceScope } from "./portable-design-evidence.js";
import { decodePNG } from "./editable-design-tools.js";
import { pngFromSVG } from "./render.js";

export function registerDesignResources(app: FastifyInstance, db: Database, storage: Storage) {
  const base = "/v1/tenants/:tenant/projects/:project/editable-projects/resources";
  const scope = z.object({ tenant: uuid, project: uuid }), guard = { preHandler: requireUser(db) };
  app.get(base, guard, async (req, reply) => {
    const p = scope.parse(req.params), q = z.object({ kind: z.enum(["image", "chart"]), q: z.string().trim().max(150).default(""), cursor: uuid.optional() }).strict().parse(req.query);
    const result = await db.tx(async tx => {
      await projectAccess(tx, req.principal, p.tenant, p.project, "write");
      const rows = (await tx.query(`SELECT a.id AS asset_id,a.name,v.id AS source_version_id,v.version,v.sha256,v.bytes,
        v.metadata->>'design_evidence_provenance'='user_attested_import' AS imported_evidence
        FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
        LEFT JOIN tasks t ON t.id::text=v.metadata->>'task_id'
        WHERE a.project_id=$1 AND a.private_owner IS NULL AND a.state='active' AND a.retention_expires_at>clock_timestamp()
          AND v.erased_at IS NULL AND v.bytes<=12582912 AND coalesce(v.metadata->>'data_mode',t.data_mode)=$2
          AND (($3='image' AND v.mime_type='image/png' AND v.bytes<=10485760) OR ($3='chart' AND v.mime_type='application/json' AND v.bytes<=4194304
            AND (v.metadata->>'analysis_role_schema'='copypaste-analysis-delivery-1' OR v.metadata->>'design_evidence_provenance'='user_attested_import')))
          AND ($4='' OR a.name ILIKE $4 ESCAPE '\\') AND ($5::uuid IS NULL OR v.id>$5)
          AND task_asset_version_sources_available(v.id) ORDER BY v.id LIMIT 21`,
        [p.project, db.config.DEMO_MODE ? "simulated" : "configured_services", q.kind, q.q ? "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%" : "", q.cursor ?? null])).rows;
      return { kind: q.kind, items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].source_version_id : null };
    }, p.tenant);
    return reply.header("Cache-Control", "no-store").send(result);
  });
  app.get(base + "/:version", guard, async (req, reply) => {
    const p = scope.extend({ version: uuid }).parse(req.params), q = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), offset: z.coerce.number().int().min(0).max(12800).default(0) }).strict().parse(req.query);
    const result = await db.tx(async tx => {
      await projectAccess(tx, req.principal, p.tenant, p.project, "write");
      const { v, bytes } = await readEditableAsset(tx, storage, p.project, p.version, q.sha256);
      if (v.metadata.data_mode !== (db.config.DEMO_MODE ? "simulated" : "configured_services")) throw new Problem(404, "NOT_FOUND", "This source is unavailable in the current service mode");
      if (v.mime_type === "image/png") {
        decodePNG(bytes);
        const preview = pngFromSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><image width="480" height="320" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString("base64")}"/></svg>`);
        return { kind: "image", name: v.name, source_version_id: v.id, sha256: v.sha256, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
          preview: { content_type: "image/png", base64: preview.toString("base64"), bytes: preview.length, sha256: hash(preview) } };
      }
      if (v.mime_type !== "application/json" || bytes.length > 4 * 1024 ** 2) throw new Problem(422, "DESIGN_EVIDENCE_INVALID", "Choose a bounded structured chart source");
      const checked = checkedDesignEvidence(bytes, v.metadata);
      if (q.offset > checked.rows.length) throw new Problem(422, "DESIGN_EVIDENCE_PAGE", "Refresh this fixed evidence source before continuing");
      return { kind: "chart", name: v.name, source_version_id: v.id, sha256: v.sha256, imported_evidence: checked.imported,
        items: checked.rows.slice(q.offset, q.offset + 64).map(row => ({ ...row, series_key: hash(designEvidenceScope(row)) })),
        offset: q.offset, next_offset: q.offset + 64 < checked.rows.length ? q.offset + 64 : null,
        total_count: checked.rows.length, unsupported_count: checked.unsupported_count };
    }, p.tenant);
    return reply.header("Cache-Control", "no-store").send(result);
  });
}
