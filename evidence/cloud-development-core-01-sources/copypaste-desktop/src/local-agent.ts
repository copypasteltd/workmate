import { randomUUID, createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  LocalCodexSession,
  LocalCodexError,
  type LocalCodexHooks,
  type LocalSessionBinding,
  type LocalCodexProfile,
  type LocalPermissionGrant,
  type LocalPermissionMode,
  type LocalTurnResult,
} from "./local-codex.js";
import {
  parseLocalInput,
  parseLocalAnswers,
  type LocalInputRequest,
  type LocalInputAnswers,
  type LocalPendingInput,
} from "./local-input.js";
import {
  executeLocalWorkflow,
  type NativeWorkflowChild,
} from "./local-workflow.js";
import {
  BrowserToolError,
  type BrowserOwner,
  type LocalBrowserSession,
} from "./browser-contract.js";
import {
  LocalProgramError,
  type LocalProgramSession,
} from "./program-contract.js";

export interface LocalAgentScope {
  tenant: string;
  project: string;
}
interface Operation {
  createKey: string;
  startKey: string;
  finishKey: string;
  cancelKey: string;
  dispatchId?: string;
  prompt: string;
  budget: number;
  taskId?: string;
  solution?: {
    versionId: string;
    request: { trial: Record<string, any>; sessions: Record<string, any>[] };
    trialId?: string;
  };
  phase: "accepting" | "starting" | "native_running" | "settling" | "uncertain";
  stopped?: boolean;
  workflowRunId?: string;
  workflow?: {
    runId: string;
    cursor: number;
    taskId: string;
    phase: "prepared" | "native_running" | "settling" | "finished";
    report?: Operation["report"];
  };
  report?: {
    status: "completed" | "failed" | "interrupted" | "unknown";
    output: string;
    thread_id: string;
    turn_id: string;
  };
}
interface ActiveLocalOperation {
  runtime?: LocalAgentRuntime;
  children: Set<LocalAgentRuntime>;
  browsers: Set<LocalBrowserSession>;
  programs: Set<LocalProgramSession>;
  abort: AbortController;
  done: Promise<void>;
}
interface LocalRecord extends LocalAgentScope {
  id: string;
  actorId: string;
  epoch: string;
  workspace: string;
  workspaceHash: string;
  role: string;
  specialist?: { id: string; version: number; name: string };
  grant?: LocalPermissionGrant;
  revoked: boolean;
  operation?: Operation;
  lastTask?: any;
  error?: string;
  uncertain?: boolean;
  lastSolution?: { versionId: string; trialId?: string };
  companyToolsVersion?: 1;
  browserToolsVersion?: 1;
  programToolsVersion?: 1;
  dispatches?: LocalDispatchReceipt[];
  messages: { role: "user" | "assistant"; text: string; status?: string }[];
  events: { kind: string; value: Record<string, unknown> }[];
}
export interface LocalDispatchReceipt {
  id: string;
  digest: string;
  state: "pending" | "succeeded" | "failed" | "uncertain" | "cancelled";
  taskId?: string;
}
export interface LocalAgentJournal {
  schema: 1;
  deviceId: string;
  sessions: LocalRecord[];
}
export interface LocalAgentIO {
  read(): Promise<LocalAgentJournal | null>;
  write(journal: LocalAgentJournal): Promise<void>;
  identity(): Promise<{ actorId: string; epoch: string }>;
  /** Current encrypted local login epoch; must not refresh or call a server. */
  localEpoch(): Promise<string | null>;
  request(
    url: string,
    options?: {
      method?: string;
      body?: unknown;
      idempotencyKey?: string;
      tenantId?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ status: number; body: any }>;
  chooseWorkspace(): Promise<string | null>;
  consent(mode: LocalPermissionMode, workspace: string): Promise<boolean>;
  approval(
    kind: "command" | "file",
    value: Record<string, unknown>,
  ): Promise<"accept" | "decline">;
  changed(): void;
  stateRoot: string;
  companyOrigin: string;
  executable: string;
  runtime: { version: string; sha256: string };
  browser?(
    owner: BrowserOwner,
    authorize: () => Promise<void>,
  ): LocalBrowserSession;
  program?(
    owner: BrowserOwner & { approvalSessionId: string },
    authorize: () => Promise<void>,
  ): LocalProgramSession;
}
export type LocalAgentRuntime = Pick<
  LocalCodexSession,
  "start" | "turn" | "close" | "interrupt" | "revoke"
>;
export type LocalRuntimeFactory = (
  profile: LocalCodexProfile,
  binding: LocalSessionBinding,
  hooks: LocalCodexHooks,
) => LocalAgentRuntime;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const modes = new Set(["read-only", "workspace-write", "full-access"]);
export class LocalAgentError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
class LocalSolutionRejection extends LocalAgentError {}

/** Trusted main-process coordinator. Neither credentials nor executable paths
 * cross IPC. A network retry never restarts a previously accepted native turn. */
export class LocalAgentController {
  private journal?: LocalAgentJournal;
  private loading?: Promise<LocalAgentJournal>;
  private writeTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private busy = new Set<string>();
  private permissions = new Set<string>();
  private running = new Map<string, ActiveLocalOperation>();
  // Questions and answers are live process state, never journal entries. A
  // renderer refresh can redisplay a question; an app restart cannot replay it.
  private inputs = new Map<
    string,
    Map<
      string,
      {
        view: LocalPendingInput;
        op: Operation;
        signal: AbortSignal;
        authorize: () => Promise<void>;
        complete: (answers: LocalInputAnswers) => void;
      }
    >
  >();
  constructor(
    private readonly io: LocalAgentIO,
    private readonly runtimeFactory: LocalRuntimeFactory = (p, b, h) =>
      new LocalCodexSession(p, b, h),
  ) {}

