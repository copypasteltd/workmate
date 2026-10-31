import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, statfs } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { projectAccess, tenantAccess } from "./access.js";
import { lockAdminAccess, permit, requireSensitiveAdmin } from "./admin-access.js";
import { lockMemberships } from "./membership.js";
import { lockCurrentScopeSession } from "./scope-closure-authority.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { deliveryFilename, writeDeliveryArchive } from "./delivery-package.js";
import { exportContent, exportCtes, exportProjection, scopeExportCatalog } from "./scope-export-catalog.js";
import type { Storage } from "./storage.js";
import { assertPublicationContentAvailable } from "./publication-authority.js";
import { publicationContent, publicationMetadata } from "./publication-service.js";
import { publicationSpecification } from "./publication-model.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { assertReportSources } from "./analysis-reports.js";
import { assertWorkflowReadAccess } from "./workflow-read-access.js";
import { assertWorkflowContract, collectWorkflowOutputs } from "./workflow-contracts.js";

export type ExportScope = { tenant: string; project?: string };
export const scopeExportLimits = { binary_bytes: 16 * 1024 ** 3, versions: 10000, records_per_category: 100000, text_bytes: 64 * 1024 ** 2 };
const query = z.object({ expected_snapshot: z.string().regex(/^[a-f0-9]{64}$/), acknowledge: z.literal("true") }).strict();
type ExportFile = { path: string; name: string; bytes: number; sha256: string; mime_type: string; content?: Buffer; storage_key?: string; asset_id?: string; version_id?: string; version?: number };
const excluded = ["OTHER_CUSTOMERS_PRIVATE_CONTENT", "ARCHIVED_PROJECT_CONTENT_RESTORE_FIRST", "WITHDRAWN_QUARANTINED_DELETED_EXPIRED_CONTENT", "CREDENTIALS_AND_INTERNAL_STORAGE_LOCATIONS", "BACKUPS_AND_UNSUBMITTED_LOCAL_FILES", "NONPERSISTENT_PREVIEWS_AND_INDEXES", "INTERNAL_EXECUTION_AND_SECURITY_LOGS"];
const capacity = () => new Problem(413, "SCOPE_EXPORT_CAPACITY", "This scope exceeds the complete export capacity. Export individual projects; no records have been silently truncated.");

async function authorize(tx: Tx, p: Principal, s: ExportScope) {
  if (p.audience === "admin") {
    await lockAdminAccess(tx); await requireSensitiveAdmin(tx, p);
    for (const permission of ["admin.exports.create", "admin.content.body.read"])
      await permit(tx, p, permission, { tenant: s.tenant, project: s.project });
  } else {
    await lockCurrentScopeSession(tx, p); await lockMemberships(tx, s.tenant);
    const membership = await tenantAccess(tx, p, s.tenant, s.project ? "read" : "manage");
    if ((await tx.query("SELECT admin_suspended FROM memberships WHERE tenant_id=$1 AND user_id=$2", [s.tenant, p.id])).rows[0]?.admin_suspended)
      throw new Problem(404, "NOT_FOUND", "Workspace not found");
    if (s.project) await projectAccess(tx, p, s.tenant, s.project);
    void membership;
  }
  const tenant = (await tx.query("SELECT id,name,status,erasure_requested_at FROM tenants WHERE id=$1 FOR SHARE", [s.tenant])).rows[0];
  if (!tenant || tenant.status !== "active" || tenant.erasure_requested_at) throw new Problem(404, "NOT_FOUND", "Workspace not found");
  const projects = (await tx.query(`SELECT id,name,description,archived FROM projects WHERE tenant_id=$1
    AND ($2::uuid IS NULL OR id=$2) AND erasure_requested_at IS NULL ORDER BY id FOR SHARE`, [s.tenant, s.project ?? null])).rows;
  if (s.project && (!projects.length || projects[0].archived)) throw new Problem(409, "PROJECT_ARCHIVED", "Restore the project before exporting its content");
  if (p.audience === "admin") for (const project of projects) for (const permission of ["admin.exports.create", "admin.content.body.read"])
    await permit(tx, p, permission, { tenant: s.tenant, project: project.id });
  return { tenant, projects: projects.filter(p => !p.archived), archived_projects: projects.filter(p => p.archived).map(p => ({ id: p.id, name: p.name })) };
}

