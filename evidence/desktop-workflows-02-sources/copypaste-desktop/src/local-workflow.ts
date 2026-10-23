import { createHash, randomUUID } from "node:crypto";
import type { LocalInputRequest, LocalInputAnswers } from "./local-input.js";

interface NativeWorkflowRun {
  id: string; workflow_id: string; version: number; revision: number; state: string; cursor: number;
  authorized: boolean; execution_location: "desktop"; results: unknown[]; error_code?: string;
  definition: { steps: ({ kind: "codex"; role_key: string; prompt: string; budget_micros: number }
    | { kind: "approval"; message: string } | { kind: "analytics.summary"; dataset_id: string })[] };
}
export interface NativeWorkflowChild {
  task_id: string; role_key: string;
  fields: { device_id: string; local_session_id: string; workspace_hash: string; runtime_version: string; runtime_sha256: string };
}
export interface NativeWorkflowIO {
  base: string;
  threadId: string; turnId: string;
  signal: AbortSignal;
  authorize(): Promise<void>;
  request(url: string, body: unknown, key: string): Promise<any>;
  read(url: string): Promise<any>;
  ask(request: LocalInputRequest, signal: AbortSignal, authorize: () => Promise<void>): Promise<LocalInputAnswers>;
  child(child: NativeWorkflowChild, run: NativeWorkflowRun): Promise<void>;
  event(value: Record<string, unknown>): Promise<void>;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}
function parseRun(value: any): NativeWorkflowRun {
  if (!value || !uuid.test(value.id) || !uuid.test(value.workflow_id) || value.execution_location !== "desktop"
    || !Number.isSafeInteger(value.version) || value.version < 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > 8
    || !["running", "awaiting_approval", ...terminal].includes(value.state) || typeof value.authorized !== "boolean"
    || !Array.isArray(value.results) || !Array.isArray(value.definition?.steps) || !value.definition.steps.length || value.definition.steps.length > 8)
    throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  for (const step of value.definition.steps) {
    if (step.kind === "codex") {
      if (typeof step.role_key !== "string" || step.role_key === "workflow-consultant" || typeof step.prompt !== "string"
        || step.prompt.length < 5 || step.prompt.length > 12000 || !Number.isSafeInteger(step.budget_micros)
        || step.budget_micros < 10000 || step.budget_micros > 10_000_000_000) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    } else if (step.kind === "approval") {
      if (typeof step.message !== "string" || step.message.length < 3 || step.message.length > 2000) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    } else if (step.kind !== "analytics.summary" || !uuid.test(step.dataset_id)) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  }
  return value;
}

/** Main-process-only sequencer. Model tools cannot answer its consent cards,
 * launch child processes or obtain scoped child inference credentials. */
