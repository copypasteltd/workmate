import { pngFromSVG } from "./render.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { audit, requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
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
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT a.*,v.mime_type,v.bytes,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' ORDER BY a.created_at DESC LIMIT 200",
            [tenant, project],
          )
        ).rows,
      };
    }, tenant);
  });
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
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const a = (
          await tx.query(
            "SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND state='active'",
            [asset, project],
          )
        ).rows[0];
        if (!a) throw new Problem(404, "NOT_FOUND", "Asset not found");
        return {
          items: (
            await tx.query(
              "SELECT id,version,mime_type,bytes,sha256,metadata,created_at FROM asset_versions WHERE asset_id=$1 ORDER BY version DESC",
              [asset],
            )
          ).rows,
        };
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
      const bytes = await storage.get(row.storage_key);
      // Recheck after I/O to avoid serving content after a concurrent quarantine/revocation.
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
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        )
        .type(row.mime_type)
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
              "SELECT 1 FROM assets WHERE id=$1 AND project_id=$2 AND state='active'",
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
        "SELECT v.*,a.name,s.tenant_id,a.id AS asset_id FROM shares s JOIN assets a ON a.id=s.asset_id JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version JOIN tenants t ON t.id=s.tenant_id JOIN memberships m ON m.tenant_id=t.id AND m.user_id=s.created_by JOIN users u ON u.id=m.user_id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.state='active' AND t.status='active' AND m.status='active' AND u.status='active' AND m.role IN ('owner','admin')",
        [hash(value)],
      )
    ).rows[0];
    if (!r) throw new Problem(404, "NOT_FOUND", "Share expired or unavailable");
    const data = await storage.get(r.storage_key);
    const valid = (
      await db.control.query(
        "SELECT 1 FROM shares s JOIN assets a ON a.id=s.asset_id JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.created_by JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=s.tenant_id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.state='active' AND m.status='active' AND u.status='active' AND m.role IN ('owner','admin') AND t.status='active'",
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
      .send(data);
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
            "SELECT * FROM brand_profiles WHERE project_id=$1 ORDER BY created_at DESC",
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
    }, tenant);
  });
}
