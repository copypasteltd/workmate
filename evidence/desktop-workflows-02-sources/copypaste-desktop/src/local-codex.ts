import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, open, unlink } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { createReadStream } from "node:fs";
import path from "node:path";
import { atomicFile } from "./files.js";
import { parseLocalInput, parseLocalAnswers, type LocalInputRequest, type LocalInputAnswers } from "./local-input.js";

export type LocalPermissionMode = "read-only" | "workspace-write" | "full-access";
export interface LocalPermissionGrant {
  id: string;
  actorId: string;
  mode: LocalPermissionMode;
  revision: number;
  expiresAt: number;
}
export interface LocalCodexProfile {
  executable: string;
  version: string;
  executableSha256: string;
  companyOrigin: string;
  baseURL: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}
export interface LocalSessionBinding {
  sessionId: string;
  actorId: string;
  tenantId: string;
  projectId: string;
  workspace: string;
  stateRoot: string;
  grant: LocalPermissionGrant;
  skills: { key: string; content: string; sha256: string }[];
  companyTools?: LocalCompanyTool[];
}
export interface LocalCompanyTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface LocalCompanyToolCall { namespace: "copypaste"; tool: string; arguments: Record<string, unknown>; callId: string; threadId: string; turnId: string }
export interface LocalCodexHooks {
  /** Main-process authority, not renderer input. Rechecked at every new turn. */
  authorize: () => Promise<void>;
  event: (kind: string, value: Record<string, unknown>) => Promise<void>;
  approval?: (kind: "command" | "file", value: Record<string, unknown>) => Promise<"accept" | "decline">;
  companyTool?: (call: LocalCompanyToolCall, signal: AbortSignal) => Promise<unknown>;
  userInput?: (request: LocalInputRequest, signal: AbortSignal) => Promise<LocalInputAnswers>;
}
export interface LocalTurnResult {
  threadId: string;
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  text: string;
  /** Native observations only. Financial settlement must use company receipts. */
  nativeTokenUsage: { input: number; output: number } | null;
}
interface Checkpoint {
  schema: 2;
  binding: string;
  threadId: string;
  phase: "ready" | "running" | "uncertain" | "revoked";
  hasTurns: boolean;
  grantRevision: number;
  grantId: string;
  permissionMode: LocalPermissionMode;
}
interface ActiveTurn {
  id: string;
  text: string;
  resolve: (result: LocalTurnResult) => void;
  reject: (error: LocalCodexError) => void;
  timer: ReturnType<typeof setTimeout>;
}
const exec = promisify(execFile);
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const modes = new Set<LocalPermissionMode>(["read-only", "workspace-write", "full-access"]);
const approvalMethods = new Map([
  ["item/commandExecution/requestApproval", "command"],
  ["item/fileChange/requestApproval", "file"],
] as const);

export class LocalCodexError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function localPermissionPolicy(mode: LocalPermissionMode) {
  if (!modes.has(mode)) throw new LocalCodexError("LOCAL_PERMISSION_INVALID");
  return mode === "full-access"
    ? { sandbox: "danger-full-access", approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } }
    : mode === "workspace-write"
      ? { sandbox: "workspace-write", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", networkAccess: false } }
      : { sandbox: "read-only", approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } };
}

