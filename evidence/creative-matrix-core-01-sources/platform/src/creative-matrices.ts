import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
import { projectAccess, replay, key } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { Storage, saveAsset } from "./storage.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { matrixCreate, matrixInput, matrixEdit, matrixRetry, type MatrixInput } from "./creative-matrix-model.js";
import { renderMatrixUnit } from "./creative-matrix-layout.js";

const scope = z.object({ tenant: uuid, project: uuid });
const batchParams = scope.extend({ batch: uuid });
const unitParams = batchParams.extend({ unit: uuid });
const mode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";
async function parent(tx: Tx, tenant: string, project: string, id: string, lock = false) {
  const row = (await tx.query(`SELECT * FROM creative_projects WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND kind='creative_matrix' AND content_state='active' ${lock ? "FOR UPDATE" : ""}`, [id, tenant, project])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Design batch not found");
  return row;
}
function active(row: any, db: Database) {
  if (row.body.data_mode !== mode(db)) throw new Problem(409, "DATA_MODE_MISMATCH", "This batch belongs to another data mode");
  if (row.body.cancelled) throw new Problem(409, "BATCH_CANCELLED", "This batch was cancelled; completed files remain available");
}
async function source(tx: Tx, project: string, ref: { asset_id: string; version: number }, lock = false) {
  const row = (await tx.query(`SELECT v.*,a.kind FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2 WHERE a.id=$1 AND a.project_id=$3 AND a.state='active' AND a.private_owner IS NULL AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) ${lock ? "FOR SHARE OF a" : ""}`, [ref.asset_id, ref.version, project])).rows[0];
  if (!row || row.mime_type !== "image/png" || Number(row.bytes) > 8_000_000)
    throw new Problem(422, "IMAGE_SOURCE_UNAVAILABLE", "Choose a shared project PNG version up to 8 MB");
  return row;
}
async function sourceBytes(tx: Tx, storage: Storage, project: string, input: MatrixInput) {
  if (!input.image) return undefined;
  const v = await source(tx, project, input.image, true), bytes = await storage.get(v.storage_key);
  if (v.sha256 !== input.image.sha256 || hash(bytes) !== input.image.sha256 || bytes.length !== Number(v.bytes))
    throw new Problem(422, "IMAGE_SOURCE_INTEGRITY", "The fixed image failed its byte check");
  if (bytes.length < 57 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 2048)
    throw new Problem(422, "IMAGE_SOURCE_INVALID", "Batch source PNG dimensions must be at most 2048 pixels");
  try { PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new Problem(422, "IMAGE_SOURCE_INVALID", "The source PNG cannot be decoded"); }
  return bytes;
}
async function currentActor(tx: Tx, row: any): Promise<Principal> {
  await lockUserAuthorities(tx, [row.actor_id]);
  const user = (await tx.query("SELECT id,email,name,auth_version,status FROM users WHERE id=$1", [row.actor_id])).rows[0];
  if (!user || user.status !== "active" || user.auth_version !== row.actor_auth_version)
    throw new Problem(403, "AUTHORIZATION_CHANGED", "The execution owner's authorization changed");
  const principal: Principal = { id: user.id, name: user.name, email: user.email, authVersion: user.auth_version, audience: "user", sessionId: "", sessionHash: "" };
  await projectAccess(tx, principal, row.tenant_id, row.project_id, "write");
  return principal;
}
const unitColumns = "u.id,u.creative_key,u.locale,u.size_key,u.revision,u.state,u.error_code,u.created_at,u.updated_at,r.input,r.input_hash";
const attemptColumns = "id,unit_id,revision,state,error_code,png_asset_id,svg_asset_id,source_asset_id,ai_cost_micros::text, cost_source,elapsed_ms,output_bytes::text,started_at,finished_at";
async function detail(tx: Tx, batch: any) {
  const units = (await tx.query(`SELECT ${unitColumns} FROM creative_matrix_units u JOIN creative_matrix_revisions r ON r.unit_id=u.id AND r.revision=u.revision WHERE u.batch_id=$1 ORDER BY u.creative_key,u.locale,u.size_key`, [batch.id])).rows;
  const attempts = (await tx.query(`SELECT ${attemptColumns} FROM creative_matrix_attempts WHERE unit_id=ANY($1::uuid[]) ORDER BY started_at,id`, [units.map((u) => u.id)])).rows;
  const counts = { queued: 0, rendering: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const unit of units) counts[unit.state as keyof typeof counts]++;
  const state = counts.queued || counts.rendering ? "running" : counts.succeeded === units.length ? "succeeded" : counts.succeeded ? "partially_succeeded" : counts.failed ? "failed" : "cancelled";
  return { id: batch.id, name: batch.name, version: batch.version, data_mode: batch.body.data_mode, cancelled: !!batch.body.cancelled, state, counts, cost: { ai_cost_micros: "0", source: "local_composition_no_ai", currency: "HKD" }, units: units.map((u) => ({ ...u, attempts: attempts.filter((a) => a.unit_id === u.id) })) };
}
export function registerCreativeMatrices(app: FastifyInstance, db: Database, storage: Storage) {
  const base = "/v1/tenants/:tenant/projects/:project/creative-batches";
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = scope.parse(req.params);
    const query = z.object({ before: uuid.optional() }).strict().parse(req.query);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      let before: any = null;
      if (query.before) before = await parent(tx, tenant, project, query.before);
      const rows = (await tx.query("SELECT id,name,version,created_at,body->>'cancelled'='true' AS cancelled FROM creative_projects WHERE tenant_id=$1 AND project_id=$2 AND kind='creative_matrix' AND content_state='active' AND body->>'data_mode'=$3 AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21", [tenant, project, mode(db), before?.created_at ?? null, before?.id ?? null])).rows;
      return { items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null };
    }, tenant);
  });
  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = scope.parse(req.params), b = matrixCreate.parse(req.body);
    return db.tx(async (tx) => {
      await lockUserAuthorities(tx, [req.principal.id]);
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(tx, req.principal.id, "creative.matrix.create:" + project, key(req), b, async () => {
        // Serialize admission per project without holding a process-local queue.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["creative-matrix-admission:" + project]);
        const pending = Number((await tx.query("SELECT count(*) FROM creative_matrix_units u JOIN creative_projects p ON p.id=u.batch_id WHERE p.project_id=$1 AND p.content_state='active' AND u.state IN ('queued','rendering')", [project])).rows[0].count);
        if (pending + b.creatives.length * b.locales.length * b.sizes.length > 240)
          throw new Problem(429, "BATCH_QUEUE_FULL", "Wait for existing design batches before adding more units");
        const refs = new Map<string, any>();
        for (const c of b.creatives) if (c.image) refs.set(c.key, await source(tx, project, c.image, true));
        const root = (await tx.query("INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by) VALUES($1,$2,$3,'creative_matrix',$4,$5) RETURNING *", [tenant, project, b.name, { schema_version: "1.0", data_mode: mode(db), cancelled: false, definition: b }, req.principal.id])).rows[0];
        for (const c of b.creatives) for (const locale of b.locales) for (const size of b.sizes) {
          const input = matrixInput.parse({ renderer: "copypaste-layout-1", creative_key: c.key, creative_name: c.name, locale, size, theme: c.theme, copy: c.copy.find((x) => x.locale === locale)!.text, image: c.image ? { ...c.image, sha256: refs.get(c.key).sha256 } : null });
          const unit = (await tx.query("INSERT INTO creative_matrix_units(tenant_id,project_id,batch_id,creative_key,locale,size_key,actor_id,actor_auth_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [tenant, project, root.id, c.key, locale, size.key, req.principal.id, req.principal.authVersion])).rows[0];
          await tx.query("INSERT INTO creative_matrix_revisions(tenant_id,project_id,unit_id,revision,input,input_hash,actor_id) VALUES($1,$2,$3,1,$4,$5,$6)", [tenant, project, unit.id, input, hash(canonical(input)), req.principal.id]);
        }
        await audit(tx, req.principal, "creative.matrix.create", root.id, "succeeded", { unit_count: b.creatives.length * b.locales.length * b.sizes.length, ai_cost_micros: "0" }, tenant);
        return { id: root.id };
      });
    }, tenant);
  });
  app.get(base + "/:batch", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, batch } = batchParams.parse(req.params);
    return db.tx(async (tx) => { await projectAccess(tx, req.principal, tenant, project); const p = await parent(tx, tenant, project, batch); if (p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "Design batch not found"); return detail(tx, p); }, tenant);
  });
  for (const operation of ["edit", "retry"] as const) app.post(base + "/:batch/units/:unit/" + operation, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, batch, unit } = unitParams.parse(req.params), b = (operation === "edit" ? matrixEdit : matrixRetry).parse(req.body);
    return db.tx(async (tx) => {
      await lockUserAuthorities(tx, [req.principal.id]); await projectAccess(tx, req.principal, tenant, project, "write");
      const p = await parent(tx, tenant, project, batch, true); active(p, db);
      return replay(tx, req.principal.id, `creative.matrix.${operation}:${unit}`, key(req), b, async () => {
        const u = (await tx.query("SELECT u.*,r.input FROM creative_matrix_units u JOIN creative_matrix_revisions r ON r.unit_id=u.id AND r.revision=u.revision WHERE u.id=$1 AND u.batch_id=$2 FOR UPDATE OF u", [unit, batch])).rows[0];
        if (!u) throw new Problem(404, "NOT_FOUND", "Design unit not found");
        if (u.revision !== b.expected_revision) throw new Problem(409, "VERSION_CONFLICT", "The unit changed; reload its current revision");
        if (u.state === "rendering" || (operation === "retry" && !["failed", "cancelled"].includes(u.state))) throw new Problem(409, "UNIT_STATE_CONFLICT", "Only a stopped unit can be retried or edited");
        if (u.revision >= 50 && operation === "edit") throw new Problem(409, "UNIT_REVISION_LIMIT", "This unit reached 50 revisions; create a new design batch");
        if (Number((await tx.query("SELECT count(*) FROM creative_matrix_attempts WHERE unit_id=$1",[unit])).rows[0].count)>=100) throw new Problem(409,"UNIT_ATTEMPT_LIMIT","This unit reached 100 attempts; create a new design batch");
        const revision = u.revision + (operation === "edit" ? 1 : 0);
        const edit = b as z.infer<typeof matrixEdit>;
        const image = operation === "edit" && edit.image !== undefined ? (edit.image ? { ...edit.image, sha256: (await source(tx,project,edit.image,true)).sha256 } : null) : u.input.image;
        const input = matrixInput.parse(operation === "edit" ? { ...u.input, copy: edit.copy, image, ...(edit.theme ? {theme:edit.theme}: {}) } : u.input);
        if (input.image) await source(tx, project, input.image, true);
        if (operation === "edit") await tx.query("INSERT INTO creative_matrix_revisions(tenant_id,project_id,unit_id,revision,input,input_hash,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [tenant, project, unit, revision, input, hash(canonical(input)), req.principal.id]);
        await tx.query("UPDATE creative_matrix_units SET revision=$2,state='queued',current_attempt=NULL,error_code=NULL,actor_id=$3,actor_auth_version=$4,updated_at=clock_timestamp() WHERE id=$1", [unit, revision, req.principal.id, req.principal.authVersion]);
        await audit(tx, req.principal, "creative.matrix." + operation, batch, "succeeded", { unit_id: unit, revision }, tenant);
        return { id: batch, unit_id: unit, revision, state: "queued" };
      });
    }, tenant);
  });
  app.post(base + "/:batch/cancel", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, batch } = batchParams.parse(req.params), b = z.object({ expected_version: z.number().int().positive() }).strict().parse(req.body);
    return db.tx(async (tx) => {
      await lockUserAuthorities(tx, [req.principal.id]); await projectAccess(tx, req.principal, tenant, project, "write");
      const p = await parent(tx, tenant, project, batch, true);
      return replay(tx, req.principal.id, "creative.matrix.cancel:" + batch, key(req), b, async () => {
        if (p.version !== b.expected_version) throw new Problem(409, "VERSION_CONFLICT", "The batch changed; reload it");
        if (p.body.data_mode !== mode(db)) throw new Problem(404, "NOT_FOUND", "Design batch not found");
        await tx.query("UPDATE creative_projects SET body=jsonb_set(body,'{cancelled}','true'),version=version+1 WHERE id=$1", [batch]);
        await tx.query("UPDATE creative_matrix_attempts SET state='cancelled',error_code='BATCH_CANCELLED',finished_at=clock_timestamp() WHERE state='rendering' AND unit_id IN(SELECT id FROM creative_matrix_units WHERE batch_id=$1)", [batch]);
        await tx.query("UPDATE creative_matrix_units SET state='cancelled',error_code='BATCH_CANCELLED',updated_at=clock_timestamp() WHERE batch_id=$1 AND state IN('queued','rendering')", [batch]);
        await audit(tx, req.principal, "creative.matrix.cancel", batch, "succeeded", {}, tenant); return { id: batch, cancelled: true };
      });
    }, tenant, true, req.principal.id);
  });
}

