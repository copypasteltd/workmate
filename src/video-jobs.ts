import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, type Principal } from "./auth.js";
import { projectAccess, replay } from "./access.js";
import { taskCapabilities, gatewayFingerprint } from "./capability-bindings.js";
import { authorizeExecutionPlan } from "./plans.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { assertTaskContentSources, recordTaskContentRead } from "./task-content-sources.js";
import { canonical, hash, Problem } from "./lib.js";
import { Storage, saveAsset } from "./storage.js";
import { callVideoGateway } from "./video-job-gateway.js";
import { validateGeneratedVideo, validateVideoReference } from "./video-job-media.js";
import { videoJobSpecification, parseVideoJobObservation } from "./video-job-protocol.js";
import type { AIRequestAuthority, AIOperation } from "./internal-ai-gateway.js";
import { assertDesktopVideoOrigin } from "./desktop-video-origin.js";
import { lockNativeWorkflowParent } from "./desktop-workflows.js";

const unavailable = (code = "GENERATED_VIDEO_UNAVAILABLE") => new Problem(409, code, "The generated video operation is unavailable under its current authority");
const mode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";

async function reference(tx: Tx, job: any) {
  if (!job.reference_asset_id) return null;
  const value = (await tx.query(`SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2
    WHERE a.id=$1 AND a.tenant_id=$3 AND a.project_id=$4 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
    AND (a.private_owner IS NULL OR a.private_owner=$5) AND v.erased_at IS NULL
    AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)
    AND task_asset_version_sources_available(v.id) FOR SHARE OF a`,
  [job.reference_asset_id, job.reference_version, job.tenant_id, job.project_id, job.private_owner])).rows[0];
  if (!value || !["image/png", "image/jpeg"].includes(value.mime_type) || Number(value.bytes) > 10_000_000
    || (job.reference_sha256 && value.sha256 !== job.reference_sha256)) throw unavailable("VIDEO_REFERENCE_UNAVAILABLE");
  return value;
}

export class GeneratedVideoJobs {
  constructor(private db: Database, private catalog: Catalog, private storage: Storage) {}

  private async origin(tx: Tx, job: any, active = true) {
    const task = (await tx.query("SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 AND project_id=$3", [job.task_id, job.tenant_id, job.project_id])).rows[0];
    if (!task || task.created_by !== job.actor_id || task.private_owner !== job.private_owner || task.content_state !== "active"
      || task.cancel_requested || !["running", "succeeded"].includes(task.status)
      || (active && (task.status !== "running" || new Date(task.lease_until).getTime() <= Date.now()))) throw unavailable("VIDEO_ORIGIN_UNAVAILABLE");
    const user = (await tx.query("SELECT id,email,name,auth_version FROM users WHERE id=$1", [task.created_by])).rows[0];
    if (!user || user.auth_version !== task.actor_auth_version) throw unavailable("VIDEO_ORIGIN_REVOKED");
    const actor: Principal = { id: user.id, email: user.email, name: user.name, authVersion: user.auth_version, audience: "user", sessionId: "", sessionHash: "" };
    await projectAccess(tx, actor, task.tenant_id, task.project_id, "write");
    await this.catalog.ensureEnabled(tx, task.role_key, task.role_hash);
    await assertTaskSkills(tx, this.catalog, task);
    await authorizeExecutionPlan(tx, task.tenant_id, task.created_by, this.catalog.forTask(task), task.mode);
    const binding = await taskCapabilities(tx, this.db.config, this.catalog, task);
    if (!binding.video || binding.video.id !== job.capability_version_id || binding.video.body.model_alias !== job.model_alias
      || binding.video.body.rates[0] !== Number(job.rate_micros) || job.gateway_fingerprint !== gatewayFingerprint(this.db.config)) throw unavailable("VIDEO_CAPABILITY_REVOKED");
    if (task.execution_location === "desktop") await assertDesktopVideoOrigin(tx, { origin_task_id: task.id,
      tenant_id: task.tenant_id, project_id: task.project_id, actor_id: task.created_by, actor_auth_version: task.actor_auth_version });
    await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
    await assertTaskContentSources(tx, task);
    await reference(tx, job);
    return { task, actor };
  }

