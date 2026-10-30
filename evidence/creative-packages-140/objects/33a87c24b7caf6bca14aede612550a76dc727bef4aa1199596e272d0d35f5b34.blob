import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireUser, type Principal } from "./auth.js";
import { projectAccess, replay, key } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { Storage, saveAssetFile } from "./storage.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { renderPoster } from "./business.js";
import { writeDeliveryArchive } from "./delivery-package.js";
import { createVideoProject } from "./video-projects.js";
import { videoRendererProfile } from "./video-render.js";
import { loadVideoFont } from "./video-font.js";
import { creativePackageLimit, packageManifest, packageSelection, packageRestore, parseCreativeSource,
  creativeReferences, remapCreativeSource } from "./creative-package-model.js";
import { readCreativePackage } from "./creative-package-reader.js";

const scopeSchema = z.object({ tenant: uuid, project: uuid });
type Scope = z.infer<typeof scopeSchema>;
type Selected = z.infer<typeof packageSelection>;
type ArchiveFile = { path: string; name: string; bytes: number; sha256: string; mime_type: string; storage_key?: string; content?: Buffer };
const available = "a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)";
const readme = `# CopyPaste · 可恢復工程 / Restorable project\n\n在「設計畫布 → 恢復工程」上傳本 ZIP、檢視清單，再確認建立新的專案共用工程。來源工程不會被覆寫。\nUpload this ZIP in Design canvas → Restore project, review the manifest, then confirm a new project-shared copy. The source is never overwritten.\n\nproject.json 保留可編輯圖層或影片腳本、分鏡、字幕、時間線及音訊設定；media/ 包含每個固定版本的來源。manifest.json 與 SHA256SUMS 記錄大小和 SHA-256。\nproject.json retains editable layers or video script, storyboard, subtitles, timeline and audio settings. media/ contains every fixed source version. manifest.json and SHA256SUMS record sizes and digests.\n\n影片附帶固定 Noto Sans TC 字型及 OFL 授權，仍需相容的 CopyPaste 原生渲染服務。畫布的系統字型參照保留於來源；換機字型差異可能改變排版，preview.svg 供原環境比對。\nVideo includes the pinned Noto Sans TC font and OFL license and requires a compatible native CopyPaste renderer. Canvas system-font references remain in source; fonts on another host can change layout. preview.svg records the source-environment review.\n\n匯入會重新分配工程與素材編號，不恢復帳戶、費用、權限、連接器或原任務的已驗證狀態。請確認素材授權適用於目的專案。\nImport allocates new content IDs and never restores accounts, costs, permissions, connectors or verified task provenance. Confirm media rights for the destination project.\n\n匯出與恢復不呼叫 AI；後續啟動 Agent 按現有費用與權限流程處理。\nExport and restore make no AI call. Later Agent work follows existing cost and permission confirmations.\n`;