/** Control-only publication tables retain their existing customer DTO/ownership rules. */
async function controlledData(tx: Tx, db: Database, p: Principal, s: ExportScope, scope: Awaited<ReturnType<typeof authorize>>) {
  const limit = scopeExportLimits.records_per_category + 1;
  const captured = (await tx.query(`WITH operations AS MATERIALIZED (
    SELECT * FROM publication_operations WHERE tenant_id=$1 AND project_id=ANY($2::uuid[]) AND actor_id=$3 AND NOT $4::boolean
    AND data_mode=$5 AND erased_at IS NULL AND retention_expires_at>clock_timestamp() ORDER BY id LIMIT ${limit}
  ) SELECT pg_export_snapshot() AS snapshot,
    coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT DISTINCT ON(project_id,target_id) id,tenant_id,project_id,connection_id,target_id,version,body,payload_sha256,data_mode,created_by,created_at
      FROM publication_policies WHERE tenant_id=$1 AND project_id=ANY($2::uuid[]) AND data_mode=$5 ORDER BY project_id,target_id,version DESC LIMIT ${limit}) p),'[]') AS policies,
    coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM operations o),'[]') AS operations,
    coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT id,operation_id,step_key,state,request_sha256,remote_id,result,error_code,dispatched_at,finished_at
      FROM publication_effects WHERE operation_id IN(SELECT id FROM operations) ORDER BY id LIMIT ${limit}) e),'[]') AS effects,
    coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT operation_id,version,state,created_at,details FROM publication_events
      WHERE operation_id IN(SELECT id FROM operations) ORDER BY operation_id,version LIMIT ${limit}) e),'[]') AS events,
    coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT x.report_id,x.mapping_id,x.tenant_id,x.project_id,x.mapping_version
      FROM creative_feedback_mappings x JOIN creative_feedback_reports r ON r.id=x.report_id
      JOIN creative_mappings m ON m.id=x.mapping_id JOIN asset_versions v ON v.id=r.asset_version_id JOIN assets a ON a.id=v.asset_id
      WHERE x.tenant_id=$1 AND x.project_id=ANY($2::uuid[]) AND r.content_state='active' AND r.retention_expires_at>clock_timestamp()
      AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND a.private_owner IS NULL AND v.erased_at IS NULL
      AND task_asset_version_sources_available(v.id) AND m.state='confirmed' AND creative_mapping_sources_available(m.id)
      ORDER BY x.report_id,x.mapping_id LIMIT ${limit}) b),'[]') AS feedback_bindings`,
    [s.tenant, scope.projects.map(r => r.id), p.id, p.audience === "admin", db.config.DEMO_MODE ? "simulated" : "configured_services"])).rows[0];
  const operations = [], availableOperations = new Set<string>();
  for (const row of captured.operations) {
    let available = true;
    try { await assertPublicationContentAvailable(tx, row); }
    catch (error) { if (!(error instanceof Problem) || error.status >= 500) throw error; available = false; }
    for (const field of ["created_at", "expires_at", "confirmed_at", "finished_at"]) if (row[field]) row[field] = new Date(row[field]);
    if (available) availableOperations.add(row.id);
    operations.push({ ...publicationMetadata(row), can_view_content: available,
      content: available ? publicationContent(publicationSpecification.parse(row.specification)) : null,
      result: available ? row.result : null, observation: available ? row.observation : null, resolution: available ? row.resolution : null });
  }
  return { snapshot: captured.snapshot, datasets: [
    { category: "publication_policies", records: captured.policies }, { category: "publication_operations", records: operations },
    { category: "publication_effects", records: captured.effects.filter((r: any) => availableOperations.has(r.operation_id)) },
    { category: "publication_events", records: captured.events.filter((r: any) => availableOperations.has(r.operation_id)) },
    { category: "creative_feedback_mappings", records: captured.feedback_bindings },
  ] };
}

