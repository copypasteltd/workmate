import { randomUUID } from "node:crypto";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, type Principal } from "./auth.js";
import { bindings, permit, lockAdminAccess } from "./admin-access.js";
import { activeRuntimeProfile } from "./runtime-profiles.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import { capabilityBody, capabilityDocument, codexBinaryHash } from "./capability-verification.js";
import { capabilityVideoPlan, capabilityVideoReference } from "./capability-video-plan.js";
import { callVideoGateway } from "./video-job-gateway.js";
import { parseVideoJobObservation } from "./video-job-protocol.js";
import { validateGeneratedVideo } from "./video-job-media.js";
import type { AIRequestAuthority, AIOperation } from "./internal-ai-gateway.js";
import { CodexRuntimeAdapter } from "./runtime.js";
import { canonical, hash, Problem } from "./lib.js";

type VideoOperation = Extract<AIOperation, `videos.${string}`>;
const denied = (code: string) => new Problem(409, code, "The frozen video verification cannot perform this operation");
const mode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";
const terminal = (state: string) => ["completed", "failed", "cancelled"].includes(state);

export async function prepareCapabilityVideoSuite(tx: Tx, db: Database, v: any, release: any, p: Principal) {
  if (!db.config.AI_BASE_URL || !db.config.AI_API_KEY) throw denied("AI_SETUP_REQUIRED");
  const document = capabilityDocument.parse(release.definition);
  if (document.profile_key !== "internal-video-v1") throw denied("VIDEO_VERIFICATION_PROFILE_INVALID");
  const plan = capabilityVideoPlan(), quote = BigInt(plan.seconds) * BigInt(document.rates[0]);
  const e = (await tx.query("SELECT * FROM ai_request_budget_envelopes WHERE validation_id=$1", [v.id])).rows[0];
  if (!e || quote > BigInt(e.amount_micros)) throw denied("VERIFICATION_BUDGET_EXHAUSTED");
  await tx.query(`INSERT INTO capability_video_suites(validation_id,auth_version,binary_sha256,plan,plan_hash,quoted_micros)
    VALUES($1,$2,$3,$4,$5,$6)`, [v.id, p.authVersion, await codexBinaryHash(db.config), JSON.stringify(plan.cases), plan.hash, quote.toString()]);
}

/** Live progress/cost is separate from the one-time immutable eligibility result. */
export async function capabilityVideoDTO(tx: Tx, id: string) {
  const suite = (await tx.query("SELECT s.*,v.lease_until AS deadline_at FROM capability_video_suites s JOIN capability_validations v ON v.id=s.validation_id WHERE validation_id=$1", [id])).rows[0];
  if (!suite) return null;
  const probes = (await tx.query("SELECT * FROM capability_video_probes WHERE validation_id=$1 ORDER BY ordinal", [id])).rows;
  return { plan_hash: suite.plan_hash, total_cases: 16, verified_cases: probes.filter(p => p.verified_at).length,
    quoted_micros: String(suite.quoted_micros), known_cost_micros: probes.reduce((n, p) => n + (p.usage_known ? BigInt(p.actual_micros) : 0n), 0n).toString(),
    usage_known: probes.every(p => p.usage_known), cancel_requested: !!suite.cancel_requested_at,
    deadline_at: new Date(suite.deadline_at).toISOString(), error_code: suite.error_code,
    cases: probes.map(p => ({ id: p.id, ordinal: p.ordinal, operation_id: p.operation_id, state: p.state, size: p.size,
      seconds: p.seconds, progress: p.progress, usage_known: p.usage_known, actual_micros: p.usage_known ? String(p.actual_micros) : null,
      verified: !!p.verified_at, error_code: p.error_code, operations: p.operations,
      media: p.decoded_media ?? null })) };
}

/** No customer task/wallet is fabricated for a platform-funded verification. */
export class CapabilityVideoVerification {
  constructor(private db: Database, private catalog: Catalog) {}

