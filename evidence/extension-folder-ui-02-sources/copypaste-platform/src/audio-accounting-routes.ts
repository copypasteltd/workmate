import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { z } from "zod";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { lockAdminAccess } from "./admin-access.js";
import { ReadScope, readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { providerAuthority, providerVisibility, modeOf, type ProviderScope } from "./provider-admin-access.js";
import { audioAccountingChannel, audioAccountingEvidenceCreate, audioAccountingQuery } from "./audio-accounting-model.js";
import { audioAccountingRow, audioAccountingDTO, assertAudioEvidenceBinding } from "./audio-accounting.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { key, replay } from "./access.js";

type Hooks = {
  newOperation(tx: Tx, p: Principal, action: string, command: unknown, k: string, scope: ProviderScope): Promise<any>;
  finish(tx: Tx, p: Principal, op: any, result: any): Promise<any>;
};
const root = "/v1/admin/ai/audio-accounting";
const ids = (params: any) => ({ channel: audioAccountingChannel.parse(params.channel), id: uuid.parse(params.request_id) });
export function registerAudioAccountingRoutes(app: FastifyInstance, db: Database, hooks: Hooks) {
  const auth = { preHandler: requireAdmin(db) };
  app.get(root, auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); const q = audioAccountingQuery.parse(req.query);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.ai.requests.read");
      // The original transitions only move forward. These monotonic facts also
      // expire signed pages after an accounting decision, within this scope.
      const f = new ReadScope(s.bs);
      const stamp = (await tx.query(`SELECT count(*)::text AS records,
        coalesce(sum(CASE r.state WHEN 'prepared' THEN 0 WHEN 'dispatched' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END),0)::text AS observation_steps,
        count(r.cost_confirmation_id) FILTER(WHERE ${providerVisibility(f, "admin.ai.cost.read")})::text AS costs,
        count(r.termination_confirmation_id)::text AS terminations
        FROM current_audio_accounting_requests r WHERE r.data_mode=${f.arg(modeOf(db))} AND r.channel=${f.arg(q.channel)}
        AND ${providerVisibility(f, "admin.ai.requests.read")}`, f.values)).rows[0];
      const bounds = await pageBounds(tx, db, req.principal, s, { ...q, accounting_stamp: hash(canonical(stamp)) }, "audio_accounting");
      let where = `r.data_mode=${s.arg(modeOf(db))} AND ${providerVisibility(s, "admin.ai.requests.read")}
        AND r.created_at<=${s.arg(bounds.asof)}::timestamptz`;
      for (const field of ["channel", "state", "tenant_id", "project_id", "task_id", "validation_id", "release_id", "actor_id"] as const)
        if (q[field]) where += ` AND r.${field}=${s.arg(q[field])}`;
      if (q.period_from) where += ` AND r.created_at>=${s.arg(q.period_from)}::timestamptz`;
      if (q.period_to) where += ` AND r.created_at<${s.arg(q.period_to)}::timestamptz`;
      if (q.cost_state) where += ` AND ${providerVisibility(s, "admin.ai.cost.read")} AND r.cost_state=${s.arg(q.cost_state)}`;
      if (q.capacity_state) where += ` AND r.capacity_held=${s.arg(q.capacity_state === "held")}::boolean`;
      if (bounds.after) where += ` AND (r.created_at,r.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
      const rows = (await tx.query(`SELECT r.*,${providerVisibility(s, "admin.ai.cost.read")} AS can_read_cost,
        to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM current_audio_accounting_requests r WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ${s.arg(q.limit + 1)}`, s.values)).rows;
      await audit(tx, req.principal, "admin.ai.requests.read", "audio-accounting-directory", "succeeded",
        { count: Math.min(rows.length, q.limit), filters_hash: bounds.context.filters });
      return { items: rows.slice(0, q.limit).map(r => audioAccountingDTO(r, r.can_read_cost)),
        next_cursor: rows.length > q.limit ? pageCursor(db, bounds, rows[q.limit - 1]) : null };
    }, undefined, true, req.principal.id);
  });
  app.get(root + "/:channel/:request_id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query); const { channel, id } = ids(req.params);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.ai.requests.read"), r = await audioAccountingRow(tx, channel, id);
      await providerAuthority(tx, req.principal, r, "admin.ai.requests.read");
      const allowed = (await tx.query(`SELECT ${providerVisibility(s, "admin.ai.cost.read")} AS allowed
        FROM current_audio_accounting_requests r WHERE channel=${s.arg(channel)} AND id=${s.arg(id)}`, s.values)).rows[0].allowed;
      const evidence = allowed ? (await tx.query(`SELECT id,document_hash,actor_id,reason,created_at FROM ai_audio_evidence
        WHERE ${channel === "audio_customer" ? "audio_job_id" : "audio_probe_id"}=$1 ORDER BY created_at,id`, [id])).rows : undefined;
      await audit(tx, req.principal, "admin.ai.requests.read", id, "succeeded", { channel, cost_visible: allowed }, r.tenant_id ?? undefined);
      return { ...audioAccountingDTO(r, allowed), ...(evidence ? { evidence } : {}) };
    }, undefined, true, req.principal.id);
  });
  app.post(root + "/:channel/:request_id/evidence", auth, async (req, reply) => {
    const { channel, id } = ids(req.params), b = audioAccountingEvidenceCreate.parse(req.body); reply.code(202).header("Cache-Control", "no-store");
    return db.tx(async tx => {
      await lockAdminAccess(tx); const r = await audioAccountingRow(tx, channel, id, true);
      for (const permission of ["admin.ai.requests.read", "admin.ai.cost.read", "admin.ai.evidence.write"])
        await providerAuthority(tx, req.principal, r, permission);
      return replay(tx, req.principal.id, "audio-accounting.evidence:" + channel + ":" + id, key(req), b, async () => {
        assertAudioEvidenceBinding(r, b.document);
        const op = await hooks.newOperation(tx, req.principal, "ai.evidence.write", b, key(req),
          { data_mode: r.data_mode, tenant_id: r.tenant_id, project_id: r.project_id });
        const body = canonical(b.document), fk = channel === "audio_customer" ? "audio_job_id" : "audio_probe_id";
        let e = (await tx.query(`SELECT id,document_hash FROM ai_audio_evidence WHERE ${fk}=$1 AND document_hash=$2`, [id, hash(body)])).rows[0];
        e ??= (await tx.query(`INSERT INTO ai_audio_evidence(audio_job_id,audio_probe_id,data_mode,canonical_document,document,actor_id,operation_id,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,document_hash`,
        [channel === "audio_customer" ? id : null, channel === "audio_validation" ? id : null, r.data_mode, body, b.document, req.principal.id, op.id, b.reason])).rows[0];
        return hooks.finish(tx, req.principal, op, { evidence_id: e.id, document_hash: e.document_hash, source: "human_submission" });
      });
    }, undefined, true, req.principal.id);
  });
  app.get("/v1/admin/ai/audio-evidence/:evidence_id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); z.object({}).strict().parse(req.query);
    return db.tx(async tx => {
      await lockAdminAccess(tx);
      const e = (await tx.query("SELECT * FROM ai_audio_evidence WHERE id=$1 AND data_mode=current_setting('app.data_mode')", [uuid.parse((req.params as any).evidence_id)])).rows[0];
      if (!e) throw new Problem(404, "NOT_FOUND", "Audio accounting evidence not found");
      const r = await audioAccountingRow(tx, e.audio_job_id ? "audio_customer" : "audio_validation", e.audio_job_id ?? e.audio_probe_id);
      for (const permission of ["admin.ai.requests.read", "admin.ai.cost.read"]) await providerAuthority(tx, req.principal, r, permission);
      await audit(tx, req.principal, "admin.ai.cost.read", e.id, "succeeded", { document_hash: e.document_hash, source: "human_submission" }, r.tenant_id ?? undefined);
      return { id: e.id, document_hash: e.document_hash, document: e.document, actor_id: e.actor_id, reason: e.reason,
        created_at: new Date(e.created_at).toISOString(), source: "human_submission", provider_authenticated: false };
    }, undefined, true, req.principal.id);
  });
}