/** Desktop-owned native process. Does not submit work to the cloud task queue. */
export class LocalCodexSession {
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private hasExited = false;
  private closing?: Promise<void>;
  private lock?: string;
  private home = "";
  private receiptFile = "";
  private bindingHash = "";
  private threadId = "";
  private hasTurns = false;
  private checkpoint?: Checkpoint;
  private grant: LocalPermissionGrant;
  private active?: ActiveTurn;
  private operation = false;
  private closed = false;
  private revoked = false;
  private sequence = 0;
  private pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (error: LocalCodexError) => void; timer: ReturnType<typeof setTimeout> }>();
  private eventTail: Promise<void> = Promise.resolve();
  private inputRequests = new Map<string, { itemId: string; abort: AbortController }>();
  private seenInputRequests = new Set<string>();
  private expiry?: ReturnType<typeof setTimeout>;
  private nativeUsage: { input: number; output: number } | null = null;
  private credential = "";
  private credentialExpiresAt = 0;
  private shutdown = new AbortController();

  constructor(private profile: LocalCodexProfile, private binding: LocalSessionBinding, private hooks: LocalCodexHooks) {
    // Callers must derive the profile/binding from trusted main-process state.
    this.profile = structuredClone(profile);
    this.binding = structuredClone(binding);
    this.grant = { ...binding.grant };
  }

  private validateGrant(grant = this.grant) {
    if (!uuid.test(grant.id) || grant.actorId !== this.binding.actorId || !modes.has(grant.mode)
      || !Number.isSafeInteger(grant.revision) || grant.revision < 1
      || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= Date.now())
      throw new LocalCodexError("LOCAL_PERMISSION_REQUIRED");
  }

  private common() {
    const policy = localPermissionPolicy(this.grant.mode);
    return { model: this.profile.model, modelProvider: "copypaste_internal", cwd: this.binding.workspace,
      approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, environments: [],
      developerInstructions: "You are the customer's local CopyPaste Codex Agent. Use the selected Skills and local tools to deliver real files and verifiable results. Follow the locally granted permission mode. All product AI uses the company provider. Never launch Docker, WSL or virtual machines. Close only task-owned browser pages when no longer needed. Report what actually completed." };
  }

  private async save(phase: Checkpoint["phase"]) {
    this.checkpoint = { schema: 2, binding: this.bindingHash, threadId: this.threadId, phase, hasTurns: this.hasTurns,
      grantRevision: this.grant.revision, grantId: this.grant.id, permissionMode: this.grant.mode };
    await atomicFile(this.receiptFile, Buffer.from(JSON.stringify(this.checkpoint)));
  }

  private async releaseLock() {
    const file = this.lock;
    this.lock = undefined;
    if (file) await unlink(file).catch((error: any) => { if (error.code !== "ENOENT") throw error; });
  }

  private async takeLock(folder: string) {
    const file = path.join(folder, "process.lock");
    try {
      const handle = await open(file, "wx", 0o600);
      this.lock = file;
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() })); }
      finally { await handle.close(); }
    } catch (error: any) {
      if (error.code === "EEXIST") throw new LocalCodexError("LOCAL_SESSION_ALREADY_OWNED");
      throw error;
    }
    // A crash lock is deliberately not removed just because it is old. A future
    // recovery action must establish that its process is gone and reconcile any
    // running checkpoint before allowing new execution.
  }

  private async emit(kind: string, value: Record<string, unknown>) {
    // Do not forward raw stderr, configuration, reasoning, or credentials.
    const sanitized = JSON.parse(JSON.stringify(value).split(this.credential || "\u0000").join("[redacted]"));
    await this.hooks.event(kind, sanitized);
  }

  private async verifyProfile() {
    const p = this.profile;
    if (!path.isAbsolute(p.executable) || !/^[a-f0-9]{64}$/.test(p.executableSha256)
      || !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(p.version)
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(p.model)
      || !["low", "medium", "high", "xhigh", "max"].includes(p.effort))
      throw new LocalCodexError("LOCAL_PROFILE_INVALID");
    const base = new URL(p.baseURL), origin = new URL(p.companyOrigin);
    if (origin.origin !== p.companyOrigin || base.origin !== origin.origin || base.username || base.password || base.hash || base.search
      || !(base.pathname === "/v1" || base.pathname.startsWith("/v1/")) || /%2f|%5c|\\/i.test(p.baseURL)
      || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))))
      throw new LocalCodexError("LOCAL_GATEWAY_INVALID");
    const executableHash = createHash("sha256");
    for await (const chunk of createReadStream(p.executable)) executableHash.update(chunk);
    if (executableHash.digest("hex") !== p.executableSha256) throw new LocalCodexError("LOCAL_CODEX_HASH_MISMATCH");
    const { stdout } = await exec(p.executable, ["--version"], { timeout: 10000, windowsHide: true });
    if (stdout.trim() !== "codex-cli " + p.version) throw new LocalCodexError("LOCAL_CODEX_VERSION_MISMATCH");
  }

  async start(credential: { token: string; expiresAt: number }) {
    if (this.operation || this.child || this.closed) throw new LocalCodexError("LOCAL_SESSION_STATE_INVALID");
    this.operation = true;
    try {
      for (const id of [this.binding.sessionId, this.binding.actorId, this.binding.tenantId, this.binding.projectId])
        if (!uuid.test(id)) throw new LocalCodexError("LOCAL_BINDING_INVALID");
      this.validateGrant();
      if (!/^[\w.-]{20,4096}$/.test(credential.token) || !Number.isSafeInteger(credential.expiresAt) || credential.expiresAt <= Date.now())
        throw new LocalCodexError("LOCAL_INFERENCE_CREDENTIAL_REQUIRED");
      if (!path.isAbsolute(this.binding.workspace) || !path.isAbsolute(this.binding.stateRoot)) throw new LocalCodexError("LOCAL_BINDING_INVALID");
      await this.hooks.authorize();
      await this.verifyProfile();
      this.binding.workspace = await realpath(this.binding.workspace);
      const folder = path.join(this.binding.stateRoot, "local-codex", this.binding.sessionId);
      await mkdir(folder, { recursive: true });
      await this.takeLock(folder);
      this.home = path.join(folder, "home");
      this.receiptFile = path.join(folder, "checkpoint.json");
      await mkdir(this.home, { recursive: true });
      const skills = [];
      if (this.binding.skills.length > 32 || new Set(this.binding.skills.map((skill) => skill.key)).size !== this.binding.skills.length)
        throw new LocalCodexError("LOCAL_SKILL_INVALID");
      for (const skill of this.binding.skills) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(skill.key) || Buffer.byteLength(skill.content) > 512000 || hash(skill.content) !== skill.sha256)
          throw new LocalCodexError("LOCAL_SKILL_INVALID");
        skills.push({ key: skill.key, sha256: skill.sha256 });
      }
      const companyTools = this.binding.companyTools ?? [];
      if (companyTools.length > 16 || new Set(companyTools.map(tool => tool.name)).size !== companyTools.length
        || companyTools.some(tool => !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || typeof tool.description !== "string"
          || tool.description.length > 8000 || !tool.inputSchema || tool.inputSchema.type !== "object")
        || Buffer.byteLength(JSON.stringify(companyTools)) > 512000 || (companyTools.length && !this.hooks.companyTool))
        throw new LocalCodexError("LOCAL_COMPANY_TOOLS_INVALID");
      this.bindingHash = hash(JSON.stringify({ session: this.binding.sessionId, actor: this.binding.actorId, tenant: this.binding.tenantId,
        project: this.binding.projectId, cwd: this.binding.workspace, version: this.profile.version,
        binary: this.profile.executableSha256, endpoint: this.profile.baseURL, model: this.profile.model, effort: this.profile.effort, skills,
        ...(companyTools.length ? { companyTools } : {}) }));
      try {
        const checkpoint: Checkpoint = JSON.parse(await readFile(this.receiptFile, "utf8"));
        if (checkpoint?.schema !== 2 || checkpoint.binding !== this.bindingHash) throw new LocalCodexError("LOCAL_CHECKPOINT_BINDING_MISMATCH");
        if (checkpoint.phase !== "ready") throw new LocalCodexError("LOCAL_CHECKPOINT_RECONCILIATION_REQUIRED");
        if (!checkpoint.threadId || typeof checkpoint.threadId !== "string" || typeof checkpoint.hasTurns !== "boolean"
          || !Number.isSafeInteger(checkpoint.grantRevision) || checkpoint.grantRevision < 1 || !uuid.test(checkpoint.grantId) || !modes.has(checkpoint.permissionMode))
          throw new LocalCodexError("LOCAL_CHECKPOINT_INVALID");
        if (this.grant.revision < checkpoint.grantRevision || (this.grant.revision === checkpoint.grantRevision
          && (this.grant.id !== checkpoint.grantId || this.grant.mode !== checkpoint.permissionMode)))
          throw new LocalCodexError("LOCAL_PERMISSION_VERSION_CONFLICT");
        this.checkpoint = checkpoint;
        this.hasTurns = checkpoint.hasTurns;
        // Codex does not persist an empty thread rollout. Reallocate only a
        // never-used thread; running/uncertain checkpoints were rejected above.
        this.threadId = checkpoint.hasTurns ? checkpoint.threadId : "";
      } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      // Validate ownership and pinned content before touching an existing home.
      // A rejected account/project must not replace another session's Skills.
      for (const skill of this.binding.skills) {
        const file = path.join(this.home, "skills", skill.key, "SKILL.md");
        await atomicFile(file, Buffer.from(skill.content));
      }
      this.credential = credential.token;
      this.credentialExpiresAt = credential.expiresAt;
      const policy = localPermissionPolicy(this.grant.mode), quote = JSON.stringify;
      const config = [
        `model = ${quote(this.profile.model)}`, 'model_provider = "copypaste_internal"',
        `model_reasoning_effort = ${quote(this.profile.effort)}`, `approval_policy = ${quote(policy.approvalPolicy)}`,
        `sandbox_mode = ${quote(policy.sandbox)}`, 'web_search = "disabled"',
        '[model_providers.copypaste_internal]', 'name = "CopyPaste Internal Gateway"',
        `base_url = ${quote(this.profile.baseURL)}`, 'env_key = "COPYPASTE_LOCAL_INFERENCE_TOKEN"', 'wire_api = "responses"',
        'request_max_retries = 0', 'stream_max_retries = 0', 'supports_websockets = false',
        '[shell_environment_policy]', 'inherit = "all"', 'ignore_default_excludes = false',
        'exclude = ["COPYPASTE_LOCAL_INFERENCE_TOKEN"]',
        '[features]', 'shell_tool = true', 'multi_agent = false', 'apps = false', 'plugins = false', 'remote_plugin = false',
        'image_generation = false', 'skill_mcp_dependency_install = false', 'prefer_mxc = false',
        '[analytics]', 'enabled = false',
        '[windows]', 'sandbox = "unelevated"',
      ].join("\n");
      await atomicFile(path.join(this.home, "config.toml"), Buffer.from(config));
      const env: NodeJS.ProcessEnv = {};
      for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ProgramFiles", "ProgramFiles(x86)"])
        if (process.env[name]) env[name] = process.env[name];
      env.CODEX_HOME = this.home;
      env.COPYPASTE_LOCAL_INFERENCE_TOKEN = credential.token;
      // Command-line values override project-local Codex provider/permission settings.
      const overrides = [
        ['model_provider', '"copypaste_internal"'], ['model', quote(this.profile.model)],
        ['model_reasoning_effort', quote(this.profile.effort)],
        ['model_providers.copypaste_internal.base_url', quote(this.profile.baseURL)],
        ['model_providers.copypaste_internal.env_key', '"COPYPASTE_LOCAL_INFERENCE_TOKEN"'],
        ['model_providers.copypaste_internal.wire_api', '"responses"'],
        ['model_providers.copypaste_internal.requires_openai_auth', 'false'],
        ['sandbox_mode', quote(policy.sandbox)], ['approval_policy', quote(policy.approvalPolicy)],
        ['features.shell_tool', 'true'], ['features.apps', 'false'], ['features.plugins', 'false'], ['features.remote_plugin', 'false'],
        ['web_search', '"disabled"'], ['features.image_generation', 'false'], ['features.multi_agent', 'false'], ['features.skill_mcp_dependency_install', 'false'],
        ['features.prefer_mxc', 'false'], ['windows.sandbox', '"unelevated"'],
        ['features.default_mode_request_user_input', 'true'],
        ['shell_environment_policy.exclude', '["COPYPASTE_LOCAL_INFERENCE_TOKEN"]'],
      ].flatMap(([key, value]) => ["-c", `${key}=${value}`]);
      this.validateGrant();
      if (this.credentialExpiresAt <= Date.now()) throw new LocalCodexError("LOCAL_INFERENCE_CREDENTIAL_REQUIRED");
      const child = this.child = spawn(this.profile.executable, ["app-server", "--stdio", "--strict-config", ...overrides],
        { cwd: this.binding.workspace, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.exited = new Promise<void>((resolve) => {
        child.once("close", () => {
          this.hasExited = true;
          void this.eventTail.finally(() => this.fail(new LocalCodexError("LOCAL_CODEX_EXITED")));
          resolve();
        });
      });
      child.once("error", () => this.fail(new LocalCodexError("LOCAL_CODEX_START_FAILED")));
      child.stdin.on("error", () => this.fail(new LocalCodexError("LOCAL_CODEX_DISCONNECTED")));
      child.stderr.resume();
      const decoder = new StringDecoder("utf8");
      let buffered = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffered += decoder.write(chunk);
        if (Buffer.byteLength(buffered) > 8 * 1024 * 1024) {
          this.fail(new LocalCodexError("LOCAL_CODEX_FRAME_LIMIT")); this.stopInBackground(); return;
        }
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (!line.trim()) continue;
          try { this.message(JSON.parse(line)); }
          catch { this.fail(new LocalCodexError("LOCAL_CODEX_PROTOCOL_INVALID")); this.stopInBackground(); }
        }
      });
      await this.rpc("initialize", { clientInfo: { name: "copypaste_desktop", title: "CopyPaste Desktop", version: "0.5.0" }, capabilities: { experimentalApi: true } });
      this.notify("initialized", {});
      const thread = await this.rpc(this.threadId ? "thread/resume" : "thread/start", {
        ...this.common(), ...(this.threadId ? { threadId: this.threadId, excludeTurns: true } : { allowProviderModelFallback: false,
          ...(companyTools.length ? { dynamicTools: [{ type: "namespace", name: "copypaste", description: "Company project artifacts, approved design and Image 2 tools. These operations use company permissions and the original task budget.",
            tools: companyTools.map(tool => ({ type: "function", ...tool })) }] } : {}) }),
      });
      this.checkThread(thread);
      this.threadId = thread.thread.id;
      await this.save("ready");
      await this.emit("local.runtime.ready", { pid: child.pid, version: this.profile.version, executable_sha256: this.profile.executableSha256,
        thread_id: this.threadId, permission_mode: this.grant.mode, grant_revision: this.grant.revision });
      this.armExpiry();
    } catch (error) {
      await this.close();
      throw error;
    } finally { this.operation = false; }
  }

  private checkThread(result: any) {
    const policy = localPermissionPolicy(this.grant.mode);
    if (!result?.thread?.id || typeof result.thread.id !== "string" || (this.threadId && result.thread.id !== this.threadId)
      || result.model !== this.profile.model || result.modelProvider !== "copypaste_internal"
      || result.sandbox?.type !== policy.sandboxPolicy.type || result.approvalPolicy !== policy.approvalPolicy)
      throw new LocalCodexError("LOCAL_CODEX_PROFILE_MISMATCH");
  }

  private armExpiry() {
    if (this.expiry) clearTimeout(this.expiry);
    const remaining = Math.min(this.credentialExpiresAt, this.grant.expiresAt) - Date.now();
    // An inference credential ending does not withdraw the customer's local
    // permission grant. Clean idle threads may resume with a fresh credential;
    // running/uncertain checkpoints still require explicit reconciliation.
    if (remaining <= 0) { this.revoked = this.grant.expiresAt <= Date.now(); this.stopInBackground(); return; }
    this.expiry = setTimeout(() => this.armExpiry(), Math.min(remaining, 2147483647));
  }

  private notify(method: string, params: unknown) {
    if (!this.child || this.hasExited || this.child.stdin.destroyed) throw new LocalCodexError("LOCAL_CODEX_DISCONNECTED");
    this.child.stdin.write(JSON.stringify({ method, params }) + "\n");
  }

  private rpc(method: string, params: unknown, timeout = 30000): Promise<any> {
    if (!this.child || this.hasExited || this.child.stdin.destroyed) return Promise.reject(new LocalCodexError("LOCAL_CODEX_DISCONNECTED"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new LocalCodexError("LOCAL_CODEX_RPC_TIMEOUT")); }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, method, params }) + "\n", (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new LocalCodexError("LOCAL_CODEX_DISCONNECTED")); }
      });
    });
  }

  private fail(error: LocalCodexError) {
    this.cancelInputs();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = undefined; }
  }

  private stopInBackground() {
    void this.close().catch(() => { void this.hooks.event("local.runtime.stop_failed", { code: "LOCAL_PROCESS_SHUTDOWN_FAILED" }).catch(() => {}); });
  }

  private setTurnId(id: string) { if (this.active) this.active.id = id; }
  private async markUncertain() { if (this.checkpoint?.phase === "running") await this.save("uncertain"); }

  private cancelInputs() {
    for (const pending of this.inputRequests.values()) pending.abort.abort();
    this.inputRequests.clear();
  }

  private async requestInput(message: any) {
    const request = parseLocalInput(message.params), turn = this.active;
    const key = typeof message.id + ":" + message.id;
    if (!this.hooks.userInput || this.closed || this.revoked || !turn || request.threadId !== this.threadId || request.turnId !== turn.id
      || !["string", "number"].includes(typeof message.id) || String(message.id).length > 160
      || this.inputRequests.size >= 4 || this.seenInputRequests.size >= 64 || this.seenInputRequests.has(key)
      || [...this.inputRequests.values()].some(pending => pending.itemId === request.itemId))
      throw new LocalCodexError("LOCAL_INPUT_SCOPE_INVALID");
    this.validateGrant(); await this.hooks.authorize();
    if (this.active !== turn || this.closed || this.revoked || this.shutdown.signal.aborted) throw new LocalCodexError("LOCAL_INPUT_CANCELLED");
    const abort = new AbortController();
    this.inputRequests.set(key, { itemId: request.itemId, abort }); this.seenInputRequests.add(key);
    // Human waiting must never occupy eventTail: terminal events, interrupt and
    // process shutdown must remain observable while a question is displayed.
    void (async () => {
      try {
        const answers = await new Promise<LocalInputAnswers>((resolve, reject) => {
          const cancelled = () => reject(new LocalCodexError("LOCAL_INPUT_CANCELLED"));
          abort.signal.addEventListener("abort", cancelled, { once: true });
          void this.hooks.userInput!(request, abort.signal).then(resolve, reject)
            .finally(() => abort.signal.removeEventListener("abort", cancelled));
          if (abort.signal.aborted) cancelled();
        });
        const validated = parseLocalAnswers(request, answers);
        this.validateGrant(); await this.hooks.authorize();
        if (abort.signal.aborted || this.closed || this.revoked || this.active !== turn || !this.child || this.hasExited || this.child.stdin.destroyed)
          throw new LocalCodexError("LOCAL_INPUT_CANCELLED");
        this.child.stdin.write(JSON.stringify({ id: message.id, result: { answers: validated } }) + "\n");
      } catch (error) {
        if (!abort.signal.aborted && !this.closed && this.active === turn) {
          this.fail(new LocalCodexError("LOCAL_INPUT_RESPONSE_FAILED")); this.stopInBackground();
        }
      } finally { abort.abort(); this.inputRequests.delete(key); }
    })();
  }

  private message(message: any) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) this.eventTail = this.eventTail.then(() => this.emit("local.runtime.rpc_rejected", {
          method: pending.method, native_code: message.error.code,
          detail: typeof message.error.message === "string" ? message.error.message.slice(0, 1000) : "Native request rejected",
        })).catch(() => {});
        message.error ? pending.reject(new LocalCodexError("LOCAL_CODEX_RPC_REJECTED")) : pending.resolve(message.result); }
      return;
    }
    this.eventTail = this.eventTail.then(async () => {
      if (message.id !== undefined && message.method) {
        if (message.method === "item/tool/requestUserInput") { await this.requestInput(message); return; }
        if (message.method === "item/tool/call") {
          const call = message.params;
          let result: { success: boolean; contentItems: { type: "inputText"; text: string }[] };
          let stop = false;
          try {
            if (this.closed || this.revoked || !this.active || call?.threadId !== this.threadId || call?.turnId !== this.active.id
              || call?.namespace !== "copypaste" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(call?.callId ?? "")
              || !this.binding.companyTools?.some(tool => tool.name === call.tool) || !this.hooks.companyTool
              || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments))
              throw new LocalCodexError("LOCAL_COMPANY_TOOL_SCOPE_INVALID");
            this.validateGrant(); await this.hooks.authorize();
            if (this.grant.mode === "read-only" && !["project_assets", "asset_text_read", "cloud_files", "cloud_file_read", "marketing_metrics", "font_catalog", "video_projects", "video_project_read", "video_project_status", "workflow_list", "workflow_read", "workflow_validate", "workflow_status"].includes(call.tool))
              throw new LocalCodexError("LOCAL_COMPANY_TOOL_READ_ONLY");
            await this.emit("local.company-tool.started", { tool: call.tool, call_id: call.callId });
            const output = await this.hooks.companyTool(call, this.shutdown.signal);
            this.validateGrant();
            if (this.closed || this.revoked || this.shutdown.signal.aborted) throw new LocalCodexError("LOCAL_COMPANY_TOOL_INTERRUPTED");
            const encoded = JSON.stringify(output);
            if (typeof encoded !== "string" || Buffer.byteLength(encoded) > 2_000_000) throw new LocalCodexError("LOCAL_COMPANY_TOOL_RESULT_INVALID");
            const artifacts: Record<string, unknown>[] = [];
            const inspect = (value: any, depth = 0) => {
              if (!value || typeof value !== "object" || depth > 3 || artifacts.length >= 20) return;
              if (uuid.test(value.id) && typeof value.name === "string" && uuid.test(value.version?.id)
                && Number.isSafeInteger(value.version?.version)) artifacts.push({ id: value.id, name: value.name.slice(0, 160), version: value.version.version, asset_version_id: value.version.id });
              else for (const key of ["source", "rendered", "artifact", "assets"]) {
                if (Array.isArray(value[key])) value[key].slice(0, 20).forEach(item => inspect(item, depth + 1));
                else inspect(value[key], depth + 1);
              }
            };
            inspect(output);
            const videoResult = output as any;
            const video = /^video_project_(queue|edit|render|status|cancel)$/.test(call.tool)
              && uuid.test(videoResult?.project?.id) && uuid.test(videoResult?.render?.id)
              && ["queued", "rendering", "succeeded", "failed", "cancelled"].includes(videoResult.render.state)
              && Number.isSafeInteger(videoResult.render.revision) && videoResult.render.revision > 0
              ? { project_id: videoResult.project.id, render_id: videoResult.render.id,
                  ...(Number.isSafeInteger(videoResult.render.version ?? videoResult.project.version)
                    ? { version: videoResult.render.version ?? videoResult.project.version } : {}),
                  revision: videoResult.render.revision, state: videoResult.render.state } : undefined;
            await this.emit("local.company-tool.completed", { tool: call.tool, call_id: call.callId, artifacts, ...(video ? { video } : {}) });
            result = { success: true, contentItems: [{ type: "inputText", text: encoded }] };
          } catch (error: any) {
            const code = error instanceof LocalCodexError ? error.code : "LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN";
            stop = !["LOCAL_COMPANY_TOOL_INPUT_INVALID", "LOCAL_COMPANY_TOOL_READ_ONLY"].includes(code);
            await this.emit("local.company-tool.failed", { code, tool: typeof call?.tool === "string" ? call.tool.slice(0, 64) : "unknown" });
            result = { success: false, contentItems: [{ type: "inputText", text: code + ". Do not invent an output or automatically replay the operation." }] };
          }
          if (this.child && !this.hasExited && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify({ id: message.id, result }) + "\n");
          if (stop) { await this.markUncertain(); this.fail(new LocalCodexError("LOCAL_COMPANY_TOOL_OUTCOME_UNKNOWN")); this.stopInBackground(); }
          return;
        }
        const kind = approvalMethods.get(message.method);
        let decision: "accept" | "decline" = "decline";
        if (kind && !this.closed && !this.revoked) {
          this.validateGrant(); await this.hooks.authorize();
          if (this.grant.mode === "full-access") decision = "accept";
          else if (this.grant.mode === "workspace-write" && this.hooks.approval) {
            const signal = this.shutdown.signal;
            decision = await new Promise<"accept" | "decline">((resolve, reject) => {
              const abort = () => resolve("decline");
              signal.addEventListener("abort", abort, { once: true });
              void this.hooks.approval!(kind, message.params ?? {}).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
              if (signal.aborted) abort();
            });
          }
        }
        if (this.child && !this.hasExited && !this.child.stdin.destroyed)
          this.child.stdin.write(JSON.stringify(kind ? { id: message.id, result: { decision } } : { id: message.id, error: { code: -32601, message: "Unsupported local client request" } }) + "\n");
        return;
      }
      const method = message.method, params = message.params ?? {};
      if (params.threadId && params.threadId !== this.threadId) return;
      if (method === "thread/tokenUsage/updated") {
        const usage = params.tokenUsage?.total;
        this.nativeUsage = usage && [usage.inputTokens, usage.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)
          ? { input: usage.inputTokens, output: usage.outputTokens } : null;
      }
      if (method === "turn/started" && this.active) this.active.id = params.turn?.id ?? this.active.id;
      if (method === "item/agentMessage/delta" && this.active && typeof params.delta === "string") this.active.text += params.delta;
      const item = params.item;
      const visibleItem = !item || ["agentMessage", "commandExecution", "fileChange", "plan", "mcpToolCall", "dynamicToolCall", "webSearch", "imageView"].includes(item.type);
      if (["item/agentMessage/delta", "item/commandExecution/outputDelta", "item/fileChange/outputDelta", "turn/started"].includes(method)
        || (["item/started", "item/completed"].includes(method) && visibleItem))
        await this.emit(method, params);
      if (method === "turn/completed" && this.active) {
        this.cancelInputs();
        const active = this.active;
        const status = params.turn?.status;
        if (!["completed", "interrupted", "failed"].includes(status) || (active.id && params.turn.id !== active.id))
          throw new LocalCodexError("LOCAL_CODEX_TURN_MISMATCH");
        clearTimeout(active.timer);
        await this.save("ready");
        await this.emit("turn/completed", params);
        this.active = undefined;
        // Native completion is an authoritative turn id even if the preceding
        // turn/start JSON-RPC response was lost. Do not rerun a completed turn.
        for (const [id, pending] of this.pending) {
          if (pending.method === "turn/start") {
            clearTimeout(pending.timer); this.pending.delete(id); pending.resolve({ turn: { id: params.turn.id } });
          }
        }
        active.resolve({ threadId: this.threadId, turnId: params.turn.id, status, text: active.text, nativeTokenUsage: this.nativeUsage });
      }
    }).catch((error) => { this.fail(error instanceof LocalCodexError ? error : new LocalCodexError("LOCAL_EVENT_PERSISTENCE_FAILED")); this.stopInBackground(); });
  }

  async turn(prompt: string, signal?: AbortSignal): Promise<LocalTurnResult> {
    if (this.closed || this.revoked || this.operation || this.active || !this.threadId || this.checkpoint?.phase !== "ready") throw new LocalCodexError("LOCAL_SESSION_NOT_READY");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000) throw new LocalCodexError("LOCAL_PROMPT_INVALID");
    if (signal?.aborted) throw new LocalCodexError("LOCAL_TURN_ABORTED");
    this.operation = true;
    const abort = () => { void this.interrupt(); };
    try {
      this.validateGrant(); await this.hooks.authorize();
      this.nativeUsage = null;
      this.seenInputRequests.clear();
      for (const skill of this.binding.skills) {
        const file = path.join(this.home, "skills", skill.key, "SKILL.md");
        if (hash(await readFile(file)) !== skill.sha256) throw new LocalCodexError("LOCAL_SKILL_CHANGED");
      }
      const skills = this.binding.skills.map((skill) => ({ type: "skill", name: skill.key,
        path: path.join(this.home, "skills", skill.key, "SKILL.md") }));
      this.hasTurns = true;
      await this.save("running");
      const completion = new Promise<LocalTurnResult>((resolve, reject) => {
        const timer = setTimeout(() => { this.fail(new LocalCodexError("LOCAL_TURN_TIMEOUT")); this.stopInBackground(); }, 15 * 60000);
        this.active = { id: "", text: "", resolve, reject, timer };
      });
      // A failure before turn/start returns must still have a rejection handler.
      void completion.catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      const policy = localPermissionPolicy(this.grant.mode);
      const result = await this.rpc("turn/start", { threadId: this.threadId, cwd: this.binding.workspace, model: this.profile.model,
        effort: this.profile.effort, approvalPolicy: policy.approvalPolicy, sandboxPolicy: policy.sandboxPolicy,
        input: [...skills, { type: "text", text: prompt }] });
      if (!result?.turn?.id) throw new LocalCodexError("LOCAL_CODEX_TURN_MISMATCH");
      this.setTurnId(result.turn.id);
      if (signal?.aborted) await this.interrupt();
      return await completion;
    } catch (error) {
      await this.markUncertain();
      this.fail(error instanceof LocalCodexError ? error : new LocalCodexError("LOCAL_TURN_FAILED"));
      this.stopInBackground();
      throw error;
    } finally { signal?.removeEventListener("abort", abort); this.operation = false; }
  }

  async updatePermission(grant: LocalPermissionGrant) {
    if (this.closed || this.active || this.operation || !this.threadId) throw new LocalCodexError("LOCAL_SESSION_NOT_IDLE");
    this.validateGrant(grant);
    if (grant.revision <= this.grant.revision) throw new LocalCodexError("LOCAL_PERMISSION_VERSION_CONFLICT");
    this.operation = true;
    try {
      await this.hooks.authorize();
      this.grant = { ...grant };
      // Native turn/start accepts sandboxPolicy + approvalPolicy, applying the
      // new choice before any tool in the next turn. thread/resume cannot load
      // a not-yet-persisted empty thread and is unnecessary while this is idle.
      try { await this.save("ready"); }
      catch (error) { await this.close(); throw error; }
      this.armExpiry();
      await this.emit("local.permission.changed", { mode: grant.mode, revision: grant.revision });
    } finally { this.operation = false; }
  }

  async interrupt() {
    this.cancelInputs();
    if (this.active?.id && this.child && !this.hasExited)
      await this.rpc("turn/interrupt", { threadId: this.threadId, turnId: this.active.id }, 3000).catch(() => {});
  }

  async revoke() {
    this.revoked = true;
    await this.close();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.cancelInputs();
    this.shutdown.abort();
    this.closing = (async () => {
      if (this.expiry) clearTimeout(this.expiry);
      const child = this.child;
      if (child && !this.hasExited) {
        await this.interrupt();
        child.stdin.end();
        const wait = async (ms: number) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([this.exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]); }
          finally { if (timer) clearTimeout(timer); }
        };
        await wait(3000);
        if (!this.hasExited && child.pid) {
          if (process.platform === "win32") await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => {});
          else child.kill("SIGKILL");
          await wait(3000);
        }
        if (!this.hasExited) throw new LocalCodexError("LOCAL_PROCESS_SHUTDOWN_FAILED");
      }
      await this.eventTail;
      if (this.checkpoint?.phase === "running") await this.save("uncertain");
      if (this.revoked && this.receiptFile && this.threadId) await this.save("revoked");
      this.fail(new LocalCodexError("LOCAL_SESSION_CLOSED"));
      this.credential = "";
      await this.releaseLock();
    })().catch(error => { this.closing = undefined; throw error; });
    return this.closing;
  }
}
