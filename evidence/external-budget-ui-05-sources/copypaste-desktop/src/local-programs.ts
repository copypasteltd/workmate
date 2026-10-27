import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { LocalProgramError, validateProgramCall, type LocalProgramSession, type ProgramToolCall, type ProgramToolResult } from "./program-contract.js";

export interface ProgramOwner {
  actorId: string; epoch: string; tenant: string; project: string; workspace: string;
  permission: string | null; revoked: boolean; grantRevision?: number; expiresAt: number; programToolsVersion?: 1;
}
interface Identity { path: string; sha256: string; size: number; dev: number; ino: number; mtimeMs: number }
export interface ApprovedProgram extends Identity {
  id: string; name: string; sessionId: string; owner: ProgramOwner; approvedAt: string; revokedAt?: string;
}
export interface ProgramReceipt {
  id: string; key: string; digest: string; taskId: string; sessionId: string; owner: ProgramOwner;
  programId: string; programName: string; executableSha256: string; argv: string[]; timeoutMs: number;
  state: "prepared" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out" | "unknown";
  startedAt: string; finishedAt?: string; pid?: number; hostPid?: number; exitCode?: number | null; signal?: string | null;
  stdout: string; stderr: string; stdoutBytes: number; stderrBytes: number; outputTruncated: boolean; error?: string; reviewedAt?: string;
}
export interface ProgramJournal { schema: 1; programs: ApprovedProgram[]; receipts: ProgramReceipt[] }
export interface ProgramInvocation { sessionId: string; taskId: string }
export interface ProgramIO {
  read(): Promise<ProgramJournal | null>; write(value: ProgramJournal): Promise<void>;
  owner(id: string): Promise<ProgramOwner>; context(id: string): Promise<ProgramOwner>;
  choose(): Promise<string | null>; confirm(program: { name: string; path: string; sha256: string; workspace: string }): Promise<boolean>;
  host?: string;
  review?(receipt: ProgramReceipt): Promise<boolean>;
  changed(): void;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const same = (a: ProgramOwner, b: ProgramOwner) => ["actorId", "epoch", "tenant", "project", "workspace", "grantRevision"]
  .every(key => a[key as keyof ProgramOwner] === b[key as keyof ProgramOwner]);
const output = (value: unknown, success = true): ProgramToolResult => ({ success, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] });
function environment() {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "userprofile", "appdata", "localappdata", "lang", "lc_all"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase())));
}
export async function inspectProgram(file: string): Promise<Identity> {
  if (!path.isAbsolute(file) || file.includes("\0") || (process.platform === "win32" && (!/\.(exe|com)$/i.test(file) || /^\\\\/.test(file)))) throw new LocalProgramError("LOCAL_PROGRAM_FILE_INVALID");
  const resolved = await realpath(file), info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0 || info.size > 512 * 1024 * 1024) throw new LocalProgramError("LOCAL_PROGRAM_FILE_INVALID");
  if (/^(docker|wsl|wslhost|podman|vagrant|virtualbox|vboxmanage|vmware|qemu-system[^.]*)\.(exe|com)$/i.test(path.basename(resolved))) throw new LocalProgramError("LOCAL_PROGRAM_NOT_SUPPORTED");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(), header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (process.platform === "win32" ? header.subarray(0, 2).toString() !== "MZ" : !["7f454c46", "feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(header.toString("hex"))) throw new LocalProgramError("LOCAL_PROGRAM_FILE_INVALID");
    const digest = createHash("sha256"), buffer = Buffer.alloc(128 * 1024); let offset = 0;
    for (;;) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead; }
    const after = await handle.stat(), current = await lstat(resolved);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== offset || after.size !== offset || before.mtimeMs !== after.mtimeMs
      || current.ino !== after.ino || current.size !== after.size || current.mtimeMs !== after.mtimeMs || await realpath(file) !== resolved) throw new LocalProgramError("LOCAL_PROGRAM_CHANGED");
    return { path: resolved, sha256: digest.digest("hex"), size: after.size, dev: after.dev, ino: after.ino, mtimeMs: after.mtimeMs };
  } finally { await handle.close(); }
}

