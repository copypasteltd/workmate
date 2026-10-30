import { randomUUID } from "node:crypto";
import { LocalCodexStartupFailure } from "./local-codex.js";
import type { LocalAgentRuntime } from "./local-agent.js";

const protocol = "desktop-startup-recovery-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha256 = /^[a-f0-9]{64}$/;
export interface LocalStartupJournal {
  attempt: 1 | 2;
  fencingToken: string;
  contractSha256: string;
  deadlineAt: number;
  /** Persisted BEFORE calling start. An unknown launch is never repeated. */
  launchAttempt?: 1 | 2;
  turnKey?: string;
  recovery?: {
    key: string;
    state: "pending" | "ready";
    body: Record<string, unknown>;
  };
}
export class LocalStartupError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export class LocalStartupRecoveryPending extends LocalStartupError {
  constructor() { super("LOCAL_STARTUP_RECOVERY_PENDING"); }
}
interface StartupHooks {
  checkpoint: { startup?: LocalStartupJournal };
  taskId: string;
  fields: Record<string, unknown>;
  request(path: string, body: unknown, key: string): Promise<{ status: number; body: any }>;
  persist(): Promise<void>;
  assertOwner(): Promise<void>;
  authorize(): Promise<void>;
  stopHeartbeat(): Promise<void>;
  startHeartbeat(): void;
  signal: AbortSignal;
  event(value: { startup_attempt: number; max_attempts: number; status: "recovering" | "ready" }): Promise<void>;
}
export interface LocalStartupRuntime {
  runtime: LocalAgentRuntime;
  closeResources(): Promise<void>;
}

/** Trusted main-process journal + original company execution, shared by roots
 * and workflow children. No scoped inference credential is written to disk. */
export class LocalStartupCoordinator {
  constructor(private readonly hooks: StartupHooks) {}

  private async active() {
    await this.hooks.assertOwner();
    if (this.hooks.signal.aborted)
      throw new LocalStartupError("LOCAL_EXECUTION_CANCELLED");
  }
  private accept(receipt: any, recovering: boolean) {
    const state = receipt?.startup, saved = this.hooks.checkpoint.startup;
    if (receipt?.task_id !== this.hooks.taskId || receipt?.state !== "running"
      || receipt?.status !== "running" || receipt?.cancel_requested
      || state?.protocol !== protocol || state?.max_attempts !== 2 || state?.state !== "preparing"
      || ![1, 2].includes(state?.attempt) || !uuid.test(state?.fencing_token ?? "")
      || !sha256.test(state?.contract_sha256 ?? "")
      || !Number.isFinite(new Date(state?.deadline_at).getTime())
      || new Date(state.deadline_at).getTime() <= Date.now()
      || typeof receipt?.credential?.token !== "string"
      || new Date(receipt.credential.expires_at).getTime() !== new Date(state.deadline_at).getTime())
      throw new LocalStartupError("LOCAL_STARTUP_ADMISSION_INVALID");
    if (!saved && state.attempt !== 1)
      throw new LocalStartupError("LOCAL_STARTUP_OWNER_REVIEW_REQUIRED");
    if (saved && (saved.contractSha256 !== state.contract_sha256
      || saved.deadlineAt !== new Date(state.deadline_at).getTime()
      || (recovering ? state.attempt !== 2 || saved.recovery?.state !== "pending"
        : state.attempt !== saved.attempt || state.fencing_token !== saved.fencingToken)))
      throw new LocalStartupError("LOCAL_STARTUP_ADMISSION_INVALID");
    const next: LocalStartupJournal = {
      ...saved,
      attempt: state.attempt,
      fencingToken: state.fencing_token,
      contractSha256: state.contract_sha256,
      deadlineAt: new Date(state.deadline_at).getTime(),
    };
    if (recovering) {
      if (state.fencing_token === saved!.fencingToken)
        throw new LocalStartupError("LOCAL_STARTUP_ADMISSION_INVALID");
      next.recovery = { ...saved!.recovery!, state: "ready" };
    }
    this.hooks.checkpoint.startup = next;
    return receipt;
  }

