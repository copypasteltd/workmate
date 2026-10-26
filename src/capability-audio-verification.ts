import { randomUUID } from "node:crypto";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, type Principal } from "./auth.js";
import { bindings, permit, lockAdminAccess } from "./admin-access.js";
import { activeRuntimeProfile } from "./runtime-profiles.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import { capabilityBody, capabilityDocument, codexBinaryHash } from "./capability-verification.js";
import { capabilityAudioPlan, capabilityAudioReference, type AudioProbeSpecification } from "./capability-audio-plan.js";
import { validateProductionAudio } from "./audio-production-media.js";
import { parseAudioTranscription } from "./audio-production-model.js";
import { internalAIRequest, type AIRequestAuthority } from "./internal-ai-gateway.js";
import { CodexRuntimeAdapter } from "./runtime.js";
import { canonical, hash, Problem } from "./lib.js";

const denied = (code: string) => new Problem(409, code, "The frozen audio verification cannot perform this operation");
const mode = (db: Database) => db.config.DEMO_MODE ? "simulated" : "configured_services";

export async function prepareCapabilityAudioSuite(tx: Tx, db: Database, v: any, release: any, p: Principal) {
  if (!db.config.AI_BASE_URL || !db.config.AI_API_KEY) throw denied("AI_SETUP_REQUIRED");
  const plan = capabilityAudioPlan(capabilityDocument.parse(release.definition));
  const envelope = (await tx.query("SELECT * FROM ai_request_budget_envelopes WHERE validation_id=$1", [v.id])).rows[0];
  if (!envelope || BigInt(plan.quoted_micros) > BigInt(envelope.amount_micros)) throw denied("VERIFICATION_BUDGET_EXHAUSTED");
  await tx.query(`INSERT INTO capability_audio_suites(validation_id,auth_version,binary_sha256,plan,plan_hash,quoted_micros)
    VALUES($1,$2,$3,$4,$5,$6)`, [v.id, p.authVersion, await codexBinaryHash(db.config), JSON.stringify(plan.cases), plan.hash, plan.quoted_micros]);
}

export async function capabilityAudioDTO(tx: Tx, id: string) {
  const suite = (await tx.query(`SELECT s.*,v.lease_until AS deadline_at FROM capability_audio_suites s
    JOIN capability_validations v ON v.id=s.validation_id WHERE validation_id=$1`, [id])).rows[0];
  if (!suite) return null;
  const probes = (await tx.query("SELECT * FROM capability_audio_probes WHERE validation_id=$1 ORDER BY ordinal", [id])).rows;
  return {
    plan_hash: suite.plan_hash, total_cases: suite.plan.length, verified_cases: probes.filter(p => p.verified_at).length,
    quoted_micros: String(suite.quoted_micros), quality_scope: "protocol_only",
    known_cost_micros: probes.reduce((n, p) => n + (p.usage_known ? BigInt(p.actual_micros) : 0n), 0n).toString(),
    usage_known: probes.every(p => p.usage_known), cancel_requested: !!suite.cancel_requested_at,
    deadline_at: new Date(suite.deadline_at).toISOString(), error_code: suite.error_code ?? null,
    cases: probes.map(p => ({ id: p.id, ordinal: p.ordinal, operation_id: p.operation_id, state: p.state,
      kind: p.specification.kind, locale: p.specification.locale, voice: p.specification.voice ?? null,
      speed: p.specification.speed ?? null, mime_type: p.specification.mime_type ?? null, timestamps: p.specification.timestamps ?? null,
      quoted_micros: String(p.quoted_micros), actual_micros: p.actual_micros === null ? null : String(p.actual_micros),
      usage_known: p.usage_known, verified: !!p.verified_at, error_code: p.error_code ?? null,
      response_sha256: p.response_sha256 ?? null, source_sha256: p.source_sha256 ?? null, media: p.media ?? null })),
  };
}

/** Platform funding never creates a fake customer task, tenant or wallet.
 * The original synchronous audio POST has no invented lookup/replay protocol. */
export class CapabilityAudioVerification {
  constructor(private db: Database, private catalog: Catalog) {}