  private async locked(tx: Tx, id: string, lease: string) {
    // Same order as administrator cancellation/revocation: access -> validation
    // -> suite -> probe. A heartbeat only holds its single suite row briefly.
    await lockAdminAccess(tx);
    await tx.query("SELECT id FROM capability_validations WHERE id=$1 FOR UPDATE", [id]);
    const s = (await tx.query(`SELECT s.*,v.state AS validation_state,v.principal_id,v.session_id,v.execution_nonce,v.release_id,v.lease_until AS deadline_at,
      r.definition,r.definition_hash,r.runtime_profile_id,r.gateway_fingerprint,r.data_mode
      FROM capability_video_suites s JOIN capability_validations v ON v.id=s.validation_id JOIN capability_releases r ON r.id=v.release_id
      WHERE s.validation_id=$1 AND r.data_mode=$2 FOR UPDATE OF s`, [id, mode(this.db)])).rows[0];
    if (!s || s.lease_token !== lease || new Date(s.lease_until).getTime() <= Date.now()) throw denied("VIDEO_VERIFICATION_LEASE_LOST");
    return s;
  }

  private principal(s: any): Principal {
    return { id: s.principal_id, sessionId: s.session_id, authVersion: s.auth_version,
      audience: "admin", email: "", name: "", sessionHash: "" };
  }

  /** A once-authorized immutable two-hour job; this cannot authorize publication. */
  private async grant(tx: Tx, s: any) {
    if (s.validation_state !== "running" || s.cancel_requested_at || s.error_code || new Date(s.deadline_at).getTime() <= Date.now())
      throw denied("VIDEO_VERIFICATION_STOPPED");
    await lockAdminAccess(tx);
    const p = this.principal(s);
    if (!(await tx.query(`SELECT s.id FROM sessions s JOIN admin_principals a ON a.id=s.admin_id
      WHERE s.id=$1 AND s.admin_id=$2 AND s.audience='admin' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      AND a.status='active' AND a.enrollment_state='enrolled' AND a.auth_version=$3 AND s.auth_version=a.auth_version
      FOR SHARE OF s,a`, [s.session_id, s.principal_id, s.auth_version])).rowCount) throw denied("VIDEO_VERIFICATION_AUTHORITY_REVOKED");
    await permit(tx, p, "admin.catalog.publish");
    if ((await bindings(tx, p)).some(b => b.effect === "deny" && b.permissions.includes("admin.catalog.publish")))
      throw denied("VIDEO_VERIFICATION_AUTHORITY_REVOKED");
    const plan = capabilityVideoPlan();
    if (s.plan_hash !== plan.hash || canonical(s.plan) !== canonical(plan.cases)
      || s.gateway_fingerprint !== gatewayFingerprint(this.db.config)
      || s.runtime_profile_id !== (await activeRuntimeProfile(tx, this.catalog)).id
      || s.binary_sha256 !== await codexBinaryHash(this.db.config)) throw denied("CAPABILITY_CONTEXT_CHANGED");
  }

  private async event(tx: Tx, id: string, body: unknown) {
    await tx.query("INSERT INTO capability_validation_events(validation_id,body) VALUES($1,$2)", [id, body]);
  }