  private async state() {
    if (this.journal) return this.journal;
    this.loading ??= (async () => {
      const j = (await this.io.read()) ?? {
        schema: 1 as const,
        deviceId: randomUUID(),
        sessions: [],
      };
      if (
        j.schema !== 1 ||
        !uuid.test(j.deviceId) ||
        !Array.isArray(j.sessions)
      )
        throw new LocalAgentError("LOCAL_STATE_INVALID");
      // A saved running phase is evidence of an uncertain local action, not a
      // reason to start it again after an application/process crash.
      for (const r of j.sessions)
        if (r.operation?.phase === "native_running") {
          r.uncertain = true;
          r.operation.report = {
            status: "unknown",
            output: "",
            thread_id: "unknown",
            turn_id: "unknown",
          };
          r.operation.phase = "settling";
          r.error = "LOCAL_EXECUTION_RECONCILIATION_REQUIRED";
        }
      return (this.journal = j);
    })();
    return this.loading;
  }
  private async persist() {
    const snapshot = structuredClone(await this.state());
    const write = this.writeTail.then(() => this.io.write(snapshot));
    this.writeTail = write.catch(() => {});
    await write;
    this.io.changed();
  }
  private async identity() {
    const generation = this.generation,
      actor = await this.io.identity();
    if (this.closed) throw new LocalAgentError("LOCAL_APP_CLOSED");
    if (
      generation !== this.generation ||
      !uuid.test(actor.actorId) ||
      !actor.epoch
    )
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    return actor;
  }
  private async record(id: string) {
    if (!uuid.test(id)) throw new LocalAgentError("LOCAL_SESSION_INVALID");
    const actor = await this.identity(),
      r = (await this.state()).sessions.find(
        (row) =>
          row.id === id &&
          row.actorId === actor.actorId &&
          row.epoch === actor.epoch,
      );
    if (!r) throw new LocalAgentError("LOCAL_SESSION_NOT_FOUND");
    return r;
  }
  private async withdrawalRecord(id: string) {
    if (!uuid.test(id)) throw new LocalAgentError("LOCAL_SESSION_INVALID");
    const generation = this.generation,
      epoch = await this.io.localEpoch(),
      journal = await this.state();
    if (!epoch || generation !== this.generation)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const r = journal.sessions.find(
      (row) => row.id === id && row.epoch === epoch,
    );
    if (!r) throw new LocalAgentError("LOCAL_SESSION_NOT_FOUND");
    return r;
  }
  private base(r: LocalRecord) {
    return `/v1/tenants/${r.tenant}/projects/${r.project}/desktop-executions`;
  }
  private async api(
    r: LocalRecord,
    url: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const response = await this.io.request(url, {
      method,
      body,
      idempotencyKey: key,
      tenantId: r.tenant,
    });
    if (response.status < 200 || response.status >= 300)
      throw new LocalAgentError(
        response.body?.error?.code ?? "LOCAL_COMPANY_API_UNAVAILABLE",
      );
    return response.body;
  }
  private grant(r: LocalRecord) {
    if (
      r.revoked ||
      !r.grant ||
      r.grant.actorId !== r.actorId ||
      r.grant.expiresAt <= Date.now()
    )
      throw new LocalAgentError("LOCAL_PERMISSION_REQUIRED");
    return r.grant;
  }
  private view(r: LocalRecord) {
    return structuredClone({
      id: r.id,
      tenant: r.tenant,
      project: r.project,
      workspace: r.workspace,
      role: r.role,
      specialist: r.specialist,
      revoked: r.revoked,
      permission: r.revoked ? null : (r.grant?.mode ?? null),
      busy: this.busy.has(r.id),
      phase: r.operation?.phase ?? "idle",
      error: r.error,
      programToolsVersion: r.programToolsVersion,
      uncertain: !!r.uncertain,
      task: r.lastTask,
      messages: r.messages,
      events: r.events,
      solution: r.operation?.solution
        ? {
            versionId: r.operation.solution.versionId,
            trialId: r.operation.solution.trialId,
          }
        : r.lastSolution,
      inputs: [...(this.inputs.get(r.id)?.values() ?? [])].map(
        (input) => input.view,
      ),
      retryable:
        !!r.operation &&
        ["accepting", "starting", "settling"].includes(r.operation.phase),
    });
  }
  private async waitForInput(
    r: LocalRecord,
    op: Operation,
    raw: LocalInputRequest,
    signal: AbortSignal,
    authorize: () => Promise<void>,
  ) {
    const request = parseLocalInput(raw);
    await authorize();
    if (
      signal.aborted ||
      r.operation !== op ||
      op.stopped ||
      op.phase !== "native_running"
    )
      throw new LocalAgentError("LOCAL_INPUT_CANCELLED");
    const inputs = this.inputs.get(r.id) ?? new Map();
    this.inputs.set(r.id, inputs);
    if (inputs.size >= 4) throw new LocalAgentError("LOCAL_INPUT_LIMIT");
    const requestId = randomUUID();
    return new Promise<LocalInputAnswers>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", cancelled);
        inputs.delete(requestId);
        if (!inputs.size && this.inputs.get(r.id) === inputs)
          this.inputs.delete(r.id);
        this.io.changed();
      };
      const cancelled = () => {
        cleanup();
        reject(new LocalAgentError("LOCAL_INPUT_CANCELLED"));
      };
      inputs.set(requestId, {
        view: { ...request, requestId, submitting: false },
        op,
        signal,
        authorize,
        complete: (answers: LocalInputAnswers) => {
          cleanup();
          resolve(answers);
        },
      });
      signal.addEventListener("abort", cancelled, { once: true });
      this.io.changed();
      if (signal.aborted) cancelled();
    });
  }
  async answer(id: string, requestId: string, raw: unknown) {
    const r = await this.record(id);
    this.grant(r);
    if (!uuid.test(requestId))
      throw new LocalAgentError("LOCAL_INPUT_NOT_FOUND");
    const input = this.inputs.get(id)?.get(requestId),
      active = this.running.get(id);
    if (
      !input ||
      !active ||
      input.signal.aborted ||
      active.abort.signal.aborted ||
      r.operation !== input.op ||
      input.op.stopped
    )
      throw new LocalAgentError("LOCAL_INPUT_NOT_FOUND");
    if (input.view.submitting)
      throw new LocalAgentError("LOCAL_INPUT_ALREADY_SUBMITTING");
    const answers = parseLocalAnswers(input.view, raw);
    input.view.submitting = true;
    this.io.changed();
    try {
      await input.authorize();
      const current = await this.record(id);
      this.grant(current);
      if (
        current !== r ||
        this.inputs.get(id)?.get(requestId) !== input ||
        this.running.get(id) !== active ||
        input.signal.aborted ||
        active.abort.signal.aborted ||
        r.operation !== input.op ||
        input.op.stopped
      )
        throw new LocalAgentError("LOCAL_INPUT_CANCELLED");
      input.complete(answers);
      return this.view(r);
    } catch (error) {
      input.view.submitting = false;
      this.io.changed();
      throw error;
    }
  }
  async list(scope: LocalAgentScope) {
    if (!uuid.test(scope.tenant) || !uuid.test(scope.project))
      throw new LocalAgentError("LOCAL_SCOPE_INVALID");
    const actor = await this.identity();
    const access = await this.io.request(
      `/v1/tenants/${scope.tenant}/projects/${scope.project}/desktop-executions/runtime`,
    );
    if (access.status !== 200)
      throw new LocalAgentError(
        [401, 403, 404].includes(access.status)
          ? "LOCAL_PROJECT_ACCESS_REQUIRED"
          : "LOCAL_COMPANY_API_UNAVAILABLE",
      );
    const current = await this.identity();
    if (actor.actorId !== current.actorId || actor.epoch !== current.epoch)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const sessions = (await this.state()).sessions.filter(
      (r) =>
        r.actorId === actor.actorId &&
        r.epoch === actor.epoch &&
        r.tenant === scope.tenant &&
        r.project === scope.project,
    );
    return {
      sessions: sessions.map((r) => this.view(r)),
      roles: access.body.role_keys as string[],
    };
  }
  async create(scope: LocalAgentScope, role: string, specialist?: { id: string; version: number }) {
    if (
      !uuid.test(scope.tenant) ||
      !uuid.test(scope.project) ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(role) ||
      (specialist && (!uuid.test(specialist.id) || !Number.isSafeInteger(specialist.version) || specialist.version < 1))
    )
      throw new LocalAgentError("LOCAL_SCOPE_INVALID");
    const actor = await this.identity(),
      generation = this.generation;
    const response = await this.io.request(
      `/v1/tenants/${scope.tenant}/projects/${scope.project}/desktop-executions/runtime`,
    );
    if (response.status !== 200 || !response.body?.role_keys?.includes(role))
      throw new LocalAgentError("DESKTOP_ROLE_NOT_READY");
    if (
      response.body.pinned_version !== this.io.runtime.version ||
      response.body.windows_x64_sha256 !== this.io.runtime.sha256
    )
      throw new LocalAgentError("LOCAL_RUNTIME_UPDATE_REQUIRED");
    let bound: LocalRecord["specialist"];
    if (specialist) {
      const checked = await this.io.request(`/v1/tenants/${scope.tenant}/projects/${scope.project}/desktop-executions/specialists/${specialist.id}?version=${specialist.version}`);
      if (checked.status !== 200 || checked.body?.id !== specialist.id || checked.body.version !== specialist.version || checked.body.role_key !== role ||
          typeof checked.body.name !== "string" || !checked.body.name.trim() || checked.body.name.length > 160)
        throw new LocalAgentError("LOCAL_SPECIALIST_UNAVAILABLE");
      bound = { id: specialist.id, version: specialist.version, name: checked.body.name };
    }
    if (generation !== this.generation || (await this.identity()).epoch !== actor.epoch)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const workspace = await this.io.chooseWorkspace();
    if (!workspace) return null;
    if (generation !== this.generation)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    const resolved = await realpath(workspace);
    const currentActor = await this.identity();
    if (generation !== this.generation || currentActor.actorId !== actor.actorId || currentActor.epoch !== actor.epoch)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    if (!path.isAbsolute(resolved))
      throw new LocalAgentError("LOCAL_WORKSPACE_INVALID");
    const r: LocalRecord = {
      tenant: scope.tenant,
      project: scope.project,
      id: randomUUID(),
      actorId: actor.actorId,
      epoch: actor.epoch,
      workspace: resolved,
      workspaceHash: hash(
        process.platform === "win32" ? resolved.toLowerCase() : resolved,
      ),
      role,
      ...(bound ? { specialist: bound } : {}),
      revoked: false,
      companyToolsVersion: 1,
      ...(this.io.browser ? { browserToolsVersion: 1 as const } : {}),
      ...(this.io.program ? { programToolsVersion: 1 as const } : {}),
      messages: [],
      events: [],
    };
    (await this.state()).sessions.push(r);
    await this.persist();
    return this.view(r);
  }
  async permission(id: string, mode: LocalPermissionMode) {
    if (!modes.has(mode)) throw new LocalAgentError("LOCAL_PERMISSION_INVALID");
    const r = await this.record(id),
      generation = this.generation;
    if (r.revoked) throw new LocalAgentError("LOCAL_PERMISSION_REVOKED");
    if (this.busy.has(id) || this.permissions.has(id))
      throw new LocalAgentError("LOCAL_STOP_BEFORE_PERMISSION_CHANGE");
    this.permissions.add(id);
    try {
      if (!(await this.io.consent(mode, r.workspace))) return this.view(r);
      await this.record(id);
      if (r.revoked || generation !== this.generation || this.busy.has(id))
        throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
      r.grant = {
        id: r.grant?.id ?? randomUUID(),
        actorId: r.actorId,
        mode,
        revision: (r.grant?.revision ?? 0) + 1,
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      await this.persist();
      return this.view(r);
    } finally {
      this.permissions.delete(id);
    }
  }
  async send(id: string, prompt: string, budget: number) {
    const r = await this.record(id);
    this.grant(r);
    if (
      this.busy.has(id) ||
      this.permissions.has(id) ||
      r.operation ||
      r.uncertain
    )
      throw new LocalAgentError("LOCAL_OPERATION_PENDING");
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 30000 ||
      !Number.isSafeInteger(budget) ||
      budget < 10000 ||
      budget > 10000000000
    )
      throw new LocalAgentError("LOCAL_REQUEST_INVALID");
    r.operation = {
      createKey: randomUUID(),
      startKey: randomUUID(),
      finishKey: randomUUID(),
      cancelKey: randomUUID(),
      prompt: prompt.trim(),
      budget,
      phase: "accepting",
    };
    r.messages.push({ role: "user", text: prompt.trim() });
    r.error = undefined;
    await this.persist();
    return this.execute(r);
  }
  async retry(id: string) {
    const r = await this.record(id);
    if (r.operation?.phase !== "settling" && !r.operation?.stopped)
      this.grant(r);
    if (
      this.busy.has(id) ||
      !r.operation ||
      !["accepting", "starting", "settling"].includes(r.operation.phase)
    )
      throw new LocalAgentError("LOCAL_REPLAY_NOT_ALLOWED");
    if (
      r.operation.dispatchId &&
      r.operation.phase !== "settling" &&
      !r.operation.stopped
    )
      throw new LocalAgentError("LOCAL_DISPATCH_RESUME_REQUIRED");
    return this.execute(r);
  }
  /** Reserve the whole reviewed batch in the encrypted native journal before
   * touching the network. Each role remains an ordinary, stoppable local turn.
   * Unknown responses reuse this exact request; they never become generic work. */
  async prepareSolution(input: {
    tenant: string;
    project: string;
    solution: string;
    trial: Record<string, any>;
    sessions: string[];
  }) {
    if (
      !input ||
      !uuid.test(input.solution) ||
      !uuid.test(input.tenant) ||
      !uuid.test(input.project) ||
      !input.trial ||
      input.trial.project_id !== input.project ||
      input.trial.approval !== true ||
      !Array.isArray(input.sessions) ||
      input.sessions.length < 1 ||
      input.sessions.length > 6 ||
      new Set(input.sessions).size !== input.sessions.length ||
      input.sessions.some((id) => !uuid.test(id))
    )
      throw new LocalAgentError("LOCAL_REQUEST_INVALID");
    const records: LocalRecord[] = [],
      generation = this.generation;
    try {
      for (const id of input.sessions) {
        const r = await this.record(id);
        this.grant(r);
        if (
          r.tenant !== input.tenant ||
          r.project !== input.project ||
          this.busy.has(id) ||
          this.permissions.has(id) ||
          r.operation ||
          r.specialist ||
          r.uncertain ||
          r.lastTask ||
          r.messages.length
        )
          throw new LocalAgentError("SOLUTION_LOCAL_SESSION_USED");
        this.permissions.add(id);
        records.push(r);
      }
      const journal = await this.state(),
        createKey = randomUUID();
      const request = {
        trial: structuredClone(input.trial),
        sessions: records.map((r) => ({
          device_id: journal.deviceId,
          local_session_id: r.id,
          workspace_hash: r.workspaceHash,
          runtime_version: this.io.runtime.version,
          runtime_sha256: this.io.runtime.sha256,
          role_key: r.role,
        })),
      };
      if (generation !== this.generation)
        throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
      for (const r of records) {
        this.grant(r);
        r.operation = {
          createKey,
          startKey: randomUUID(),
          finishKey: randomUUID(),
          cancelKey: randomUUID(),
          prompt: "Local method trial",
          budget: 0,
          phase: "accepting",
          solution: { versionId: input.solution, request },
        };
      }
      await this.persist();
      try {
        return await this.admitSolution(records[0]);
      } catch (error) {
        // Only a definitive server rejection releases a local reservation. A
        // transport/500 outcome remains durable and must be reconciled.
        if (error instanceof LocalSolutionRejection) {
          for (const r of records)
            if (r.operation?.createKey === createKey && !r.operation.taskId)
              r.operation = undefined;
          await this.persist();
        }
        throw error;
      }
    } finally {
      for (const r of records) this.permissions.delete(r.id);
      this.io.changed();
    }
  }
  private async admitSolution(r: LocalRecord) {
    const op = r.operation!,
      solution = op.solution!;
    await this.record(r.id);
    if (!op.stopped) this.grant(r);
    const reply = await this.io.request(
      `/v1/solution-versions/${solution.versionId}/desktop-trials`,
      {
        method: "POST",
        tenantId: r.tenant,
        body: solution.request,
        idempotencyKey: op.createKey,
      },
    );
    if (reply.status < 200 || reply.status >= 300) {
      const code = reply.body?.error?.code ?? "LOCAL_COMPANY_API_UNAVAILABLE";
      if (
        reply.status >= 400 &&
        reply.status < 500 &&
        ![408, 429].includes(reply.status)
      )
        throw new LocalSolutionRejection(code);
      throw new LocalAgentError(code);
    }
    await this.record(r.id);
    if (!op.stopped) this.grant(r);
    const tasks = reply.body?.tasks,
      links = reply.body?.local_sessions;
    if (
      reply.body?.execution_location !== "desktop" ||
      !uuid.test(reply.body?.id) ||
      !Array.isArray(tasks) ||
      !Array.isArray(links) ||
      tasks.length !== solution.request.sessions.length ||
      links.length !== tasks.length
    )
      throw new LocalAgentError("SOLUTION_LOCAL_RECEIPT_INVALID");
    for (let position = 0; position < tasks.length; position++) {
      if (
        tasks[position].position !== position ||
        !uuid.test(tasks[position].task_id) ||
        links[position].position !== position ||
        links[position].local_session_id !==
          solution.request.sessions[position].local_session_id ||
        links[position].budget_micros !==
          Math.floor(solution.request.trial.budget_micros / tasks.length) +
            (position === 0
              ? solution.request.trial.budget_micros % tasks.length
              : 0)
      )
        throw new LocalAgentError("SOLUTION_LOCAL_RECEIPT_INVALID");
    }
    for (const local of (await this.state()).sessions) {
      if (
        local.actorId !== r.actorId ||
        local.epoch !== r.epoch ||
        local.operation?.createKey !== op.createKey
      )
        continue;
      const position = solution.request.sessions.findIndex(
        (s) => s.local_session_id === local.id,
      );
      if (position < 0) continue;
      const current = local.operation;
      current.solution!.trialId = reply.body.id;
      local.lastSolution = {
        versionId: solution.versionId,
        trialId: reply.body.id,
      };
      if (!current.taskId) {
        current.taskId = tasks[position].task_id;
        current.phase = "starting";
        local.messages.push({
          role: "user",
          text: String(solution.request.trial.brief),
        });
        local.lastTask = {
          task_id: current.taskId,
          status: "queued",
          execution_location: "desktop",
          budget_micros: links[position].budget_micros,
        };
      }
    }
    await this.persist();
    return reply.body;
  }
  async schedulingOwner(id: string) {
    const r = await this.withdrawalRecord(id);
    return {
      actorId: r.actorId,
      epoch: r.epoch,
      tenant: r.tenant,
      project: r.project,
      workspace: r.workspace,
      permission: r.revoked ? null : (r.grant?.mode ?? null),
      revoked: r.revoked,
      grantRevision: r.grant?.revision,
      expiresAt: r.grant?.expiresAt ?? 0,
    };
  }
  async schedulingContext(id: string) {
    const r = await this.record(id);
    await this.api(r, this.base(r) + "/runtime");
    if ((await this.record(id)) !== r)
      throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    return {
      ...(await this.schedulingOwner(id)),
      role: r.role,
      permission: r.revoked ? null : (r.grant?.mode ?? null),
      grantRevision: r.grant?.revision,
      revoked: r.revoked,
      busy: this.busy.has(id),
      pending: !!r.operation,
      uncertain: !!r.uncertain,
    };
  }
  async programOwner(id: string, online = false) {
    const owner = online
      ? await this.schedulingContext(id)
      : await this.schedulingOwner(id);
    const r = await this.withdrawalRecord(id);
    return { ...owner, programToolsVersion: r.programToolsVersion };
  }
  /** A durable caller id is committed with the native operation and its terminal
   * receipt. A queue crash between these two journals cannot create a second task. */
  async dispatch(
    id: string,
    dispatchId: string,
    prompt: string,
    budget: number,
    beforeNative?: () => Promise<void>,
  ): Promise<LocalDispatchReceipt> {
    if (
      !uuid.test(dispatchId) ||
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 30000 ||
      !Number.isSafeInteger(budget) ||
      budget < 10000 ||
      budget > 10000000000
    )
      throw new LocalAgentError("LOCAL_REQUEST_INVALID");
    const r = await this.record(id),
      digest = hash(JSON.stringify([prompt.trim(), budget]));
    r.dispatches ??= [];
    let receipt = r.dispatches.find((row) => row.id === dispatchId);
    if (receipt) {
      if (receipt.digest !== digest)
        throw new LocalAgentError("LOCAL_DISPATCH_CONFLICT");
      if (receipt.state !== "pending") return structuredClone(receipt);
      if (r.operation?.dispatchId !== dispatchId)
        throw new LocalAgentError("LOCAL_DISPATCH_RECONCILIATION_REQUIRED");
      if (this.busy.has(id)) return structuredClone(receipt);
      if (r.operation.phase !== "settling" && !r.operation.stopped)
        this.grant(r);
    } else {
      this.grant(r);
      if (
        this.busy.has(id) ||
        this.permissions.has(id) ||
        r.operation ||
        r.uncertain
      )
        throw new LocalAgentError("LOCAL_OPERATION_PENDING");
      if (r.dispatches.length >= 1000)
        throw new LocalAgentError("LOCAL_DISPATCH_LIMIT");
      receipt = { id: dispatchId, digest, state: "pending" };
      r.dispatches.push(receipt);
      r.operation = {
        dispatchId,
        createKey: randomUUID(),
        startKey: randomUUID(),
        finishKey: randomUUID(),
        cancelKey: randomUUID(),
        prompt: prompt.trim(),
        budget,
        phase: "accepting",
      };
      r.messages.push({ role: "user", text: prompt.trim() });
      r.error = undefined;
    }
    await this.persist();
    if (!this.busy.has(id)) await this.execute(r, beforeNative);
    return structuredClone(receipt);
  }
  private dispatchFinished(r: LocalRecord, op: Operation) {
    if (!op.dispatchId) return;
    const receipt = r.dispatches?.find((row) => row.id === op.dispatchId);
    if (!receipt)
      throw new LocalAgentError("LOCAL_DISPATCH_RECONCILIATION_REQUIRED");
    receipt.taskId = op.taskId;
    receipt.state =
      r.uncertain || r.lastTask?.status === "reconciling"
        ? "uncertain"
        : r.lastTask?.status === "succeeded"
          ? "succeeded"
          : r.lastTask?.status === "cancelled"
            ? "cancelled"
            : "failed";
  }
  private async execute(r: LocalRecord, beforeNative?: () => Promise<void>) {
    if (this.closed) throw new LocalAgentError("LOCAL_APP_CLOSED");
    if (this.busy.has(r.id))
      throw new LocalAgentError("LOCAL_OPERATION_PENDING");
    const op = r.operation!;
    this.busy.add(r.id);
    this.io.changed();
    const generation = this.generation,
      base = this.base(r),
      journal = await this.state();
    const fields = {
      device_id: journal.deviceId,
      local_session_id: r.id,
      workspace_hash: r.workspaceHash,
      runtime_version: this.io.runtime.version,
      runtime_sha256: this.io.runtime.sha256,
    };
    let runtime: LocalAgentRuntime | undefined,
      heartbeat: ReturnType<typeof setInterval> | undefined,
      heartbeatRun: Promise<unknown> | undefined;
    let admitted = false,
      nativeAccepted = false,
      stoppingHeartbeat = false;
    const abort = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const active: ActiveLocalOperation = {
      abort,
      done,
      children: new Set(),
      browsers: new Set(),
      programs: new Set(),
    };
    abort.signal.addEventListener(
      "abort",
      () => {
        for (const resource of [...active.browsers, ...active.programs])
          void resource.close().catch(() => {});
      },
      { once: true },
    );
    this.running.set(r.id, active);
    const assertOwner = async () => {
      const actor = await this.identity();
      this.grant(r);
      if (
        generation !== this.generation ||
        actor.actorId !== r.actorId ||
        actor.epoch !== r.epoch
      )
        throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
    };
    const stopHeartbeat = async () => {
      stoppingHeartbeat = true;
      if (heartbeat) clearInterval(heartbeat);
      await heartbeatRun;
    };
    const settleReport = async () => {
      await stopHeartbeat();
      const actor = await this.identity();
      if (
        generation !== this.generation ||
        actor.actorId !== r.actorId ||
        actor.epoch !== r.epoch
      )
        throw new LocalAgentError("LOCAL_ACCOUNT_CHANGED");
      // Reporting a terminal/unknown outcome is allowed after local permission
      // withdrawal; it never starts tools or another model request.
      r.lastTask = await this.api(
        r,
        base + "/" + op.taskId + "/finish",
        "POST",
        op.report,
        op.finishKey,
      );
      if (op.workflowRunId) {
        try {
          const { run } = await this.api(
            r,
            base + "/" + op.taskId + "/workflow-runs/" + op.workflowRunId,
          );
          if (
            run.id === op.workflowRunId &&
            run.execution_location === "desktop"
          ) {
            const previous =
              [...r.events]
                .reverse()
                .find(
                  (event) =>
                    event.kind === "local.workflow.progress" &&
                    event.value.run_id === run.id,
                )?.value ?? {};
            r.events.push({
              kind: "local.workflow.progress",
              value: {
                ...previous,
                run_id: run.id,
                workflow_id: run.workflow_id,
                version: run.version,
                revision: run.revision,
                cursor: run.cursor,
                steps: run.definition.steps.length,
                authorized: run.authorized,
                state: run.state,
                error_code: run.error_code,
              },
            });
          }
        } catch {
          /* Root receipt remains authoritative; content withdrawal may hide the run. */
        }
      }
      r.messages.push({
        role: "assistant",
        text: op.report!.output,
        status: r.lastTask.status,
      });
      r.uncertain ||=
        op.report!.status === "unknown" || r.lastTask.status === "reconciling";
      this.dispatchFinished(r, op);
      r.operation = undefined;
      if (!r.uncertain) r.error = undefined;
      await this.persist();
    };
    try {
      if (op.phase !== "settling" && !op.stopped) await assertOwner();
      if (!op.taskId) {
        if (op.solution) await this.admitSolution(r);
        else {
          const task = await this.api(
            r,
            base,
            "POST",
            {
              ...fields,
              title: op.prompt.slice(0, 100),
              prompt: op.prompt,
              role_key: r.role,
              ...(r.specialist ? { agent_id: r.specialist.id, agent_version: r.specialist.version } : {}),
              budget_micros: op.budget,
            },
            op.createKey,
          );
          op.taskId = task.task_id;
          r.lastTask = task;
          op.phase = "starting";
          await this.persist();
        }
      }
      const taskURL = base + "/" + op.taskId;
      if (op.phase !== "settling") {
        if (!op.stopped) await assertOwner();
        if (op.stopped || abort.signal.aborted) {
          r.lastTask = await this.api(
            r,
            taskURL + "/cancel",
            "POST",
            {},
            op.cancelKey,
          );
          if (["finished", "reconciling"].includes(r.lastTask.state)) {
            r.uncertain ||= r.lastTask.state === "reconciling";
            this.dispatchFinished(r, op);
            r.operation = undefined;
            await this.persist();
            return this.view(r);
          }
          // The server may already have accepted a start whose response was
          // lost. No native turn was accepted while the journal was starting.
          op.report = {
            status: "failed",
            output: "",
            thread_id: "unknown",
            turn_id: "unknown",
          };
          op.phase = "settling";
          await this.persist();
          await settleReport();
          return this.view(r);
        }
        const started = await this.api(
          r,
          taskURL + "/start",
          "POST",
          fields,
          op.startKey,
        );
        admitted = true;
        await assertOwner();
        if (
          started.runtime?.pinned_version !== this.io.runtime.version ||
          started.runtime?.windows_x64_sha256 !== this.io.runtime.sha256 ||
          started.inference_path !== "/v1/desktop-inference/v1" ||
          !Array.isArray(started.skills)
        )
          throw new LocalAgentError("LOCAL_RUNTIME_UPDATE_REQUIRED");
        r.lastTask = {
          ...started,
          credential: undefined,
          skills: undefined,
          prompt: undefined,
          company_tools: undefined,
        };
        const authorize = async () => {
          await assertOwner();
          const live = await this.api(r, taskURL + "/heartbeat", "POST", {});
          await assertOwner();
          if (
            live.cancel_requested ||
            live.state !== "running" ||
            live.status !== "running"
          )
            throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
          r.lastTask = live;
        };
        await beforeNative?.();
        await assertOwner();
        const profile: LocalCodexProfile = {
          executable: this.io.executable,
          version: this.io.runtime.version,
          executableSha256: this.io.runtime.sha256,
          companyOrigin: this.io.companyOrigin,
          baseURL: this.io.companyOrigin + started.inference_path,
          model: started.model,
          effort: started.effort,
        };
        const browser =
          r.browserToolsVersion === 1
            ? this.createBrowser(r, active, op.taskId!, r.id, authorize)
            : undefined;
        const programs =
          r.programToolsVersion === 1
            ? this.createPrograms(r, active, op.taskId!, r.id, authorize)
            : undefined;
        runtime = this.runtimeFactory(
          profile,
          {
            sessionId: r.id,
            actorId: r.actorId,
            tenantId: r.tenant,
            projectId: r.project,
            workspace: r.workspace,
            stateRoot: this.io.stateRoot,
            grant: { ...this.grant(r) },
            skills: started.skills,
            ...(r.companyToolsVersion === 1
              ? { companyTools: started.company_tools ?? [] }
              : {}),
            ...(browser ? { browserToolsVersion: 1 as const } : {}),
            ...(programs ? { programToolsVersion: 1 as const } : {}),
          },
          {
            authorize,
            approval: (kind, value) => this.io.approval(kind, value),
            ...(browser
              ? {
                  browserTool: (
                    call: Parameters<LocalBrowserSession["call"]>[0],
                    signal: AbortSignal,
                  ) =>
                    browser.call(call, AbortSignal.any([signal, abort.signal])),
                }
              : {}),
            ...(programs
              ? {
                  programTool: (
                    call: Parameters<LocalProgramSession["call"]>[0],
                    signal: AbortSignal,
                  ) =>
                    programs.call(
                      call,
                      AbortSignal.any([signal, abort.signal]),
                    ),
                }
              : {}),
            userInput: (request, signal) =>
              this.waitForInput(
                r,
                op,
                request,
                AbortSignal.any([signal, abort.signal]),
                authorize,
              ),
            companyTool: async (call, signal) => {
              await assertOwner();
              if (abort.signal.aborted || signal.aborted)
                throw new LocalCodexError("LOCAL_COMPANY_TOOL_INTERRUPTED");
              const response = await this.io.request(taskURL + "/tools", {
                method: "POST",
                tenantId: r.tenant,
                idempotencyKey: hash(op.taskId + ":" + call.callId),
                signal: AbortSignal.any([signal, abort.signal]),
                body: {
                  tool: call.tool,
                  arguments: call.arguments,
                  call_id: call.callId,
                  thread_id: call.threadId,
                  turn_id: call.turnId,
                },
              });
              await assertOwner();
              if (
                response.status === 400 &&
                response.body?.error?.code === "VALIDATION_ERROR"
              )
                throw new LocalCodexError("LOCAL_COMPANY_TOOL_INPUT_INVALID");
              if (
                response.status !== 200 ||
                !response.body ||
                !("output" in response.body)
              )
                throw new LocalCodexError("LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN");
              const output = response.body.output;
              if (call.tool !== "workflow_run") return output;
              if (r.role !== "workflow-consultant")
                throw new LocalCodexError("LOCAL_COMPANY_TOOL_SCOPE_INVALID");
              if (!uuid.test(output?.run?.id))
                throw new LocalCodexError("LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN");
              op.workflowRunId = output.run.id;
              await this.persist();
              const workflowSignal = AbortSignal.any([signal, abort.signal]);
              return executeLocalWorkflow(
                {
                  base: taskURL,
                  threadId: call.threadId,
                  turnId: call.turnId,
                  signal: workflowSignal,
                  authorize,
                  request: async (url, body, requestKey) => {
                    await assertOwner();
                    const reply = await this.io.request(url, {
                      method: "POST",
                      tenantId: r.tenant,
                      body,
                      idempotencyKey: requestKey,
                      signal: workflowSignal,
                    });
                    await assertOwner();
                    if (reply.status !== 200)
                      throw new LocalAgentError(
                        reply.body?.error?.code ??
                          "LOCAL_WORKFLOW_OUTCOME_UNKNOWN",
                      );
                    return reply.body;
                  },
                  read: async (url) => {
                    await assertOwner();
                    const reply = await this.io.request(url, {
                      tenantId: r.tenant,
                      signal: workflowSignal,
                    });
                    await assertOwner();
                    if (reply.status !== 200)
                      throw new LocalAgentError(
                        "LOCAL_WORKFLOW_APPROVAL_WITHDRAWN",
                      );
                    return reply.body;
                  },
                  ask: (request, inputSignal, confirm) =>
                    this.waitForInput(r, op, request, inputSignal, confirm),
                  child: (child, run) =>
                    this.executeWorkflowChild(
                      r,
                      op,
                      active,
                      child,
                      run.id,
                      run.cursor,
                      workflowSignal,
                      authorize,
                      assertOwner,
                    ),
                  event: async (value) => {
                    r.events.push({ kind: "local.workflow.progress", value });
                    if (r.events.length > 500) r.events.shift();
                    await this.persist();
                  },
                },
                output,
              );
            },
            event: async (kind, value) => {
              if (generation !== this.generation) return;
              r.events.push({ kind, value });
              if (r.events.length > 500) r.events.shift();
              this.io.changed();
            },
          },
        );
        active.runtime = runtime;
        if (op.stopped || abort.signal.aborted)
          throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
        await runtime.start({
          token: started.credential.token,
          expiresAt: new Date(started.credential.expires_at).getTime(),
        });
        heartbeat = setInterval(() => {
          if (heartbeatRun || stoppingHeartbeat) return;
          heartbeatRun = authorize()
            .catch(() => {
              abort.abort();
              void runtime?.close().catch(() => {});
            })
            .finally(() => {
              heartbeatRun = undefined;
              this.io.changed();
            });
        }, 10000);
        if (op.stopped || abort.signal.aborted)
          throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
        op.phase = "native_running";
        await this.persist();
        nativeAccepted = true;
        const result: LocalTurnResult = await runtime.turn(
          started.role_instructions +
            "\n\nCustomer request:\n" +
            started.prompt,
          abort.signal,
        );
        await stopHeartbeat();
        await runtime.close();
        await browser?.close();
        await programs?.close();
        if (programs) active.programs.delete(programs);
        op.report = {
          status: result.status,
          output: result.text.slice(0, 100000),
          thread_id: result.threadId,
          turn_id: result.turnId,
        };
        op.phase = "settling";
        await this.persist();
      }
      await settleReport();
      return this.view(r);
    } catch (error) {
      r.error =
        error instanceof LocalAgentError
          ? error.code
          : error instanceof Error
            ? error.message
            : "LOCAL_EXECUTION_FAILED";
      if (
        op.phase === "native_running" ||
        (admitted && op.phase === "starting")
      ) {
        r.uncertain ||= nativeAccepted;
        if (nativeAccepted) r.error = "LOCAL_EXECUTION_RECONCILIATION_REQUIRED";
        op.report = {
          status: nativeAccepted ? "unknown" : "failed",
          output: "",
          thread_id: "unknown",
          turn_id: "unknown",
        };
        op.phase = "settling";
        await this.persist();
        await runtime?.close().catch(() => {});
        await settleReport().catch(() => {});
      } else await this.persist();
      throw error;
    } finally {
      abort.abort();
      await stopHeartbeat();
      try {
        await Promise.all([
          runtime?.close(),
          ...[...active.children].map((child) => child.close()),
          ...[...active.browsers, ...active.programs].map((resource) =>
            resource.close(),
          ),
        ]);
        this.running.delete(r.id);
        this.busy.delete(r.id);
      } catch (error) {
        r.error = "LOCAL_PROCESS_SHUTDOWN_FAILED";
        r.uncertain = true;
        await this.persist();
        throw error;
      } finally {
        resolveDone();
        this.io.changed();
      }
    }
  }
  private createBrowser(
    r: LocalRecord,
    active: ActiveLocalOperation,
    taskId: string,
    sessionId: string,
    authorize: () => Promise<void>,
  ) {
    if (!this.io.browser)
      throw new LocalAgentError("LOCAL_BROWSER_UNAVAILABLE");
    const browser = this.io.browser(
      {
        actorId: r.actorId,
        epoch: r.epoch,
        tenantId: r.tenant,
        projectId: r.project,
        sessionId,
        taskId,
        workspace: r.workspace,
      },
      async () => {
        if (active.abort.signal.aborted || r.operation?.stopped)
          throw new BrowserToolError("BROWSER_INTERRUPTED", false);
        // Check local permission both before and after company authority awaits.
        if (this.grant(r).mode !== "full-access")
          throw new BrowserToolError("BROWSER_FULL_ACCESS_REQUIRED");
        await authorize();
        if (active.abort.signal.aborted || r.operation?.stopped)
          throw new BrowserToolError("BROWSER_INTERRUPTED", false);
        if (this.grant(r).mode !== "full-access")
          throw new BrowserToolError("BROWSER_FULL_ACCESS_REQUIRED");
      },
    );
    active.browsers.add(browser);
    return browser;
  }
  private createPrograms(
    r: LocalRecord,
    active: ActiveLocalOperation,
    taskId: string,
    sessionId: string,
    authorize: () => Promise<void>,
  ) {
    if (!this.io.program)
      throw new LocalAgentError("LOCAL_PROGRAM_UNAVAILABLE");
    const programs = this.io.program(
      {
        actorId: r.actorId,
        epoch: r.epoch,
        tenantId: r.tenant,
        projectId: r.project,
        sessionId,
        approvalSessionId: r.id,
        taskId,
        workspace: r.workspace,
      },
      async () => {
        if (active.abort.signal.aborted || r.operation?.stopped)
          throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
        if (this.grant(r).mode !== "full-access")
          throw new LocalProgramError("LOCAL_PROGRAM_FULL_ACCESS_REQUIRED");
        await authorize();
        if (active.abort.signal.aborted || r.operation?.stopped)
          throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
        if (this.grant(r).mode !== "full-access")
          throw new LocalProgramError("LOCAL_PROGRAM_FULL_ACCESS_REQUIRED");
      },
    );
    active.programs.add(programs);
    return programs;
  }
  private async executeWorkflowChild(
    r: LocalRecord,
    op: Operation,
    active: ActiveLocalOperation,
    child: NativeWorkflowChild,
    runId: string,
    cursor: number,
    signal: AbortSignal,
    authorizeParent: () => Promise<void>,
    assertOwner: () => Promise<void>,
  ) {
    const fields = child.fields,
      journal = await this.state();
    if (
      !uuid.test(child.task_id) ||
      !uuid.test(fields.local_session_id) ||
      fields.local_session_id === r.id ||
      fields.device_id !== journal.deviceId ||
      fields.workspace_hash !== r.workspaceHash ||
      fields.runtime_version !== this.io.runtime.version ||
      fields.runtime_sha256 !== this.io.runtime.sha256 ||
      op.workflow?.taskId === child.task_id
    )
      throw new LocalAgentError("LOCAL_WORKFLOW_REPLAY_FORBIDDEN");
    await assertOwner();
    await authorizeParent();
    if (signal.aborted) throw new LocalAgentError("LOCAL_WORKFLOW_INTERRUPTED");
    const checkpoint: NonNullable<Operation["workflow"]> = {
      runId,
      cursor,
      taskId: child.task_id,
      phase: "prepared",
    };
    op.workflow = checkpoint;
    await this.persist();
    const taskURL = this.base(r) + "/" + child.task_id;
    let runtime: LocalAgentRuntime | undefined,
      accepted = false,
      admitted = false;
    let browser: LocalBrowserSession | undefined;
    let programs: LocalProgramSession | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined,
      heartbeatRun: Promise<unknown> | undefined;
    let stoppingHeartbeat = false;
    const stopHeartbeat = async () => {
      stoppingHeartbeat = true;
      if (heartbeat) clearInterval(heartbeat);
      await heartbeatRun;
    };
    const authorize = async () => {
      await assertOwner();
      await authorizeParent();
      if (signal.aborted)
        throw new LocalAgentError("LOCAL_WORKFLOW_INTERRUPTED");
      const live = await this.api(r, taskURL + "/heartbeat", "POST", {});
      await assertOwner();
      if (
        signal.aborted ||
        live.cancel_requested ||
        live.state !== "running" ||
        live.status !== "running"
      )
        throw new LocalAgentError("LOCAL_EXECUTION_CANCELLED");
    };
    const shutdownChild = () => {
      void runtime
        ?.interrupt()
        .catch(() => {})
        .then(() => runtime?.close())
        .catch(() => {});
    };
    const finish = async () => {
      if (!checkpoint.report) return;
      const result = await this.api(
        r,
        taskURL + "/finish",
        "POST",
        checkpoint.report,
        hash("workflow-finish:" + child.task_id),
      );
      checkpoint.phase = "finished";
      await this.persist();
      if (result.status === "reconciling")
        throw new LocalAgentError("LOCAL_WORKFLOW_RECONCILIATION_REQUIRED");
    };
    try {
      const started = await this.api(
        r,
        taskURL + "/start",
        "POST",
        fields,
        hash("workflow-start:" + child.task_id),
      );
      admitted = true;
      await assertOwner();
      if (
        signal.aborted ||
        started.runtime?.pinned_version !== this.io.runtime.version ||
        started.runtime?.windows_x64_sha256 !== this.io.runtime.sha256 ||
        started.inference_path !== "/v1/desktop-inference/v1" ||
        !Array.isArray(started.skills)
      )
        throw new LocalAgentError("LOCAL_RUNTIME_UPDATE_REQUIRED");
      browser = this.io.browser
        ? this.createBrowser(
            r,
            active,
            child.task_id,
            fields.local_session_id,
            authorize,
          )
        : undefined;
      programs =
        r.programToolsVersion === 1
          ? this.createPrograms(
              r,
              active,
              child.task_id,
              fields.local_session_id,
              authorize,
            )
          : undefined;
      runtime = this.runtimeFactory(
        {
          executable: this.io.executable,
          version: this.io.runtime.version,
          executableSha256: this.io.runtime.sha256,
          companyOrigin: this.io.companyOrigin,
          baseURL: this.io.companyOrigin + started.inference_path,
          model: started.model,
          effort: started.effort,
        },
        {
          sessionId: fields.local_session_id,
          actorId: r.actorId,
          tenantId: r.tenant,
          projectId: r.project,
          workspace: r.workspace,
          stateRoot: this.io.stateRoot,
          grant: { ...this.grant(r) },
          skills: started.skills,
          companyTools: started.company_tools ?? [],
          ...(browser ? { browserToolsVersion: 1 as const } : {}),
          ...(programs ? { programToolsVersion: 1 as const } : {}),
        },
        {
          authorize,
          approval: (kind, value) => this.io.approval(kind, value),
          ...(browser
            ? {
                browserTool: (
                  call: Parameters<LocalBrowserSession["call"]>[0],
                  inputSignal: AbortSignal,
                ) =>
                  browser!.call(call, AbortSignal.any([inputSignal, signal])),
              }
            : {}),
          ...(programs
            ? {
                programTool: (
                  call: Parameters<LocalProgramSession["call"]>[0],
                  inputSignal: AbortSignal,
                ) =>
                  programs!.call(call, AbortSignal.any([inputSignal, signal])),
              }
            : {}),
          userInput: (request, inputSignal) =>
            this.waitForInput(
              r,
              op,
              request,
              AbortSignal.any([inputSignal, signal]),
              authorize,
            ),
          companyTool: async (call, inputSignal) => {
            await authorize();
            if (call.tool.startsWith("workflow_"))
              throw new LocalCodexError("LOCAL_COMPANY_TOOL_SCOPE_INVALID");
            const response = await this.io.request(taskURL + "/tools", {
              method: "POST",
              tenantId: r.tenant,
              idempotencyKey: hash(child.task_id + ":" + call.callId),
              signal: AbortSignal.any([signal, inputSignal]),
              body: {
                tool: call.tool,
                arguments: call.arguments,
                call_id: call.callId,
                thread_id: call.threadId,
                turn_id: call.turnId,
              },
            });
            await assertOwner();
            if (
              response.status === 400 &&
              response.body?.error?.code === "VALIDATION_ERROR"
            )
              throw new LocalCodexError("LOCAL_COMPANY_TOOL_INPUT_INVALID");
            if (
              signal.aborted ||
              inputSignal.aborted ||
              response.status !== 200 ||
              !("output" in (response.body ?? {}))
            )
              throw new LocalCodexError("LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN");
            return response.body.output;
          },
          event: async (kind, value) => {
            if (active.abort.signal.aborted) return;
            r.events.push({
              kind,
              value: {
                ...value,
                workflow_run_id: runId,
                workflow_cursor: cursor,
                workflow_task_id: child.task_id,
              },
            });
            if (r.events.length > 500) r.events.shift();
            this.io.changed();
          },
        },
      );
      active.children.add(runtime);
      signal.addEventListener("abort", shutdownChild, { once: true });
      if (signal.aborted)
        throw new LocalAgentError("LOCAL_WORKFLOW_INTERRUPTED");
      await runtime.start({
        token: started.credential.token,
        expiresAt: new Date(started.credential.expires_at).getTime(),
      });
      heartbeat = setInterval(() => {
        if (heartbeatRun || stoppingHeartbeat) return;
        heartbeatRun = authorize()
          .catch(() => {
            active.abort.abort();
            shutdownChild();
          })
          .finally(() => {
            heartbeatRun = undefined;
          });
      }, 10000);
      await authorize();
      checkpoint.phase = "native_running";
      await this.persist();
      accepted = true;
      const result = await runtime.turn(
        started.role_instructions +
          "\n\nCustomer workflow step:\n" +
          started.prompt,
        signal,
      );
      // A completed child must no longer authorize as a running execution.
      // Drain any in-flight check before its company receipt becomes terminal.
      await stopHeartbeat();
      checkpoint.report = {
        status: result.status,
        output: result.text.slice(0, 100000),
        thread_id: result.threadId,
        turn_id: result.turnId,
      };
      checkpoint.phase = "settling";
      await this.persist();
      await runtime.close();
      await browser?.close();
      if (browser) active.browsers.delete(browser);
      await programs?.close();
      if (programs) active.programs.delete(programs);
      await finish();
    } catch (error) {
      await stopHeartbeat();
      if (admitted && !checkpoint.report) {
        checkpoint.report = {
          status: accepted ? "unknown" : "failed",
          output: "",
          thread_id: "unknown",
          turn_id: "unknown",
        };
        checkpoint.phase = "settling";
        await this.persist();
        await runtime?.close().catch(() => {});
        await finish().catch(() => {});
      }
      throw error;
    } finally {
      await stopHeartbeat();
      signal.removeEventListener("abort", shutdownChild);
      await runtime?.close();
      if (runtime) active.children.delete(runtime);
      await browser?.close();
      if (browser) active.browsers.delete(browser);
      await programs?.close();
      if (programs) active.programs.delete(programs);
    }
  }
  async stop(id: string) {
    const r = await this.withdrawalRecord(id),
      active = this.running.get(id),
      op = r.operation;
    if (op) op.stopped = true;
    active?.abort.abort();
    // Interrupt immediately, independently of the company's network health.
    const localStop = (async () => {
      await Promise.all([
        active?.runtime?.interrupt().catch(() => {}),
        ...[...(active?.children ?? [])].map((child) =>
          child.interrupt().catch(() => {}),
        ),
      ]);
      if (active) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            active.done,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 3500);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (this.running.get(id) === active)
          await Promise.all([
            active.runtime?.close(),
            ...[...active.children].map((child) => child.close()),
          ]);
      }
    })();
    let remoteError: unknown, cancelled: any;
    try {
      await this.persist();
      if (op?.taskId)
        await this.api(
          r,
          this.base(r) + "/" + op.taskId + "/cancel",
          "POST",
          {},
          op.cancelKey,
        )
          .then((value) => {
            cancelled = value;
          })
          .catch((e) => {
            remoteError = e;
          });
    } finally {
      await localStop;
    }
    if (
      !active &&
      !remoteError &&
      r.operation === op &&
      op?.phase === "accepting" &&
      !op.taskId
    ) {
      // Recover only the original idempotent creation, then cancel it. A lost
      // create response must not require a renewed OS grant to release money.
      await this.execute(r);
    }
    if (
      !active &&
      !remoteError &&
      cancelled &&
      r.operation === op &&
      op &&
      ["accepting", "starting"].includes(op.phase)
    ) {
      r.lastTask = cancelled;
      if (["finished", "reconciling"].includes(cancelled.state)) {
        r.uncertain ||= cancelled.state === "reconciling";
        this.dispatchFinished(r, op);
        r.operation = undefined;
        await this.persist();
      } else {
        op.report = {
          status: "failed",
          output: "",
          thread_id: "unknown",
          turn_id: "unknown",
        };
        op.phase = "settling";
        await this.persist();
        // Receipt synchronization only; execute skips all native startup in
        // the settling phase, even if the local grant has since been revoked.
        await this.execute(r);
      }
    }
    if (remoteError) {
      r.error = "LOCAL_STOPPED_COMPANY_RECEIPT_PENDING";
      await this.persist();
    }
    return this.view(await this.withdrawalRecord(id));
  }
  async revoke(id: string) {
    const r = await this.withdrawalRecord(id);
    r.revoked = true;
    const active = this.running.get(id);
    active?.abort.abort();
    await Promise.all([
      this.persist(),
      active?.runtime?.revoke(),
      ...[...(active?.children ?? [])].map((child) => child.revoke()),
    ]);
    return this.view(await this.withdrawalRecord(id));
  }
  async invalidate() {
    ++this.generation;
    const journal = await this.state();
    for (const r of journal.sessions) r.revoked = true;
    const active = [...this.running.values()];
    for (const item of active) item.abort.abort();
    await Promise.all(
      active.flatMap((item) => [
        item.runtime?.revoke(),
        ...[...item.children].map((child) => child.revoke()),
      ]),
    );
    await this.persist();
  }
  async close() {
    this.closed = true;
    for (const item of this.running.values()) item.abort.abort();
    this.inputs.clear();
    await Promise.all(
      [...this.running.values()].flatMap((item) => [
        item.runtime?.close(),
        ...[...item.children].map((child) => child.close()),
      ]),
    );
    await this.writeTail;
  }
}
