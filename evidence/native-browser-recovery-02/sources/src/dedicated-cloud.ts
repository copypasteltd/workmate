import { randomBytes } from "node:crypto";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { projectAccess, replay, tenantAccess } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { billingAccount } from "./billing.js";
import { Problem, hash } from "./lib.js";
import { assertLiveEnvironment } from "./recovery-fence.js";
import {
  dedicatedQuoteInput, dedicatedConfirmation, dedicatedControlInput,
  dedicatedNodePoll, dedicatedNodeAcknowledgement, dedicatedPlanInput,
  dedicatedNodeRegistration, dedicatedFrameInput, dedicatedMaximumCost,
  dedicatedSpecificationHash, dedicatedUsageCost,
} from "./dedicated-cloud-model.js";
import { reserveDedicatedComputer, settleDedicatedComputer } from "./dedicated-cloud-billing.js";

const missing = () => new Problem(404, "NOT_FOUND", "Private computer session not found");
const conflict = (code = "CLOUD_RUNTIME_UNAVAILABLE") => new Problem(409, code, "Review the current computer, authorization and resource ceiling");
const active = ["starting", "running", "stop_requested", "reconciling"];
const privateSession = (r: any) => ({
  id: r.id, state: r.state, version: r.version, confirmed_at: r.confirmed_at,
  started_at: r.started_at, expires_at: r.expires_at, stopped_at: r.stopped_at,
  cleanup_verified: r.cleanup_verified, charged_micros: String(r.charged_micros),
  quote_id: r.quote_id, maximum_cost_micros: String(r.maximum_cost_micros),
  specification_hash: r.specification_hash, specification: r.body,
  last_error: r.last_error,
});

/** A control plane for preprovisioned, dedicated cloud computers. Resource
 * consent is a customer route, never an Agent tool or an implicit side effect. */
