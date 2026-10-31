import { pngFromSVG } from "./render.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { audit, requireUser } from "./auth.js";
import { projectAccess, key, replay } from "./access.js";
import { hash, name, Problem, token, uuid } from "./lib.js";
import { Storage, saveAsset } from "./storage.js";

const params = z.object({ tenant: uuid, project: uuid });
const assetParams = params.extend({ asset: uuid });
export function registerAssets(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const base = "/v1/tenants/:tenant/projects/:project";
  app.get(base + "/assets", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const q=z.object({q:z.string().trim().max(150).optional(),cursor:uuid.optional(),
      limit:z.coerce.number().int().min(1).max(200).default(200),scope:z.enum(["all","shared","private"]).default("all")}).strict().parse(req.query);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      let cursor:any;
      if(q.cursor){cursor=(await tx.query("SELECT id,created_at FROM assets WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND state='active'",[q.cursor,tenant,project])).rows[0];
        if(!cursor)throw new Problem(409,"ASSET_CURSOR_UNAVAILABLE","The file list changed. Refresh the search before loading more.");}
      const rows=(await tx.query(
        `SELECT a.*,v.mime_type,v.bytes,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
        WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND v.erased_at IS NULL AND ($3::text IS NULL OR a.name ILIKE $3 ESCAPE '\\')
        AND ($4='all' OR ($4='shared' AND a.private_owner IS NULL) OR ($4='private' AND a.private_owner=$5))
        AND ($6::uuid IS NULL OR (a.created_at,a.id)<((SELECT created_at FROM assets WHERE id=$6),$6::uuid)) ORDER BY a.created_at DESC,a.id DESC LIMIT $7`,
        [tenant,project,q.q?'%'+q.q.replace(/[\\%_]/g,"\\$&")+'%':null,q.scope,req.principal.id,cursor?.id??null,q.limit+1])).rows;
      return {
        items:rows.slice(0,q.limit),...(Object.keys(req.query as object).length?{next_cursor:rows.length>q.limit?rows[q.limit-1].id:null}:{}),
      };
    }, tenant);
  });
  app.post(
    base + "/assets/:asset/publish",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, asset } = assetParams.parse(req.params);
      const b = z
        .object({ expected_version: z.number().int().positive(), name })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `asset.publish:${asset}`,
          key(req),
          b,
          async () => {
            const a = (
              await tx.query(
                "SELECT a.*,v.id AS source_version_id,v.storage_key,v.mime_type,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1 AND a.project_id=$2 AND a.state='active' FOR UPDATE OF a",
                [asset, project],
              )
            ).rows[0];
            if (!a || a.private_owner !== req.principal.id)
              throw new Problem(404, "NOT_FOUND", "Private artifact not found");
            if (a.current_version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Refresh the private artifact before publishing",
              );
            const provenance = (
              await tx.query("SELECT publication_input_sources($1) AS refs", [
                a.source_version_id,
              ])
            ).rows[0].refs;
            if (!provenance)
              throw new Problem(
                409,
                "TASK_SOURCE_REVOKED",
                "A source used by this artifact is no longer available",
              );
            const result = await saveAsset(tx, storage, {
              tenant,
              project,
              user: req.principal.id,
              name: b.name,
              mime: a.mime_type,
              bytes: await storage.get(a.storage_key),
              kind: "published_deliverable",
              metadata: {
                publication_origin_version_id: a.source_version_id,
                publication_sources: provenance,
              },
              ...(a.metadata?.seo_run_id
                ? {
                    metadata: {
                      publication_origin_version_id: a.source_version_id,
                      publication_sources: provenance,
                      seo_run_id: a.metadata.seo_run_id,
                      ...(a.metadata.seo_change_task_id
                        ? { seo_change_task_id: a.metadata.seo_change_task_id }
                        : {}),
                      seo_publication_source: {
                        asset_id: a.id,
                        version: a.current_version,
                      },
                    },
                  }
                : {}),
            });
            await audit(
              tx,
              req.principal,
              "asset.publish_to_project",
              result.id,
              "succeeded",
              { source_asset_id: a.id, source_version: a.current_version },
              tenant,
            );
            return result;
          },
        );
      }, tenant);
    },
  );
  for (const versioning of [false, true])
    app.post(
      base + "/assets" + (versioning ? "/:asset/versions" : ""),
      { preHandler: requireUser(db) },
      async (req) => {
        const p = (versioning ? assetParams : params).parse(req.params) as {
          tenant: string;
          project: string;
          asset?: string;
        };
        // Authorize before reading a potentially large multipart upload.
        await db.tx(
          (tx) =>
            projectAccess(tx, req.principal, p.tenant, p.project, "write"),
          p.tenant,
        );
        const file = await req.file({
          limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 },
        });
        if (!file)
          throw new Problem(400, "FILE_REQUIRED", "Choose a file to upload");
        const bytes = await file.toBuffer();
        const filename = name.parse(file.filename.replace(/[\r\n\0]/g, ""));
        const mime =
          /^(image\/(png|jpeg|webp|gif)|application\/(pdf|json)|text\/(plain|csv)|video\/mp4|audio\/(mpeg|wav))$/.test(
            file.mimetype,
          )
            ? file.mimetype
            : "application/octet-stream";
        const expected = versioning
          ? z.coerce
              .number()
              .int()
              .positive()
              .parse((file.fields.expected_version as any)?.value)
          : undefined;
        return db.tx(async (tx) => {
          await projectAccess(tx, req.principal, p.tenant, p.project, "write");
          const a = await saveAsset(tx, storage, {
            tenant: p.tenant,
            project: p.project,
            user: req.principal.id,
            name: filename,
            mime,
            bytes,
            asset: p.asset,
            expectedVersion: expected,
          });
          await audit(
            tx,
            req.principal,
            versioning ? "asset.version.create" : "asset.create",
            a.id,
            "succeeded",
            {},
            p.tenant,
          );
          return a;
        }, p.tenant);
      },
    );
  app.get(
    base + "/assets/:asset/versions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, asset } = assetParams.parse(req.params);
      const q=z.object({limit:z.coerce.number().int().min(1).max(200).optional(),before_version:z.coerce.number().int().positive().optional()}).strict().parse(req.query);
      const paged=q.limit!==undefined||q.before_version!==undefined,limit=q.limit??50;
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const a = (
          await tx.query(
            "SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND state='active'",
            [asset, project],
          )
        ).rows[0];
        if (!a) throw new Problem(404, "NOT_FOUND", "Asset not found");
        const rows=(
            await tx.query(
              "SELECT id,version,mime_type,bytes,sha256,metadata,created_at FROM asset_versions WHERE asset_id=$1 AND ($2::integer IS NULL OR version<$2) AND (NOT $4::boolean OR erased_at IS NULL) ORDER BY version DESC LIMIT $3",
              [asset,q.before_version??null,paged?limit+1:null,paged],
            )
          ).rows;
        return {items:paged?rows.slice(0,limit):rows,...(paged?{next_cursor:rows.length>limit?rows[limit-1].version:null}:{})};
      }, tenant);
    },
  );
  app.get(
    base + "/assets/:asset/download",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project, asset } = assetParams.parse(req.params);
      const version = z
        .object({ version: z.coerce.number().int().positive().optional() })
        .parse(req.query).version;
      const row = await db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const a = (
          await tx.query(
            "SELECT a.name,v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=coalesce($3,a.current_version) WHERE a.id=$1 AND a.project_id=$2 AND a.state='active'",
            [asset, project, version ?? null],
          )
        ).rows[0];
        if (!a) throw new Problem(404, "NOT_FOUND", "Asset not found");
        await audit(
          tx,
          req.principal,
          "asset.download",
          asset,
          "succeeded",
          { version: a.version },
          tenant,
        );
        return a;
      }, tenant);
      const bytes = await storage.stream(row.storage_key);
      // Recheck after I/O to avoid serving content after a concurrent quarantine/revocation.
      try {
        await db.tx(async (tx) => {
          await projectAccess(tx, req.principal, tenant, project);
          if (
            !(
              await tx.query(
                "SELECT 1 FROM assets WHERE id=$1 AND state='active'",
                [asset],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Asset not found");
        }, tenant);
      } catch (e) {
        bytes.destroy();
        throw e;
      }
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        )
        .type(row.mime_type)
        .header("Content-Length", row.bytes)
        .header("X-Content-SHA256", row.sha256)
        .send(bytes);
    },
  );
  app.post(
    base + "/assets/:asset/shares",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, asset } = assetParams.parse(req.params);
      const b = z
        .object({
          expires_in_hours: z.number().int().min(1).max(168).default(24),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        if (
          !(
            await tx.query(
              "SELECT 1 FROM assets WHERE id=$1 AND project_id=$2 AND state='active' AND private_owner IS NULL",
              [asset, project],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Asset not found");
        const value = token();
        const s = (
          await tx.query(
            "INSERT INTO shares(tenant_id,asset_id,digest,expires_at,created_by) VALUES($1,$2,$3,now()+$4*interval '1 hour',$5) RETURNING id,expires_at",
            [tenant, asset, hash(value), b.expires_in_hours, req.principal.id],
          )
        ).rows[0];
        return { ...s, url: `${db.config.API_ORIGIN}/v1/shares/${value}` };
      }, tenant);
    },
  );
  app.get("/v1/shares/:token", async (req, reply) => {
    const value = z
      .string()
      .regex(/^[\w-]{43}$/)
      .parse((req.params as any).token);
    // A share remains bounded to its owner's current membership and active content.
    const r = (
      await db.control.query(
        "SELECT v.*,a.name,s.tenant_id,a.id AS asset_id FROM shares s JOIN assets a ON a.id=s.asset_id JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version JOIN tenants t ON t.id=s.tenant_id JOIN memberships m ON m.tenant_id=t.id AND m.user_id=s.created_by JOIN users u ON u.id=m.user_id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.state='active' AND a.private_owner IS NULL AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_sources_available(a.id) AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id) AND t.status='active' AND NOT EXISTS(SELECT 1 FROM projects erased WHERE erased.id=a.project_id AND erased.erasure_requested_at IS NOT NULL) AND m.status='active' AND u.status='active' AND m.role IN ('owner','admin')",
        [hash(value)],
      )
    ).rows[0];
    if (!r) throw new Problem(404, "NOT_FOUND", "Share expired or unavailable");
    const data = await storage.stream(r.storage_key);
    try {
      const valid = (
        await db.control.query(
          "SELECT 1 FROM shares s JOIN assets a ON a.id=s.asset_id JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.created_by JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=s.tenant_id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.state='active' AND a.private_owner IS NULL AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_sources_available(a.id) AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id) AND m.status='active' AND u.status='active' AND m.role IN ('owner','admin') AND t.status='active' AND NOT EXISTS(SELECT 1 FROM projects erased WHERE erased.id=a.project_id AND erased.erasure_requested_at IS NOT NULL)",
          [hash(value)],
        )
      ).rowCount;
      if (!valid) throw new Problem(404, "NOT_FOUND", "Share unavailable");
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`,
        )
        .type(r.mime_type)
        .header("Content-Length", r.bytes)
        .header("X-Content-SHA256", r.sha256)
        .send(data);
    } catch (e) {
      data.destroy();
      throw e;
    }
  });
  app.get(
    base + "/assets/:asset/thumbnail",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, asset } = z
        .object({ tenant: uuid, project: uuid, asset: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const v = (
          await tx.query(
            "SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1 AND a.project_id=$2 AND a.state='active'",
            [asset, project],
          )
        ).rows[0];
        if (!v || v.mime_type !== "image/png" || Number(v.bytes) > 8_000_000)
          throw new Problem(
            404,
            "PREVIEW_UNAVAILABLE",
            "PNG preview unavailable",
          );
        const b = await storage.get(v.storage_key);
        if (
          b.length < 24 ||
          b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          b.readUInt32BE(16) > 4096 ||
          b.readUInt32BE(20) > 4096
        )
          throw new Problem(
            404,
            "PREVIEW_UNAVAILABLE",
            "PNG preview unavailable",
          );
        const thumb = pngFromSVG(
          `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><image width="480" height="360" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${b.toString("base64")}"/></svg>`,
        );
        await projectAccess(tx, req.principal, tenant, project);
        if (
          !(
            await tx.query(
              "SELECT 1 FROM assets WHERE id=$1 AND state='active'",
              [asset],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Asset unavailable");
        return {
          mime_type: "image/png",
          base64: thumb.toString("base64"),
          version: v.version,
        };
      }, tenant);
    },
  );
  app.get(base + "/brand", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT * FROM brand_profiles WHERE project_id=$1 AND content_state='active' ORDER BY created_at DESC LIMIT 200",
            [project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base + "/brand", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = z
      .object({
        name,
        colors: z.array(z.string().regex(/^#[a-f\d]{6}$/i)).max(12),
        tone: z.string().max(2000),
        approved_copy: z.string().max(10000).default(""),
        fonts: z.array(z.string().max(100)).max(12).default([]),
      })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return (
        await tx.query(
          "INSERT INTO brand_profiles(tenant_id,project_id,name,body) VALUES($1,$2,$3,$4) RETURNING *",
          [tenant, project, b.name, b],
        )
      ).rows[0];
    }, tenant, false, req.principal.id);
  });
}
