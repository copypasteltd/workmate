import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import { projectAccess, replay } from "./access.js";
import { taskCapabilities, gatewayFingerprint } from "./capability-bindings.js";
import { authorizeExecutionPlan } from "./plans.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { assertTaskContentSources, recordTaskSourceRead } from "./task-content-sources.js";
import { assertDesktopVideoOrigin } from "./desktop-video-origin.js";
import { Storage, saveAsset } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import { internalAIRequest, AIRequestFailure, finishInternalAIRequest, type AIRequestInfo, type AIRequestPermit } from "./internal-ai-gateway.js";
import { audioProductionRequest, parseAudioTranscription, audioSubtitles, subtitleEdit, validateAudioCues } from "./audio-production-model.js";
import { validateProductionAudio } from "./audio-production-media.js";
import { AudioAuthorizations } from "./audio-authorizations.js";

const unavailable = (code = "AUDIO_OPERATION_UNAVAILABLE") => new Problem(409, code, "The audio operation is unavailable under its current authority");
type Authorize = (tx: Tx) => Promise<unknown>;
const currentMode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";

/** One original HTTP submission. Unknown OpenAI audio POSTs have no invented
 * lookup/retry protocol. They retain their capacity and original budget hold. */
export class AudioProduction {
  readonly authorizations: AudioAuthorizations;
  constructor(private db: Database, private catalog: Catalog, private storage: Storage) {
    this.authorizations = new AudioAuthorizations(db, (tx, row, active) =>
      this.origin(tx, { ...row, kind: row.specification.kind }, active));
  }

  private async source(tx: Tx, job: any) {
    if (!job.source_asset_id) return null;
    const v = (await tx.query(`SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2
      WHERE a.id=$1 AND a.tenant_id=$3 AND a.project_id=$4 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
      AND (a.private_owner IS NULL OR a.private_owner=$5) AND v.erased_at IS NULL
      AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)
      AND task_asset_version_sources_available(v.id) FOR SHARE OF a`,
    [job.source_asset_id, job.source_version, job.tenant_id, job.project_id, job.private_owner])).rows[0];
    if (!v || !["audio/wav", "audio/mpeg"].includes(v.mime_type) || Number(v.bytes) > 25_000_000
      || job.source_sha256 && v.sha256 !== job.source_sha256) throw unavailable("AUDIO_SOURCE_UNAVAILABLE");
    return v;
  }

  private async origin(tx: Tx, job: any, active = true) {
    if (job.authorization_id && !(await tx.query("SELECT audio_authorization_available($1,$2) AS ok",
      [job.authorization_id, active])).rows[0].ok) throw unavailable("AUDIO_AUTHORIZATION_UNAVAILABLE");
    const task = (await tx.query("SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 AND project_id=$3", [job.task_id, job.tenant_id, job.project_id])).rows[0];
    if (!task || task.created_by !== job.actor_id || task.private_owner !== job.private_owner || task.content_state !== "active"
      || task.cancel_requested || !["running", "succeeded"].includes(task.status)
      || active && (task.status !== "running" || new Date(task.lease_until).getTime() <= Date.now()
        || task.fencing_token !== job.origin_fencing || task.attempt !== job.origin_attempt)) throw unavailable("AUDIO_ORIGIN_UNAVAILABLE");
    const u = (await tx.query("SELECT id,email,name,auth_version FROM users WHERE id=$1 AND status='active'", [task.created_by])).rows[0];
    if (!u || u.auth_version !== task.actor_auth_version) throw unavailable("AUDIO_ORIGIN_REVOKED");
    const actor: Principal = { id: u.id, email: u.email, name: u.name, authVersion: u.auth_version, audience: "user", sessionId: "", sessionHash: "" };
    await projectAccess(tx, actor, task.tenant_id, task.project_id, active ? "write" : "read");
    await this.catalog.ensureEnabled(tx, task.role_key, task.role_hash);
    await assertTaskSkills(tx, this.catalog, task);
    if (active) await authorizeExecutionPlan(tx, task.tenant_id, task.created_by, this.catalog.forTask(task), task.mode);
    const binding = await taskCapabilities(tx, this.db.config, this.catalog, task), cap = job.kind === "speech" ? binding.speech : binding.transcription;
    if (!cap || cap.id !== job.capability_version_id || cap.body.model_alias !== job.model_alias
      || cap.body.rates[0] !== Number(job.rate_micros) || job.gateway_fingerprint !== gatewayFingerprint(this.db.config)) throw unavailable("AUDIO_CAPABILITY_REVOKED");
    if (active && task.execution_location === "desktop") await assertDesktopVideoOrigin(tx, { origin_task_id: task.id,
      tenant_id: task.tenant_id, project_id: task.project_id, actor_id: task.created_by, actor_auth_version: task.actor_auth_version });
    await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
    await assertTaskContentSources(tx, task);
    await this.source(tx, job);
    return { task, actor, cap };
  }