export async function executeLocalWorkflow(io: NativeWorkflowIO, initial: any) {
  let run = parseRun(initial?.run);
  if (run.authorized || !["running"].includes(run.state) || run.cursor !== 0 || run.results.length || !initial.customer_confirmation_required
    || initial.definition_hash !== digest(run.definition)) throw new Error("LOCAL_WORKFLOW_REPLAY_FORBIDDEN");
  const runId = run.id, frozenHash = initial.definition_hash;
  const base = io.base + "/workflow-runs/" + run.id;
  const total = run.definition.steps.reduce((sum, step) => sum + (step.kind === "codex" ? step.budget_micros : 0), 0);
  if (initial.step_budget_micros !== total || initial.budget_excludes_current_consultant !== true) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  const seenChildren = new Set<string>();
  const check = async () => { if (io.signal.aborted) throw new Error("LOCAL_WORKFLOW_INTERRUPTED"); await io.authorize(); if (io.signal.aborted) throw new Error("LOCAL_WORKFLOW_INTERRUPTED"); };
  const update = async (value: any) => {
    const next = parseRun(value);
    if (next.id !== runId || next.workflow_id !== run.workflow_id || next.version !== run.version || next.revision < run.revision
      || digest(next.definition) !== frozenHash || next.cursor < run.cursor) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    run = next;
    await io.event({ run_id: run.id, workflow_id: run.workflow_id, version: run.version, revision: run.revision,
      state: run.state, cursor: run.cursor, steps: run.definition.steps.length, error_code: run.error_code,
      authorized: run.authorized,
      charged_micros: run.results.reduce((sum: bigint, result: any) => sum + (/^\d+$/.test(result?.charged_micros ?? "") ? BigInt(result.charged_micros) : 0n), 0n).toString(),
      child_task_ids: [...seenChildren], result_origin: "desktop_client_report" });
  };
  const decision = async (stage: "launch" | "step", question: string) => {
    await check();
    const request: LocalInputRequest = { threadId: io.threadId, turnId: io.turnId, itemId: "workflow-" + run.id + "-" + run.revision,
      isBlocking: true, questions: [{ id: "workflow_decision", header: stage === "launch" ? "本機流程費用 / Local workflow fees" : "流程審批 / Workflow approval",
        question: question + `\n\nWorkflow ${run.id} · v${run.version} · step ${run.cursor + 1}\nDefinition ${frozenHash}`,
        isOther: false, isSecret: false, options: [
          { label: "批准 / Approve", description: "執行此具體版本及步驟 / Execute this exact version and step" },
          { label: "取消流程 / Cancel workflow", description: "停止並保留已發生的費用 / Stop and retain incurred usage" },
        ] }] };
    const expectedRevision = run.revision, pending = new AbortController();
    const authorizeApproval = async () => {
      await check();
      const current = parseRun((await io.read(base)).run);
      if (current.id !== runId || current.revision !== expectedRevision || current.state !== run.state
        || digest(current.definition) !== frozenHash || terminal.has(current.state)) throw new Error("LOCAL_WORKFLOW_APPROVAL_WITHDRAWN");
    };
    let monitorRun: Promise<unknown> | undefined;
    const monitor = setInterval(() => {
      if (monitorRun) return;
      monitorRun = authorizeApproval().catch(() => pending.abort()).finally(() => { monitorRun = undefined; });
    }, 1000);
    let answers: LocalInputAnswers;
    try { answers = await io.ask(request, AbortSignal.any([io.signal, pending.signal]), authorizeApproval); await authorizeApproval(); }
    finally { clearInterval(monitor); await monitorRun; }
    const answer = answers!.workflow_decision?.answers?.[0];
    if (!["批准 / Approve", "取消流程 / Cancel workflow"].includes(answer)) throw new Error("LOCAL_WORKFLOW_APPROVAL_INVALID");
    const response = await io.request(base + "/decision", { expected_revision: run.revision, stage,
      definition_hash: frozenHash, decision: answer === "批准 / Approve" ? "approve" : "cancel" }, randomUUID());
    await update(response.run);
  };
  const steps = run.definition.steps.map((step, index) => `${index + 1}. ` + (step.kind === "codex"
    ? `${step.role_key} · HK$ ${(step.budget_micros / 1_000_000).toFixed(2)}\n${step.prompt.slice(0, 180)}`
    : step.kind === "approval" ? "人工審批 / Human approval: " + step.message.slice(0, 160) : "廣告數據匯總 / Analytics summary: " + step.dataset_id));
  await update(run);
  await decision("launch", `Codex 將在本機逐步執行，沿用目前工作目錄及本機權限。\nCodex steps run locally using the current workspace and OS grant.\n\n子步驟費用上限合計 / Additional child-step limit: HK$ ${(total / 1_000_000).toFixed(2)}\n不包括目前流程顧問對話的額度；每步分別預留及結算。\nExcludes this consultant conversation; each step reserves and settles separately.\n\n${steps.join("\n\n")}`);
  const deadline = Date.now() + 25 * 60_000;
  while (!terminal.has(run.state)) {
    await check();
    if (Date.now() > deadline) throw new Error("LOCAL_WORKFLOW_DEADLINE_REACHED");
    const result = await io.request(base + "/advance", { expected_revision: run.revision }, randomUUID());
    await update(result.run);
    if (result.action === "terminal") {
      if (!terminal.has(run.state)) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    } else if (result.action === "approval") {
      if (typeof result.message !== "string") throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
      const step = run.definition.steps[run.cursor];
      if (step.kind !== "approval" || result.message !== step.message || run.state !== "awaiting_approval") throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
      await decision("step", step.message);
    } else if (result.action === "codex") {
      const child: NativeWorkflowChild = result.child, step = run.definition.steps[run.cursor];
      if (!child || !uuid.test(child.task_id) || seenChildren.has(child.task_id) || step?.kind !== "codex" || child.role_key !== step.role_key
        || !uuid.test(child.fields?.local_session_id)) throw new Error("LOCAL_WORKFLOW_REPLAY_FORBIDDEN");
      seenChildren.add(child.task_id); await check(); await io.child(child, run); await check();
    } else if (result.action === "wait") {
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); io.signal.removeEventListener("abort", abort); resolve(); };
        const abort = () => { clearTimeout(timer); io.signal.removeEventListener("abort", abort); reject(new Error("LOCAL_WORKFLOW_INTERRUPTED")); };
        const timer = setTimeout(done, 500); io.signal.addEventListener("abort", abort, { once: true }); if (io.signal.aborted) abort();
      });
    } else if (result.action !== "next") throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  }
  return { run, execution_location: "desktop", result_origin: "desktop_client_report", automatically_replayed: false };
}