export class DedicatedCloud {
  constructor(private db: Database) {}
  private get mode() { return this.db.config.DEMO_MODE ? "simulated" : "configured_services"; }
  private async serial(tx: Tx) {
    // Optional infrastructure is low volume. One bounded controller lock keeps
    // computer/session/wallet ordering deterministic across poll, stop and ack.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('dedicated-cloud-control',0))");
  }
  private async customer(tx: Tx, p: Principal, tenant: string, project: string, write = false) {
    await lockUserAuthorities(tx, [p.id]);
    await projectAccess(tx, p, tenant, project, write ? "write" : "read");
    if (p.audience === "native" && p.sessionId && (await tx.query(
      "SELECT 1 FROM refresh_tokens WHERE session_id=$1 AND client_id='desktop'", [p.sessionId])).rowCount)
      throw conflict("DESKTOP_LOCAL_EXECUTION_REQUIRED");
  }
  private async sourceFacts(tx: Tx, tenant: string, project: string, owner: string, versions: string[]) {
    const rows = [];
    for (const version of versions) {
      const row = (await tx.query(`SELECT v.id,v.sha256,v.bytes,v.mime_type,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id
        WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.state='active'
        AND (a.private_owner IS NULL OR a.private_owner=$4) AND v.erased_at IS NULL
        AND a.retention_expires_at>clock_timestamp() AND task_asset_version_sources_available(v.id)
        AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)`, [version, tenant, project, owner])).rows[0];
      if (!row) throw new Problem(404, "SOURCE_UNAVAILABLE", "A selected private file is unavailable");
      rows.push({ id: row.id, sha256: row.sha256, bytes: String(row.bytes), mime_type: row.mime_type, name: row.name });
    }
    return rows;
  }
  async plans(p: Principal, tenant: string, project: string) {
    return this.db.tx(async tx => {
      await this.customer(tx, p, tenant, project);
      return (await tx.query(`SELECT p.key,p.version,p.body,count(n.id)::int AS available_computers
        FROM cloud_runtime_plan_heads h JOIN cloud_runtime_plans p ON p.key=h.key AND p.version=h.version
        LEFT JOIN cloud_runtime_nodes n ON n.plan_key=p.key AND n.state='available' AND n.last_heartbeat_at>clock_timestamp()-interval '30 seconds'
        WHERE h.enabled AND p.data_mode=$1 GROUP BY p.key,p.version ORDER BY p.key`, [this.mode])).rows;
    }, tenant, true, p.id);
  }
  async quote(p: Principal, tenant: string, project: string, input: unknown, idempotency: string) {
    const b = dedicatedQuoteInput.parse(input);
    const saved = await this.db.tx(async tx => {
      await this.serial(tx); await this.customer(tx, p, tenant, project, true);
      return replay(tx, p.id, "cloud-runtime.quote:" + tenant + ":" + project, idempotency, b, async () => {
        const row = (await tx.query(`SELECT p.* FROM cloud_runtime_plan_heads h JOIN cloud_runtime_plans p ON p.key=h.key AND p.version=h.version
          WHERE h.key=$1 AND h.enabled AND p.data_mode=$2`, [b.plan_key, this.mode])).rows[0];
        if (!row) throw conflict();
        const plan = dedicatedPlanInput.parse(row.body);
        if (b.minutes > plan.max_minutes || b.scope.terminal && !plan.terminal || b.scope.visual && !plan.visual) throw conflict("CLOUD_RUNTIME_SCOPE_UNAVAILABLE");
        const w = await billingAccount(tx, b.billing_account_id);
        if (w.user_id ? w.user_id !== p.id : w.tenant_id !== tenant) throw missing();
        if (w.tenant_id) await tenantAccess(tx, p, tenant, "manage");
        if (w.data_mode !== this.mode) throw conflict();
        const files = await this.sourceFacts(tx, tenant, project, p.id, b.scope.selected_asset_versions);
        const maximum = dedicatedMaximumCost(plan.per_minute_micros, b.minutes);
        const specification = { ...b, plan_version: row.version, plan, selected_files: files, maximum_cost_micros: maximum,
          currency: "HKD", data_mode: this.mode, kernel: "codex", ai_routing: "company_only", automatic_renewal: false,
          duration_starts_at: "customer_confirmation", billing: "verified_running_milliseconds_rounded_up_to_microdollars", private_owner: p.id, tenant_id: tenant, project_id: project };
        const quote = (await tx.query(`INSERT INTO cloud_runtime_quotes(tenant_id,project_id,private_owner,actor_auth_version,billing_account_id,
          plan_key,plan_version,body,specification_hash,maximum_cost_micros) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [tenant, project, p.id, p.authVersion, w.id, row.key, row.version, specification, dedicatedSpecificationHash(specification), maximum])).rows[0];
        return { id: quote.id };
      });
    }, tenant, true, p.id);
    return this.db.tx(async tx => {
      await this.customer(tx, p, tenant, project);
      const q = (await tx.query("SELECT * FROM cloud_runtime_quotes WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND private_owner=$4 AND content_state='active'",
        [saved.id, tenant, project, p.id])).rows[0];
      if (!q) throw missing();
      await this.sourceFacts(tx, tenant, project, p.id, q.body.scope.selected_asset_versions);
      return { id: q.id, specification: q.body, specification_hash: q.specification_hash, maximum_cost_micros: String(q.maximum_cost_micros),
        expires_at: q.expires_at, customer_confirmation_required: true };
    }, tenant, true, p.id);
  }
  async activate(p: Principal, tenant: string, project: string, input: unknown, idempotency: string) {
    const b = dedicatedConfirmation.parse(input);
    const id = await this.db.tx(async tx => {
      await this.serial(tx); await this.customer(tx, p, tenant, project, true);
      const q = (await tx.query("SELECT * FROM cloud_runtime_quotes WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND private_owner=$4 AND content_state='active' FOR UPDATE",
        [b.quote_id, tenant, project, p.id])).rows[0];
      if (!q) throw missing();
      if (q.specification_hash !== b.specification_hash || String(q.maximum_cost_micros) !== b.maximum_cost_micros) throw conflict("CLOUD_RUNTIME_CONFIRMATION_CHANGED");
      const result = await replay(tx, p.id, "cloud-runtime.activate:" + tenant + ":" + project, idempotency, b, async () => {
        if (q.state !== "pending" || +q.expires_at <= Date.now() || q.actor_auth_version !== p.authVersion) throw conflict("CLOUD_RUNTIME_QUOTE_STALE");
        const head = (await tx.query("SELECT * FROM cloud_runtime_plan_heads WHERE key=$1 AND enabled AND version=$2", [q.plan_key, q.plan_version])).rows[0];
        if (!head) throw conflict("CLOUD_RUNTIME_QUOTE_STALE");
        const currentFiles = await this.sourceFacts(tx, tenant, project, p.id, q.body.scope.selected_asset_versions);
        if (dedicatedSpecificationHash(currentFiles) !== dedicatedSpecificationHash(q.body.selected_files)) throw conflict("CLOUD_RUNTIME_SOURCE_CHANGED");
        const w = await billingAccount(tx, q.billing_account_id);
        if (w.user_id ? w.user_id !== p.id : w.tenant_id !== tenant) throw missing();
        if (w.tenant_id) await tenantAccess(tx, p, tenant, "manage");
        if ((await tx.query("SELECT count(*)::int AS n FROM cloud_runtime_sessions WHERE private_owner=$1 AND state=ANY($2)", [p.id, active])).rows[0].n >= 2)
          throw conflict("CLOUD_RUNTIME_CONCURRENCY_LIMIT");
        const node = (await tx.query(`SELECT * FROM cloud_runtime_nodes WHERE plan_key=$1 AND state='available'
          AND last_heartbeat_at>clock_timestamp()-interval '30 seconds' ORDER BY last_heartbeat_at DESC,id LIMIT 1 FOR UPDATE`, [q.plan_key])).rows[0];
        if (!node) throw conflict("CLOUD_RUNTIME_CAPACITY_UNAVAILABLE");
        await tx.query("SELECT set_config('app.cloud_runtime_confirmation_hash',$1,true)", [q.specification_hash]);
        const session = (await tx.query(`INSERT INTO cloud_runtime_sessions(tenant_id,project_id,private_owner,quote_id,node_id,generation,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+$7::int*interval '1 minute') RETURNING *`,
          [tenant, project, p.id, q.id, node.id, node.generation + 1, q.body.minutes])).rows[0];
        await reserveDedicatedComputer(tx, session, q);
        await tx.query("UPDATE cloud_runtime_nodes SET state='occupied',generation=$2,version=version+1 WHERE id=$1", [node.id, session.generation]);
        await tx.query("UPDATE cloud_runtime_quotes SET state='activated' WHERE id=$1", [q.id]);
        await this.command(tx, session, "start", { specification_hash: q.specification_hash, specification: q.body,
          deadline: session.expires_at, kernel: "codex", company_only: true });
        await this.event(tx, session, "confirmed", { maximum_cost_micros: String(q.maximum_cost_micros) });
        return { id: session.id };
      });
      return result.id;
    }, tenant, true, p.id);
    return this.read(p, tenant, project, id);
  }
  private async row(tx: Tx, id: string, owner?: string) {
    const row = (await tx.query(`SELECT s.*,q.body,q.maximum_cost_micros,q.specification_hash,q.actor_auth_version,q.billing_account_id
      FROM cloud_runtime_sessions s JOIN cloud_runtime_quotes q ON q.id=s.quote_id WHERE s.id=$1
      AND ($2::uuid IS NULL OR s.private_owner=$2) AND s.content_state='active' AND q.content_state='active'`, [id, owner ?? null])).rows[0];
    if (!row) throw missing(); return row;
  }
  async read(p: Principal, tenant: string, project: string, id: string) {
    return this.db.tx(async tx => {
      await this.customer(tx, p, tenant, project);
      const row = await this.row(tx, id, p.id);
      if (row.tenant_id !== tenant || row.project_id !== project) throw missing();
      return privateSession(row);
    }, tenant, true, p.id);
  }
  async list(p: Principal, tenant: string, project: string) {
    return this.db.tx(async tx => {
      await this.customer(tx, p, tenant, project);
      return (await tx.query(`SELECT s.*,q.body,q.maximum_cost_micros,q.specification_hash FROM cloud_runtime_sessions s JOIN cloud_runtime_quotes q ON q.id=s.quote_id
        WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.private_owner=$3 AND s.content_state='active' AND q.content_state='active'
        ORDER BY s.confirmed_at DESC,s.id DESC LIMIT 50`, [tenant, project, p.id])).rows.map(privateSession);
    }, tenant, true, p.id);
  }
  private async event(tx: Tx, s: any, kind: string, body: unknown) {
    await tx.query("INSERT INTO cloud_runtime_events(tenant_id,project_id,private_owner,session_id,kind,body) VALUES($1,$2,$3,$4,$5,$6)",
      [s.tenant_id, s.project_id, s.private_owner, s.id, kind, body]);
  }
  private async command(tx: Tx, s: any, kind: "start" | "stop" | "input", body: unknown) {
    return (await tx.query(`INSERT INTO cloud_runtime_commands(tenant_id,project_id,private_owner,session_id,node_id,generation,kind,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [s.tenant_id, s.project_id, s.private_owner, s.id, s.node_id, s.generation, kind, body])).rows[0].id;
  }
  private async requestStop(tx: Tx, s: any, reason: string) {
    if (!active.includes(s.state)) return;
    const exists = (await tx.query("SELECT 1 FROM cloud_runtime_commands WHERE session_id=$1 AND kind='stop'", [s.id])).rowCount;
    if (!exists) await this.command(tx, s, "stop", { reason });
    await tx.query("UPDATE cloud_runtime_commands SET state='cancelled',body='{}' WHERE session_id=$1 AND kind='input' AND state='pending'", [s.id]);
    await tx.query("DELETE FROM cloud_runtime_frames WHERE session_id=$1", [s.id]);
    if (s.state === "starting" || s.state === "running")
      await tx.query("UPDATE cloud_runtime_sessions SET state='stop_requested',last_error=$2,version=version+1 WHERE id=$1", [s.id, reason]);
  }
  async stop(p: Principal, tenant: string, project: string, id: string) {
    await this.db.tx(async tx => {
      await this.serial(tx); await this.customer(tx, p, tenant, project);
      const s = await this.row(tx, id, p.id); if (s.tenant_id !== tenant || s.project_id !== project) throw missing();
      await this.requestStop(tx, s, "CUSTOMER_STOPPED");
    }, tenant, true, p.id);
    return this.read(p, tenant, project, id);
  }
  async input(p: Principal, tenant: string, project: string, id: string, input: unknown, idempotency: string) {
    const b = dedicatedControlInput.parse(input);
    return this.db.tx(async tx => {
      await this.serial(tx); await this.customer(tx, p, tenant, project, true);
      const s = await this.row(tx, id, p.id); if (s.tenant_id !== tenant || s.project_id !== project) throw missing();
      if (s.state !== "running" || +s.expires_at <= Date.now() || s.actor_auth_version !== p.authVersion) throw conflict();
      if (b.kind === "terminal" ? !s.body.scope.terminal : !s.body.scope.visual) throw conflict("CLOUD_RUNTIME_SCOPE_UNAVAILABLE");
      await this.sourceFacts(tx, tenant, project, p.id, s.body.scope.selected_asset_versions);
      return replay(tx, p.id, "cloud-runtime.input:" + id, idempotency, b, async () => {
        if ((await tx.query("SELECT 1 FROM cloud_runtime_commands WHERE session_id=$1 AND kind='input' AND state IN('pending','delivered')", [id])).rowCount)
          throw conflict("CLOUD_RUNTIME_INPUT_PENDING");
        const commandId = await this.command(tx, s, "input", b);
        await tx.query("UPDATE cloud_runtime_sessions SET last_customer_activity_at=clock_timestamp(),version=version+1 WHERE id=$1", [id]);
        return { command_id: commandId };
      });
    }, tenant, true, p.id);
  }
  private async node(tx: Tx, id: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Problem(401, "NODE_AUTHENTICATION_REQUIRED", "Computer authentication required");
    const row = (await tx.query("SELECT * FROM cloud_runtime_nodes WHERE id=$1 AND token_hash=$2 FOR UPDATE", [id, hash(token)])).rows[0];
    if (!row || row.state === "quarantined") throw new Problem(401, "NODE_AUTHENTICATION_REQUIRED", "Computer authentication required");
    return row;
  }
  async publishPlan(tx: Tx, admin: Principal, input: unknown, enabled: boolean) {
    const b = dedicatedPlanInput.parse(input); await this.serial(tx);
    const version = (await tx.query("SELECT coalesce(max(version),0)+1 AS n FROM cloud_runtime_plans WHERE key=$1", [b.key])).rows[0].n;
    await tx.query("INSERT INTO cloud_runtime_plans(key,version,body,data_mode,created_by) VALUES($1,$2,$3,$4,$5)", [b.key, version, b, this.mode, admin.id]);
    await tx.query("INSERT INTO cloud_runtime_plan_heads(key,version,enabled) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET version=excluded.version,enabled=excluded.enabled", [b.key, version, enabled]);
    return { key: b.key, version, enabled, body: b };
  }
  async registerNode(tx: Tx, admin: Principal, input: unknown) {
    const b = dedicatedNodeRegistration.parse(input); await this.serial(tx);
    const plan = (await tx.query(`SELECT 1 FROM cloud_runtime_plan_heads h JOIN cloud_runtime_plans p ON p.key=h.key AND p.version=h.version
      WHERE h.key=$1 AND p.data_mode=$2`, [b.plan_key, this.mode])).rowCount;
    if (!plan) throw conflict();
    const token = randomBytes(32).toString("base64url");
    const node = (await tx.query("INSERT INTO cloud_runtime_nodes(name,plan_key,machine_fingerprint,token_hash,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,plan_key,state", [b.name, b.plan_key, b.machine_fingerprint, hash(token), admin.id])).rows[0];
    return { ...node, enrollment_token: token, token_is_shown_once: true };
  }
  private async currentAuthority(tx: Tx, s: any) {
    if (!s.body?.scope || s.body.data_mode !== this.mode) return false;
    await tx.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [s.tenant_id, s.private_owner]);
    const row = (await tx.query(`SELECT u.status='active' AND u.auth_version=$2 AND t.status='active' AND NOT p.archived AND m.status='active'
      AND (m.role IN('owner','admin') OR m.role='member' AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=u.id AND pm.role='editor'))
      AND EXISTS(SELECT 1 FROM wallets w WHERE w.id=$5 AND w.data_mode=$6 AND (w.user_id=u.id OR w.tenant_id=t.id AND m.role IN('owner','admin'))) AS allowed
      FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id JOIN projects p ON p.tenant_id=t.id
      WHERE u.id=$1 AND m.tenant_id=$3 AND p.id=$4`, [s.private_owner, s.actor_auth_version, s.tenant_id, s.project_id, s.billing_account_id, this.mode])).rows[0];
    if (!row?.allowed) return false;
    try { await this.sourceFacts(tx, s.tenant_id, s.project_id, s.private_owner, s.body.scope.selected_asset_versions); return true; }
    catch (e) { if (e instanceof Problem && e.code === "SOURCE_UNAVAILABLE") return false; throw e; }
  }
  async maintain() {
    await assertLiveEnvironment(this.db);
    await this.db.tx(async tx => {
      await this.serial(tx);
      const rows = (await tx.query(`SELECT s.*,q.body,q.actor_auth_version,q.billing_account_id,n.last_heartbeat_at FROM cloud_runtime_sessions s JOIN cloud_runtime_quotes q ON q.id=s.quote_id
        JOIN cloud_runtime_nodes n ON n.id=s.node_id
        WHERE s.state=ANY($1) ORDER BY s.confirmed_at,s.id LIMIT 100`, [active])).rows;
      await lockUserAuthorities(tx, rows.map(s => s.private_owner));
      for (const s of rows) {
        if (+s.expires_at <= Date.now() || !await this.currentAuthority(tx, s)) await this.requestStop(tx, s, "LEASE_OR_AUTHORIZATION_ENDED");
        else if (!s.last_heartbeat_at || Date.now() - +s.last_heartbeat_at > 30_000) await this.requestStop(tx, s, "COMPUTER_OFFLINE");
        if (s.last_heartbeat_at && Date.now() - +s.last_heartbeat_at > 60_000 && s.state !== "reconciling") {
          await tx.query("UPDATE cloud_runtime_sessions SET state='reconciling',last_error='CLEANUP_AND_USAGE_UNCONFIRMED',version=version+1 WHERE id=$1", [s.id]);
          await tx.query("UPDATE cloud_runtime_holds SET state='reconciling' WHERE session_id=$1 AND state='reserved'", [s.id]);
        }
      }
      await tx.query("DELETE FROM cloud_runtime_frames WHERE created_at<clock_timestamp()-interval '10 seconds'");
    }, undefined, true);
  }
  async poll(id: string, token: string, input: unknown) {
    const b = dedicatedNodePoll.parse(input); await this.maintain();
    return this.db.tx(async tx => {
      await this.serial(tx); const n = await this.node(tx, id, token);
      if (n.machine_fingerprint !== b.machine_fingerprint) throw conflict("CLOUD_RUNTIME_COMPUTER_CHANGED");
      const s = (await tx.query("SELECT * FROM cloud_runtime_sessions WHERE node_id=$1 AND state=ANY($2)", [id, active])).rows[0];
      if (s && (n.instance_id !== b.instance_id || b.current_session_id && b.current_session_id !== s.id || b.current_generation > s.generation)) {
        await this.requestStop(tx, s, "COMPUTER_RESTARTED_OR_CHANGED");
        await tx.query("UPDATE cloud_runtime_nodes SET state='draining',instance_id=$2,last_heartbeat_at=clock_timestamp(),version=version+1 WHERE id=$1", [id, b.instance_id]);
        const commands = (await tx.query("UPDATE cloud_runtime_commands SET state='delivered',delivered_at=coalesce(delivered_at,clock_timestamp()) WHERE session_id=$1 AND kind='stop' RETURNING id,session_id,generation,kind,body", [s.id])).rows;
        return { stop_all: true, commands, server_time: new Date().toISOString() };
      }
      if (!s && b.current_session_id) return { stop_all: true, commands: [], server_time: new Date().toISOString() };
      await tx.query(`UPDATE cloud_runtime_nodes SET last_heartbeat_at=clock_timestamp(),instance_id=$2,
        state=CASE WHEN state='registered' THEN 'available' ELSE state END,version=version+1 WHERE id=$1`, [id, b.instance_id]);
      const commands = s ? (await tx.query(`SELECT id,session_id,generation,kind,body FROM cloud_runtime_commands
        WHERE session_id=$1 AND state IN('pending','delivered') AND (kind='stop' OR $2 IN('starting','running'))
        ORDER BY CASE WHEN kind='stop' THEN 0 ELSE 1 END,created_at,id LIMIT 1`, [s.id, s.state])).rows : [];
      for (const c of commands) {
        await tx.query("UPDATE cloud_runtime_commands SET state='delivered',delivered_at=coalesce(delivered_at,clock_timestamp()) WHERE id=$1", [c.id]);
        if (c.kind === "start") await tx.query("UPDATE cloud_runtime_sessions SET first_delivered_at=coalesce(first_delivered_at,clock_timestamp()),version=version+1 WHERE id=$1", [s.id]);
      }
      return { stop_all: false, commands, server_time: new Date().toISOString(), heartbeat_deadline_milliseconds: 15_000 };
    }, undefined, true);
  }
  async acknowledge(id: string, token: string, input: unknown) {
    const b = dedicatedNodeAcknowledgement.parse(input);
    await this.maintain();
    return this.db.tx(async tx => {
      await this.serial(tx); const n = await this.node(tx, id, token);
      const s = await this.row(tx, b.session_id);
      if (s.node_id !== id || s.generation !== b.generation || n.generation !== b.generation || n.instance_id !== b.instance_id) throw conflict("CLOUD_RUNTIME_STALE_GENERATION");
      const c = (await tx.query("SELECT * FROM cloud_runtime_commands WHERE id=$1 AND session_id=$2 AND generation=$3 FOR UPDATE", [b.command_id, s.id, s.generation])).rows[0];
      if (!c || !["delivered", "completed", "failed"].includes(c.state)) throw conflict("CLOUD_RUNTIME_COMMAND_UNAVAILABLE");
      const receiptHash = dedicatedSpecificationHash(b);
      if (["completed", "failed"].includes(c.state)) {
        if (c.body.receipt_hash !== receiptHash) throw conflict("CLOUD_RUNTIME_RECEIPT_CONFLICT");
        return { accepted: true, state: s.state };
      }
      if (c.kind === "start" && b.outcome === "ready" && !b.cleanup_verified && s.state === "starting" && +s.expires_at > Date.now()) {
        await lockUserAuthorities(tx, [s.private_owner]);
        if (!await this.currentAuthority(tx, s)) await this.requestStop(tx, s, "LEASE_OR_AUTHORIZATION_ENDED");
        else await tx.query("UPDATE cloud_runtime_sessions SET state='running',started_at=clock_timestamp(),version=version+1 WHERE id=$1", [s.id]);
      } else if ((c.kind === "stop" && b.outcome === "stopped" || c.kind === "start" && b.outcome === "failed") && b.cleanup_verified) {
        const elapsed = Math.max(0, Date.now() - +(s.first_delivered_at ?? new Date()));
        if (b.running_milliseconds > elapsed + 2000) throw conflict("CLOUD_RUNTIME_USAGE_UNCERTAIN");
        const charge = dedicatedUsageCost(s.body.plan.per_minute_micros, b.running_milliseconds, String(s.maximum_cost_micros));
        const stopped = (await tx.query(`UPDATE cloud_runtime_sessions SET state=$2,cleanup_verified=true,usage_milliseconds=$3,charged_micros=$4,
          stopped_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *`, [s.id, b.outcome === "failed" ? "failed" : "stopped", b.running_milliseconds, charge])).rows[0];
        await settleDedicatedComputer(tx, stopped, charge);
        await tx.query("UPDATE cloud_runtime_nodes SET state=CASE WHEN state='draining' THEN 'quarantined' ELSE 'available' END,version=version+1 WHERE id=$1", [id]);
        await tx.query("DELETE FROM cloud_runtime_frames WHERE session_id=$1", [s.id]);
      } else if (!(c.kind === "input" && ["completed", "failed"].includes(b.outcome) && s.state === "running"))
        throw conflict("CLOUD_RUNTIME_RECEIPT_UNAVAILABLE");
      await tx.query("UPDATE cloud_runtime_commands SET state=$2,result=$3,body=jsonb_build_object('receipt_hash',$4::text),completed_at=clock_timestamp() WHERE id=$1",
        [c.id, b.outcome === "failed" ? "failed" : "completed", b.result ?? null, receiptHash]);
      await this.event(tx, s, "computer_receipt", { command_id: c.id, kind: c.kind, outcome: b.outcome, cleanup_verified: b.cleanup_verified });
      return { accepted: true, state: (await this.row(tx, s.id)).state };
    }, undefined, true);
  }
  async frame(id: string, token: string, input: unknown) {
    const b = dedicatedFrameInput.parse(input), bytes = Buffer.from(b.png_base64, "base64");
    if (bytes.length > 524288 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw conflict("CLOUD_RUNTIME_FRAME_INVALID");
    return this.db.tx(async tx => {
      await this.serial(tx); const n = await this.node(tx, id, token), s = await this.row(tx, b.session_id);
      await lockUserAuthorities(tx, [s.private_owner]);
      if (s.node_id !== id || s.generation !== b.generation || n.generation !== b.generation || s.state !== "running" || +s.expires_at <= Date.now()
        || !s.body.scope.visual || !await this.currentAuthority(tx, s)) throw conflict("CLOUD_RUNTIME_VIEW_UNAVAILABLE");
      const stored = (await tx.query(`INSERT INTO cloud_runtime_frames(session_id,generation,sequence,body) VALUES($1,$2,$3,$4)
        ON CONFLICT(session_id) DO UPDATE SET sequence=excluded.sequence,body=excluded.body,created_at=clock_timestamp()
        WHERE cloud_runtime_frames.generation=excluded.generation AND cloud_runtime_frames.sequence<excluded.sequence RETURNING sequence`, [s.id, s.generation, b.sequence, bytes])).rows[0];
      if (!stored) throw conflict("CLOUD_RUNTIME_FRAME_STALE"); return { accepted: true };
    }, undefined, true);
  }
  async view(p: Principal, tenant: string, project: string, id: string) {
    return this.db.tx(async tx => {
      await this.customer(tx, p, tenant, project);
      const s = await this.row(tx, id, p.id);
      if (s.tenant_id !== tenant || s.project_id !== project || s.state !== "running" || !(s.body.scope.visual || s.body.scope.terminal) || +s.expires_at <= Date.now()) throw missing();
      await this.sourceFacts(tx, tenant, project, p.id, s.body.scope.selected_asset_versions);
      const frame = s.body.scope.visual ? (await tx.query("SELECT * FROM cloud_runtime_frames WHERE session_id=$1 AND generation=$2 AND created_at>clock_timestamp()-interval '5 seconds'", [id, s.generation])).rows[0] : null;
      const commands = (await tx.query("SELECT id,kind,state,result,completed_at FROM cloud_runtime_commands WHERE session_id=$1 AND kind='input' ORDER BY created_at DESC,id DESC LIMIT 10", [id])).rows;
      return { frame: frame ? { sequence: String(frame.sequence), png_base64: frame.body.toString("base64"), created_at: frame.created_at } : null, commands };
    }, tenant, true, p.id);
  }
}