  private async locked(tx: Tx, id: string, lease: string) {
    await lockAdminAccess(tx);
    await tx.query("SELECT id FROM capability_validations WHERE id=$1 FOR UPDATE", [id]);
    const s = (await tx.query(`SELECT s.*,v.state AS validation_state,v.principal_id,v.session_id,v.release_id,
      v.lease_until AS deadline_at,r.definition,r.definition_hash,r.runtime_profile_id,r.gateway_fingerprint,r.data_mode,
      s.lease_until>clock_timestamp() AS lease_current,v.lease_until>clock_timestamp() AS grant_current
      FROM capability_audio_suites s JOIN capability_validations v ON v.id=s.validation_id
      JOIN capability_releases r ON r.id=v.release_id WHERE s.validation_id=$1 AND r.data_mode=$2 FOR UPDATE OF s`, [id, mode(this.db)])).rows[0];
    if (!s || s.lease_token !== lease || !s.lease_current) throw denied("AUDIO_VERIFICATION_LEASE_LOST");
    return s;
  }

  private principal(s: any): Principal {
    return { id: s.principal_id, sessionId: s.session_id, authVersion: s.auth_version,
      audience: "admin", email: "", name: "", sessionHash: "" };
  }

  private async grant(tx: Tx, s: any) {
    if (s.validation_state !== "running" || s.cancel_requested_at || s.error_code || !s.grant_current)
      throw denied("AUDIO_VERIFICATION_STOPPED");
    const p = this.principal(s);
    if (!(await tx.query(`SELECT s.id FROM sessions s JOIN admin_principals a ON a.id=s.admin_id
      WHERE s.id=$1 AND s.admin_id=$2 AND s.audience='admin' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      AND a.status='active' AND a.enrollment_state='enrolled' AND a.auth_version=$3 AND s.auth_version=a.auth_version
      FOR SHARE OF s,a`, [s.session_id, s.principal_id, s.auth_version])).rowCount) throw denied("AUDIO_VERIFICATION_AUTHORITY_REVOKED");
    await permit(tx, p, "admin.catalog.publish");
    if ((await bindings(tx, p)).some(b => b.effect === "deny" && b.permissions.includes("admin.catalog.publish")))
      throw denied("AUDIO_VERIFICATION_AUTHORITY_REVOKED");
    const plan = capabilityAudioPlan(capabilityDocument.parse(s.definition));
    if (s.plan_hash !== plan.hash || canonical(s.plan) !== canonical(plan.cases)
      || String(s.quoted_micros) !== plan.quoted_micros || s.gateway_fingerprint !== gatewayFingerprint(this.db.config)
      || s.runtime_profile_id !== (await activeRuntimeProfile(tx, this.catalog)).id
      || s.binary_sha256 !== await codexBinaryHash(this.db.config)) throw denied("CAPABILITY_CONTEXT_CHANGED");
    const time = (await tx.query("SELECT $1::timestamptz>clock_timestamp() AS grant_current,$2::timestamptz>clock_timestamp() AS lease_current", [s.deadline_at, s.lease_until])).rows[0];
    if (!time.lease_current) throw denied("AUDIO_VERIFICATION_LEASE_LOST");
    if (!time.grant_current) throw denied("AUDIO_VERIFICATION_STOPPED");
  }

  private async event(tx: Tx, id: string, body: unknown) {
    await tx.query("INSERT INTO capability_validation_events(validation_id,body) VALUES($1,$2)", [id, body]);
  }