  private async response(path: string, body: unknown, key: string, recovering = false): Promise<any> {
    // At most one network repeat, using the SAME durable request identity.
    // It does not allocate another launch or extend the execution deadline.
    for (let networkAttempt = 0; networkAttempt < (recovering ? 2 : 1); networkAttempt++) {
      await this.active();
      let result: { status: number; body: any };
      try { result = await this.hooks.request(path, body, key); }
      catch {
        await this.active();
        if (recovering && networkAttempt === 0) continue;
        if (recovering) throw new LocalStartupRecoveryPending();
        throw new LocalStartupError("LOCAL_COMPANY_API_UNAVAILABLE");
      }
      if (result.status >= 200 && result.status < 300) return result.body;
      if (recovering && result.status >= 500) {
        if (networkAttempt === 0) continue;
        throw new LocalStartupRecoveryPending();
      }
      throw new LocalStartupError(result.body?.error?.code ?? "LOCAL_COMPANY_API_UNAVAILABLE");
    }
    throw new LocalStartupRecoveryPending();
  }

  async admission(startKey: string) {
    await this.active();
    const saved = this.hooks.checkpoint.startup;
    if (saved?.launchAttempt !== undefined)
      throw new LocalStartupError("LOCAL_STARTUP_OWNER_REVIEW_REQUIRED");
    const recovering = saved?.recovery?.state === "pending";
    const receipt = recovering
      ? await this.response("/startup-recovery", saved!.recovery!.body, saved!.recovery!.key, true)
      : await this.response("/start", { ...this.hooks.fields, startup_protocol: protocol }, startKey);
    await this.active();
    this.accept(receipt, recovering);
    await this.hooks.persist();
    return receipt;
  }

  async start(
    receipt: any,
    factory: (receipt: any) => LocalStartupRuntime,
  ): Promise<LocalStartupRuntime & { receipt: any }> {
    let current = receipt;
    for (;;) {
      await this.active();
      await this.hooks.authorize();
      let saved = this.hooks.checkpoint.startup!;
      if (saved.launchAttempt !== undefined || saved.deadlineAt <= Date.now())
        throw new LocalStartupError("LOCAL_STARTUP_OWNER_REVIEW_REQUIRED");
      saved.launchAttempt = saved.attempt;
      await this.hooks.persist();
      await this.active();
      const owned = factory(current);
      try {
        await owned.runtime.start({
          token: current.credential.token,
          expiresAt: new Date(current.credential.expires_at).getTime(),
        });
        await this.active();
        return { ...owned, receipt: current };
      } catch (error) {
        // A failure of either cleanup keeps the launch consumed and forbids
        // requesting new authority, even when the original error was transient.
        await owned.runtime.close();
        await owned.closeResources();
        await this.active();
        if (!(error instanceof LocalCodexStartupFailure) || saved.attempt !== 1)
          throw error;
        await this.hooks.stopHeartbeat();
        await this.hooks.authorize();
        await this.active();
        if (saved.deadlineAt <= Date.now()) throw error;
        saved.launchAttempt = undefined;
        saved.recovery = {
          key: randomUUID(), state: "pending",
          body: {
            ...this.hooks.fields,
            startup_fencing_token: saved.fencingToken,
            contract_sha256: saved.contractSha256,
            expected_attempt: 1,
            stage: error.stage,
          },
        };
        await this.hooks.persist();
        await this.hooks.event({ startup_attempt: 2, max_attempts: 2, status: "recovering" });
        const recovered = await this.response("/startup-recovery", saved.recovery.body, saved.recovery.key, true);
        await this.active();
        current = this.accept(recovered, true);
        await this.hooks.persist();
        await this.hooks.event({ startup_attempt: 2, max_attempts: 2, status: "ready" });
        this.hooks.startHeartbeat();
      }
    }
  }

  async admitTurn() {
    await this.active();
    const saved = this.hooks.checkpoint.startup;
    if (!saved || saved.launchAttempt !== saved.attempt || saved.recovery?.state === "pending")
      throw new LocalStartupError("LOCAL_STARTUP_ADMISSION_INVALID");
    saved.turnKey ??= randomUUID();
    await this.hooks.persist();
    const result = await this.response("/turn-admission", {
      ...this.hooks.fields,
      startup_fencing_token: saved.fencingToken,
      contract_sha256: saved.contractSha256,
    }, saved.turnKey);
    if (result?.admitted !== true || result?.task_id !== this.hooks.taskId
      || result?.startup_fencing_token !== saved.fencingToken)
      throw new LocalStartupError("LOCAL_STARTUP_ADMISSION_INVALID");
    await this.active();
  }
}