  async prepare(task: any, fencing: string, args: unknown, callId: string, authorize: Authorize, signal?: AbortSignal) {
    const spec = audioProductionRequest.parse(args);
    signal?.throwIfAborted();
    if (fencing !== task.fencing_token) throw unavailable("AUDIO_ORIGIN_UNAVAILABLE");
    let pending: string | undefined;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await this.prepareOnce(task, fencing, spec, callId, authorize, signal);
        if ("job" in next) return next.job!;
        pending = next.authorization.id;
        await this.authorizations.wait(task, pending!, authorize, signal);
      }
    } catch (error) {
      if (pending) await this.authorizations.cancel(pending, "AUDIO_PREPARATION_ENDED");
      throw error;
    }
  }

  private async prepareOnce(task: any, fencing: string, spec: ReturnType<typeof audioProductionRequest.parse>,
    callId: string, authorize: Authorize, signal?: AbortSignal) {
    return this.db.tx(async tx => {
      await authorize(tx);
      await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
      const binding = await taskCapabilities(tx, this.db.config, this.catalog, task), cap = spec.kind === "speech" ? binding.speech : binding.transcription;
      if (!cap || !this.catalog.forTask(task).tool_ids.includes("speech.generate.internal")) throw unavailable("AUDIO_CAPABILITY_SETUP_REQUIRED");
      if (!(cap.body.limits.locales as string[]).includes(spec.locale)) throw unavailable("AUDIO_LANGUAGE_NOT_VERIFIED");
      if (spec.kind === "speech" && !(cap.body.limits.voices as string[]).includes(spec.voice))
        throw unavailable("AUDIO_VOICE_NOT_VERIFIED");
      if (spec.kind === "transcription" && spec.timestamps && !(cap.body.limits.response_formats as string[]).includes("verbose_json"))
        throw unavailable("AUDIO_TIMESTAMPS_NOT_VERIFIED");
      // A replay returns the exact original fact, including unknown/cancelled.
      const digest = hash(canonical(spec));
      const existing = (await tx.query("SELECT * FROM ai_audio_jobs WHERE task_id=$1 AND (call_id=$2 OR specification_hash=$3) ORDER BY created_at,id LIMIT 1",
        [task.id, callId, digest])).rows[0];
      if (existing) {
        if (existing.specification_hash !== digest || existing.capability_version_id !== cap.id) throw unavailable("AUDIO_REPLAY_CHANGED");
        return { job: await this.metadata(tx, existing) };
      }
      let source: any = null, probe: any = null;
      if (spec.kind === "transcription") {
        source = await this.source(tx, { source_asset_id: spec.source.asset_id, source_version: spec.source.version,
          tenant_id: task.tenant_id, project_id: task.project_id, private_owner: task.private_owner });
        const bytes = await this.storage.get(source.storage_key);
        if (bytes.length !== Number(source.bytes) || hash(bytes) !== source.sha256) throw unavailable("AUDIO_SOURCE_INTEGRITY_FAILED");
        probe = await validateProductionAudio(this.db.config, bytes, source.mime_type, signal);
        // Saving output later inherits the exact source dependency, not just its filename.
        await recordTaskSourceRead(tx, task, "asset_version", source.id, source.id, source.sha256);
      }
      const units = spec.kind === "speech" ? [...spec.text].length : probe.duration_ms;
      const authorization = await this.authorizations.proposal(tx, task, spec, callId, cap,
        gatewayFingerprint(this.db.config), source, probe, units);
      if (authorization.state !== "confirmed") return { authorization };
      signal?.throwIfAborted();
      const id = (await tx.query("SELECT prepare_ai_audio_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id", [task.id, fencing, callId,
        spec, digest, cap.id, source?.asset_id ?? null, spec.kind === "transcription" ? spec.source.version : null,
        source?.sha256 ?? null, probe, units])).rows[0].id;
      return { job: await this.metadata(tx, (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1", [id])).rows[0]) };
    }, task.tenant_id, true, task.created_by);
  }

  private async metadata(tx: Tx, job: any) {
    const assets = (await tx.query(`SELECT x.kind,x.revision,a.id,a.name,v.id AS asset_version_id,v.version,v.mime_type,v.bytes::text,v.sha256
      FROM ai_audio_job_artifacts x JOIN assets a ON a.id=x.asset_id JOIN asset_versions v ON v.asset_id=x.asset_id AND v.version=x.asset_version
      WHERE x.job_id=$1 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND video_asset_available(a.id) AND task_asset_version_sources_available(v.id) ORDER BY x.revision,x.kind`, [job.id])).rows;
    return { id: job.id, task_id: job.task_id, operation_id: job.operation_id, kind: job.kind, state: job.state, revision: job.revision,
      subtitle_revision: job.subtitle_revision, model_alias: job.model_alias, capability_version_id: job.capability_version_id,
      authorization_id: job.authorization_id ?? null,
      authorization_basis: job.authorization_id ? "independent_customer_session" : "legacy_model_declaration",
      data_mode: job.data_mode, quoted_micros: String(job.quoted_micros), actual_micros: job.usage_known ? String(job.actual_micros) : null,
      pricing_unit: job.pricing_unit, quoted_units: String(job.quoted_units), billable_units: job.usage_known ? String(job.billable_units) : null,
      usage_state: job.usage_known ? "confirmed_company_tariff" : "awaiting_confirmation", supplier_cost_micros: null,
      duration_ms: job.duration_ms, decoded_media: job.decoded_media, error_code: job.error_code, delivery_state: job.delivery_state,
      cancel_requested: !!job.cancel_requested_at, assets, created_at: job.created_at, finished_at: job.finished_at };
  }

  private async outcome(id: string, state: "unknown" | "cancelled", code: string, dispatched: boolean) {
    await this.db.tx(async tx => {
      const job = (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!job || job.state === "completed" || job.state === "cancelled" || job.state === "unknown") return;
      if (dispatched !== (job.state === "dispatched")) return;
      await tx.query(`UPDATE ai_audio_jobs SET state=$2,error_code=$3,usage_known=$4,billable_units=$5,finished_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,
        [id, state, code, !dispatched, dispatched ? null : 0]);
      await tx.query("INSERT INTO ai_audio_job_events(job_id,kind,body) VALUES($1,$2,$3)", [id, state, { code, usage_known: !dispatched }]);
    }, undefined, true);
  }

  async execute(task: any, id: string, authorize: Authorize, signal: AbortSignal = new AbortController().signal) {
    let job = (await this.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=$1 AND task_id=$2 AND data_mode=$3", [id, task.id, currentMode(this.db)])).rows[0];
    if (!job) throw unavailable();
    if (job.state !== "prepared") return this.db.tx(tx => this.metadata(tx, job), task.tenant_id, true, task.created_by);
    let ownedDispatch = false, response: Response | undefined;
    try {
      const spec = audioProductionRequest.parse(job.specification);
      const prepared = await this.db.tx(async tx => {
        await authorize(tx);
        const { cap } = await this.origin(tx, job);
        const source = await this.source(tx, job);
        return { source, cap };
      }, task.tenant_id, true, task.created_by);
      let body: Record<string, unknown> | FormData;
      if (spec.kind === "speech") body = { model: job.model_alias, input: spec.text, voice: spec.voice, speed: spec.speed, response_format: "wav" };
      else {
        const bytes = await this.storage.get(prepared.source.storage_key);
        if (bytes.length !== Number(prepared.source.bytes) || hash(bytes) !== job.source_sha256) throw unavailable("AUDIO_SOURCE_INTEGRITY_FAILED");
        body = new FormData();
        body.set("model", job.model_alias); body.set("file", new Blob([new Uint8Array(bytes)], { type: prepared.source.mime_type }), prepared.source.mime_type === "audio/wav" ? "source.wav" : "source.mp3");
        body.set("language", spec.locale === "en" ? "en" : "zh");
        body.set("response_format", spec.timestamps ? "verbose_json" : "json");
        if (spec.timestamps) body.set("timestamp_granularities[]", "segment");
      }
      response = await internalAIRequest(this.db.config, {
        operation: spec.kind === "speech" ? "audio.speech" : "audio.transcriptions", model: job.model_alias, body,
        operationId: job.operation_id, audioLimits: prepared.cap.body.limits, signal,
        authority: { taskId: task.id, tenantId: task.tenant_id, projectId: task.project_id, actorId: task.created_by,
          capabilityVersionId: job.capability_version_id, attempt: task.attempt, fencingToken: task.fencing_token, budgeted: true,
          authorize: async (info: AIRequestInfo): Promise<AIRequestPermit> => {
            if (info.requestId !== job.operation_id || info.capabilityVersionId !== job.capability_version_id || info.model !== job.model_alias
              || info.operation !== (job.kind === "speech" ? "audio.speech" : "audio.transcriptions")) throw new AIRequestFailure("AUDIO_REQUEST_SCOPE_INVALID", 403);
            return { dispatch: async () => {
              await this.db.tx(async tx => {
                await authorize(tx);
                await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ai-gateway:" + job.data_mode]);
                const current = (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
                if (current.state !== "prepared" || current.cancel_requested_at) throw new AIRequestFailure("AUDIO_OPERATION_ALREADY_SUBMITTED", 409);
                await this.origin(tx, current);
                const policy = (await tx.query("SELECT policy_version_id FROM ai_gateway_policy_heads WHERE data_mode=$1", [job.data_mode])).rows[0];
                const reason = (await tx.query("SELECT ai_gateway_limit_reason($1,$2,$3,'audio','task',$4) AS reason", [policy.policy_version_id, task.tenant_id, task.created_by, id])).rows[0].reason;
                if (reason) throw new AIRequestFailure("AUDIO_PROVIDER_CAPACITY", 429);
                await tx.query("UPDATE ai_audio_jobs SET state='dispatched',request_hash=$2,dispatched_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [id, info.requestHash]);
                await tx.query("INSERT INTO ai_audio_job_events(job_id,kind) VALUES($1,'dispatched')", [id]);
              }, task.tenant_id, true, task.created_by);
              ownedDispatch = true;
            }, finish: async outcome => {
              if (outcome.state === "unknown" && ownedDispatch) await this.outcome(id, "unknown", "AUDIO_TRANSPORT_UNCERTAIN", true);
            } };
          } },
      });
      if (!response.ok) throw new AIRequestFailure("AUDIO_PROVIDER_RESPONSE_FAILED", 502, true);
      const raw = Buffer.from(await response.arrayBuffer());
      let probe: any, document: any;
      if (spec.kind === "speech") {
        if (!/^(?:audio\/(?:wav|x-wav|wave)|application\/octet-stream)(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
          throw unavailable("AUDIO_RESPONSE_TYPE_INVALID");
        probe = await validateProductionAudio(this.db.config, raw, "audio/wav", signal);
      } else {
        if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable("AUDIO_RESPONSE_TYPE_INVALID");
        probe = job.source_probe;
        document = parseAudioTranscription(raw, probe.duration_ms, spec.timestamps);
      }
      // A complete, validated response proves the published company tariff;
      // it is not a claim about the supplier's undisclosed invoice/cost.
      await this.db.tx(async tx => {
        const current = (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!["dispatched", "unknown"].includes(current.state) || !ownedDispatch) throw unavailable("AUDIO_OUTCOME_CONFLICT");
        await tx.query(`UPDATE ai_audio_jobs SET state='completed',usage_known=true,billable_units=quoted_units,
          response_sha256=$2,response_bytes=$3,duration_ms=$4,decoded_media=$5,error_code=NULL,finished_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,
        [id, hash(raw), raw.length, probe.duration_ms, probe]);
        await tx.query("INSERT INTO ai_audio_job_events(job_id,kind,body) VALUES($1,'completed',$2)", [id, { sha256: hash(raw), bytes: raw.length, pricing_basis: "validated_complete_company_response" }]);
      }, undefined, true);
      try {
        await this.db.tx(async tx => {
          const current = (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
          await this.origin(tx, current);
          if (signal.aborted || current.cancel_requested_at) throw unavailable("AUDIO_DELIVERY_CANCELLED");
          if (spec.kind === "speech") await this.artifact(tx, current, 0, "audio", raw, "audio/wav", "wav", task.created_by, "Validated AI generated speech");
          else {
            await this.artifact(tx, current, 0, "raw_response", raw, "application/json", "json", task.created_by, "Exact original UTF-8 provider response");
            await this.subtitleArtifacts(tx, current, 1, document, task.created_by, "Original validated provider transcription");
          }
          await tx.query("UPDATE ai_audio_jobs SET delivery_state='available',subtitle_revision=$2,revision=revision+1 WHERE id=$1", [id, spec.kind === "speech" ? 0 : 1]);
        }, task.tenant_id, true, task.created_by);
      } catch {
        await this.db.control.query("UPDATE ai_audio_jobs SET delivery_state='blocked',error_code='AUDIO_DELIVERY_UNAVAILABLE',revision=revision+1 WHERE id=$1 AND delivery_state='pending'", [id]);
      }
      await finishInternalAIRequest(response, { state: "completed", httpStatus: response.status });
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      if (ownedDispatch) await this.outcome(id, "unknown", error instanceof AIRequestFailure ? error.code : "AUDIO_RESPONSE_NOT_VALIDATED", true);
      else if (!(error instanceof AIRequestFailure && error.code === "AUDIO_OPERATION_ALREADY_SUBMITTED"))
        await this.outcome(id, "cancelled", "AUDIO_NOT_DISPATCHED", false);
      if (!ownedDispatch) throw error;
    }
    job = (await this.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=$1", [id])).rows[0];
    return this.db.tx(tx => this.metadata(tx, job), task.tenant_id, true, task.created_by);
  }

  private async artifact(tx: Tx, job: any, revision: number, kind: string, bytes: Buffer, mime: string, ext: string, actor: string, reason: string) {
    const asset = await saveAsset(tx, this.storage, { tenant: job.tenant_id, project: job.project_id, user: job.actor_id,
      name: `audio-${job.id.slice(0, 8)}-${kind}-v${revision}.${ext}`, mime, kind: "audio_production", bytes,
      ...(job.private_owner ? { privateOwner: job.private_owner } : {}), metadata: { task_id: job.task_id, audio_job_id: job.id,
        audio_kind: job.kind, artifact_kind: kind, subtitle_revision: revision, ai_generated: job.kind === "speech" } });
    await tx.query("INSERT INTO ai_audio_job_artifacts(job_id,revision,kind,asset_id,asset_version,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [job.id, revision, kind, asset.id, asset.version.version, actor, reason]);
    return asset;
  }
  private async subtitleArtifacts(tx: Tx, job: any, revision: number, doc: any, actor: string, reason: string) {
    await this.artifact(tx, job, revision, "transcript", Buffer.from(JSON.stringify({ ...doc, audio_job_id: job.id, revision }, null, 2) + "\n"), "application/json", "json", actor, reason);
    if (doc.cues.length) {
      await this.artifact(tx, job, revision, "srt", Buffer.from(audioSubtitles(doc.cues, false)), "application/x-subrip", "srt", actor, reason);
      await this.artifact(tx, job, revision, "vtt", Buffer.from(audioSubtitles(doc.cues, true)), "text/vtt", "vtt", actor, reason);
    }
  }

  private async userJob(tx: Tx, actor: Principal, tenant: string, project: string, id: string, write = false) {
    await projectAccess(tx, actor, tenant, project, write ? "write" : "read");
    const job = (await tx.query(`SELECT j.* FROM ai_audio_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.id=$1 AND j.tenant_id=$2 AND j.project_id=$3
      AND j.data_mode=$4 AND t.content_state='active' AND (j.private_owner IS NULL OR j.private_owner=$5) ${write ? "FOR UPDATE OF j" : ""}`,
    [id, tenant, project, currentMode(this.db), actor.id])).rows[0];
    if (!job) throw new Problem(404, "NOT_FOUND", "Audio operation not found");
    return job;
  }
  async read(actor: Principal, tenant: string, project: string, id: string) {
    return this.db.tx(async tx => this.metadata(tx, await this.userJob(tx, actor, tenant, project, id)), tenant, true, actor.id);
  }
  async list(actor: Principal, tenant: string, project: string, query: { task_id?: string; cursor?: string; limit: number }) {
    return this.db.tx(async tx => {
      await projectAccess(tx, actor, tenant, project);
      const values = [tenant, project, currentMode(this.db), actor.id, query.task_id ?? null, query.cursor ?? null, query.limit + 1];
      const where = `j.tenant_id=$1 AND j.project_id=$2 AND j.data_mode=$3 AND (j.private_owner IS NULL OR j.private_owner=$4)
        AND t.content_state='active' AND ($5::uuid IS NULL OR j.task_id=$5)`;
      if (query.cursor && !(await tx.query(`SELECT 1 FROM ai_audio_jobs j JOIN tasks t ON t.id=j.task_id WHERE ${where} AND j.id=$6`, values.slice(0, 6))).rowCount)
        throw new Problem(410, "CURSOR_UNAVAILABLE", "Refresh the audio operations list");
      const rows = (await tx.query(`SELECT j.* FROM ai_audio_jobs j JOIN tasks t ON t.id=j.task_id WHERE ${where}
        AND ($6::uuid IS NULL OR (j.created_at,j.id)<(SELECT created_at,id FROM ai_audio_jobs WHERE id=$6)) ORDER BY j.created_at DESC,j.id DESC LIMIT $7`, values)).rows;
      const items = []; for (const job of rows.slice(0, query.limit)) items.push(await this.metadata(tx, job));
      return { items, next_cursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
    }, tenant, true, actor.id);
  }
  async preview(actor: Principal, tenant: string, project: string, id: string, artifactKind: "audio" | "transcript" | "raw_response" | "srt" | "vtt", revision?: number) {
    return this.db.tx(async tx => {
      const job = await this.userJob(tx, actor, tenant, project, id);
      await this.origin(tx, job, false);
      const item = (await this.metadata(tx, job)).assets.find(item => item.kind === artifactKind && item.revision === (["audio", "raw_response"].includes(artifactKind) ? 0 : revision ?? job.subtitle_revision));
      if (!item) throw new Problem(404, "NOT_FOUND", "Audio artifact unavailable");
      const v = (await tx.query("SELECT * FROM asset_versions WHERE asset_id=$1 AND version=$2", [item.id, item.version])).rows[0];
      const raw = await this.storage.get(v.storage_key);
      await this.origin(tx, job, false);
      if (raw.length !== Number(v.bytes) || hash(raw) !== v.sha256) throw unavailable("AUDIO_OUTPUT_INTEGRITY_FAILED");
      return { content_type: v.mime_type, base64: raw.toString("base64"), bytes: raw.length, sha256: v.sha256,
        ai_generated: job.kind === "speech", ...(artifactKind === "transcript" ? { document: JSON.parse(raw.toString("utf8")) } : {}) };
    }, tenant, true, actor.id);
  }
  async edit(actor: Principal, tenant: string, project: string, id: string, input: unknown, requestKey: string) {
    const b = subtitleEdit.parse(input);
    return this.db.tx(async tx => {
      const job = await this.userJob(tx, actor, tenant, project, id, true);
      await this.origin(tx, job, false);
      return replay(tx, actor.id, "audio.subtitles.edit:" + id, requestKey, b, async () => {
        if (job.revision !== b.expected_revision) throw unavailable("AUDIO_REVISION_CONFLICT");
        if (job.kind !== "transcription" || job.state !== "completed" || job.delivery_state !== "available") throw unavailable("AUDIO_SUBTITLE_EDIT_UNAVAILABLE");
        validateAudioCues(b.cues, job.duration_ms);
        if (b.cues.length && b.cues.map(cue => cue.text).join("\n") !== b.text)
          throw new Problem(422, "AUDIO_SUBTITLE_TEXT_MISMATCH", "The full edited transcript must equal all subtitle texts joined with newlines");
        const revision = job.subtitle_revision + 1;
        await this.subtitleArtifacts(tx, job, revision, { schema_version: 1, text: b.text, cues: b.cues, duration_ms: job.duration_ms,
          timing_source: b.cues.length ? "customer_manual_revision" : "none", previous_revision: job.subtitle_revision }, actor.id, b.reason);
        await tx.query("UPDATE ai_audio_jobs SET subtitle_revision=$2,revision=revision+1 WHERE id=$1", [id, revision]);
        await tx.query("INSERT INTO ai_audio_job_events(job_id,kind,body) VALUES($1,'subtitle_revision',$2)", [id, { revision, actor_id: actor.id }]);
        await audit(tx, actor, "audio.subtitles.edited", id, "succeeded", { revision, reason: b.reason }, tenant);
        return this.metadata(tx, { ...job, revision: job.revision + 1, subtitle_revision: revision });
      });
    }, tenant, true, actor.id);
  }
  async cancel(actor: Principal, tenant: string, project: string, id: string, expected: number, requestKey: string) {
    return this.db.tx(async tx => {
      const job = await this.userJob(tx, actor, tenant, project, id, true);
      return replay(tx, actor.id, "audio.cancel:" + id, requestKey, { expected_revision: expected }, async () => {
        if (job.revision !== expected) throw unavailable("AUDIO_REVISION_CONFLICT");
        if (!job.usage_known && !job.cancel_requested_at) {
          const before = job.state === "prepared";
          await tx.query(`UPDATE ai_audio_jobs SET cancel_requested_at=clock_timestamp(),state=$2,usage_known=$3,billable_units=$4,
            error_code=$5,finished_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,
          [id, before ? "cancelled" : "unknown", before, before ? 0 : null, before ? "CANCELLED_BEFORE_DISPATCH" : "AUDIO_CANCEL_AWAITING_CONFIRMATION"]);
          await tx.query("INSERT INTO ai_audio_job_events(job_id,kind) VALUES($1,$2)", [id, before ? "cancelled" : "unknown"]);
        }
        await audit(tx, actor, "audio.cancel.requested", id, "succeeded", { operation_id: job.operation_id }, tenant);
        return this.metadata(tx, (await tx.query("SELECT * FROM ai_audio_jobs WHERE id=$1", [id])).rows[0]);
      });
    }, tenant, true, actor.id);
  }
  async recover() {
    // No restart replays a potentially dispatched synthesis/transcription POST.
    await this.authorizations.recover();
    return this.db.tx(async tx => {
      const changed = await tx.query(`WITH changed AS (UPDATE ai_audio_jobs j SET state=CASE WHEN j.state='prepared' THEN 'cancelled' ELSE 'unknown' END,
        usage_known=(j.state='prepared'),billable_units=CASE WHEN j.state='prepared' THEN 0 ELSE NULL END,
        error_code='AUDIO_ORIGINATOR_NOT_ACTIVE',finished_at=clock_timestamp(),revision=j.revision+1
        WHERE j.state IN('prepared','dispatched') AND j.data_mode=$1 AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=j.task_id
          AND t.status='running' AND t.fencing_token=j.origin_fencing AND t.attempt=j.origin_attempt AND t.lease_until>clock_timestamp()
          AND NOT t.cancel_requested AND t.content_state='active') RETURNING j.id,j.state)
        INSERT INTO ai_audio_job_events(job_id,kind) SELECT id,state FROM changed RETURNING job_id`, [currentMode(this.db)]);
      return changed.rowCount ?? 0;
    }, undefined, true);
  }
}