  private async prepare(id: string, lease: string) {
    return this.db.tx(async tx => {
      const s = await this.locked(tx, id, lease);
      await this.grant(tx, s);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ai-gateway:" + s.data_mode]);
      const rows = (await tx.query("SELECT * FROM capability_video_probes WHERE validation_id=$1 ORDER BY ordinal FOR UPDATE", [id])).rows;
      const unfinished = rows.find(p => !p.verified_at);
      if (unfinished) return unfinished;
      if (rows.length === 16) return null;
      const ordinal = rows.length, specification = s.plan[ordinal], rate = BigInt(s.definition.rates[0]), quote = BigInt(specification.seconds) * rate;
      const e = (await tx.query("SELECT * FROM ai_request_budget_envelopes WHERE validation_id=$1", [id])).rows[0];
      const b = (await tx.query(`SELECT b.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies b ON b.id=h.policy_id WHERE h.data_mode=$1`, [s.data_mode])).rows[0];
      const policy = (await tx.query("SELECT policy_version_id FROM ai_gateway_policy_heads WHERE data_mode=$1", [s.data_mode])).rows[0];
      const period = (await tx.query("SELECT ai_platform_budget_period($1,'verification') AS id", [s.data_mode])).rows[0].id;
      const bounds = (await tx.query(`SELECT ai_budget_used($1,NULL)::text AS used,ai_budget_used(NULL,$2)::text AS daily,
        ai_budget_subject_blocked($1) AS blocked,(SELECT amount_micros FROM ai_platform_budget_periods WHERE id=$2)::text AS daily_limit`, [e.id, period])).rows[0];
      if (bounds.blocked || BigInt(bounds.used) + quote * 1_000_000n > BigInt(e.amount_micros) * 1_000_000n
        || BigInt(bounds.used) + quote * 1_000_000n > BigInt(b.verification_run_micros) * 1_000_000n) throw denied("VERIFICATION_BUDGET_EXHAUSTED");
      if (BigInt(bounds.daily) + quote * 1_000_000n > (BigInt(bounds.daily_limit) < BigInt(b.verification_daily_micros) ? BigInt(bounds.daily_limit) : BigInt(b.verification_daily_micros)) * 1_000_000n)
        throw denied("PLATFORM_BUDGET_EXHAUSTED");
      const limit = (await tx.query("SELECT ai_gateway_limit_reason($1,NULL,$2,'video','validation') AS reason", [policy.policy_version_id, s.principal_id])).rows[0].reason;
      if (limit) throw denied("VIDEO_VERIFICATION_" + limit);
      const probe = (await tx.query(`INSERT INTO capability_video_probes(validation_id,ordinal,actor_id,data_mode,envelope_id,platform_period_id,policy_version_id,
        model_alias,gateway_fingerprint,specification,size,seconds,rate_micros,quoted_micros)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, ordinal, s.principal_id, s.data_mode, e.id, period, policy.policy_version_id, s.definition.model_alias, s.gateway_fingerprint,
        specification, specification.size, specification.seconds, rate.toString(), quote.toString()])).rows[0];
      await this.event(tx, id, { video_probe_id: probe.id, kind: "video.prepared", ordinal, operation_id: probe.operation_id, quoted_micros: quote.toString() });
      return probe;
    }, undefined, true);
  }

  private authority(id: string, lease: string, probe: any, operation: VideoOperation, signal: AbortSignal): AIRequestAuthority {
    const check = async (tx: Tx, dispatch = false) => {
      if (signal.aborted) throw denied("VIDEO_VERIFICATION_STOPPED");
      const s = await this.locked(tx, id, lease);
      const p = (await tx.query("SELECT * FROM capability_video_probes WHERE id=$1 FOR UPDATE", [probe.id])).rows[0];
      if (!p || p.validation_id !== id || p.gateway_fingerprint !== gatewayFingerprint(this.db.config)) throw denied("CAPABILITY_CONTEXT_CHANGED");
      if (operation === "videos.create") {
        await this.grant(tx, s);
        if (p.state !== "prepared" || p.dispatched_at) throw denied("VIDEO_ALREADY_DISPATCHED");
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ai-gateway:" + s.data_mode]);
        const b = (await tx.query(`SELECT b.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies b ON b.id=h.policy_id WHERE h.data_mode=$1`, [s.data_mode])).rows[0];
        const policy = (await tx.query("SELECT policy_version_id FROM ai_gateway_policy_heads WHERE data_mode=$1", [s.data_mode])).rows[0];
        const limits = (await tx.query(`SELECT ai_budget_used($1,NULL)::text AS used,ai_budget_used(NULL,$2)::text AS daily,
          (SELECT amount_micros FROM ai_platform_budget_periods WHERE id=$2)::text AS daily_limit,
          (SELECT amount_micros FROM ai_request_budget_envelopes WHERE id=$1)::text AS run_limit,
          ai_gateway_limit_reason($3,NULL,$4,'video','validation',$5) AS reason`, [p.envelope_id, p.platform_period_id, policy.policy_version_id, p.actor_id, p.id])).rows[0];
        if (limits.reason || BigInt(limits.used) > BigInt(limits.run_limit) * 1_000_000n || BigInt(limits.used) > BigInt(b.verification_run_micros) * 1_000_000n
          || BigInt(limits.daily) > BigInt(limits.daily_limit) * 1_000_000n || BigInt(limits.daily) > BigInt(b.verification_daily_micros) * 1_000_000n)
          throw denied("VIDEO_VERIFICATION_ADMISSION_CHANGED");
        if ((await tx.query("SELECT utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date AS today FROM ai_platform_budget_periods WHERE id=$1", [p.platform_period_id])).rows[0]?.today !== true)
          throw denied("VIDEO_VERIFICATION_BUDGET_DAY_CHANGED");
        if (dispatch) {
          await tx.query("UPDATE capability_video_probes SET state='submitting',dispatched_at=clock_timestamp() WHERE id=$1", [p.id]);
          await this.event(tx, id, { kind: "video.dispatched", video_probe_id: p.id, operation_id: p.operation_id });
        }
      } else if (operation === "videos.content") {
        await this.grant(tx, s);
        if (!p.usage_known || p.state !== "completed" || p.ordinal === 15 || BigInt(p.actual_micros) > BigInt(p.quoted_micros)) throw denied("VIDEO_VERIFICATION_CONTENT_UNAVAILABLE");
      } else {
        // Original-resource control continues after revocation solely to obtain
        // a final usage fact; it cannot start another operation or read content.
        if (!p.dispatched_at || operation !== "videos.lookup" && !p.provider_id) throw denied("VIDEO_NOT_DISPATCHED");
        if (operation === "videos.cancel" && (terminal(p.state) || p.ordinal !== 15 && !s.cancel_requested_at && !s.error_code && s.validation_state === "running"))
          throw denied("VIDEO_CANCEL_UNAVAILABLE");
      }
    };
    return { taskId: id, actorId: probe.actor_id, budgeted: true,
      authorize: async info => {
        if (info.taskId !== id || info.actorId !== probe.actor_id || info.tenantId || info.projectId || info.capabilityVersionId
          || info.model !== probe.model_alias || info.operation !== operation || operation === "videos.create" && info.requestId !== probe.operation_id)
          throw denied("VIDEO_REQUEST_SCOPE_INVALID");
        await this.db.tx(tx => check(tx), undefined, true);
        return { dispatch: () => this.db.tx(tx => check(tx, true), undefined, true), finish: async () => {} };
      } };
  }

  private async observe(id: string, lease: string, probeId: string, raw: unknown, operation: VideoOperation) {
    return this.db.tx(async tx => {
      await this.locked(tx, id, lease);
      const p = (await tx.query("SELECT * FROM capability_video_probes WHERE id=$1 FOR UPDATE", [probeId])).rows[0];
      const parsed = parseVideoJobObservation(raw, { operationId: p.operation_id, model: p.model_alias, size: p.size, seconds: p.seconds,
        ...(p.provider_id ? { videoId: p.provider_id } : {}) }), v = parsed.value;
      if (!p.dispatched_at) throw denied("VIDEO_NOT_DISPATCHED");
      const prior = (await tx.query("SELECT * FROM capability_video_observations WHERE probe_id=$1 AND (event_id=$2 OR sequence=$3)", [probeId, v.event_id, v.sequence])).rows;
      if (prior.length && (prior.length !== 1 || prior[0].event_id !== v.event_id || prior[0].body_hash !== parsed.hash)) throw denied("VIDEO_OBSERVATION_CONFLICT");
      if (!prior.length) await tx.query("INSERT INTO capability_video_observations(probe_id,event_id,sequence,body_hash,body) VALUES($1,$2,$3,$4,$5)", [probeId, v.event_id, v.sequence, parsed.hash, v]);
      if (p.provider_sequence !== null && v.sequence < Number(p.provider_sequence)) throw denied("VIDEO_OBSERVATION_STALE");
      if (terminal(p.state) && p.state !== v.status || p.usage_known && v.usage && BigInt(v.usage.billable_seconds) !== BigInt(p.billable_seconds)
        || p.content_sha256 && (p.content_sha256 !== v.content?.sha256 || p.content_bytes !== v.content?.bytes)
        || p.state === "in_progress" && v.status === "queued" || p.progress !== null && v.progress !== null && v.progress < p.progress)
        throw denied("VIDEO_OBSERVATION_CONFLICT");
      await tx.query(`UPDATE capability_video_probes SET state=$2,provider_id=$3,provider_sequence=$4,progress=$5,
        usage_known=usage_known OR $6,billable_seconds=coalesce(billable_seconds,$7),content_sha256=coalesce(content_sha256,$8),content_bytes=coalesce(content_bytes,$9),
        operations=ARRAY(SELECT DISTINCT unnest(operations||$10::text[])),observed_at=clock_timestamp(),error_code=$11,
        cancel_observed_at=CASE WHEN $12 THEN coalesce(cancel_observed_at,clock_timestamp()) ELSE cancel_observed_at END WHERE id=$1`,
      [p.id, v.status, v.id, v.sequence, v.progress ?? p.progress, !!v.usage, v.usage?.billable_seconds ?? null, v.content?.sha256 ?? null,
        v.content?.bytes ?? null, [operation, "videos.create"], v.error?.code ?? null,
        operation === "videos.retrieve" && !!p.cancel_sent_at && p.operations.includes("videos.cancel") && parsed.terminal]);
      if (v.usage && BigInt(v.usage.billable_seconds) * BigInt(p.rate_micros) > BigInt(p.quoted_micros)) {
        await tx.query("INSERT INTO capability_video_budget_violations(probe_id,envelope_id,code) VALUES($1,$2,'ALLOCATION_EXCEEDED') ON CONFLICT DO NOTHING", [p.id, p.envelope_id]);
        await tx.query("UPDATE capability_video_suites SET error_code='AI_REQUEST_BUDGET_VIOLATION' WHERE validation_id=$1", [id]);
      }
      await this.event(tx, id, { kind: "video.observed", video_probe_id: p.id, operation, sequence: v.sequence, state: v.status, usage_known: p.usage_known || !!v.usage });
      return (await tx.query("SELECT * FROM capability_video_probes WHERE id=$1", [p.id])).rows[0];
    }, undefined, true);
  }

  private async stop(id: string, lease: string, code: string, cancelled = false) {
    await this.db.tx(async tx => {
      await this.locked(tx, id, lease);
      await tx.query(`UPDATE capability_video_suites SET error_code=coalesce(error_code,$2),
        cancel_requested_at=CASE WHEN $3 THEN coalesce(cancel_requested_at,clock_timestamp()) ELSE cancel_requested_at END WHERE validation_id=$1`, [id, code, cancelled]);
    }, undefined, true);
  }

  private async finish(id: string, lease: string) {
    return this.db.tx(async tx => {
      const s = await this.locked(tx, id, lease);
      const v = (await tx.query("SELECT * FROM capability_validations WHERE id=$1 FOR UPDATE", [id])).rows[0];
      const dto = (await capabilityVideoDTO(tx, id))!;
      if (v.state !== "running") return;
      let error = s.error_code;
      if (!error && (s.cancel_requested_at || new Date(s.deadline_at).getTime() <= Date.now())) error = s.cancel_requested_at ? "VIDEO_VERIFICATION_CANCELLED" : "VIDEO_VERIFICATION_EXPIRED";
      if (!error && dto.verified_cases !== 16) return;
      if (!error) {
        try { await this.grant(tx, s); } catch (e: any) { error = e.code ?? "VIDEO_VERIFICATION_AUTHORITY_REVOKED"; }
      }
      const probes = (await tx.query("SELECT * FROM capability_video_probes WHERE validation_id=$1 ORDER BY ordinal", [id])).rows;
      const evidence: any = { definition_hash: s.definition_hash, gateway_fingerprint: s.gateway_fingerprint, data_mode: s.data_mode,
        codex_version: this.db.config.CODEX_VERSION, codex_binary_sha256: s.binary_sha256, model_alias: s.definition.model_alias,
        reasoning_effort: null, supported_operations: capabilityBody(this.db.config, capabilityDocument.parse(s.definition)).supported_operations,
        input_tokens: 0, output_tokens: 0, known_cost_micros: dto.known_cost_micros, accepted: probes.some(p => p.dispatched_at), usage_known: dto.usage_known,
        checks: error ? [] : ["pinned_codex", "video_specification_matrix", "video_png_jpeg_references", "video_operation_lookup", "video_resource_retrieval", "video_cancellation_observed", "video_fully_decoded_mp4", "known_usage"],
        ...(error ? { error_code: error } : {}) };
      let state = error ? !dto.usage_known ? "reconciling" : s.cancel_requested_at ? "cancelled" : "failed" : "passed", capId: string | null = null;
      if (state === "passed") {
        const body = capabilityBody(this.db.config, capabilityDocument.parse(s.definition)), fingerprint = hash(canonical(body));
        await tx.query("INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,'internal-video-v1',$2,$3,true) ON CONFLICT DO NOTHING", [fingerprint, s.data_mode, body]);
        const cap = (await tx.query("SELECT * FROM internal_capability_versions WHERE fingerprint=$1", [fingerprint])).rows[0];
        if (cap.revoked) { state = "failed"; evidence.error_code = "CAPABILITY_VERSION_REVOKED"; } else capId = cap.id;
      }
      await this.event(tx, id, { state, result: evidence, kind: "video.verification_finalized", plan_hash: s.plan_hash });
      await tx.query(`UPDATE capability_validations SET state=$2,result=$3,capability_version_id=$4,finished_at=clock_timestamp(),
        expires_at=CASE WHEN $2='passed' THEN clock_timestamp()+interval '24 hours' ELSE NULL END WHERE id=$1`, [id, state, evidence, capId]);
      await audit(tx, this.principal(s), "admin.catalog.publish", s.release_id, "verification_" + state,
        { validation_id: id, known_cost_micros: dto.known_cost_micros, error_code: evidence.error_code ?? null });
    }, undefined, true);
  }

  /** One fenced, bounded step. Browser/request lifetime does not own the suite. */
  async advance(signal: AbortSignal = new AbortController().signal, validationId?: string) {
    if (signal.aborted) return null;
    const lease = randomUUID();
    const id = await this.db.tx(async tx => {
      const s = (await tx.query(`SELECT s.validation_id FROM capability_video_suites s JOIN capability_validations v ON v.id=s.validation_id
        JOIN capability_releases r ON r.id=v.release_id WHERE r.data_mode=$1 AND ($2::uuid IS NULL OR s.validation_id=$2)
        AND (v.state='running' OR EXISTS(SELECT 1 FROM capability_video_probes p WHERE p.validation_id=v.id AND p.dispatched_at IS NOT NULL AND NOT p.usage_known))
        AND s.next_poll_at<=clock_timestamp() AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp())
        ORDER BY s.next_poll_at,s.validation_id FOR UPDATE OF s SKIP LOCKED LIMIT 1`, [mode(this.db), validationId ?? null])).rows[0];
      if (!s) return null;
      await tx.query("UPDATE capability_video_suites SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds' WHERE validation_id=$1", [s.validation_id, lease]);
      return s.validation_id as string;
    }, undefined, true);
    if (!id) return null;
    const stop = new AbortController(), combined = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(150000)]);
    let heartbeatRun: Promise<unknown> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeatRun || combined.aborted) return;
      heartbeatRun = this.db.control.query(`UPDATE capability_video_suites SET lease_until=clock_timestamp()+interval '45 seconds'
        WHERE validation_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`, [id, lease])
        .then(r => { if (!r.rowCount) stop.abort(); }).catch(() => stop.abort()).finally(() => { heartbeatRun = undefined; });
    }, 5000);
    heartbeat.unref();
    let probe: any;
    try {
      let allowed = true;
      try {
        await this.db.tx(async tx => { const s = await this.locked(tx, id, lease); await this.grant(tx, s); }, undefined, true);
        await new CodexRuntimeAdapter(this.db.config).version();
      } catch (e: any) { allowed = false; await this.stop(id, lease, e.code ?? "CAPABILITY_CONTEXT_CHANGED", true); }
      probe = (await this.db.control.query("SELECT * FROM capability_video_probes WHERE validation_id=$1 AND verified_at IS NULL ORDER BY ordinal LIMIT 1", [id])).rows[0];
      if (!probe && allowed) probe = await this.prepare(id, lease);
      const invoke = async (operation: VideoOperation) => {
        const result = await callVideoGateway(this.db.config, probe, operation, this.authority(id, lease, probe, operation, combined), combined,
          operation === "videos.create" ? capabilityVideoReference(probe.specification) : undefined);
        if (!("value" in result)) throw denied("VIDEO_PROTOCOL_INVALID");
        probe = await this.observe(id, lease, probe.id, result.value, operation);
      };
      if (probe) {
        if (probe.state === "prepared") {
          if (!allowed) await this.db.control.query("UPDATE capability_video_probes SET state='cancelled',usage_known=true,billable_seconds=0,error_code='VIDEO_CANCELLED_BEFORE_DISPATCH' WHERE id=$1", [probe.id]);
          else await invoke("videos.create");
        }
        if (probe.dispatched_at) {
          if (!probe.operations.includes("videos.lookup")) await invoke("videos.lookup");
          if (!probe.operations.includes("videos.retrieve") || !probe.usage_known || probe.cancel_sent_at && !probe.cancel_observed_at)
            await invoke("videos.retrieve");
          if ((probe.ordinal === 15 || !allowed) && !terminal(probe.state)
            && (!probe.cancel_sent_at || Date.now() - new Date(probe.cancel_sent_at).getTime() >= 5000)) {
            await this.db.tx(async tx => { await this.locked(tx, id, lease);
              await tx.query("UPDATE capability_video_probes SET cancel_sent_at=clock_timestamp() WHERE id=$1", [probe.id]); }, undefined, true);
            await invoke("videos.cancel");
            // Cancellation acknowledgement alone is not the terminal proof.
            await invoke("videos.retrieve");
          }
          if (probe.usage_known) {
            if (BigInt(probe.actual_micros) > BigInt(probe.quoted_micros)) await this.stop(id, lease, "AI_REQUEST_BUDGET_VIOLATION");
            else if (allowed && probe.ordinal === 15 && probe.state === "cancelled" && probe.cancel_observed_at && probe.operations.includes("videos.cancel")) {
              await this.db.tx(async tx => { const s = await this.locked(tx, id, lease); await this.grant(tx, s);
                await tx.query("UPDATE capability_video_probes SET verified_at=clock_timestamp() WHERE id=$1", [probe.id]); }, undefined, true);
            } else if (allowed && probe.ordinal < 15 && probe.state === "completed") {
              const content = await callVideoGateway(this.db.config, probe, "videos.content", this.authority(id, lease, probe, "videos.content", combined), combined);
              if (!("bytes" in content)) throw denied("VIDEO_CONTENT_TYPE_INVALID");
              const media = await validateGeneratedVideo(this.db.config, content.bytes, probe, { sha256: probe.content_sha256, bytes: probe.content_bytes }, combined);
              await this.db.tx(async tx => { const s = await this.locked(tx, id, lease); await this.grant(tx, s);
                await tx.query(`UPDATE capability_video_probes SET verified_at=clock_timestamp(),decoded_media=$2,
                  operations=ARRAY(SELECT DISTINCT unnest(operations||ARRAY['videos.content'])) WHERE id=$1`, [probe.id, media]); }, undefined, true);
            } else if (allowed && terminal(probe.state)) await this.stop(id, lease, probe.ordinal === 15 ? "VIDEO_CANCELLATION_NOT_OBSERVED" : "VIDEO_GENERATION_NOT_COMPLETED");
          }
        }
      }
    } catch (e: any) {
      if (e.code !== "VIDEO_VERIFICATION_LEASE_LOST") {
        const code = typeof e.code === "string" && /^[A-Z0-9_]{1,100}$/.test(e.code) ? e.code : "VIDEO_VERIFICATION_OPERATION_UNCERTAIN";
        await this.db.tx(async tx => {
          await this.locked(tx, id, lease);
          if (probe) {
            const p = (await tx.query("SELECT * FROM capability_video_probes WHERE id=$1 FOR UPDATE", [probe.id])).rows[0];
            await tx.query(`UPDATE capability_video_probes SET state=CASE WHEN state='prepared' THEN 'cancelled' WHEN state IN('submitting','queued','in_progress','unknown') THEN 'unknown' ELSE state END,
              usage_known=usage_known OR dispatched_at IS NULL,billable_seconds=CASE WHEN dispatched_at IS NULL THEN 0 ELSE billable_seconds END,error_code=$2 WHERE id=$1`, [probe.id, code]);
            if (!p.dispatched_at || code.startsWith("GENERATED_VIDEO_") || ["VIDEO_PROTOCOL_INVALID", "VIDEO_OBSERVATION_CONFLICT", "VIDEO_CONTENT_TYPE_INVALID"].includes(code))
              await tx.query("UPDATE capability_video_suites SET error_code=coalesce(error_code,$2) WHERE validation_id=$1", [id, code]);
          } else if (!/_(CAPACITY|RATE)$/.test(code)) await tx.query("UPDATE capability_video_suites SET error_code=coalesce(error_code,$2) WHERE validation_id=$1", [id, code]);
          await this.event(tx, id, { kind: "video.operation_error", video_probe_id: probe?.id ?? null, code });
        }, undefined, true).catch(() => {});
      }
    } finally {
      clearInterval(heartbeat); await heartbeatRun;
      try { await this.finish(id, lease).catch(e => { if (e.code !== "VIDEO_VERIFICATION_LEASE_LOST") throw e; }); }
      finally { await this.db.control.query(`UPDATE capability_video_suites SET lease_token=NULL,lease_until=NULL,
        next_poll_at=clock_timestamp()+($3::integer*interval '1 millisecond') WHERE validation_id=$1 AND lease_token=$2`, [id, lease, this.db.config.AI_VIDEO_POLL_INTERVAL_MS]); }
    }
    return id;
  }
}