async function selectArchiveAsset(tx: Tx, principal: Principal, scope: Scope, selection: Selected, lock = false) {
  await projectAccess(tx, principal, scope.tenant, scope.project, "write");
  const row = (await tx.query(`SELECT a.id,a.name,a.private_owner,v.storage_key,v.sha256,v.bytes,v.mime_type FROM assets a
    JOIN asset_versions v ON v.asset_id=a.id AND v.version=$4
    WHERE a.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND ${available} ${lock ? "FOR SHARE OF a" : ""}`,
  [selection.asset_id, scope.tenant, scope.project, selection.version])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Archive asset version is unavailable");
  if (row.sha256 !== selection.sha256) throw new Problem(409, "VERSION_CONFLICT", "Choose the exact uploaded archive version again");
  if (!["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(row.mime_type)
    || Number(row.bytes) > creativePackageLimit || Number(row.bytes) < 1)
    throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "Choose a CopyPaste project ZIP up to 100 MiB");
  return row;
}

async function selectProject(tx: Tx, principal: Principal, scope: Scope, id: string, version: number, storage: Storage, db: Database) {
  await projectAccess(tx, principal, scope.tenant, scope.project);
  const p = (await tx.query(`SELECT * FROM creative_projects WHERE id=$1 AND tenant_id=$2 AND project_id=$3
    AND kind IN ('poster','video') AND content_state='active' AND retention_expires_at>clock_timestamp()`, [id, scope.tenant, scope.project])).rows[0];
  if (!p) throw new Problem(404, "NOT_FOUND", "Creative project is unavailable");
  if (p.version !== version) throw new Problem(409, "VERSION_CONFLICT", "Refresh the creative project before exporting");
  let definition: unknown = p.body, renderer_profile: Record<string, unknown> = { renderer: "poster-system-fonts-1", font_portability: "system_font_reference" };
  if (p.kind === "video") {
    if (p.body.data_mode !== (db.config.DEMO_MODE ? "simulated" : "configured_services")) throw new Problem(404, "NOT_FOUND", "Video project is unavailable in this mode");
    const v = (await tx.query("SELECT definition,renderer_profile FROM video_project_versions WHERE video_id=$1 AND version=$2", [id, version])).rows[0];
    if (!v) throw new Problem(404, "NOT_FOUND", "Video version is unavailable");
    definition = v.definition; renderer_profile = v.renderer_profile;
  }
  definition = parseCreativeSource(p.kind, definition);
  const files: ArchiveFile[] = [], media: z.infer<typeof packageManifest>["media"] = [];
  const content = (name: string, bytes: Buffer, mime: string) => files.push({ path: name, name, bytes: bytes.length, sha256: hash(bytes), mime_type: mime, content: bytes });
  content("project.json", Buffer.from(JSON.stringify(definition, null, 2) + "\n"), "application/json");
  for (const ref of creativeReferences(p.kind, definition)) {
    const v = (await tx.query(`SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$3
      WHERE a.id=$1 AND a.project_id=$2 AND ${available} AND (a.private_owner IS NULL OR a.private_owner=$4)`,
    [ref.asset_id, scope.project, ref.version, p.private_owner ?? null])).rows[0];
    if (!v || !["image/png", "audio/wav", "audio/mpeg"].includes(v.mime_type)
      || Number(v.bytes) > (v.mime_type === "image/png" ? 8_000_000 : 30_000_000))
      throw new Problem(422, "PACKAGE_SOURCE_UNAVAILABLE", "A fixed source version is missing, withdrawn or unsupported");
    if (p.kind === "video") {
      const bound = (await tx.query("SELECT sha256,bytes,mime_type FROM video_project_sources WHERE video_id=$1 AND version=$2 AND asset_id=$3 AND asset_version=$4", [id, version, ref.asset_id, ref.version])).rows[0];
      if (!bound || bound.sha256 !== v.sha256 || String(bound.bytes) !== String(v.bytes) || bound.mime_type !== v.mime_type)
        throw new Problem(409, "VERSION_CONFLICT", "A bound video source no longer matches its recorded version");
    }
    const file = `media/${String(media.length + 1).padStart(3, "0")}.${v.mime_type === "image/png" ? "png" : v.mime_type === "audio/wav" ? "wav" : "mp3"}`;
    files.push({ path: file, name: file, bytes: Number(v.bytes), sha256: v.sha256, mime_type: v.mime_type, storage_key: v.storage_key });
    media.push({ ...ref, path: file, mime_type: v.mime_type });
  }
  if (p.kind === "video") {
    const font = await loadVideoFont();
    if (renderer_profile.font_sha256 !== font.sha256) throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "The recorded video font is not available on this host");
    let directory = path.resolve(import.meta.dirname, "../assets/fonts/noto-sans-tc");
    try { await readFile(path.join(directory, "OFL.txt")); } catch { directory = path.resolve(import.meta.dirname, "../../assets/fonts/noto-sans-tc"); }
    const bytes = await readFile(path.join(directory, "NotoSansTC-VF.ttf"));
    if (hash(bytes) !== font.sha256) throw new Problem(503, "VIDEO_FONT_INTEGRITY", "The pinned video font changed");
    content("fonts/NotoSansTC-VF.ttf", bytes, "font/ttf"); content("fonts/OFL.txt", await readFile(path.join(directory, "OFL.txt")), "text/plain");
  } else {
    content("preview.svg", Buffer.from(renderPoster(definition, Object.fromEntries(media.map(m => [m.asset_id + ":" + m.version, m.path])))), "image/svg+xml");
  }
  const manifest = packageManifest.parse({ schema_version: "copypaste-creative-package-1", kind: p.kind, name: p.name,
    origin: { project_id: scope.project, creative_id: id, version }, renderer_profile,
    files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), media,
    limitations: p.kind === "poster" ? ["System fonts can change layout on another host; review the included source-environment preview before production."]
      : ["Requires a compatible native CopyPaste campaign-cuts renderer; embedded font and source media are verified before restore."] });
  if (files.reduce((n, f) => n + f.bytes, 0) + 1024 ** 2 > creativePackageLimit)
    throw new Problem(413, "CREATIVE_PACKAGE_TOO_LARGE", "This project exceeds the portable package limit of 100 MiB");
  return { p, files, manifest };
}