/** Caller already verified the parent's independent Admin body permission. */
export async function matrixContentBody(tx: Tx, batch: any) {
  return { definition: batch.body,
    units: (await tx.query(`SELECT ${unitColumns} FROM creative_matrix_units u JOIN creative_matrix_revisions r ON r.unit_id=u.id AND r.revision=u.revision WHERE u.batch_id=$1 ORDER BY u.created_at,u.id`,[batch.id])).rows,
    revisions: (await tx.query("SELECT r.unit_id,r.revision,r.input,r.input_hash,r.actor_id,r.created_at FROM creative_matrix_revisions r JOIN creative_matrix_units u ON u.id=r.unit_id WHERE u.batch_id=$1 ORDER BY r.unit_id,r.revision",[batch.id])).rows,
    attempts: (await tx.query(`SELECT ${attemptColumns} FROM creative_matrix_attempts WHERE unit_id IN(SELECT id FROM creative_matrix_units WHERE batch_id=$1) ORDER BY started_at,id`,[batch.id])).rows };
}

function errorCode(e: unknown) {
  if (e instanceof Problem && /^[A-Z_]{3,60}$/.test(e.code)) return e.code;
  return "RENDER_FAILED";
}
/** One local composition per maintenance pass, with two global / one tenant slots. */
export async function advanceCreativeMatrices(db: Database, storage: Storage, renderer = renderMatrixUnit) {
  const claim = await db.tx(async (tx) => {
    if (!(await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended('creative-matrix-claim',0)) AS locked")).rows[0].locked) return null;
    const expired = (await tx.query("SELECT u.batch_id,u.id AS unit_id,a.id FROM creative_matrix_attempts a JOIN creative_matrix_units u ON u.id=a.unit_id WHERE a.state='rendering' AND a.lease_until<clock_timestamp() ORDER BY a.lease_until LIMIT 10")).rows;
    for (const old of expired) {
      await tx.query("SELECT id FROM creative_projects WHERE id=$1 FOR UPDATE", [old.batch_id]);
      await tx.query("SELECT id FROM creative_matrix_units WHERE id=$1 FOR UPDATE", [old.unit_id]);
      const failed = await tx.query("UPDATE creative_matrix_attempts SET state='failed',error_code='RENDER_INTERRUPTED',finished_at=clock_timestamp() WHERE id=$1 AND state='rendering' AND lease_until<clock_timestamp() RETURNING id", [old.id]);
      if (failed.rowCount) await tx.query("UPDATE creative_matrix_units SET state='failed',error_code='RENDER_INTERRUPTED',updated_at=clock_timestamp() WHERE id=$1 AND current_attempt=$2 AND state='rendering'", [old.unit_id, old.id]);
    }
    if (Number((await tx.query("SELECT count(*) FROM creative_matrix_attempts WHERE state='rendering'")).rows[0].count) >= 2) return null;
    const p = (await tx.query("SELECT p.* FROM creative_projects p WHERE p.kind='creative_matrix' AND p.content_state='active' AND p.body->>'cancelled'='false' AND p.body->>'data_mode'=$1 AND EXISTS(SELECT 1 FROM creative_matrix_units u WHERE u.batch_id=p.id AND u.state='queued') AND NOT EXISTS(SELECT 1 FROM creative_matrix_attempts a WHERE a.tenant_id=p.tenant_id AND a.state='rendering') ORDER BY p.created_at,p.id LIMIT 1", [mode(db)])).rows[0];
    if (!p) return null;
    const candidate = (await tx.query("SELECT id,actor_id FROM creative_matrix_units WHERE batch_id=$1 AND state='queued' ORDER BY created_at,id LIMIT 1", [p.id])).rows[0];
    if (!candidate) return null;
    await lockUserAuthorities(tx, [candidate.actor_id]);
    const lockedParent = await parent(tx, p.tenant_id, p.project_id, p.id, true);
    if (lockedParent.body.cancelled) return null;
    const u = (await tx.query("SELECT u.*,r.input,r.input_hash FROM creative_matrix_units u JOIN creative_matrix_revisions r ON r.unit_id=u.id AND r.revision=u.revision WHERE u.id=$1 AND u.state='queued' FOR UPDATE OF u", [candidate.id])).rows[0];
    if (!u) return null;
    if (u.actor_id !== candidate.actor_id) return null;
    try {
      await currentActor(tx, u);
      const input = matrixInput.parse(u.input);
      if (hash(canonical(input)) !== u.input_hash) throw new Problem(409, "INPUT_INTEGRITY", "The saved input failed verification");
      if (input.image) await source(tx, u.project_id, input.image, true);
    } catch (e) {
      const failed = (await tx.query("INSERT INTO creative_matrix_attempts(tenant_id,project_id,unit_id,revision,actor_id,state,lease_token,lease_until,input_hash,error_code,finished_at) VALUES($1,$2,$3,$4,$5,'failed',$6,clock_timestamp(),$7,$8,clock_timestamp()) RETURNING id", [u.tenant_id,u.project_id,u.id,u.revision,u.actor_id,randomUUID(),u.input_hash,errorCode(e)])).rows[0];
      await tx.query("UPDATE creative_matrix_units SET state='failed',current_attempt=$3,error_code=$2,updated_at=clock_timestamp() WHERE id=$1", [u.id, errorCode(e),failed.id]);
      await audit(tx,{id:u.actor_id,audience:"user"},"creative.matrix.denied",p.id,"denied",{unit_id:u.id,revision:u.revision,error_code:errorCode(e)},u.tenant_id);
      return { denied: true, unit_id: u.id };
    }
    const a = (await tx.query("INSERT INTO creative_matrix_attempts(tenant_id,project_id,unit_id,revision,actor_id,state,lease_token,lease_until,input_hash) VALUES($1,$2,$3,$4,$5,'rendering',$6,clock_timestamp()+interval '90 seconds',$7) RETURNING id,lease_token", [u.tenant_id, u.project_id, u.id, u.revision, u.actor_id, randomUUID(), u.input_hash])).rows[0];
    await tx.query("UPDATE creative_matrix_units SET state='rendering',current_attempt=$2,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1", [u.id, a.id]);
    return { ...u, attempt_id: a.id, lease_token: a.lease_token, denied: false };
  }, undefined, true);
  if (!claim || claim.denied) return claim;
  const started = Date.now();
  try {
    const image = await db.tx(async (tx) => { await currentActor(tx, claim); const p = await parent(tx, claim.tenant_id, claim.project_id, claim.batch_id); active(p, db); return sourceBytes(tx, storage, claim.project_id, claim.input); }, claim.tenant_id, true, claim.actor_id);
    const rendered = await renderer(matrixInput.parse(claim.input), image);
    return await db.tx(async (tx) => {
      const principal = await currentActor(tx, claim);
      const p = await parent(tx, claim.tenant_id, claim.project_id, claim.batch_id, true); active(p, db);
      const u = (await tx.query("SELECT * FROM creative_matrix_units WHERE id=$1 FOR UPDATE", [claim.id])).rows[0];
      const a = (await tx.query("SELECT * FROM creative_matrix_attempts WHERE id=$1 AND state='rendering' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE", [claim.attempt_id, claim.lease_token])).rows[0];
      if (!a || u.revision !== claim.revision || u.current_attempt !== a.id || u.state !== "rendering") return { stale: true, unit_id: claim.id };
      if (claim.input.image) await source(tx, claim.project_id, claim.input.image, true);
      const prefix = `${claim.creative_key}-${claim.locale}-${claim.size_key}-r${claim.revision}`;
      const metadata = { creative_batch: p.id, unit_id: claim.id, input_revision: claim.revision, input_hash: claim.input_hash, attempt_id: a.id, renderer: "copypaste-layout-1", ai_cost_micros: "0", cost_source: "local_composition_no_ai" };
      const asset = async (format: string, mime: string, bytes: Buffer) => saveAsset(tx, storage, { tenant: claim.tenant_id, project: claim.project_id, user: claim.actor_id, name: `${prefix}.${format}`, kind: "creative_matrix_output", mime, bytes, metadata: { ...metadata, format } });
      const png = await asset("png", "image/png", Buffer.from(rendered.png));
      const svg = await asset("svg", "image/svg+xml", rendered.svg);
      const description = Buffer.from(canonical(rendered.layout));
      const editable = await asset("json", "application/json", description);
      await tx.query("UPDATE creative_matrix_attempts SET state='succeeded',png_asset_id=$2,svg_asset_id=$3,source_asset_id=$4,elapsed_ms=$5,output_bytes=$6,finished_at=clock_timestamp() WHERE id=$1", [a.id, png.id, svg.id, editable.id, Date.now() - started, rendered.png.length + rendered.svg.length + description.length]);
      await tx.query("UPDATE creative_matrix_units SET state='succeeded',error_code=NULL,updated_at=clock_timestamp() WHERE id=$1", [claim.id]);
      await audit(tx, principal, "creative.matrix.render", p.id, "succeeded", { unit_id: claim.id, revision: claim.revision, attempt_id: a.id, ai_cost_micros: "0" }, claim.tenant_id);
      return { unit_id: claim.id, attempt_id: a.id, state: "succeeded" };
    }, claim.tenant_id, true, claim.actor_id);
  } catch (e) {
    return db.tx(async (tx) => {
      await tx.query("SELECT id FROM creative_projects WHERE id=$1 FOR UPDATE", [claim.batch_id]);
      await tx.query("SELECT id FROM creative_matrix_units WHERE id=$1 FOR UPDATE", [claim.id]);
      const ended = await tx.query("UPDATE creative_matrix_attempts SET state='failed',error_code=$2,elapsed_ms=$3,finished_at=clock_timestamp() WHERE id=$1 AND state='rendering' AND lease_token=$4 RETURNING id", [claim.attempt_id, errorCode(e), Date.now() - started, claim.lease_token]);
      if (ended.rowCount) {
        await tx.query("UPDATE creative_matrix_units SET state='failed',error_code=$2,updated_at=clock_timestamp() WHERE id=$1 AND current_attempt=$3 AND revision=$4 AND state='rendering'", [claim.id, errorCode(e), claim.attempt_id, claim.revision]);
        await audit(tx,{id:claim.actor_id,audience:"user"},"creative.matrix.render.failed",claim.batch_id,"failed",{unit_id:claim.id,revision:claim.revision,attempt_id:claim.attempt_id,error_code:errorCode(e)},claim.tenant_id);
      }
      return { unit_id: claim.id, state: ended.rowCount ? "failed" : "stale", error_code: errorCode(e) };
    }, claim.tenant_id, true, claim.actor_id);
  }
}
