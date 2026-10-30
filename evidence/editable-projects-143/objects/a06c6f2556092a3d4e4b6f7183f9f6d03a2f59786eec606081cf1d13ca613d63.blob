import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Database, Tx } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
import { lockUserAuthorities } from "./user-authority.js";
import { projectAccess, replay, key } from "./access.js";
import { saveAsset, type Storage } from "./storage.js";
import { canonical, hash, name, Problem, uuid } from "./lib.js";
import { editableDesignSchema } from "./editable-design-model.js";
import { renderEditableDesign, packageEditableDesign } from "./editable-design-render.js";
import { cleanEditableInput, editableScenes, editableRendererProfile, loadEditableResources, readEditableSource,
  type EditableInput, type EditableKind } from "./editable-project-source.js";

type Scope = { tenant: string; project: string };
const mode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";
export async function selectEditableProject(tx: Tx, scope: Scope, id: string, version?: number, lock = false) {
  const p = (await tx.query(`SELECT * FROM creative_projects WHERE id=$1 AND tenant_id=$2 AND project_id=$3
    AND kind IN ('vector','presentation') AND content_state='active' AND retention_expires_at>clock_timestamp()
    ${lock ? "FOR UPDATE NOWAIT" : "FOR SHARE NOWAIT"}`, [id, scope.tenant, scope.project])).rows[0];
  if (!p) throw new Problem(404, "NOT_FOUND", "The editable project is unavailable");
  if (version !== undefined && p.version !== version) throw new Problem(409, "VERSION_CONFLICT", "Refresh this project before saving or exporting");
  return p;
}
export async function createEditableProject(tx: Tx, db: Database, storage: Storage, principal: Principal, scope: Scope,
  kind: EditableKind, projectName: string, source: unknown, rendererProfile?: Record<string, unknown>) {
  const input = cleanEditableInput(kind, source), profile = await editableRendererProfile();
  if (rendererProfile && canonical(profile) !== canonical(rendererProfile))
    throw new Problem(422, "PACKAGE_RENDERER_UNSUPPORTED", "This editable project needs a different pinned renderer or font");
  const checked = await loadEditableResources(tx, storage, scope.project, kind, input);
  // Validate native text layout, glyphs, shapes and evidence before a project exists.
  await renderEditableDesign(kind, input, checked.resources, checked.imported_evidence ? "user_attested_import" : mode(db));
  const body = { schema: editableDesignSchema, input, data_mode: mode(db), renderer_profile: profile, imported_evidence: checked.imported_evidence };
  const p = (await tx.query(`INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version,name,kind,body`, [scope.tenant, scope.project, projectName, kind, body, principal.id])).rows[0];
  await saveVersion(tx, principal, scope, p, checked.source_versions);
  return p;
}
async function saveVersion(tx: Tx, principal: Principal, scope: Scope, p: any, versions: string[]) {
  await tx.query(`INSERT INTO editable_project_versions(creative_id,version,tenant_id,project_id,kind,input,source_versions,renderer_profile,imported_evidence,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [p.id, p.version, scope.tenant, scope.project, p.kind, p.body.input, versions,
    p.body.renderer_profile, p.body.imported_evidence, principal.id]);
}
async function availableResult(tx: Tx, scope: Scope, result: { id: string; version: number }) {
  const p = (await tx.query(`SELECT id FROM creative_projects WHERE id=$1 AND project_id=$2
    AND content_state='active' AND retention_expires_at>clock_timestamp()
    AND editable_project_version_available(id,$3)`, [result.id, scope.project, result.version])).rows[0];
  if (!p) throw new Problem(410, "REQUEST_RESULT_REMOVED", "The original editable project or its sources were removed; it will not be recreated");
}
export function registerEditableProjects(app: FastifyInstance, db: Database, storage: Storage) {
  const base = "/v1/tenants/:tenant/projects/:project/editable-projects", scopeSchema = z.object({ tenant: uuid, project: uuid });
  const guard = { preHandler: requireUser(db) }, workers = new Set<string>();
  const waiting: { user: string; start: () => void }[] = [];
  function drain() {
    for (let i = 0; i < waiting.length && workers.size < 2;) {
      if (workers.has(waiting[i].user)) { i++; continue; }
      const next = waiting.splice(i, 1)[0]; workers.add(next.user); next.start();
    }
  }
  async function bounded<T>(user: string, work: () => Promise<T>) {
    // Preview remounts and an immediate save are ordinary client interactions.
    // Serialize each user's work without allowing an unbounded render backlog.
    if (waiting.length >= 16 || waiting.filter(v => v.user === user).length >= 4)
      throw new Problem(429, "EDITABLE_PROJECT_BUSY", "Too many editable designs are waiting; please try again shortly");
    await new Promise<void>(start => { waiting.push({ user, start }); drain(); });
    try { return await work(); } finally { workers.delete(user); drain(); }
  }
  app.get(base + "/sources", guard, async req => {
    const scope = scopeSchema.parse(req.params), q = z.object({ cursor: uuid.optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const rows = (await tx.query(`SELECT a.id AS asset_id,a.name,v.id AS source_version_id,v.sha256,
        v.metadata->>'design_kind' AS kind FROM assets a JOIN asset_versions v ON v.asset_id=a.id
        LEFT JOIN tasks t ON t.id::text=v.metadata->>'task_id'
        WHERE a.project_id=$1 AND a.private_owner IS NULL AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND v.mime_type='application/json' AND v.metadata->>'editable_design_schema'=$2
        AND v.metadata->>'design_kind' IN ('vector','presentation')
        AND coalesce(v.metadata->>'data_mode',t.data_mode)=$3
        AND ($4::uuid IS NULL OR v.id>$4) AND task_asset_version_sources_available(v.id)
        ORDER BY v.id LIMIT 21`, [scope.project, editableDesignSchema, mode(db), q.cursor ?? null])).rows;
      return { items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].source_version_id : null };
    }, scope.tenant);
  });
  app.get(base + "/requests/:key", guard, async req => {
    const scope = scopeSchema.extend({ key: z.string().regex(/^[\w:-]{16,128}$/) }).parse(req.params),
      q = z.object({ operation: z.enum(["create", "update", "render"]) }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const r = (await tx.query("SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
        [req.principal.id, `editable.project.${q.operation}:${scope.tenant}:${scope.project}`, scope.key])).rows[0];
      if (!r) return { state: "not_recorded" };
      if (r.revoked_at) return { state: "removed" };
      const id = r.response.project_id ?? r.response.id;
      const p = (await tx.query(`SELECT id FROM creative_projects WHERE id=$1 AND project_id=$2 AND content_state='active'
        AND retention_expires_at>clock_timestamp() AND body->>'data_mode'=$3
        AND editable_project_version_available(id,$4)`, [id, scope.project, mode(db), r.response.version])).rows[0];
      if (!p) return { state: "removed" };
      if (q.operation === "render" && (await tx.query("SELECT count(*)::int AS n FROM asset_versions WHERE id=ANY($1::uuid[])",
        [r.response.files.map((v: any) => v.asset_version_id)])).rows[0].n !== r.response.files.length) return { state: "removed" };
      return { state: "completed", result: r.response };
    }, scope.tenant);
  });
  app.get(base, guard, async req => {
    const scope = scopeSchema.parse(req.params), q = z.object({ cursor: uuid.optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project);
      let can_write = true;
      try { await projectAccess(tx, req.principal, scope.tenant, scope.project, "write"); } catch (e) {
        if (e instanceof Problem && e.status === 403) can_write = false; else throw e;
      }
      const rows = (await tx.query(`SELECT id,name,kind,version,body->>'imported_evidence'='true' AS imported_evidence,
        editable_project_version_available(id,version) AS available FROM creative_projects
        WHERE project_id=$1 AND kind IN ('vector','presentation') AND content_state='active' AND retention_expires_at>clock_timestamp()
        AND body->>'data_mode'=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 21`, [scope.project, mode(db), q.cursor ?? null])).rows;
      return { items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null, can_write };
    }, scope.tenant);
  });
  app.post(base, guard, async req => {
    const scope = scopeSchema.parse(req.params), body = z.object({ name, source_version_id: uuid, sha256: z.string().regex(/^[a-f0-9]{64}$/), confirm_project_sharing: z.literal(true) }).strict().parse(req.body), requestKey = key(req);
    return bounded(req.principal.id, () => db.tx(async tx => {
      await lockUserAuthorities(tx, [req.principal.id]); await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const result = await replay(tx, req.principal.id, `editable.project.create:${scope.tenant}:${scope.project}`, requestKey, body, async () => {
        const source = await readEditableSource(tx, storage, scope.project, body.source_version_id, body.sha256);
        if (source.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "The source is unavailable in this service mode");
        const p = await createEditableProject(tx, db, storage, req.principal, scope, source.kind, body.name, source.input);
        await audit(tx, req.principal, "editable.project.create", p.id, "succeeded", { source_version_id: source.source.id, version: p.version, ai_cost_micros: "0" }, scope.tenant);
        return { id: p.id, version: p.version, name: p.name, kind: p.kind, ai_cost_micros: "0" };
      });
      await availableResult(tx, scope, result);
      return result;
    }, scope.tenant));
  });
  app.get(base + "/:id", guard, async req => {
    const scope = scopeSchema.extend({ id: uuid }).parse(req.params), q = z.object({ version: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project);
      const p = await selectEditableProject(tx, scope, scope.id), version = q.version ?? p.version;
      const v = (await tx.query("SELECT * FROM editable_project_versions WHERE creative_id=$1 AND version=$2 AND editable_project_version_available(creative_id,version)", [p.id, version])).rows[0];
      if (!v || p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "This project version or one of its sources is unavailable");
      const versions = (await tx.query("SELECT version,created_at,editable_project_version_available(creative_id,version) AS available FROM editable_project_versions WHERE creative_id=$1 ORDER BY version DESC LIMIT 100", [p.id])).rows;
      return { id: p.id, name: p.name, kind: p.kind, version, current_version: p.version, input: v.input, imported_evidence: v.imported_evidence, versions };
    }, scope.tenant);
  });
  app.put(base + "/:id", guard, async req => {
    const scope = scopeSchema.extend({ id: uuid }).parse(req.params), body = z.object({ name, expected_version: z.number().int().positive(), input: z.unknown() }).strict().parse(req.body), requestKey = key(req);
    return bounded(req.principal.id, () => db.tx(async tx => {
      await lockUserAuthorities(tx, [req.principal.id]); await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const result = await replay(tx, req.principal.id, `editable.project.update:${scope.tenant}:${scope.project}`, requestKey, { id: scope.id, ...body }, async () => {
        const p = await selectEditableProject(tx, scope, scope.id, body.expected_version, true);
        if (p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "This project is unavailable in this service mode");
        const input = cleanEditableInput(p.kind, body.input), checked = await loadEditableResources(tx, storage, scope.project, p.kind, input);
        await renderEditableDesign(p.kind, input, checked.resources, checked.imported_evidence ? "user_attested_import" : mode(db));
        const updated = (await tx.query("UPDATE creative_projects SET name=$2,version=version+1,body=$3 WHERE id=$1 RETURNING *", [p.id, body.name,
          { ...p.body, input, renderer_profile: await editableRendererProfile(), imported_evidence: checked.imported_evidence }])).rows[0];
        await saveVersion(tx, req.principal, scope, updated, checked.source_versions);
        await audit(tx, req.principal, "editable.project.update", p.id, "succeeded", { from_version: p.version, version: updated.version, ai_cost_micros: "0" }, scope.tenant);
        return { id: updated.id, name: updated.name, kind: updated.kind, version: updated.version, ai_cost_micros: "0" };
      });
      await availableResult(tx, scope, result);
      return result;
    }, scope.tenant));
  });
  app.get(base + "/:id/preview", guard, async (req, reply) => {
    const scope = scopeSchema.extend({ id: uuid }).parse(req.params), q = z.object({ version: z.coerce.number().int().positive(), page: z.coerce.number().int().min(1).max(20).default(1) }).strict().parse(req.query);
    const bytes = await bounded(req.principal.id, () => db.tx(async tx => {
      await projectAccess(tx, req.principal, scope.tenant, scope.project);
      const p = await selectEditableProject(tx, scope, scope.id);
      if (p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "This project is unavailable in this service mode");
      const saved = (await tx.query("SELECT input FROM editable_project_versions WHERE creative_id=$1 AND version=$2 AND editable_project_version_available(creative_id,version)", [p.id, q.version])).rows[0];
      if (!saved) throw new Problem(404, "NOT_FOUND", "The saved page or its sources are unavailable");
      const input = saved.input as EditableInput;
      const checked = await loadEditableResources(tx, storage, scope.project, p.kind, input);
        const scene = editableScenes(p.kind, input)[q.page - 1];
        if (!scene) throw new Problem(404, "NOT_FOUND", "Choose an available page");
        const rendered = await renderEditableDesign("vector", { title: input.title, locale: input.locale, purpose: "Project page preview", scene,
          ...(input.brand ? { brand: input.brand } : {}) }, checked.resources, checked.imported_evidence ? "user_attested_import" : mode(db));
        const image = rendered.files.find(v => v.mime === "image/png");
      if (!image) throw new Problem(404, "NOT_FOUND", "Choose an available page");
        if (Math.max(scene.width, scene.height) <= 960) return image.bytes;
        const scale = 960 / Math.max(scene.width, scene.height), canvas = createCanvas(Math.round(scene.width * scale), Math.round(scene.height * scale));
        canvas.getContext("2d").drawImage(await loadImage(image.bytes), 0, 0, canvas.width, canvas.height);
        return canvas.toBuffer("image/png");
    }, scope.tenant));
    return reply.header("Cache-Control", "no-store").send({ content_type: "image/png", base64: bytes.toString("base64"), bytes: bytes.length, sha256: hash(bytes) });
  });
  app.post(base + "/:id/render", guard, async req => {
    const scope = scopeSchema.extend({ id: uuid }).parse(req.params), body = z.object({ expected_version: z.number().int().positive() }).strict().parse(req.body), requestKey = key(req);
    return bounded(req.principal.id, () => db.tx(async tx => {
      await lockUserAuthorities(tx, [req.principal.id]); await projectAccess(tx, req.principal, scope.tenant, scope.project, "write");
      const result = await replay(tx, req.principal.id, `editable.project.render:${scope.tenant}:${scope.project}`, requestKey, { id: scope.id, ...body }, async () => {
        const p = await selectEditableProject(tx, scope, scope.id, body.expected_version, true);
        if (p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "This project is unavailable in this service mode");
        const checked = await loadEditableResources(tx, storage, scope.project, p.kind, p.body.input);
        const rendered = await renderEditableDesign(p.kind, p.body.input, checked.resources, checked.imported_evidence ? "user_attested_import" : mode(db));
        const source = { schema: editableDesignSchema, kind: p.kind, input: p.body.input, input_sha256: hash(canonical(p.body.input)),
          data_mode: mode(db), data_provenance: checked.imported_evidence ? "user_attested_import" : "current_project_sources", pages: rendered.pages, font: rendered.font };
        rendered.files.push({ name: p.kind === "vector" ? "vector.source.json" : "presentation.source.json", mime: "application/json", bytes: Buffer.from(JSON.stringify(source, null, 2) + "\n") });
        const manifest = { schema: "copypaste-editable-design-manifest-1", kind: p.kind, project_id: p.id, version: p.version,
          data_mode: mode(db), data_provenance: source.data_provenance, pages: rendered.pages, font: rendered.font, provider_calls: 0,
          files: rendered.files.map(f => ({ filename: f.name, bytes: f.bytes.length, sha256: hash(f.bytes), mime_type: f.mime })) };
        await tx.query("SELECT set_config('app.editable_project_id',$1,true)", [p.id]);
        const files = [];
        for (const f of packageEditableDesign(rendered.files, rendered.fontBytes, rendered.fontLicense, manifest, rendered.staticFontFiles)) {
          const a = await saveAsset(tx, storage, { tenant: scope.tenant, project: scope.project, user: req.principal.id, kind: "deliverable", name: f.name, mime: f.mime, bytes: f.bytes,
            metadata: { editable_project_id: p.id, editable_project_version: p.version, project_design_source_versions: checked.source_versions,
              ...(p.body.input.brand ? { brand_reference: p.body.input.brand } : {}), editable_design_schema: editableDesignSchema, design_kind: p.kind,
              data_mode: mode(db), data_provenance: source.data_provenance, provider_calls: 0 } });
          await tx.query("INSERT INTO editable_project_outputs(asset_id,creative_id,version,tenant_id,project_id) VALUES($1,$2,$3,$4,$5)", [a.id, p.id, p.version, scope.tenant, scope.project]);
          files.push({ name: f.name, asset_id: a.id, asset_version_id: a.version.id, sha256: a.version.sha256, mime_type: f.mime, bytes: f.bytes.length });
        }
        await audit(tx, req.principal, "editable.project.render", p.id, "succeeded", { version: p.version, files: files.length, ai_cost_micros: "0" }, scope.tenant);
        return { project_id: p.id, version: p.version, kind: p.kind, files, data_provenance: source.data_provenance, ai_cost_micros: "0" };
      });
      const count = (await tx.query("SELECT count(*)::int AS n FROM asset_versions WHERE id=ANY($1::uuid[])", [result.files.map((f: any) => f.asset_version_id)])).rows[0].n;
      if (count !== result.files.length) throw new Problem(410, "REQUEST_RESULT_REMOVED", "This delivery or one of its sources was removed; it will not be recreated");
      return result;
    }, scope.tenant));
  });
}