  private async bounds(tx: Tx, s: any, envelopeId: string, periodId: string, additional: bigint, exclude?: string) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ai-gateway:" + s.data_mode]);
    const budget = (await tx.query(`SELECT b.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies b
      ON b.id=h.policy_id WHERE h.data_mode=$1`, [s.data_mode])).rows[0];
    const policy = (await tx.query("SELECT policy_version_id FROM ai_gateway_policy_heads WHERE data_mode=$1", [s.data_mode])).rows[0];
    const limits = (await tx.query(`SELECT ai_budget_used($1,NULL)::text AS used,ai_budget_used(NULL,$2)::text AS daily,
      ai_budget_subject_blocked($1) AS blocked,
      (SELECT amount_micros FROM ai_platform_budget_periods WHERE id=$2)::text AS daily_limit,
      (SELECT utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date FROM ai_platform_budget_periods WHERE id=$2) AS today,
      (SELECT amount_micros FROM ai_request_budget_envelopes WHERE id=$1)::text AS run_limit,
      ai_gateway_limit_reason($3,NULL,$4,'audio','validation',$5) AS reason`, [envelopeId, periodId, policy.policy_version_id, s.principal_id, exclude ?? null])).rows[0];
    if (!limits.today) throw denied("AUDIO_VERIFICATION_BUDGET_DAY_CHANGED");
    if (limits.blocked || BigInt(limits.used) + additional > BigInt(limits.run_limit) * 1_000_000n
      || BigInt(limits.used) + additional > BigInt(budget.verification_run_micros) * 1_000_000n)
      throw denied("VERIFICATION_BUDGET_EXHAUSTED");
    if (BigInt(limits.daily) + additional > BigInt(limits.daily_limit) * 1_000_000n
      || BigInt(limits.daily) + additional > BigInt(budget.verification_daily_micros) * 1_000_000n)
      throw denied("PLATFORM_BUDGET_EXHAUSTED");
    if (limits.reason) throw denied("AUDIO_VERIFICATION_" + limits.reason);
    return policy.policy_version_id;
  }

  private async prepare(id: string, lease: string) {
    return this.db.tx(async tx => {
      const s = await this.locked(tx, id, lease); await this.grant(tx, s);
      const rows = (await tx.query("SELECT * FROM capability_audio_probes WHERE validation_id=$1 ORDER BY ordinal FOR UPDATE", [id])).rows;
      const unfinished = rows.find(p => !p.verified_at);
      if (unfinished) return unfinished;
      if (rows.length === s.plan.length) return null;
      const ordinal = rows.length, plan = capabilityAudioPlan(capabilityDocument.parse(s.definition));
      const quote = BigInt(plan.units[ordinal]) * BigInt(s.definition.rates[0]);
      const envelope = (await tx.query("SELECT * FROM ai_request_budget_envelopes WHERE validation_id=$1", [id])).rows[0];
      const period = (await tx.query("SELECT ai_platform_budget_period($1,'verification') AS id", [s.data_mode])).rows[0].id;
      const policy = await this.bounds(tx, s, envelope.id, period, quote * 1_000_000n);
      const probe = (await tx.query(`INSERT INTO capability_audio_probes(validation_id,ordinal,actor_id,data_mode,envelope_id,
        platform_period_id,policy_version_id,model_alias,gateway_fingerprint,specification,quoted_units,rate_micros,quoted_micros)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, ordinal, s.principal_id, s.data_mode, envelope.id, period, policy, s.definition.model_alias, s.gateway_fingerprint,
        s.plan[ordinal], plan.units[ordinal], s.definition.rates[0], quote.toString()])).rows[0];
      await this.event(tx, id, { kind: "audio.prepared", audio_probe_id: probe.id, ordinal, operation_id: probe.operation_id, quoted_micros: quote.toString() });
      return probe;
    }, undefined, true);
  }

  private authority(id: string, lease: string, probe: any, source: string | null, signal: AbortSignal): AIRequestAuthority {
    return { taskId: id, actorId: probe.actor_id, budgeted: true, authorize: async info => {
      if (info.taskId !== id || info.actorId !== probe.actor_id || info.tenantId || info.projectId || info.capabilityVersionId
        || info.requestId !== probe.operation_id || info.model !== probe.model_alias
        || info.operation !== (probe.specification.kind === "speech" ? "audio.speech" : "audio.transcriptions"))
        throw denied("AUDIO_VERIFICATION_REQUEST_SCOPE_INVALID");
      const check = async (tx: Tx, dispatch: boolean) => {
        if (signal.aborted) throw denied("AUDIO_VERIFICATION_STOPPED");
        const s = await this.locked(tx, id, lease); await this.grant(tx, s);
        const p = (await tx.query("SELECT * FROM capability_audio_probes WHERE id=$1 FOR UPDATE", [probe.id])).rows[0];
        if (!p || p.state !== "prepared" || p.dispatched_at || p.gateway_fingerprint !== gatewayFingerprint(this.db.config))
          throw denied("AUDIO_VERIFICATION_ALREADY_DISPATCHED");
        await this.bounds(tx, s, p.envelope_id, p.platform_period_id, 0n, p.id);
        if (dispatch) {
          await tx.query(`UPDATE capability_audio_probes SET state='dispatched',dispatched_at=clock_timestamp(),
            request_hash=$2,source_sha256=$3 WHERE id=$1`, [p.id, info.requestHash, source]);
          await this.event(tx, id, { kind: "audio.dispatched", audio_probe_id: p.id, operation_id: p.operation_id, request_hash: info.requestHash });
        }
      };
      await this.db.tx(tx => check(tx, false), undefined, true);
      // Only this fenced suite may record a validated completion. Transport
      // errors are handled by advance; the persisted dispatch survives crashes.
      return { requestId: info.requestId, dispatch: () => this.db.tx(tx => check(tx, true), undefined, true), finish: async () => {} };
    } };
  }

  private async bytes(response: Response, max: number) {
    if (!response.ok || !response.body) throw denied("AUDIO_VERIFICATION_HTTP_ERROR");
    const reader = response.body.getReader(), chunks: Buffer[] = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > max) throw denied("AUDIO_VERIFICATION_RESPONSE_TOO_LARGE");
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks);
  }

  private async execute(id: string, lease: string, probe: any, signal: AbortSignal) {
    const spec = probe.specification as AudioProbeSpecification;
    let body: Record<string, unknown> | FormData, units: number, source: string | null = null, input: any;
    const document = (await this.db.control.query(`SELECT r.definition FROM capability_validations v
      JOIN capability_releases r ON r.id=v.release_id WHERE v.id=$1`, [id])).rows[0].definition;
    const capability = capabilityBody(this.db.config, capabilityDocument.parse(document));
    if (spec.kind === "speech") {
      units = [...spec.text].length;
      body = { model: probe.model_alias, input: spec.text, voice: spec.voice, speed: spec.speed, response_format: "wav" };
    } else {
      const reference = await capabilityAudioReference(spec.mime_type);
      input = await validateProductionAudio(this.db.config, reference.bytes, spec.mime_type, signal);
      units = input.duration_ms; source = reference.sha256;
      if (units > Number(probe.quoted_units)) throw denied("AUDIO_VERIFICATION_REFERENCE_TOO_LONG");
      body = new FormData(); body.set("model", probe.model_alias);
      body.set("file", new Blob([new Uint8Array(reference.bytes)], { type: spec.mime_type }), reference.filename);
      body.set("language", spec.locale === "en" ? "en" : spec.locale === "yue-HK" ? "yue" : "zh");
      body.set("response_format", spec.timestamps ? "verbose_json" : "json");
      if (spec.timestamps) body.set("timestamp_granularities[]", "segment");
    }
    const response = await internalAIRequest(this.db.config, { operation: spec.kind === "speech" ? "audio.speech" : "audio.transcriptions",
      model: probe.model_alias, body, operationId: probe.operation_id, audioLimits: capability.limits, signal,
      authority: this.authority(id, lease, probe, source, signal) });
    const raw = await this.bytes(response, spec.kind === "speech" ? 25_000_000 : 2_000_000);
    let media: any;
    if (spec.kind === "speech") {
      if (!/^(?:audio\/(?:wav|x-wav|wave)|application\/octet-stream)(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
        throw denied("AUDIO_VERIFICATION_CONTENT_TYPE_INVALID");
      media = await validateProductionAudio(this.db.config, raw, "audio/wav", signal);
    } else {
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw denied("AUDIO_VERIFICATION_CONTENT_TYPE_INVALID");
      const parsed = parseAudioTranscription(raw, input.duration_ms, spec.timestamps);
      media = { input, utf8_json: true, text_sha256: hash(parsed.text), text_characters: [...parsed.text].length,
        segment_count: parsed.cues.length, timing_source: parsed.timing_source, quality_scope: "protocol_only" };
    }
    await this.db.tx(async tx => {
      await this.locked(tx, id, lease);
      const current = (await tx.query("SELECT * FROM capability_audio_probes WHERE id=$1 FOR UPDATE", [probe.id])).rows[0];
      if (current.state !== "dispatched") throw denied("AUDIO_VERIFICATION_RESULT_CONFLICT");
      await tx.query(`UPDATE capability_audio_probes SET state='completed',usage_known=true,billable_units=$2,
        response_sha256=$3,response_bytes=$4,media=$5,finished_at=clock_timestamp(),verified_at=clock_timestamp() WHERE id=$1`,
      [probe.id, units, hash(raw), raw.length, media]);
      await this.event(tx, id, { kind: "audio.completed", audio_probe_id: probe.id, response_sha256: hash(raw),
        billable_units: units, pricing_basis: "validated_complete_company_response", quality_scope: "protocol_only" });
    }, undefined, true);
  }

  private async finish(id: string, lease: string) {
    await this.db.tx(async tx => {
      const s = await this.locked(tx, id, lease);
      if (s.validation_state !== "running") return;
      const dto = (await capabilityAudioDTO(tx, id))!;
      let error = s.error_code;
      if (!error && (s.cancel_requested_at || !s.grant_current)) error = s.cancel_requested_at ? "AUDIO_VERIFICATION_CANCELLED" : "AUDIO_VERIFICATION_EXPIRED";
      if (!error && dto.verified_cases !== dto.total_cases) return;
      if (!error) { try { await this.grant(tx, s); } catch (e: any) { error = e.code ?? "AUDIO_VERIFICATION_AUTHORITY_REVOKED"; } }
      const probes = (await tx.query("SELECT * FROM capability_audio_probes WHERE validation_id=$1 ORDER BY ordinal", [id])).rows;
      const body = capabilityBody(this.db.config, capabilityDocument.parse(s.definition));
      const evidence: any = { definition_hash: s.definition_hash, gateway_fingerprint: s.gateway_fingerprint, data_mode: s.data_mode,
        codex_version: this.db.config.CODEX_VERSION, codex_binary_sha256: s.binary_sha256, model_alias: s.definition.model_alias,
        reasoning_effort: null, supported_operations: body.supported_operations, input_tokens: 0, output_tokens: 0,
        known_cost_micros: dto.known_cost_micros, accepted: probes.some(p => p.dispatched_at), usage_known: dto.usage_known,
        quality_scope: "protocol_only", checks: error ? [] : ["pinned_codex", "frozen_audio_matrix", "fully_decoded_audio",
          "bounded_company_response", "known_usage"], ...(error ? { error_code: error } : {}) };
      let state = error ? !dto.usage_known ? "reconciling" : s.cancel_requested_at ? "cancelled" : "failed" : "passed", capId: string | null = null;
      if (state === "passed") {
        const fingerprint = hash(canonical(body));
        await tx.query("INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,true) ON CONFLICT DO NOTHING",
          [fingerprint, s.definition.profile_key, s.data_mode, body]);
        const cap = (await tx.query("SELECT * FROM internal_capability_versions WHERE fingerprint=$1", [fingerprint])).rows[0];
        if (cap.revoked) { state = "failed"; evidence.error_code = "CAPABILITY_VERSION_REVOKED"; } else capId = cap.id;
      }
      await this.event(tx, id, { kind: "audio.verification_finalized", state, result: evidence, plan_hash: s.plan_hash });
      await tx.query(`UPDATE capability_validations SET state=$2,result=$3,capability_version_id=$4,finished_at=clock_timestamp(),
        expires_at=CASE WHEN $2='passed' THEN clock_timestamp()+interval '24 hours' ELSE NULL END WHERE id=$1`, [id, state, evidence, capId]);
      await audit(tx, this.principal(s), "admin.catalog.publish", s.release_id, "verification_" + state,
        { validation_id: id, known_cost_micros: dto.known_cost_micros, error_code: evidence.error_code ?? null });
    }, undefined, true);
  }

  async advance(signal: AbortSignal = new AbortController().signal, validationId?: string) {
    if (signal.aborted) return null;
    const lease = randomUUID();
    const id = await this.db.tx(async tx => {
      const s = (await tx.query(`SELECT s.validation_id FROM capability_audio_suites s JOIN capability_validations v ON v.id=s.validation_id
        JOIN capability_releases r ON r.id=v.release_id WHERE r.data_mode=$1 AND v.state='running'
        AND ($2::uuid IS NULL OR s.validation_id=$2) AND s.next_poll_at<=clock_timestamp()
        AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp()) ORDER BY s.next_poll_at,s.validation_id
        FOR UPDATE OF s SKIP LOCKED LIMIT 1`, [mode(this.db), validationId ?? null])).rows[0];
      if (!s) return null;
      await tx.query("UPDATE capability_audio_suites SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds' WHERE validation_id=$1", [s.validation_id, lease]);
      return s.validation_id as string;
    }, undefined, true);
    if (!id) return null;
    const stop = new AbortController(), combined = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(180000)]);
    let heartbeatRun: Promise<unknown> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeatRun || combined.aborted) return;
      heartbeatRun = this.db.control.query(`UPDATE capability_audio_suites SET lease_until=clock_timestamp()+interval '45 seconds'
        WHERE validation_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING cancel_requested_at`, [id, lease])
        .then(r => { if (!r.rowCount || r.rows[0].cancel_requested_at) stop.abort(); }).catch(() => stop.abort()).finally(() => { heartbeatRun = undefined; });
    }, 5000); heartbeat.unref();
    let probe: any;
    try {
      await this.db.tx(async tx => { const s = await this.locked(tx, id, lease); await this.grant(tx, s); }, undefined, true);
      await new CodexRuntimeAdapter(this.db.config).version();
      probe = await this.prepare(id, lease);
      if (probe) {
        if (probe.state !== "prepared") throw denied("AUDIO_VERIFICATION_ORIGINAL_POST_UNCERTAIN");
        await this.execute(id, lease, probe, combined);
      }
    } catch (e: any) {
      if (e.code !== "AUDIO_VERIFICATION_LEASE_LOST") {
        const code = typeof e.code === "string" && /^[A-Z0-9_]{1,100}$/.test(e.code) ? e.code : "AUDIO_VERIFICATION_OPERATION_UNCERTAIN";
        await this.db.tx(async tx => {
          await this.locked(tx, id, lease);
          const current = (await tx.query("SELECT * FROM capability_audio_probes WHERE validation_id=$1 AND NOT usage_known ORDER BY ordinal LIMIT 1 FOR UPDATE", [id])).rows[0];
          if (current?.state === "prepared" && signal.aborted) {
            await this.event(tx, id, { kind: "audio.processor_paused", audio_probe_id: current.id, dispatched: false }); return;
          }
          if (current && current.state !== "unknown") await tx.query(`UPDATE capability_audio_probes SET
            state=CASE WHEN dispatched_at IS NULL THEN 'cancelled' ELSE 'unknown' END,
            usage_known=dispatched_at IS NULL,billable_units=CASE WHEN dispatched_at IS NULL THEN 0 ELSE NULL END,
            finished_at=CASE WHEN dispatched_at IS NULL THEN clock_timestamp() ELSE NULL END,error_code=$2 WHERE id=$1`, [current.id, code]);
          if (!current && /_(CAPACITY|RATE)$/.test(code)) return;
          await tx.query("UPDATE capability_audio_suites SET error_code=coalesce(error_code,$2) WHERE validation_id=$1", [id, code]);
          await this.event(tx, id, { kind: "audio.operation_error", audio_probe_id: current?.id ?? null, code });
        }, undefined, true);
      }
    } finally {
      clearInterval(heartbeat); await heartbeatRun;
      try { await this.finish(id, lease).catch(e => { if (e.code !== "AUDIO_VERIFICATION_LEASE_LOST") throw e; }); }
      finally { await this.db.control.query(`UPDATE capability_audio_suites SET lease_token=NULL,lease_until=NULL,
        next_poll_at=clock_timestamp()+interval '1 second' WHERE validation_id=$1 AND lease_token=$2`, [id, lease]); }
    }
    return id;
  }
}
