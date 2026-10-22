import { randomUUID, createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { LocalCodexSession, type LocalCodexHooks, type LocalSessionBinding, type LocalCodexProfile, type LocalPermissionGrant, type LocalPermissionMode, type LocalTurnResult } from "./local-codex.js";

export interface LocalAgentScope { tenant: string; project: string }
interface Operation {
  createKey: string; startKey: string; finishKey: string; cancelKey: string;
  prompt: string; budget: number; taskId?: string;
  phase: "accepting" | "starting" | "native_running" | "settling" | "uncertain";
  stopped?: boolean;
  report?: { status: "completed" | "failed" | "interrupted" | "unknown"; output: string; thread_id: string; turn_id: string };
}
interface LocalRecord extends LocalAgentScope {
  id: string; actorId: string; epoch: string; workspace: string; workspaceHash: string; role: string;
  grant?: LocalPermissionGrant; revoked: boolean; operation?: Operation; lastTask?: any; error?: string;
  uncertain?: boolean;
  messages: { role: "user" | "assistant"; text: string; status?: string }[];
  events: { kind: string; value: Record<string, unknown> }[];
}
export interface LocalAgentJournal { schema: 1; deviceId: string; sessions: LocalRecord[] }
export interface LocalAgentIO {
  read(): Promise<LocalAgentJournal | null>;
  write(journal: LocalAgentJournal): Promise<void>;
  identity(): Promise<{ actorId: string; epoch: string }>;
  request(url: string, options?: { method?: string; body?: unknown; idempotencyKey?: string; tenantId?: string }): Promise<{ status: number; body: any }>;
  chooseWorkspace(): Promise<string | null>;
  consent(mode: LocalPermissionMode, workspace: string): Promise<boolean>;
  approval(kind: "command" | "file", value: Record<string, unknown>): Promise<"accept" | "decline">;
  changed(): void;
  stateRoot: string;
  companyOrigin: string;
  executable: string;
  runtime: { version: string; sha256: string };
}
export type LocalAgentRuntime = Pick<LocalCodexSession, "start" | "turn" | "close" | "interrupt" | "revoke">;
export type LocalRuntimeFactory = (profile: LocalCodexProfile, binding: LocalSessionBinding, hooks: LocalCodexHooks) => LocalAgentRuntime;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const modes = new Set(["read-only", "workspace-write", "full-access"]);
export class LocalAgentError extends Error { constructor(public readonly code: string) { super(code); } }

/** Trusted main-process coordinator. Neither credentials nor executable paths
 * cross IPC. A network retry never restarts a previously accepted native turn. */
export class LocalAgentController {
  private journal?: LocalAgentJournal;
  private loading?: Promise<LocalAgentJournal>;
  private writeTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private busy = new Set<string>();
  private permissions = new Set<string>();
  private running = new Map<string, { runtime?: LocalAgentRuntime; abort: AbortController; done: Promise<void> }>();
  constructor(private readonly io: LocalAgentIO, private readonly runtimeFactory: LocalRuntimeFactory = (p, b, h) => new LocalCodexSession(p, b, h)) {}

  private async state() {
    if (this.journal) return this.journal;
    this.loading ??= (async () => {
      const j = await this.io.read() ?? { schema: 1 as const, deviceId: randomUUID(), sessions: [] };
      if (j.schema !== 1 || !uuid.test(j.deviceId) || !Array.isArray(j.sessions)) throw new LocalAgentError("LOCAL_STATE_INVALID");
      // A saved running phase is evidence of an uncertain local action, not a
      // reason to start it again after an application/process crash.
      for (const r of j.sessions) if (r.operation?.phase === "native_running") {
        r.uncertain = true;
        r.operation.report = { status: "unknown", output: "", thread_id: "unknown", turn_id: "unknown" };
        r.operation.phase = "settling"; r.error = "LOCAL_EXECUTION_RECONCILIATION_REQUIRED";
      }
      return this.journal = j;
    })();
    return this.loading;
  }
  private async persist() {
    const snapshot = structuredClone(await this.state());
    const write = this.writeTail.then(() => this.io.write(snapshot));
    this.writeTail = write.catch(() => {});
    await write; this.io.changed();
  }
  private async identity() {
    const generation = this.generation, actor = await this.io.identity();
    if (generation !== this.generation || !uuid.test(actor.actorId) || !actor.epoch) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    return actor;
  }
  private async record(id: string) {
    if (!uuid.test(id)) throw new LocalAgentError("LOCAL_SESSION_INVALID");
    const actor = await this.identity(), r = (await this.state()).sessions.find(row => row.id === id && row.actorId === actor.actorId && row.epoch === actor.epoch);
    if (!r) throw new LocalAgentError("LOCAL_SESSION_NOT_FOUND");
    return r;
  }
  private base(r: LocalRecord) { return `/v1/tenants/${r.tenant}/projects/${r.project}/desktop-executions`; }
  private async api(r: LocalRecord, url: string, method = "GET", body?: unknown, key?: string) {
    const response = await this.io.request(url, { method, body, idempotencyKey: key, tenantId: r.tenant });
    if (response.status < 200 || response.status >= 300) throw new LocalAgentError(response.body?.error?.code ?? "LOCAL_COMPANY_API_UNAVAILABLE");
    return response.body;
  }
  private grant(r: LocalRecord) {
    if (r.revoked || !r.grant || r.grant.actorId !== r.actorId || r.grant.expiresAt <= Date.now()) throw new LocalAgentError("LOCAL_PERMISSION_REQUIRED");
    return r.grant;
  }
  private view(r: LocalRecord) {
    return structuredClone({ id: r.id, tenant: r.tenant, project: r.project, workspace: r.workspace, role: r.role, revoked: r.revoked,
      permission: r.revoked ? null : r.grant?.mode ?? null, busy: this.busy.has(r.id), phase: r.operation?.phase ?? "idle", error: r.error,
      uncertain: !!r.uncertain, task: r.lastTask, messages: r.messages, events: r.events, retryable: !!r.operation && ["accepting", "starting", "settling"].includes(r.operation.phase) });
  }
  async list(scope: LocalAgentScope) {
    if (!uuid.test(scope.tenant) || !uuid.test(scope.project)) throw new LocalAgentError("LOCAL_SCOPE_INVALID");
    const actor = await this.identity();
    const access = await this.io.request(`/v1/tenants/${scope.tenant}/projects/${scope.project}/desktop-executions/runtime`);
    if (access.status !== 200) throw new LocalAgentError("LOCAL_PROJECT_ACCESS_REQUIRED");
    const current = await this.identity();
    if (actor.actorId !== current.actorId || actor.epoch !== current.epoch) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const sessions = (await this.state()).sessions.filter(r => r.actorId === actor.actorId && r.epoch === actor.epoch && r.tenant === scope.tenant && r.project === scope.project);
    return { sessions: sessions.map(r => this.view(r)), roles: access.body.role_keys as string[] };
  }
  async create(scope: LocalAgentScope, role: string) {
    if (!uuid.test(scope.tenant) || !uuid.test(scope.project) || !/^[a-z][a-z0-9-]{0,79}$/.test(role)) throw new LocalAgentError("LOCAL_SCOPE_INVALID");
    const actor = await this.identity(), generation = this.generation;
    const response = await this.io.request(`/v1/tenants/${scope.tenant}/projects/${scope.project}/desktop-executions/runtime`);
    if (response.status !== 200 || !response.body?.role_keys?.includes(role)) throw new LocalAgentError("DESKTOP_ROLE_NOT_READY");
    if (response.body.pinned_version !== this.io.runtime.version || response.body.windows_x64_sha256 !== this.io.runtime.sha256) throw new LocalAgentError("LOCAL_RUNTIME_UPDATE_REQUIRED");
    const workspace = await this.io.chooseWorkspace();
    if (!workspace) return null;
    if (generation !== this.generation) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const resolved = await realpath(workspace);
    if (!path.isAbsolute(resolved)) throw new LocalAgentError("LOCAL_WORKSPACE_INVALID");
    const r: LocalRecord = { ...scope, id: randomUUID(), actorId: actor.actorId, epoch: actor.epoch, workspace: resolved,
      workspaceHash: hash(process.platform === "win32" ? resolved.toLowerCase() : resolved), role, revoked: false, messages: [], events: [] };
    (await this.state()).sessions.push(r); await this.persist(); return this.view(r);
  }
  async permission(id: string, mode: LocalPermissionMode) {
    if (!modes.has(mode)) throw new LocalAgentError("LOCAL_PERMISSION_INVALID");
    const r = await this.record(id), generation = this.generation;
    if (r.revoked) throw new LocalAgentError("LOCAL_PERMISSION_REVOKED");
    if (this.busy.has(id) || this.permissions.has(id)) throw new LocalAgentError("LOCAL_STOP_BEFORE_PERMISSION_CHANGE");
    this.permissions.add(id);
    try {
      if (!(await this.io.consent(mode, r.workspace))) return this.view(r);
      await this.record(id);
      if (r.revoked || generation !== this.generation || this.busy.has(id)) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
      r.grant = { id: r.grant?.id ?? randomUUID(), actorId: r.actorId, mode, revision: (r.grant?.revision ?? 0) + 1, expiresAt: Number.MAX_SAFE_INTEGER };
      await this.persist(); return this.view(r);
    } finally { this.permissions.delete(id); }
  }
  async send(id: string, prompt: string, budget: number) {
    const r = await this.record(id); this.grant(r);
    if (this.busy.has(id) || this.permissions.has(id) || r.operation || r.uncertain) throw new LocalAgentError("LOCAL_OPERATION_PENDING");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 30000 || !Number.isSafeInteger(budget) || budget < 10000 || budget > 10000000000) throw new LocalAgentError("LOCAL_REQUEST_INVALID");
    r.operation = { createKey: randomUUID(), startKey: randomUUID(), finishKey: randomUUID(), cancelKey: randomUUID(), prompt: prompt.trim(), budget, phase: "accepting" };
    r.messages.push({ role: "user", text: prompt.trim() }); r.error = undefined;
    await this.persist(); return this.execute(r);
  }
  async retry(id: string) {
    const r = await this.record(id); if (r.operation?.phase !== "settling") this.grant(r);
    if (this.busy.has(id) || !r.operation || !["accepting", "starting", "settling"].includes(r.operation.phase)) throw new LocalAgentError("LOCAL_REPLAY_NOT_ALLOWED");
    return this.execute(r);
  }
  private async execute(r: LocalRecord) {
    const op = r.operation!; this.busy.add(r.id); this.io.changed();
    const generation = this.generation, base = this.base(r), journal = await this.state();
    const fields = { device_id: journal.deviceId, local_session_id: r.id, workspace_hash: r.workspaceHash, runtime_version: this.io.runtime.version, runtime_sha256: this.io.runtime.sha256 };
    let runtime: LocalAgentRuntime | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, heartbeatRun: Promise<unknown> | undefined;
    let admitted = false, nativeAccepted = false, stoppingHeartbeat = false;
    const abort = new AbortController();
    let resolveDone!: () => void; const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const active: { runtime?: LocalAgentRuntime; abort: AbortController; done: Promise<void> } = { abort, done };
    this.running.set(r.id, active);
    const assertOwner = async () => { const actor = await this.identity(); this.grant(r); if (generation !== this.generation || actor.actorId !== r.actorId || actor.epoch !== r.epoch) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED"); };
    const stopHeartbeat = async () => { stoppingHeartbeat = true; if (heartbeat) clearInterval(heartbeat); await heartbeatRun; };
    const settleReport = async () => {
      await stopHeartbeat();
      const actor = await this.identity();
      if (generation !== this.generation || actor.actorId !== r.actorId || actor.epoch !== r.epoch) throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
      // Reporting a terminal/unknown outcome is allowed after local permission
      // withdrawal; it never starts tools or another model request.
      r.lastTask = await this.api(r, base + "/" + op.taskId + "/finish", "POST", op.report, op.finishKey);
      r.messages.push({ role: "assistant", text: op.report!.output, status: r.lastTask.status });
      r.uncertain ||= op.report!.status === "unknown" || r.lastTask.status === "reconciling";
      r.operation = undefined; if (!r.uncertain) r.error = undefined; await this.persist();
    };
    try {
      if (op.phase !== "settling") await assertOwner();
      if (!op.taskId) {
        const task = await this.api(r, base, "POST", { ...fields, title: op.prompt.slice(0, 100), prompt: op.prompt, role_key: r.role, budget_micros: op.budget }, op.createKey);
        op.taskId = task.task_id; r.lastTask = task; op.phase = "starting"; await this.persist();
      }
      const taskURL = base + "/" + op.taskId;
      if (op.phase !== "settling") {
        await assertOwner();
        if (op.stopped || abort.signal.aborted) {
          r.lastTask = await this.api(r, taskURL + "/cancel", "POST", {}, op.cancelKey);
          r.operation = undefined; await this.persist(); return this.view(r);
        }
        const started = await this.api(r, taskURL + "/start", "POST", fields, op.startKey);
        admitted = true;
        await assertOwner();
        if (started.runtime?.pinned_version !== this.io.runtime.version || started.runtime?.windows_x64_sha256 !== this.io.runtime.sha256
          || started.inference_path !== "/v1/desktop-inference/v1" || !Array.isArray(started.skills)) throw new LocalAgentError("LOCAL_RUNTIME_UPDATE_REQUIRED");
        r.lastTask = { ...started, credential: undefined, skills: undefined, prompt: undefined };
        const authorize = async () => {
          await assertOwner();
          const live = await this.api(r, taskURL + "/heartbeat", "POST", {});
          if (live.cancel_requested || live.state !== "running" || live.status !== "running") throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
          r.lastTask = live;
        };
        const profile: LocalCodexProfile = { executable: this.io.executable, version: this.io.runtime.version, executableSha256: this.io.runtime.sha256,
          companyOrigin: this.io.companyOrigin, baseURL: this.io.companyOrigin + started.inference_path, model: started.model, effort: started.effort };
        runtime = this.runtimeFactory(profile, { sessionId: r.id, actorId: r.actorId, tenantId: r.tenant, projectId: r.project,
          workspace: r.workspace, stateRoot: this.io.stateRoot, grant: { ...this.grant(r) }, skills: started.skills }, {
          authorize, approval: (kind, value) => this.io.approval(kind, value),
          event: async (kind, value) => {
            if (generation !== this.generation) return;
            r.events.push({ kind, value }); if (r.events.length > 500) r.events.shift(); this.io.changed();
          },
        });
        active.runtime = runtime;
        if (op.stopped || abort.signal.aborted) throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
        await runtime.start({ token: started.credential.token, expiresAt: new Date(started.credential.expires_at).getTime() });
        heartbeat = setInterval(() => {
          if (heartbeatRun || stoppingHeartbeat) return;
          heartbeatRun = authorize().catch(() => { abort.abort(); void runtime?.close().catch(() => {}); }).finally(() => { heartbeatRun = undefined; this.io.changed(); });
        }, 10000);
        if (op.stopped || abort.signal.aborted) throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
        op.phase = "native_running"; await this.persist();
        nativeAccepted = true;
        const result: LocalTurnResult = await runtime.turn(started.role_instructions + "\n\nCustomer request:\n" + started.prompt, abort.signal);
        await stopHeartbeat();
        await runtime.close();
        op.report = { status: result.status, output: result.text.slice(0, 100000), thread_id: result.threadId, turn_id: result.turnId };
        op.phase = "settling"; await this.persist();
      }
      await settleReport();
      return this.view(r);
    } catch (error) {
      r.error = error instanceof LocalAgentError ? error.code : error instanceof Error ? error.message : "LOCAL_EXECUTION_FAILED";
      if (op.phase === "native_running" || (admitted && op.phase === "starting")) {
        r.uncertain ||= nativeAccepted;
        if (nativeAccepted) r.error = "LOCAL_EXECUTION_RECONCILIATION_REQUIRED";
        op.report = { status: nativeAccepted ? "unknown" : "failed", output: "", thread_id: "unknown", turn_id: "unknown" };
        op.phase = "settling"; await this.persist();
        await runtime?.close().catch(() => {});
        await settleReport().catch(() => {});
      } else await this.persist();
      throw error;
    } finally {
      await stopHeartbeat();
      try { await runtime?.close(); this.running.delete(r.id); this.busy.delete(r.id); }
      catch (error) { r.error = "LOCAL_PROCESS_SHUTDOWN_FAILED"; r.uncertain = true; await this.persist(); throw error; }
      finally { resolveDone(); this.io.changed(); }
    }
  }
  async stop(id: string) {
    const r = await this.record(id), active = this.running.get(id);
    if (r.operation) r.operation.stopped = true;
    active?.abort.abort();
    await this.persist();
    // Interrupt immediately, independently of the company's network health.
    const localStop = (async () => {
      await active?.runtime?.interrupt().catch(() => {});
      if (active) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([active.done, new Promise<void>(resolve => { timer = setTimeout(resolve, 3500); })]); }
        finally { if (timer) clearTimeout(timer); }
        if (this.running.get(id) === active) await active.runtime?.close();
      }
    })();
    let remoteError: unknown;
    if (r.operation?.taskId) await this.api(r, this.base(r) + "/" + r.operation.taskId + "/cancel", "POST", {}, r.operation.cancelKey).catch(e => { remoteError = e; });
    await localStop;
    if (remoteError) { r.error = "LOCAL_STOPPED_COMPANY_RECEIPT_PENDING"; await this.persist(); }
    return this.view(r);
  }
  async revoke(id: string) {
    const r = await this.record(id); r.revoked = true;
    const active = this.running.get(id); active?.abort.abort();
    await Promise.all([this.persist(), active?.runtime?.revoke()]);
    return this.view(r);
  }
  async invalidate() {
    ++this.generation;
    const journal = await this.state(); for (const r of journal.sessions) r.revoked = true;
    const active = [...this.running.values()]; for (const item of active) item.abort.abort();
    await Promise.all(active.map(item => item.runtime?.revoke())); await this.persist();
  }
  async close() {
    for (const item of this.running.values()) item.abort.abort();
    await Promise.all([...this.running.values()].map(item => item.runtime?.close())); await this.writeTail;
  }
}