  async prepare(task: any, fencing: string, args: unknown, callId: string, authorize: (tx: Tx) => Promise<unknown>) {
    const spec = videoJobSpecification.parse(args);
    return this.db.tx(async tx => {
      await authorize(tx);
      await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
      const binding = await taskCapabilities(tx, this.db.config, this.catalog, task);
      if (!binding.video || !this.catalog.forTask(task).tool_ids.includes("video.generate.internal")) throw unavailable("VIDEO_CAPABILITY_SETUP_REQUIRED");
      const source = await reference(tx, { task_id: task.id, tenant_id: task.tenant_id, project_id: task.project_id, private_owner: task.private_owner,
        reference_asset_id: spec.reference?.asset_id, reference_version: spec.reference?.version });
      const normalized = { ...spec, ...(source ? { reference: { ...spec.reference, sha256: source.sha256 } } : {}) };
      const id = (await tx.query("SELECT prepare_ai_video_job($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id", [task.id, fencing, callId,
        normalized, hash(canonical(normalized)), binding.video.id, spec.reference?.asset_id ?? null, spec.reference?.version ?? null, source?.sha256 ?? null])).rows[0].id;
      return this.metadata(tx, (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1", [id])).rows[0]);
    }, task.tenant_id, true, task.created_by);
  }

  private async metadata(tx: Tx, job: any) {
    let asset: any = null;
    if (job.output_asset_id) {
      asset = (await tx.query(`SELECT a.id,a.name,v.version,v.mime_type,v.bytes::text,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2
        WHERE a.id=$1 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
        AND task_asset_version_sources_available(v.id)`, [job.output_asset_id, job.output_version])).rows[0] ?? null;
    }
    let sourceAvailable = true;
    try { await reference(tx, job); } catch { sourceAvailable = false; }
    return { id: job.id, task_id: job.task_id, operation_id: job.operation_id, revision: job.public_revision, state: job.state,
      progress: job.progress, size: job.size, seconds: job.seconds, model_alias: job.model_alias,
      capability_version_id: job.capability_version_id, data_mode: job.data_mode,
      quoted_micros: String(job.quoted_micros), actual_micros: job.usage_known ? String(job.actual_micros) : null,
      usage_state: job.usage_known ? "confirmed" : "awaiting_confirmation", billable_seconds: job.billable_seconds === null ? null : String(job.billable_seconds),
      budget_violation: job.usage_known && BigInt(job.actual_micros) > BigInt(job.quoted_micros),
      cancel_requested: !!job.cancel_requested_at, error_code: job.error_code, delivery_error: job.delivery_error,
      delivery_state: asset && sourceAvailable ? "available" : job.output_asset_id ? "unavailable" : job.delivery_state,
      assets: asset && sourceAvailable ? [asset] : [], observed_at: job.observed_at, next_poll_at: job.next_poll_at,
      probe: asset && sourceAvailable ? job.delivery_probe : null,
      created_at: job.created_at, finished_at: job.finished_at };
  }

  async read(actor: Principal, tenant: string, project: string, id: string) {
    return this.db.tx(async tx => {
      await projectAccess(tx, actor, tenant, project);
      const job = (await tx.query("SELECT j.* FROM ai_video_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.id=$1 AND j.tenant_id=$2 AND j.project_id=$3 AND t.content_state='active'", [id, tenant, project])).rows[0];
      if (!job || (job.private_owner && job.private_owner !== actor.id)) throw new Problem(404, "NOT_FOUND", "Video operation not found");
      return this.metadata(tx, job);
    }, tenant, false, actor.id);
  }

  async list(actor: Principal, tenant: string, project: string, query: { task_id?: string; cursor?: string; limit: number }) {
    return this.db.tx(async tx => {
      await projectAccess(tx, actor, tenant, project);
      const args = [tenant, project, query.task_id ?? null];
      if (query.cursor && !(await tx.query(`SELECT 1 FROM ai_video_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.id=$4
        AND j.tenant_id=$1 AND j.project_id=$2 AND ($3::uuid IS NULL OR j.task_id=$3) AND t.content_state='active'`, [...args, query.cursor])).rowCount)
        throw new Problem(410, "CURSOR_UNAVAILABLE", "Refresh the generated-video list");
      const rows = (await tx.query(`SELECT j.* FROM ai_video_jobs j JOIN tasks t ON t.id=j.task_id
        WHERE j.tenant_id=$1 AND j.project_id=$2 AND ($3::uuid IS NULL OR j.task_id=$3) AND t.content_state='active'
        AND ($4::uuid IS NULL OR (j.created_at,j.id)<(SELECT created_at,id FROM ai_video_jobs WHERE id=$4))
        ORDER BY j.created_at DESC,j.id DESC LIMIT $5`, [...args, query.cursor ?? null, query.limit + 1])).rows;
      const items = [];
      for (const job of rows.slice(0, query.limit)) items.push(await this.metadata(tx, job));
      return { items, next_cursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
    }, tenant, false, actor.id);
  }

  async preview(actor: Principal, tenant: string, project: string, id: string) {
    return this.db.tx(async tx => {
      await projectAccess(tx, actor, tenant, project);
      const job = (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1 AND tenant_id=$2 AND project_id=$3", [id, tenant, project])).rows[0];
      if (!job || job.private_owner && job.private_owner !== actor.id) throw new Problem(404, "NOT_FOUND", "Video operation not found");
      await this.origin(tx, job, false);
      const version = job.output_asset_id && (await tx.query(`SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2
        WHERE a.id=$1 AND a.tenant_id=$3 AND a.project_id=$4 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND video_asset_available(a.id) AND task_asset_version_sources_available(v.id)`,
      [job.output_asset_id, job.output_version, tenant, project])).rows[0];
      if (!version) throw new Problem(404, "NOT_FOUND", "Generated video preview unavailable");
      if (Number(version.bytes) > 20_000_000) throw new Problem(413, "VIDEO_PREVIEW_LIMIT", "Download this video for playback; the inline preview limit is 20 MB");
      const bytes = await this.storage.get(version.storage_key);
      await projectAccess(tx, actor, tenant, project);
      await this.origin(tx, job, false);
      if (!(await tx.query("SELECT 1 FROM assets WHERE id=$1 AND state='active' AND video_asset_available(id)", [version.asset_id])).rowCount
        || bytes.length !== Number(version.bytes) || hash(bytes) !== version.sha256 || version.mime_type !== "video/mp4") throw unavailable("VIDEO_OUTPUT_UNAVAILABLE");
      return { content_type: "video/mp4", base64: bytes.toString("base64"), bytes: bytes.length, sha256: version.sha256 };
    }, tenant, false, actor.id);
  }

  async cancel(actor: Principal, tenant: string, project: string, id: string, revision: number | null, requestKey: string = randomUUID()) {
    return this.db.tx(async tx => {
      await projectAccess(tx, actor, tenant, project, "write");
      const job = (await tx.query("SELECT j.* FROM ai_video_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.id=$1 AND j.tenant_id=$2 AND j.project_id=$3 AND t.content_state='active' FOR UPDATE OF j", [id, tenant, project])).rows[0];
      if (!job || (job.private_owner && job.private_owner !== actor.id)) throw new Problem(404, "NOT_FOUND", "Video operation not found");
      return replay(tx, actor.id, "video.generation.cancel:" + id, requestKey, { expected_revision: revision }, async () => {
        if (revision !== null && job.public_revision !== revision) throw unavailable("VIDEO_REVISION_CONFLICT");
        if (!job.cancel_requested_at && !job.usage_known) {
          await tx.query("UPDATE ai_video_jobs SET cancel_requested_at=clock_timestamp(),next_poll_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [id]);
          await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'cancel_requested',$2)", [id, { actor_id: actor.id }]);
        }
        await audit(tx, actor, "video.generation.cancel.requested", id, "succeeded", { operation_id: job.operation_id }, tenant);
        return this.metadata(tx, (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1", [id])).rows[0]);
      });
    }, tenant, true, actor.id);
  }

  async observe(id: string, raw: unknown, source: "submit" | "poll" | "lookup" | "cancel" | "callback", lease?: string) {
    return this.db.tx(async tx => {
      const job = (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1 AND data_mode=$2 FOR UPDATE", [id, mode(this.db)])).rows[0];
      if (!job || (lease && (job.lease_token !== lease || new Date(job.lease_until).getTime() <= Date.now()))) throw unavailable("VIDEO_LEASE_LOST");
      const parsed = parseVideoJobObservation(raw, { operationId: job.operation_id, model: job.model_alias, size: job.size, seconds: job.seconds, ...(job.provider_id ? { videoId: job.provider_id } : {}) });
      const value = parsed.value;
      const prior = (await tx.query("SELECT * FROM ai_video_observations WHERE job_id=$1 AND (event_id=$2 OR sequence=$3)", [id, value.event_id, value.sequence])).rows;
      if (prior.length) {
        if (prior.length !== 1 || prior[0].event_id !== value.event_id || prior[0].body_hash !== parsed.hash) throw unavailable("VIDEO_OBSERVATION_CONFLICT");
        return { duplicate: true };
      }
      if (job.state === "prepared") throw unavailable("VIDEO_NOT_DISPATCHED");
      await tx.query("INSERT INTO ai_video_observations(job_id,event_id,sequence,source,body,body_hash) VALUES($1,$2,$3,$4,$5,$6)", [id, value.event_id, value.sequence, source, value, parsed.hash]);
      if (job.provider_sequence !== null && BigInt(value.sequence) < BigInt(job.provider_sequence)) return { stale: true };
      if (["completed", "failed", "cancelled"].includes(job.state) && value.status !== job.state) throw unavailable("VIDEO_TERMINAL_CONFLICT");
      if (job.state === "in_progress" && value.status === "queued"
        || job.progress !== null && value.progress !== null && value.progress < job.progress) throw unavailable("VIDEO_OBSERVATION_REGRESSION");
      if (job.usage_known && value.usage && BigInt(job.billable_seconds) !== BigInt(value.usage.billable_seconds)) throw unavailable("VIDEO_USAGE_CONFLICT");
      if (job.content_sha256 && (value.content?.sha256 !== job.content_sha256 || value.content?.bytes !== job.content_bytes)) throw unavailable("VIDEO_CONTENT_CONFLICT");
      await tx.query(`UPDATE ai_video_jobs SET state=$2,provider_id=$3,provider_sequence=$4,progress=$5,
        usage_known=usage_known OR $6,billable_seconds=coalesce(billable_seconds,$7),content_sha256=coalesce(content_sha256,$8),content_bytes=coalesce(content_bytes,$9),
        error_code=$10,observed_at=clock_timestamp(),finished_at=CASE WHEN $11 THEN coalesce(finished_at,clock_timestamp()) ELSE finished_at END,
        next_poll_at=clock_timestamp()+($12::integer*interval '1 millisecond'),revision=revision+1 WHERE id=$1`,
      [id, value.status, value.id, value.sequence, value.progress ?? job.progress, !!value.usage, value.usage?.billable_seconds ?? null,
        value.content?.sha256 ?? null, value.content?.bytes ?? null, value.error?.code ?? null, parsed.terminal, this.db.config.AI_VIDEO_POLL_INTERVAL_MS]);
      await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'observed',$2)", [id, { source, sequence: value.sequence, state: value.status, usage_known: job.usage_known || !!value.usage }]);
      if (value.usage && BigInt(value.usage.billable_seconds) * BigInt(job.rate_micros) > BigInt(job.quoted_micros))
        await tx.query("INSERT INTO ai_video_budget_violations(job_id,envelope_id,code) VALUES($1,$2,'ALLOCATION_EXCEEDED') ON CONFLICT(job_id) DO NOTHING", [id, job.envelope_id]);
      await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'video.generation.updated',$3)", [job.tenant_id, job.task_id, { job_id: id, state: value.status, progress: value.progress, usage_known: job.usage_known || !!value.usage }]);
      return { duplicate: false };
    }, undefined, true);
  }

  /** Task -> job is the same lock order as Stop's task trigger. */
  private async locked(tx: Tx, id: string, lease?: string) {
    const hint = (await tx.query("SELECT t.* FROM tasks t JOIN ai_video_jobs j ON j.task_id=t.id WHERE j.id=$1", [id])).rows[0];
    if (hint) await lockNativeWorkflowParent(tx, hint);
    await tx.query("SELECT t.id FROM tasks t JOIN ai_video_jobs j ON j.task_id=t.id WHERE j.id=$1 FOR UPDATE OF t", [id]);
    const job = (await tx.query("SELECT * FROM ai_video_jobs WHERE id=$1 AND data_mode=$2 FOR UPDATE", [id, mode(this.db)])).rows[0];
    if (!job || (lease && (job.lease_token !== lease || new Date(job.lease_until).getTime() <= Date.now()))) throw unavailable("VIDEO_LEASE_LOST");
    return job;
  }

  private async uncertain(id: string, lease: string, code: string) {
    await this.db.tx(async tx => {
      const job = await this.locked(tx, id, lease);
      if (job.usage_known) return;
      // No network intent was committed: this is the only locally provable zero.
      if (!job.dispatched_at) {
        await tx.query(`UPDATE ai_video_jobs SET state='cancelled',usage_known=true,billable_seconds=0,error_code=$2,
          finished_at=clock_timestamp(),delivery_state='blocked',delivery_error=$2,revision=revision+1 WHERE id=$1`, [id, code]);
      } else {
        await tx.query(`UPDATE ai_video_jobs SET state=CASE WHEN state IN('completed','failed','cancelled') THEN state ELSE 'unknown' END,
          error_code=CASE WHEN state IN('completed','failed','cancelled') THEN error_code ELSE $2 END,
          next_poll_at=clock_timestamp()+($3::integer*interval '1 millisecond'),revision=revision+1 WHERE id=$1`, [id, code, this.db.config.AI_VIDEO_POLL_INTERVAL_MS]);
      }
      await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'uncertain',$2)", [id, { code, dispatched: !!job.dispatched_at }]);
    }, undefined, true);
  }

  private authority(job: any, lease: string, operation: Extract<AIOperation, `videos.${string}`>, signal: AbortSignal): AIRequestAuthority {
    const check = async (tx: Tx, dispatch = false) => {
      const current = await this.locked(tx, job.id, lease);
      if (current.operation_id !== job.operation_id || current.model_alias !== job.model_alias
        || current.gateway_fingerprint !== gatewayFingerprint(this.db.config)) throw unavailable("VIDEO_GATEWAY_CHANGED");
      if (signal.aborted) throw unavailable("VIDEO_PROCESSING_STOPPED");
      if (operation === "videos.create") {
        if (current.state !== "prepared" || current.dispatched_at || current.cancel_requested_at || current.erased_at) throw unavailable("VIDEO_ALREADY_DISPATCHED");
        await this.origin(tx, current);
        if (!(await tx.query(`SELECT 1 FROM ai_request_budget_envelopes e JOIN reservations r ON r.task_id=e.task_id
          WHERE e.id=$1 AND r.status='reserved' AND r.amount_micros=e.amount_micros
          AND NOT ai_budget_subject_blocked(e.id) AND ai_budget_used(e.id,NULL)<=e.amount_micros::numeric*1000000`, [current.envelope_id])).rowCount)
          throw unavailable("VIDEO_BUDGET_UNAVAILABLE");
        if (dispatch) {
          await tx.query("UPDATE ai_video_jobs SET state='submitting',dispatched_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [job.id]);
          await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'dispatched',$2)", [job.id, { operation_id: current.operation_id }]);
        }
      } else if (operation === "videos.content") {
        if (current.state !== "completed" || current.delivery_state !== "pending" || current.cancel_requested_at) throw unavailable("VIDEO_DELIVERY_UNAVAILABLE");
        await this.origin(tx, current, false);
      } else {
        // Resource-only reconciliation survives user revocation. It never reads
        // a prompt/reference or confers authority to submit another generation.
        if (!current.dispatched_at || operation !== "videos.lookup" && !current.provider_id) throw unavailable("VIDEO_NOT_DISPATCHED");
        if (operation === "videos.cancel" && (!current.cancel_requested_at || current.usage_known
          || ["completed", "failed", "cancelled"].includes(current.state))) throw unavailable("VIDEO_CANCEL_UNAVAILABLE");
      }
    };
    return { taskId: job.task_id, tenantId: job.tenant_id, projectId: job.project_id, actorId: job.actor_id,
      capabilityVersionId: job.capability_version_id, budgeted: true,
      authorize: async info => {
        if (info.operation !== operation || info.model !== job.model_alias || info.taskId !== job.task_id
          || info.tenantId !== job.tenant_id || info.projectId !== job.project_id || info.actorId !== job.actor_id
          || info.capabilityVersionId !== job.capability_version_id
          || operation === "videos.create" && info.requestId !== job.operation_id) throw unavailable("VIDEO_REQUEST_SCOPE_INVALID");
        await this.db.tx(tx => check(tx), job.tenant_id, true, job.actor_id);
        return { dispatch: () => this.db.tx(tx => check(tx, true), job.tenant_id, true, job.actor_id),
          finish: async outcome => {
            if (operation === "videos.create" && outcome.state !== "completed")
              await this.uncertain(job.id, lease, "VIDEO_SUBMISSION_UNCERTAIN");
          } };
      } };
  }

  private async input(job: any, lease: string) {
    return this.db.tx(async tx => {
      const current = await this.locked(tx, job.id, lease), { task } = await this.origin(tx, current);
      const source = await reference(tx, current);
      if (!source) return undefined;
      const bytes = await this.storage.get(source.storage_key);
      if (bytes.length !== Number(source.bytes) || bytes.length > 10_000_000 || hash(bytes) !== source.sha256)
        throw unavailable("VIDEO_REFERENCE_INTEGRITY_FAILED");
      await validateVideoReference(bytes, source.mime_type);
      await this.origin(tx, current);
      await recordTaskContentRead(tx, task, "asset_version", source.id, source.id, source.sha256);
      return { bytes, mime: source.mime_type };
    }, job.tenant_id, true, job.actor_id);
  }

  private async deliver(job: any, lease: string, signal: AbortSignal) {
    try {
      const result = await callVideoGateway(this.db.config, job, "videos.content", this.authority(job, lease, "videos.content", signal), signal);
      if (!("bytes" in result)) throw unavailable("VIDEO_CONTENT_TYPE_INVALID");
      const probe = await validateGeneratedVideo(this.db.config, result.bytes, job,
        { sha256: job.content_sha256, bytes: job.content_bytes }, signal);
      return await this.db.tx(async tx => {
        const current = await this.locked(tx, job.id, lease);
        if (current.output_asset_id) return;
        if (current.state !== "completed" || current.delivery_state !== "pending" || current.cancel_requested_at || signal.aborted)
          throw unavailable("VIDEO_DELIVERY_UNAVAILABLE");
        await this.origin(tx, current, false);
        const asset = await saveAsset(tx, this.storage, { tenant: current.tenant_id, project: current.project_id, user: current.actor_id,
          name: `generated-video-${current.operation_id}.mp4`, mime: "video/mp4", bytes: result.bytes,
          metadata: { task_id: current.task_id, video_job_id: current.id, operation_id: current.operation_id,
            specification_hash: current.specification_hash, size: current.size, seconds: current.seconds,
            capability_version_id: current.capability_version_id, model_alias: current.model_alias,
            reference: current.reference_asset_id ? { asset_id: current.reference_asset_id, version: current.reference_version, sha256: current.reference_sha256 } : null,
            probe, content_origin: "company_internal_video_service" } });
        // Recheck after object I/O as well as before it. A rolled-back object's
        // random immutable storage key is handled by the existing orphan GC.
        await this.origin(tx, current, false);
        if (signal.aborted) throw unavailable("VIDEO_PROCESSING_STOPPED");
        await tx.query(`UPDATE ai_video_jobs SET output_asset_id=$2,output_version=$3,delivery_state='available',delivery_probe=$4,
          delivery_error=NULL,revision=revision+1 WHERE id=$1`, [current.id, asset.id, asset.version.version, probe]);
        await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'delivery',$2)", [current.id, { state: "available", asset_id: asset.id, version: asset.version.version, sha256: probe.sha256 }]);
        await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'video.generation.delivery',$3)", [current.tenant_id, current.task_id, { job_id: current.id, asset_id: asset.id, version: asset.version.version }]);
      }, job.tenant_id, true, job.actor_id);
    } catch (error: any) {
      if (signal.aborted) throw error;
      const permanent = ["GENERATED_VIDEO_INTEGRITY_FAILED", "GENERATED_VIDEO_SPECIFICATION_MISMATCH", "GENERATED_VIDEO_DECODE_FAILED", "VIDEO_CONTENT_TYPE_INVALID"].includes(error.code);
      let blocked = false;
      try { await this.db.tx(async tx => {
        const current = await this.locked(tx, job.id, lease);
        if (current.cancel_requested_at || current.erased_at) throw unavailable("VIDEO_DELIVERY_UNAVAILABLE");
        await this.origin(tx, current, false);
      }, job.tenant_id, true, job.actor_id); }
      catch (authorityError: any) { if (authorityError.code === "VIDEO_LEASE_LOST") throw authorityError; blocked = true; }
      const code = permanent ? error.code : blocked ? "VIDEO_DELIVERY_AUTHORITY_REVOKED" : "VIDEO_DELIVERY_RETRY_REQUIRED";
      await this.db.tx(async tx => {
        const current = await this.locked(tx, job.id, lease);
        if (current.output_asset_id) return;
        await tx.query("UPDATE ai_video_jobs SET delivery_state=$2,delivery_error=$3,revision=revision+1 WHERE id=$1", [job.id, permanent ? "invalid" : blocked ? "blocked" : "pending", code]);
        await tx.query("INSERT INTO ai_video_job_events(job_id,kind,body) VALUES($1,'delivery',$2)", [job.id, { state: permanent ? "invalid" : blocked ? "blocked" : "pending", code }]);
      }, job.tenant_id, true, job.actor_id);
    }
  }

  /** One durable poll/download step; no browser or request lifetime owns a job. */
  async advance(signal: AbortSignal = new AbortController().signal, id?: string) {
    if (signal.aborted) return null;
    const lease = randomUUID();
    const claimed = await this.db.tx(async tx => {
      const job = (await tx.query(`SELECT * FROM ai_video_jobs WHERE data_mode=$1 AND ($2::uuid IS NULL OR id=$2)
        AND (NOT usage_known OR (state='completed' AND delivery_state='pending')) AND next_poll_at<=clock_timestamp()
        AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY next_poll_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [mode(this.db), id ?? null])).rows[0];
      if (!job) return null;
      return (await tx.query("UPDATE ai_video_jobs SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds',revision=revision+1 WHERE id=$1 RETURNING *", [job.id, lease])).rows[0];
    }, undefined, true);
    if (!claimed) return null;
    const stop = new AbortController(), combined = AbortSignal.any([signal, stop.signal]);
    let heartbeatRun: Promise<unknown> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeatRun || combined.aborted) return;
      heartbeatRun = this.db.control.query("UPDATE ai_video_jobs SET lease_until=clock_timestamp()+interval '45 seconds',revision=revision+1 WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()", [claimed.id, lease])
        .then(result => { if (!result.rowCount) stop.abort(); }).catch(() => stop.abort()).finally(() => { heartbeatRun = undefined; });
    }, 5000);
    heartbeat.unref();
    try {
      let job = claimed;
      if (job.state === "prepared") {
        if (job.cancel_requested_at || job.erased_at) {
          await this.uncertain(job.id, lease, "VIDEO_CANCELLED_BEFORE_DISPATCH");
        } else {
          const input = await this.input(job, lease);
          const result = await callVideoGateway(this.db.config, job, "videos.create", this.authority(job, lease, "videos.create", combined), combined, input);
          if (!("value" in result)) throw unavailable("VIDEO_PROTOCOL_INVALID");
          await this.observe(job.id, result.value, "submit", lease);
        }
      } else if (!job.usage_known) {
        // A lost submit response or process lease always uses the original
        // operation lookup, never a second generation POST.
        const operation = job.provider_id ? "videos.retrieve" : "videos.lookup";
        const result = await callVideoGateway(this.db.config, job, operation, this.authority(job, lease, operation, combined), combined);
        if (!("value" in result)) throw unavailable("VIDEO_PROTOCOL_INVALID");
        await this.observe(job.id, result.value, operation === "videos.lookup" ? "lookup" : "poll", lease);
      }
      job = (await this.db.control.query("SELECT * FROM ai_video_jobs WHERE id=$1", [job.id])).rows[0];
      if (job.cancel_requested_at && job.provider_id && !job.usage_known && !["completed", "failed", "cancelled"].includes(job.state)
        && (!job.cancel_sent_at || Date.now() - new Date(job.cancel_sent_at).getTime() >= 5000)) {
        await this.db.tx(async tx => {
          const current = await this.locked(tx, job.id, lease);
          await tx.query("UPDATE ai_video_jobs SET cancel_sent_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [current.id]);
        }, job.tenant_id, true, job.actor_id);
        const result = await callVideoGateway(this.db.config, job, "videos.cancel", this.authority(job, lease, "videos.cancel", combined), combined);
        if (!("value" in result)) throw unavailable("VIDEO_PROTOCOL_INVALID");
        await this.observe(job.id, result.value, "cancel", lease);
        job = (await this.db.control.query("SELECT * FROM ai_video_jobs WHERE id=$1", [job.id])).rows[0];
      }
      if (job.state === "completed" && job.delivery_state === "pending") {
        if (job.cancel_requested_at || job.erased_at) {
          await this.db.control.query("UPDATE ai_video_jobs SET delivery_state='blocked',delivery_error='VIDEO_DELIVERY_CANCELLED',revision=revision+1 WHERE id=$1 AND lease_token=$2", [job.id, lease]);
        } else if (job.usage_known && BigInt(job.actual_micros) > BigInt(job.quoted_micros)) {
          await this.db.control.query("UPDATE ai_video_jobs SET delivery_state='blocked',delivery_error='VIDEO_BUDGET_VIOLATION',revision=revision+1 WHERE id=$1 AND lease_token=$2", [job.id, lease]);
        } else await this.deliver(job, lease, combined);
      }
    } catch (error: any) {
      if (error.code !== "VIDEO_LEASE_LOST") await this.uncertain(claimed.id, lease,
        error instanceof Problem && /^[A-Z0-9_]{1,100}$/.test(error.code) ? error.code : "VIDEO_OPERATION_UNCERTAIN").catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await heartbeatRun;
      // Stop cannot release a provider's cost/slot. Only this local processing
      // lease is released so a later worker can query the same operation.
      await this.db.control.query(`UPDATE ai_video_jobs SET lease_token=NULL,lease_until=NULL,
        next_poll_at=greatest(next_poll_at,clock_timestamp()+($3::integer*interval '1 millisecond')),revision=revision+1
        WHERE id=$1 AND lease_token=$2`, [claimed.id, lease, this.db.config.AI_VIDEO_POLL_INTERVAL_MS]);
    }
    return { id: claimed.id };
  }

  async wait(actor: Principal, tenant: string, project: string, id: string, signal?: AbortSignal) {
    const combined = signal ?? new AbortController().signal;
    const deadline = Date.now() + 840000;
    while (!combined.aborted && Date.now() < deadline) {
      const result = await this.read(actor, tenant, project, id);
      if (result.budget_violation) throw unavailable("VIDEO_COST_RECONCILIATION_REQUIRED");
      if (result.usage_state === "confirmed" && (["failed", "cancelled"].includes(result.state)
        || result.state === "completed" && result.delivery_state !== "pending")) return result;
      await this.advance(combined, id);
      await delay(Math.min(this.db.config.AI_VIDEO_POLL_INTERVAL_MS, 1000), undefined, { signal: combined });
    }
    throw unavailable(combined.aborted ? "VIDEO_WAIT_INTERRUPTED" : "VIDEO_WAIT_RECONCILIATION_REQUIRED");
  }
}