/** Reuse normal retained-content readers, including revision and fixed-output fences. */
async function readableSources(tx: Tx, storage: Storage, p: Principal, projects: string[], signal?: AbortSignal) {
  const limit = scopeExportLimits.records_per_category + 1, admin = p.audience === "admin";
  const candidates = (await tx.query(`SELECT * FROM tasks WHERE project_id=ANY($1::uuid[]) AND content_state='active'
    AND retention_expires_at>clock_timestamp() AND task_content_sources_available(id)
    AND (NOT $2::boolean OR private_owner IS NULL) ORDER BY id LIMIT ${limit}`, [projects, admin])).rows;
  if (candidates.length >= limit) throw capacity();
  const tasks = new Map<string, any>();
  const allow = async (read: () => Promise<unknown>) => {
    signal?.throwIfAborted();
    try { await read(); return true; }
    catch (error) {
      if (!(error instanceof Problem) || error.status >= 500 || /BUSY|CHANGING/.test(error.code)) throw error;
      return false;
    }
  };
  for (const task of candidates) if (await allow(async () => {
    await assertReportSources(tx, task, false); await assertTaskContentSources(tx, task);
  })) tasks.set(task.id, task);
  const runs = (await tx.query(`SELECT * FROM workflow_runs WHERE project_id=ANY($1::uuid[]) AND content_state='active'
    AND (NOT $2::boolean OR private_owner IS NULL) ORDER BY id LIMIT ${limit}`, [projects, admin])).rows;
  if (runs.length >= limit) throw capacity();
  const readableRuns: string[] = [];
  for (const run of runs) if (await allow(async () => {
    if (run.origin_task_id) return assertWorkflowReadAccess(tx, storage, run, tasks.get(run.origin_task_id));
    // Retained shared workflows predate native/cloud origin tasks; check their fixed inputs and outputs explicitly.
    await assertWorkflowContract(tx, run);
    const files: any[] = [];
    for (const result of run.results ?? []) {
      if (result.kind === "codex" && result.task_id && !tasks.has(result.task_id))
        throw new Problem(409, "WORKFLOW_READ_SOURCE_UNAVAILABLE", "Workflow source is unavailable");
      files.push(...(result.files ?? (result.asset_version_id ? [result] : [])));
    }
    if (files.length > 8 * 201) throw capacity();
    if (files.length) {
      const available = await tx.query(`SELECT v.id FROM jsonb_to_recordset($1::jsonb) AS expected(asset_version_id uuid,asset_id uuid,sha256 text)
        JOIN asset_versions v ON v.id=expected.asset_version_id JOIN assets a ON a.id=v.asset_id
        WHERE (expected.asset_id IS NULL OR a.id=expected.asset_id) AND (expected.sha256 IS NULL OR v.sha256=expected.sha256)
        AND a.tenant_id=$2 AND a.project_id=$3 AND (a.private_owner IS NULL OR a.private_owner=$4)
        AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
        [JSON.stringify(files), run.tenant_id, run.project_id, run.private_owner ?? run.created_by]);
      if (available.rows.length !== files.length) throw new Problem(409, "WORKFLOW_READ_SOURCE_UNAVAILABLE", "Workflow output is unavailable");
    }
    if (Object.keys(run.named_outputs ?? {}).length) await collectWorkflowOutputs(tx, storage, run, run.results);
  })) readableRuns.push(run.id);
  return { tasks: [...tasks.keys()], runs: readableRuns };
}

/** One imported PostgreSQL snapshot binds business rows, publication DTOs and object identities. */
async function capture(tx: Tx, storage: Storage, p: Principal, s: ExportScope, scope: Awaited<ReturnType<typeof authorize>>, extras: { category: string; records: any[] }[], signal?: AbortSignal) {
  const admin = p.audience === "admin";
  await tx.query("SET LOCAL statement_timeout='60s'");
  const sources = await readableSources(tx, storage, p, scope.projects.map(p => p.id), signal);
  const values = [s.tenant, scope.projects.map(p => p.id), p.id, admin, !s.project, sources.tasks, sources.runs];
  const statements = scopeExportCatalog.map(d => `SELECT '${d.table}' AS category,coalesce(jsonb_agg(data),'[]'::jsonb) AS records
    FROM (SELECT ${exportProjection(d)} AS data FROM ${d.table} r WHERE r.tenant_id=$1 AND (${d.where})
    AND (NOT $4::boolean OR coalesce(to_jsonb(r)->>'private_owner','')='') LIMIT ${scopeExportLimits.records_per_category + 1}) selected`);
  statements.push(`SELECT '__files',coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) FROM (
    SELECT a.id AS asset_id,a.name,a.project_id,v.id AS version_id,v.version,v.bytes::text,v.mime_type,v.sha256,v.storage_key
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.id IN(SELECT id FROM export_versions)
    ORDER BY a.id,v.version LIMIT ${scopeExportLimits.versions + 1}) selected`);
  const datasets = [...(await tx.query(exportCtes + " " + statements.join(" UNION ALL "), values)).rows, ...extras];
  const files: ExportFile[] = [], categories: { name: string; records: number; path: string; bytes: number; sha256: string }[] = [];
  let textBytes = 0, binaryBytes = 0;
  for (const dataset of datasets) {
    const rows: any[] = dataset.records;
    if (dataset.category === "__files") {
      if (rows.length > scopeExportLimits.versions) throw capacity();
      for (const row of rows) {
        const bytes = Number(row.bytes);
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw capacity();
        binaryBytes += bytes;
        if (binaryBytes > scopeExportLimits.binary_bytes) throw capacity();
        files.push({ path: `files/${row.project_id}/${row.asset_id}/v${row.version}/${deliveryFilename(row.name)}`,
          name: row.name, bytes, sha256: row.sha256, mime_type: row.mime_type, storage_key: row.storage_key,
          asset_id: row.asset_id, version_id: row.version_id, version: row.version });
      }
      continue;
    }
    if (rows.length > scopeExportLimits.records_per_category) throw capacity();
    const records = rows.map(r => canonical(exportContent(r))).sort();
    const content = Buffer.from(records.join("\n") + (records.length ? "\n" : ""));
    textBytes += content.length;
    if (textBytes > scopeExportLimits.text_bytes) throw capacity();
    const file = { path: `data/${dataset.category}.ndjson`, name: dataset.category + ".ndjson", bytes: content.length, sha256: hash(content), mime_type: "application/x-ndjson", content };
    files.push(file); categories.push({ name: dataset.category, records: rows.length, path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path)); categories.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = { format: "workmate-scope-export-1", tenant_id: s.tenant, project_id: s.project ?? null,
    exported_for: p.id, audience: admin ? "admin_shared_content" : "customer_authorized_content",
    workspace: scope.tenant.name, projects: scope.projects, archived_projects: scope.archived_projects,
    categories, versions: files.filter(f => f.storage_key).length, binary_bytes: binaryBytes, text_bytes: textBytes,
    files: files.map(({ content: _body, storage_key: _key, ...file }) => file), limits: scopeExportLimits,
    excluded: [...excluded, ...(s.project ? ["TENANT_AND_PERSONAL_MEMORIES_USE_WORKSPACE_EXPORT"] : []), ...(admin ? ["PRIVATE_CUSTOMER_DATA_EXPORT_FROM_CUSTOMER_SIGN_IN"] : [])],
    numeric_encoding: "Int64 counters, file sizes and monetary micros are decimal strings in NDJSON.",
    completeness: "All currently readable retained records and available versions in the listed categories; excluded content is never restored or invented.",
  };
  return { files, manifest, fingerprint: hash(canonical(manifest)) };
}

export async function selectScopeExport(db: Database, storage: Storage, p: Principal, s: ExportScope, signal?: AbortSignal) {
  return db.tx(async authority => {
    await authority.query("SET LOCAL statement_timeout='60s'");
    const scope = await authorize(authority, p, s);
    const controlled = await controlledData(authority, db, p, s, scope);
    // Customer data is always read through cp_app RLS, never the control connection.
    // Both readers import the snapshot held by the still-open authority transaction.
    return db.tx(tx => capture(tx, storage, p, s, scope, controlled.datasets, signal), s.tenant, p.audience === "admin", p.id, { snapshot: controlled.snapshot });
  }, s.tenant, true, p.id);
}

const readme = `# CopyPaste · 範圍資料匯出 / Scope data export\n\n先讀 manifest.json。data/ 是 UTF-8 NDJSON，每行一筆；files/ 保留可用的固定歷史版本及原始位元組。SHA256SUMS 可獨立核對每個檔案與清單。\n\nRead manifest.json first. data/ contains one UTF-8 JSON record per line; files/ contains exact available original and retained historical versions. Verify SHA256SUMS independently. File sizes, Int64 counters and monetary micros use decimal strings to preserve precision.\n\n此為有權讀取的資料快照，不是全庫備份或自動還原工具。沒有執行任何內嵌程式，亦沒有呼叫 AI。封存專案需先恢復；撤回、隔離、刪除、過期及其他客戶的私人正文不恢復。\n\nThis is an authorized data snapshot, not a database backup or an automatic restore program. Exporting runs no embedded code or AI. Restore archived projects before exporting their content. Revoked, quarantined, deleted, expired and other customers' private content is excluded.\n\n憑據、內部儲存位置、全庫備份、未上傳本機檔案及非持久預覽/索引不包括。客戶自行寫入正文的商業資料仍在包內，請保管下載副本。雲端刪除不會自動清除已下載的副本。\n\nCredentials, internal storage locations, backups, unsubmitted local files and nonpersistent previews/indexes are excluded. Customer-authored business text remains in the archive. Keep downloaded copies secure; later cloud deletion cannot remove those local copies.\n`;

export function registerScopeExports(app: FastifyInstance, db: Database, storage: Storage) {
  const inFlight = new Set<string>();
  const serve = (preview: boolean, admin: boolean) => async (req: any, reply: any) => {
    let s: ExportScope;
    if (admin) {
      const { kind, id } = z.object({ kind: z.enum(["projects", "tenants"]), id: uuid }).parse(req.params);
      const row = (await db.control.query(`SELECT ${kind === "projects" ? "tenant_id" : "id"} AS tenant FROM ${kind} WHERE id=$1`, [id])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Scope not found");
      s = { tenant: row.tenant, ...(kind === "projects" ? { project: id } : {}) };
    } else s = z.object({ tenant: uuid, project: uuid.optional() }).parse(req.params);
    if (req.headers["x-tenant-id"] !== undefined && req.headers["x-tenant-id"] !== s.tenant) throw new Problem(400, "TENANT_MISMATCH", "Workspace header does not match export scope");
    const p: Principal = req.principal;
    const q = preview ? z.object({}).strict().parse(req.query) : query.parse(req.query);
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    if (inFlight.size >= 2 || inFlight.has(p.id)) throw new Problem(429, "SCOPE_EXPORT_BUSY", "Another scope export is in progress. Try again shortly.");
    inFlight.add(p.id);
    let directory: string | undefined, handedOff = false;
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
    const interrupt = () => controller.abort(); req.raw.once("aborted", interrupt); reply.raw.once("close", interrupt);
    const cleanup = async () => {
      req.raw.off("aborted", interrupt); reply.raw.off("close", interrupt); inFlight.delete(p.id);
      if (directory) await rm(directory, { recursive: true, force: true });
    };
    try {
      const selected = await selectScopeExport(db, storage, p, s, signal); signal.throwIfAborted();
      if (preview) return { snapshot: selected.fingerprint, name: s.project ? selected.manifest.projects[0].name : selected.manifest.workspace,
        tenant_id: s.tenant, project_id: s.project ?? null, audience: selected.manifest.audience,
        categories: selected.manifest.categories.map(({ path: _path, sha256: _sha, ...r }) => r),
        versions: selected.manifest.versions, binary_bytes: selected.manifest.binary_bytes, text_bytes: selected.manifest.text_bytes,
        projects: selected.manifest.projects, archived_projects: selected.manifest.archived_projects, excluded: selected.manifest.excluded, limits: scopeExportLimits };
      if ((q as z.infer<typeof query>).expected_snapshot !== selected.fingerprint) throw new Problem(409, "SCOPE_EXPORT_CHANGED", "The readable data changed. Refresh the preview before downloading.");
      await mkdir(db.config.DATA_DIR, { recursive: true });
      const parent = await realpath(db.config.DATA_DIR), disk = await statfs(parent);
      if (Number(disk.bavail) * Number(disk.bsize) < selected.manifest.binary_bytes + selected.manifest.text_bytes + 64 * 1024 ** 2)
        throw new Problem(503, "SCOPE_EXPORT_BUSY", "Export storage is full. Try again later.");
      directory = await mkdtemp(path.join(parent, "scope-export-"));
      const archive = await writeDeliveryArchive(directory, selected.files, { ...selected.manifest, snapshot: selected.fingerprint, exported_at: new Date().toISOString() }, storage, signal, readme);
      const checked = await selectScopeExport(db, storage, p, s, signal); signal.throwIfAborted();
      if (checked.fingerprint !== selected.fingerprint) throw new Problem(409, "SCOPE_EXPORT_CHANGED", "The readable data changed during packaging. Refresh the preview and retry.");
      await db.tx(async tx => {
        await authorize(tx, p, s);
        await audit(tx, p, "scope.export.download", s.project ?? s.tenant, "succeeded", { snapshot: selected.fingerprint, versions: selected.manifest.versions,
          categories: selected.manifest.categories.length, bytes: archive.bytes, sha256: archive.sha256, audience: selected.manifest.audience }, s.tenant);
      }, s.tenant, true, p.id);
      signal.throwIfAborted();
      const stream = createReadStream(archive.output, { signal });
      stream.once("close", () => { void cleanup().catch(() => app.log.error("Scope export temporary cleanup failed")); });
      handedOff = true;
      return reply.type("application/zip").header("Content-Disposition", `attachment; filename="workmate-${s.project ?? s.tenant}-data.zip"`)
        .header("Content-Length", archive.bytes).header("X-Content-SHA256", archive.sha256).send(stream);
    } finally { if (!handedOff) await cleanup(); }
  };
  for (const suffix of ["", "/projects/:project"]) for (const preview of [true, false])
    app.get(`/v1/tenants/:tenant${suffix}/export-${preview ? "preview" : "package"}`, { preHandler: requireUser(db), config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, serve(preview, false));
  for (const preview of [true, false]) app.get(`/v1/admin/scopes/:kind/:id/export-${preview ? "preview" : "package"}`,
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, serve(preview, true));
}