/** Local customer approvals and durable receipts. No company token enters a child. */
export class LocalProgramController {
  private loading?: Promise<ProgramJournal>;
  private journal?: ProgramJournal;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  private generation = 0;
  private active = new Map<string, { programId: string; sessionId: string; abort: AbortController; done: Promise<ProgramReceipt> }>();
  private sessions = new Set<LocalProgramSession>();
  constructor(private io: ProgramIO) {}
  private async state() {
    this.loading ??= (async () => {
      const value = await this.io.read() ?? { schema: 1 as const, programs: [], receipts: [] };
      if (value.schema !== 1 || !Array.isArray(value.programs) || !Array.isArray(value.receipts)
        || value.programs.length > 100 || value.receipts.length > 200) throw new LocalProgramError("LOCAL_PROGRAM_STATE_INVALID", false);
      for (const receipt of value.receipts) if (["prepared", "running"].includes(receipt.state)) {
        receipt.state = "unknown"; receipt.error = "LOCAL_PROGRAM_REVIEW_REQUIRED";
      }
      return this.journal = value;
    })();
    return this.loading;
  }
  private async persist() {
    const value = structuredClone(await this.state()), pending = this.writes.then(() => this.io.write(value));
    this.writes = pending.catch(() => {});
    try { await pending; this.io.changed(); } catch {
      this.closed = true; for (const item of this.active.values()) item.abort.abort();
      throw new LocalProgramError("LOCAL_PROGRAM_STORAGE_FAILED", false);
    }
  }
  private async owner(id: string, online = false) {
    if (this.closed) throw new LocalProgramError("LOCAL_PROGRAM_APP_CLOSED", false);
    if (!uuid.test(id)) throw new LocalProgramError("LOCAL_PROGRAM_INPUT_INVALID");
    const owner = await (online ? this.io.context(id) : this.io.owner(id));
    if (this.closed) throw new LocalProgramError("LOCAL_PROGRAM_APP_CLOSED", false);
    return owner;
  }
  private granted(owner: ProgramOwner) {
    if (owner.revoked || owner.permission !== "full-access" || !owner.grantRevision || owner.expiresAt <= Date.now()) throw new LocalProgramError("LOCAL_PROGRAM_FULL_ACCESS_REQUIRED");
    if (owner.programToolsVersion !== 1) throw new LocalProgramError("LOCAL_PROGRAM_NEW_SESSION_REQUIRED");
  }
  async list(id: string) {
    const owner = await this.owner(id), state = await this.state();
    return { ready: owner.programToolsVersion === 1, programs: state.programs.filter(program => program.sessionId === id && program.owner.actorId === owner.actorId && program.owner.epoch === owner.epoch).map(program => ({
      id: program.id, name: program.name, path: program.path, sha256: program.sha256, approvedAt: program.approvedAt,
      active: same(program.owner, owner) && !program.revokedAt && !owner.revoked && owner.permission === "full-access" && owner.expiresAt > Date.now(), revokedAt: program.revokedAt,
    })), receipts: state.receipts.filter(receipt => receipt.sessionId === id && receipt.owner.actorId === owner.actorId && receipt.owner.epoch === owner.epoch).map(receipt => structuredClone(receipt)) };
  }
  async approve(id: string) {
    const owner = await this.owner(id, true), generation = this.generation; this.granted(owner);
    const chosen = await this.io.choose(); if (!chosen) return null;
    const identity = await inspectProgram(chosen), name = path.basename(identity.path);
    if (!await this.io.confirm({ name, path: identity.path, sha256: identity.sha256, workspace: owner.workspace })) return null;
    const current = await this.owner(id, true); this.granted(current);
    if (generation !== this.generation || !same(owner, current)) throw new LocalProgramError("LOCAL_PROGRAM_PERMISSION_CHANGED");
    const verified = await inspectProgram(identity.path);
    if (JSON.stringify(identity) !== JSON.stringify(verified)) throw new LocalProgramError("LOCAL_PROGRAM_CHANGED");
    const state = await this.state();
    if (state.programs.length >= 100) throw new LocalProgramError("LOCAL_PROGRAM_CATALOG_LIMIT");
    const existing = state.programs.find(program => program.sessionId === id && same(program.owner, owner) && !program.revokedAt && program.path === identity.path && program.sha256 === identity.sha256);
    if (existing) return { id: existing.id };
    const program: ApprovedProgram = { ...identity, id: randomUUID(), name, sessionId: id, owner: structuredClone(owner), approvedAt: new Date().toISOString() };
    state.programs.push(program); await this.persist(); return { id: program.id };
  }
  async revoke(id: string, programId: string) {
    const owner = await this.owner(id), state = await this.state();
    const program = state.programs.find(item => item.id === programId && item.sessionId === id && item.owner.actorId === owner.actorId && item.owner.epoch === owner.epoch);
    if (!program) throw new LocalProgramError("LOCAL_PROGRAM_NOT_FOUND");
    program.revokedAt ??= new Date().toISOString();
    try { await this.persist(); }
    finally {
      const active = [...this.active.values()].filter(item => item.programId === programId);
      active.forEach(item => item.abort.abort()); await Promise.allSettled(active.map(item => item.done));
    }
  }
  async review(id: string, receiptId: string) {
    const owner = await this.owner(id, true), state = await this.state(), generation = this.generation; this.granted(owner);
    const receipt = state.receipts.find(item => item.id === receiptId && item.sessionId === id && item.owner.actorId === owner.actorId && item.owner.epoch === owner.epoch);
    if (!receipt || receipt.state !== "unknown") throw new LocalProgramError("LOCAL_PROGRAM_RECEIPT_NOT_FOUND");
    if (!this.io.review || !await this.io.review(structuredClone(receipt))) return;
    const current = await this.owner(id, true); this.granted(current);
    if (!same(owner, current) || generation !== this.generation) throw new LocalProgramError("LOCAL_PROGRAM_PERMISSION_CHANGED");
    receipt.reviewedAt ??= new Date().toISOString(); await this.persist();
  }
  session(owner: ProgramInvocation, authorize: () => Promise<void>): LocalProgramSession {
    const shutdown = new AbortController(); let closing: Promise<void> | undefined;
    const calls = new Map<string, { digest: string; result: Promise<ProgramToolResult> }>();
    const session: LocalProgramSession = {
      call: async (call, external) => {
        const signal = AbortSignal.any([external, shutdown.signal]);
        const check = async () => { if (signal.aborted) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false); await authorize(); this.granted(await this.owner(owner.sessionId)); if (signal.aborted) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false); };
        await check(); validateProgramCall(call);
        const digest = hash(JSON.stringify(call)), previous = calls.get(call.callId);
        if (previous) { if (previous.digest !== digest) throw new LocalProgramError("LOCAL_PROGRAM_CALL_CONFLICT", false); const result = await previous.result; await check(); return structuredClone(result); }
        if (calls.size >= 128) throw new LocalProgramError("LOCAL_PROGRAM_CALL_LIMIT");
        const result = (async () => {
          await check();
          if (call.tool === "list") {
            const listed = await this.list(owner.sessionId);
            return output({ programs: listed.programs.filter(program => program.active).map(({ id, name, sha256 }) => ({ id, name, sha256 })) });
          }
          if (call.tool === "status") {
            const current = await this.owner(owner.sessionId);
            const receipt = (await this.state()).receipts.find(item => item.id === call.arguments.receipt_id && item.taskId === owner.taskId && item.sessionId === owner.sessionId
              && item.owner.actorId === current.actorId && item.owner.epoch === current.epoch);
            if (!receipt) throw new LocalProgramError("LOCAL_PROGRAM_RECEIPT_NOT_FOUND");
            return output(receipt, receipt.state === "succeeded");
          }
          const receipt = await this.run(owner, call, signal, check); return output(receipt, receipt.state === "succeeded");
        })();
        calls.set(call.callId, { digest, result }); return structuredClone(await result);
      },
      close: () => closing ??= (async () => { shutdown.abort(); await Promise.allSettled([...calls.values()].map(item => item.result)); this.sessions.delete(session); })(),
    };
    this.sessions.add(session); return session;
  }
  private async run(invocation: ProgramInvocation, call: ProgramToolCall, signal: AbortSignal, check: () => Promise<void>) {
    const owner = await this.owner(invocation.sessionId), state = await this.state(); this.granted(owner);
    const key = hash(JSON.stringify([owner.actorId, owner.epoch, invocation.taskId, call.callId])), digest = hash(JSON.stringify(call));
    const previous = state.receipts.find(receipt => receipt.key === key);
    if (previous) {
      if (previous.digest !== digest) throw new LocalProgramError("LOCAL_PROGRAM_CALL_CONFLICT", false);
      const active = this.active.get(previous.id); return structuredClone(active ? await active.done : previous);
    }
    const program = state.programs.find(item => item.id === call.arguments.program_id && item.sessionId === invocation.sessionId && same(item.owner, owner) && !item.revokedAt);
    if (!program) throw new LocalProgramError("LOCAL_PROGRAM_NOT_APPROVED");
    if (state.receipts.some(item => item.programId === program.id && item.state === "unknown" && !item.reviewedAt)) throw new LocalProgramError("LOCAL_PROGRAM_REVIEW_REQUIRED", false);
    if (state.receipts.length >= 200) throw new LocalProgramError("LOCAL_PROGRAM_HISTORY_LIMIT");
    if (this.active.size >= 2) throw new LocalProgramError("LOCAL_PROGRAM_CONCURRENCY_LIMIT");
    const receipt: ProgramReceipt = { id: randomUUID(), key, digest, taskId: invocation.taskId, sessionId: invocation.sessionId, owner: structuredClone(owner),
      programId: program.id, programName: program.name, executableSha256: program.sha256, argv: [...call.arguments.argv as string[]], timeoutMs: Number(call.arguments.timeout_ms ?? 30000),
      state: "prepared", startedAt: new Date().toISOString(), stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0, outputTruncated: false };
    state.receipts.push(receipt);
    const abort = new AbortController(), activeSignal = AbortSignal.any([signal, abort.signal]);
    const done = Promise.resolve().then(async () => {
      await this.persist(); await check();
      if (activeSignal.aborted || program.revokedAt) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
      const current = await inspectProgram(program.path);
      if (["path", "sha256", "size", "dev", "ino", "mtimeMs"].some(key => current[key as keyof Identity] !== program[key as keyof Identity])) throw new LocalProgramError("LOCAL_PROGRAM_CHANGED");
      await check();
      if (activeSignal.aborted || program.revokedAt) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
      await this.execute(program, receipt, owner.workspace, activeSignal);
      return receipt;
    }).catch(error => {
      if (["prepared", "running"].includes(receipt.state)) receipt.state = receipt.pid || receipt.hostPid ? "unknown" : activeSignal.aborted ? "cancelled" : "failed";
      receipt.error = error instanceof LocalProgramError ? error.code : "LOCAL_PROGRAM_OUTCOME_UNKNOWN";
      return receipt;
    }).then(async value => { value.finishedAt = new Date().toISOString(); await this.persist(); return structuredClone(value); }).finally(() => this.active.delete(receipt.id));
    this.active.set(receipt.id, { programId: program.id, sessionId: invocation.sessionId, abort, done });
    return done;
  }
  private async execute(program: ApprovedProgram, receipt: ProgramReceipt, cwd: string, signal: AbortSignal) {
    if (signal.aborted) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
    let executable = program.path, args = receipt.argv;
    const guarded = process.platform === "win32";
    if (guarded) {
      if (!this.io.host) throw new LocalProgramError("LOCAL_PROGRAM_HOST_UNAVAILABLE", false);
      const manifest = JSON.parse(await readFile(path.join(path.dirname(this.io.host), "manifest.json"), "utf8")), host = await inspectProgram(this.io.host);
      if (manifest.schema !== 1 || manifest.platform !== "windows-x64" || manifest.sha256 !== host.sha256) throw new LocalProgramError("LOCAL_PROGRAM_HOST_INVALID", false);
      executable = this.io.host; args = [program.path, program.sha256, ...receipt.argv];
    }
    if (signal.aborted || program.revokedAt) throw new LocalProgramError("LOCAL_PROGRAM_INTERRUPTED", false);
    let child: ChildProcess, kill: Promise<void> | undefined, timedOut = false, exited = false, leaderExited = false, spawnError: Error | undefined;
    let header = Buffer.alloc(0), headerSeen = !guarded;
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }, stored = { stdout: 0, stderr: 0 };
    child = spawn(executable, args, { cwd, shell: false, windowsHide: true, detached: !guarded, env: environment(), stdio: ["pipe", "pipe", "pipe"] });
    const exit = new Promise<void>(resolve => {
      child.once("error", error => { spawnError = error; });
      child.once("exit", () => { leaderExited = true; });
      child.once("close", (code, exitSignal) => { exited = true; receipt.exitCode = code; receipt.signal = exitSignal; resolve(); });
    });
    const terminate = () => kill ??= (async () => {
      if (exited || !child.pid || leaderExited) return;
      if (guarded) {
        child.stdin?.end();
        let grace: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([exit, new Promise<void>(resolve => { grace = setTimeout(resolve, 2000); })]); }
        finally { if (grace) clearTimeout(grace); }
        if (!leaderExited) child.kill("SIGKILL"); // Closing the guardian also closes its native Job Object.
      }
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    })();
    // A guardian may close its input while an owned stop is already in flight.
    // Consume EPIPE and keep termination scoped to this exact child process.
    child.stdin?.on("error", () => { if (!leaderExited) void terminate(); });
    for (const key of ["stdout", "stderr"] as const) child[key]!.on("data", (raw: Buffer) => {
      let data = Buffer.from(raw);
      if (key === "stdout" && !headerSeen) {
        header = Buffer.concat([header, data]); const end = header.indexOf(10);
        if (end < 0) { if (header.length > 80) { spawnError = new Error("Invalid program guardian"); void terminate(); } return; }
        const matched = /^CPPROGRAM1 ([1-9][0-9]{0,9})$/.exec(header.subarray(0, end).toString("ascii"));
        if (!matched) { spawnError = new Error("Invalid program guardian"); void terminate(); return; }
        receipt.pid = Number(matched[1]); headerSeen = true; data = header.subarray(end + 1); header = Buffer.alloc(0);
      }
      receipt[key === "stdout" ? "stdoutBytes" : "stderrBytes"] += data.length;
      const retain = data.subarray(0, Math.max(0, 32768 - stored[key])); stored[key] += retain.length; if (retain.length) chunks[key].push(retain);
      if (retain.length < data.length) receipt.outputTruncated = true;
    });
    const stop = () => { void terminate(); }; signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; void terminate(); }, receipt.timeoutMs);
    try {
      if (guarded) receipt.hostPid = child.pid; else receipt.pid = child.pid;
      receipt.state = "running";
      await this.persist(); if (signal.aborted) stop();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exit, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new LocalProgramError("LOCAL_PROGRAM_SHUTDOWN_FAILED", false)), receipt.timeoutMs + 12000); })]);
      } finally { if (deadline) clearTimeout(deadline); }
      receipt.state = spawnError || !headerSeen ? "failed" : signal.aborted ? "cancelled" : timedOut ? "timed_out" : receipt.exitCode === 0 ? "succeeded" : "failed";
      if (spawnError) receipt.error = "LOCAL_PROGRAM_SPAWN_FAILED";
      else if (!headerSeen) receipt.error = "LOCAL_PROGRAM_HOST_FAILED";
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", stop); if (!exited) await terminate(); if (kill) await kill;
      receipt.stdout = Buffer.concat(chunks.stdout).toString("utf8"); receipt.stderr = Buffer.concat(chunks.stderr).toString("utf8");
    }
  }
  async withdraw(id?: string) {
    this.generation++;
    const active = [...this.active.values()].filter(item => !id || item.sessionId === id);
    active.forEach(item => item.abort.abort()); await Promise.allSettled(active.map(item => item.done));
  }
  async close() {
    this.closed = true; await this.withdraw(); await Promise.allSettled([...this.sessions].map(session => session.close())); await this.writes;
  }
}