export function registerCreativePackages(app: FastifyInstance, db: Database, storage: Storage) {
  const base = "/v1/tenants/:tenant/projects/:project/creative-project-packages", inFlight = new Set<string>();
  const guard = { preHandler: requireUser(db), config: { rateLimit: { hook: "preHandler" as const, max: 8, timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => req.principal?.id ?? req.ip } } };
  app.get(base + "/requests/:key", { preHandler: requireUser(db) }, async req => {
    const scope = scopeSchema.extend({ key: z.string().regex(/^[\w:-]{16,128}$/) }).parse(req.params);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const row = (await tx.query("SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
        [req.principal.id, `creative.package.restore:${scope.tenant}:${scope.project}`, scope.key])).rows[0];
      if (!row) return { state: "not_recorded" };
      if (row.revoked_at) return { state: "removed" };
      const current = (await tx.query("SELECT id FROM creative_projects WHERE id=$1 AND project_id=$2 AND created_by=$3 AND content_state='active' AND retention_expires_at>clock_timestamp()",
        [row.response.id, scope.project, req.principal.id])).rows[0];
      return current ? { state: "completed", result: row.response } : { state: "removed" };
    }, scope.tenant);
  });
  app.get(base, { preHandler: requireUser(db) }, async req => {
    const scope = scopeSchema.parse(req.params);
    return db.tx(async tx => { await projectAccess(tx, req.principal, scope.tenant, scope.project);
      return { items: (await tx.query(`SELECT id,name,kind,version,private_owner FROM creative_projects WHERE project_id=$1
        AND kind IN ('poster','video') AND content_state='active' AND retention_expires_at>clock_timestamp()
        AND (kind='poster' OR body->>'data_mode'=$2) ORDER BY created_at DESC,id DESC LIMIT 100`,
      [scope.project, db.config.DEMO_MODE ? "simulated" : "configured_services"])).rows }; }, scope.tenant);
  });
  app.get(base + "/:id", guard, async (req, reply) => {
    const scope = scopeSchema.extend({ id: uuid }).parse(req.params), { expected_version } = z.object({ expected_version: z.coerce.number().int().positive() }).strict().parse(req.query);
    if (inFlight.size >= 2 || inFlight.has(req.principal.id)) throw new Problem(429, "CREATIVE_PACKAGE_BUSY", "Another creative package operation is still running");
    inFlight.add(req.principal.id);
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]), interrupt = () => controller.abort();
    req.raw.once("aborted", interrupt); reply.raw.once("close", interrupt); let directory: string | undefined, handed = false;
    const cleanup = async () => { req.raw.off("aborted", interrupt); reply.raw.off("close", interrupt); inFlight.delete(req.principal.id); if (directory) await rm(directory, { recursive: true, force: true }); };
    try {
      const selected = await db.tx(tx => selectProject(tx, req.principal, scope, scope.id, expected_version, storage, db), scope.tenant);
      directory = await temporaryDirectory();
      const archive = await writeDeliveryArchive(directory, selected.files, selected.manifest, storage, signal, readme);
      await db.tx(async tx => {
        const current = await selectProject(tx, req.principal, scope, scope.id, expected_version, storage, db);
        if (canonical(current.manifest) !== canonical(selected.manifest)) throw new Problem(409, "VERSION_CONFLICT", "The creative project changed during export");
        await audit(tx, req.principal, "creative.package.export", scope.id, "succeeded", { version: expected_version, files: selected.files.length, bytes: archive.bytes, sha256: archive.sha256, ai_cost_micros: "0" }, scope.tenant);
      }, scope.tenant);
      signal.throwIfAborted(); const stream = createReadStream(archive.output); handed = true;
      stream.once("close", () => { void cleanup().catch(e => app.log.error(e, "Creative package cleanup failed")); });
      return reply.type("application/zip").header("Cache-Control", "no-store").header("Content-Disposition", `attachment; filename="workmate-${selected.p.kind}-${scope.id}-v${expected_version}.zip"`)
        .header("Content-Length", archive.bytes).header("X-Content-SHA256", archive.sha256).send(stream);
    } finally { if (!handed) await cleanup(); }
  });
  async function temporaryDirectory() {
    await mkdir(db.config.DATA_DIR, { recursive: true }); const parent = await realpath(db.config.DATA_DIR), disk = await statfs(parent);
    if (Number(disk.bavail) * Number(disk.bsize) < creativePackageLimit * 3) throw new Problem(503, "CREATIVE_PACKAGE_BUSY", "Not enough temporary storage for a project package");
    return mkdtemp(path.join(parent, "creative-package-"));
  }
  async function openUploaded(principal: Principal, scope: Scope, selection: Selected, signal: AbortSignal, directory: string) {
    const asset = await db.tx(tx => selectArchiveAsset(tx, principal, scope, selection), scope.tenant);
    const file = path.join(directory, "input.zip"), digest = createHash("sha256"); let bytes = 0;
    await pipeline(await storage.stream(asset.storage_key), new Transform({ transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length; if (bytes > Number(asset.bytes) || bytes > creativePackageLimit) { done(new Problem(422, "CREATIVE_PACKAGE_INVALID", "Archive size changed")); return; }
      digest.update(chunk); done(null, chunk);
    } }), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
    if (bytes !== Number(asset.bytes) || digest.digest("hex") !== selection.sha256) throw new Problem(422, "CREATIVE_PACKAGE_INVALID", "Archive integrity check failed");
    const parsed = await readCreativePackage(file, directory, signal);
    if (parsed.manifest.kind === "video") {
      const profile = await videoRendererProfile();
      if (canonical(profile) !== canonical(parsed.manifest.renderer_profile)
        || parsed.members.get("fonts/NotoSansTC-VF.ttf")?.sha256 !== profile.font_sha256)
        throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "The package requires a different native video renderer or font");
      const font = await loadVideoFont();
      if (font.sha256 !== profile.font_sha256) throw new Problem(503, "VIDEO_FONT_INTEGRITY", "The video font is unavailable");
    }
    return { asset, ...parsed };
  }
  for (const action of ["preview", "restore"] as const) app.post(base + "/" + action, guard, async (req, reply) => {
    const scope = scopeSchema.parse(req.params), body = action === "preview" ? packageSelection.parse(req.body) : packageRestore.parse(req.body);
    const requestKey = action === "restore" ? key(req) : "";
    if (inFlight.size >= 2 || inFlight.has(req.principal.id)) throw new Problem(429, "CREATIVE_PACKAGE_BUSY", "Another creative package operation is still running");
    inFlight.add(req.principal.id);
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]), interrupt = () => controller.abort();
    req.raw.once("aborted", interrupt); reply.raw.once("close", interrupt); let directory: string | undefined;
    try {
      directory = await temporaryDirectory(); const loaded = await openUploaded(req.principal, scope, body, signal, directory);
      return await db.tx(async tx => {
        await lockUserAuthorities(tx, [req.principal.id]); await selectArchiveAsset(tx, req.principal, scope, body, true); signal.throwIfAborted();
        const preview = { schema_version: loaded.manifest.schema_version, kind: loaded.manifest.kind, name: loaded.manifest.name,
          origin: loaded.manifest.origin, preview_hash: loaded.preview_hash, files: loaded.manifest.files, media_count: loaded.manifest.media.length,
          total_bytes: loaded.total_bytes, limitations: loaded.manifest.limitations, target_project_id: scope.project,
          visibility: "project_shared", ai_cost_micros: "0" };
        if (action === "preview") return preview;
        const input = packageRestore.parse(body);
        if (input.preview_hash !== loaded.preview_hash) throw new Problem(409, "PACKAGE_PREVIEW_CHANGED", "Review this exact archive before restoring");
        const result = await replay(tx, req.principal.id, `creative.package.restore:${scope.tenant}:${scope.project}`, requestKey, input, async () => {
          const mapping = new Map<string, { asset_id: string; version: number }>();
          for (const media of loaded.manifest.media) {
            signal.throwIfAborted(); const member = loaded.members.get(media.path)!;
            const saved = await saveAssetFile(tx, storage, { tenant: scope.tenant, project: scope.project, user: req.principal.id,
              name: `${input.name}-${path.basename(media.path)}`, mime: media.mime_type, kind: "imported_creative_source",
              file: member.file, size: member.bytes, sha256: member.sha256,
              metadata: { source: "user_uploaded_creative_package", package_sha256: input.sha256, rights_attested_by: req.principal.id } });
            mapping.set(media.asset_id + ":" + media.version, { asset_id: saved.id, version: saved.version.version });
          }
          const definition = remapCreativeSource(loaded.manifest.kind, loaded.definition, mapping);
          let project;
          if (loaded.manifest.kind === "video") project = await createVideoProject(tx, db, req.principal, scope.tenant, scope.project,
            { name: input.name, definition: definition as import("./video-project-model.js").VideoDefinition }, loaded.manifest.renderer_profile);
          else project = (await tx.query("INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by) VALUES($1,$2,$3,'poster',$4,$5) RETURNING id,version",
            [scope.tenant, scope.project, input.name, definition, req.principal.id])).rows[0];
          signal.throwIfAborted();
          await selectArchiveAsset(tx, req.principal, scope, body, true);
          await audit(tx, req.principal, "creative.package.restore", project.id, "succeeded", { package_sha256: input.sha256,
            kind: loaded.manifest.kind, source_asset_id: input.asset_id, source_version: input.version, files: loaded.manifest.media.length,
            visibility: "project_shared", rights_attested_by: req.principal.id, ai_cost_micros: "0" }, scope.tenant);
          return { ...project, name: input.name, kind: loaded.manifest.kind, imported_assets: mapping.size,
            visibility: "project_shared", ai_cost_micros: "0", source_package_sha256: input.sha256 };
        });
        const exists = (await tx.query("SELECT id FROM creative_projects WHERE id=$1 AND project_id=$2 AND created_by=$3 AND content_state='active' AND retention_expires_at>clock_timestamp()",
          [result.id, scope.project, req.principal.id])).rows[0];
        if (!exists) throw new Problem(410, "REQUEST_RESULT_REMOVED", "The restored project was removed; this request will not recreate it");
        return result;
      }, scope.tenant);
    } finally { req.raw.off("aborted", interrupt); reply.raw.off("close", interrupt); inFlight.delete(req.principal.id); if (directory) await rm(directory, { recursive: true, force: true }); }
  });
}
