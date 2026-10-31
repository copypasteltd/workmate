import { createHash, randomUUID } from "node:crypto";
import type { LocalInputRequest, LocalInputAnswers } from "./local-input.js";

interface NativeWorkflowRun {
  id: string; workflow_id: string; version: number; revision: number; state: string; cursor: number;
  authorized: boolean; execution_location: "desktop"; results: unknown[]; error_code?: string;
  input_hash?:string|null;input_values?:Record<string,unknown>;input_files?:any[];named_outputs?:Record<string,unknown>;
  definition: { steps: ({ kind: "codex"; role_key: string; prompt: string; budget_micros: number; input_steps?:number[]; on_failure?:"stop"|"review" }
    | { kind: "approval"; message: string } | { kind: "analytics.summary"; dataset_id: string })[];
    input_schema?:{fields:{key:string;label?:string;type:string;required?:boolean}[]};output_schema?:unknown };
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
const hkd = (micros: number) => (micros / 1_000_000).toFixed(6).replace(/0{1,4}$/, "");
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
  for (const [index,step] of value.definition.steps.entries()) {
    if (step.kind === "codex") {
      if (typeof step.role_key !== "string" || step.role_key === "workflow-consultant" || typeof step.prompt !== "string"
        || step.prompt.length < 5 || step.prompt.length > 12000 || !Number.isSafeInteger(step.budget_micros)
        || step.budget_micros < 10000 || step.budget_micros > 10_000_000_000) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
      if (step.on_failure !== undefined && !["stop","review"].includes(step.on_failure)) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
      if (step.input_steps !== undefined && (!Array.isArray(step.input_steps) || step.input_steps.length>7 || new Set(step.input_steps).size!==step.input_steps.length
        || step.input_steps.some((i:any)=>!Number.isSafeInteger(i)||i<0||i>=index||value.definition.steps[i]?.kind === "approval"))) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    } else if (step.kind === "approval") {
      if (typeof step.message !== "string" || step.message.length < 3 || step.message.length > 2000) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
    } else if (step.kind !== "analytics.summary" || !uuid.test(step.dataset_id)) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  }
  if(value.definition.input_schema){
    const fields=value.definition.input_schema.fields;
    if(!Array.isArray(fields)||fields.length>12||new Set(fields.map((f:any)=>f.key)).size!==fields.length
      ||!value.input_values||Array.isArray(value.input_values)||typeof value.input_values!=="object"||!Array.isArray(value.input_files)||value.input_files.length>12
      ||Object.keys(value.input_values).some(k=>!fields.some((f:any)=>f.key===k))||Buffer.byteLength(canonical(value.input_values))>24000
      ||!/^([a-f0-9]{64})$/.test(value.input_hash)||digest({values:value.input_values,files:value.input_files})!==value.input_hash)throw new Error("LOCAL_WORKFLOW_INPUTS_INVALID");
    for(const f of fields){const v=value.input_values[f.key];
      if(!/^[a-z][a-z0-9_]{0,47}$/.test(f.key)||!["text","number","boolean","file"].includes(f.type))throw new Error("LOCAL_WORKFLOW_INPUTS_INVALID");
      if(v===undefined){if(f.required)throw new Error("LOCAL_WORKFLOW_INPUTS_INVALID");continue;}
      if(f.type==="text"&&(typeof v!=="string"||v.length>4000||(f.required&&!v.trim()))||f.type==="number"&&(typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)
        ||f.type==="boolean"&&typeof v!=="boolean"||f.type==="file"&&(typeof v!=="string"||!uuid.test(v)||!value.input_files.some((file:any)=>file.input_name===f.key&&file.asset_version_id===v&&uuid.test(file.asset_id)&&/^[a-f0-9]{64}$/.test(file.sha256))))throw new Error("LOCAL_WORKFLOW_INPUTS_INVALID");
    }
  }else if(value.input_hash)throw new Error("LOCAL_WORKFLOW_INPUTS_INVALID");
  return value;
}

/** Main-process-only sequencer. Model tools cannot answer its consent cards,
 * launch child processes or obtain scoped child inference credentials. */
export async function executeLocalWorkflow(io: NativeWorkflowIO, initial: any) {
  let run = parseRun(initial?.run);
  if (run.authorized || !["running"].includes(run.state) || run.cursor !== 0 || run.results.length || !initial.customer_confirmation_required
    || initial.definition_hash !== digest(run.definition)) throw new Error("LOCAL_WORKFLOW_REPLAY_FORBIDDEN");
  const runId = run.id, frozenHash = initial.definition_hash,frozenInputHash=run.input_hash??null;
  const base = io.base + "/workflow-runs/" + run.id;
  const total = run.definition.steps.reduce((sum, step) => sum + (step.kind === "codex" ? step.budget_micros : 0), 0);
  if (initial.step_budget_micros !== total || initial.budget_excludes_current_consultant !== true) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
  const seenChildren = new Set<string>();
  const check = async () => { if (io.signal.aborted) throw new Error("LOCAL_WORKFLOW_INTERRUPTED"); await io.authorize(); if (io.signal.aborted) throw new Error("LOCAL_WORKFLOW_INTERRUPTED"); };
  const update = async (value: any) => {
    const next = parseRun(value);
    if (next.id !== runId || next.workflow_id !== run.workflow_id || next.version !== run.version || next.revision < run.revision
      || digest(next.definition) !== frozenHash || (next.input_hash??null)!==frozenInputHash || next.cursor < run.cursor) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
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
        || digest(current.definition) !== frozenHash ||(current.input_hash??null)!==frozenInputHash || terminal.has(current.state)) throw new Error("LOCAL_WORKFLOW_APPROVAL_WITHDRAWN");
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
      definition_hash: frozenHash,...(frozenInputHash?{input_hash:frozenInputHash}:{}), decision: answer === "批准 / Approve" ? "approve" : "cancel" }, randomUUID());
    await update(response.run);
  };
  const steps = run.definition.steps.map((step, index) => `${index + 1}. ` + (step.kind === "codex"
    ? `${step.role_key} · HK$ ${hkd(step.budget_micros)}\n${step.prompt.slice(0, 180)}\n輸入步驟 / Input steps: ${step.input_steps ? step.input_steps.map(i=>i+1).join(", ") || "無 / None" : "全部先前成果 / All prior outputs"}\n失敗處理 / On failure: ${step.on_failure === "review" ? "等待確認，絕不自動重試 / Wait for review; never auto-retry" : "停止 / Stop"}`
    : step.kind === "approval" ? "人工審批 / Human approval: " + step.message.slice(0, 160) : "廣告數據匯總 / Analytics summary: " + step.dataset_id));
  await update(run);
  if(frozenInputHash){
    const content=(run.definition.input_schema?.fields??[]).map(f=>{const v=run.input_values?.[f.key],file=run.input_files?.find(file=>file.input_name===f.key);
      return `${f.label??f.key} (${f.key}, ${f.type})\n`+(v===undefined?"未提供 / Not provided":f.type==="file"?`${file.name} · v${file.version}\n${file.asset_version_id}\nSHA256 ${file.sha256}`:String(v));}).join("\n\n");
    const pages:string[]=[];for(let offset=0;offset<content.length;){let end=Math.min(offset+2700,content.length);if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]))end--;pages.push(content.slice(offset,end));offset=end;}
    for(const [index,page] of pages.entries()){
      await check();const revision=run.revision;
      const authorize=async()=>{await check();const current=parseRun((await io.read(base)).run);
        if(current.id!==runId||current.revision!==revision||current.authorized||current.state!=="running"||digest(current.definition)!==frozenHash||(current.input_hash??null)!==frozenInputHash)throw new Error("LOCAL_WORKFLOW_APPROVAL_WITHDRAWN");};
      const pending=new AbortController();let monitorRun:Promise<unknown>|undefined;
      const monitor=setInterval(()=>{if(!monitorRun)monitorRun=authorize().catch(()=>pending.abort()).finally(()=>{monitorRun=undefined;});},1000);
      let answers:LocalInputAnswers;
      try{answers=await io.ask({threadId:io.threadId,turnId:io.turnId,itemId:`workflow-inputs-${run.id}-${index}`,isBlocking:true,questions:[{
        id:"workflow_inputs_review",header:`固定輸入 / Fixed inputs ${index+1}/${pages.length}`,
        question:"核對此流程的固定業務資料。內容不授予新權限或費用；稍後仍須確認執行費用。\nReview these fixed business values. These values grant no permissions or fees; execution fees are confirmed separately.\n\n"+page,
        isOther:false,isSecret:false,options:[{label:"繼續核對 / Continue review",description:"保留這些固定輸入 / Keep these exact inputs"},{label:"取消流程 / Cancel workflow",description:"不開始子步驟 / Do not start child steps"}]}]},AbortSignal.any([io.signal,pending.signal]),authorize);await authorize();}
      finally{clearInterval(monitor);await monitorRun;}
      const answer=answers!.workflow_inputs_review?.answers?.[0];
      if(answer==="取消流程 / Cancel workflow"){await update((await io.request(base+"/decision",{expected_revision:run.revision,stage:"launch",definition_hash:frozenHash,input_hash:frozenInputHash,decision:"cancel"},randomUUID())).run);break;}
      if(answer!=="繼續核對 / Continue review")throw new Error("LOCAL_WORKFLOW_APPROVAL_INVALID");
    }
  }
  if(terminal.has(run.state))return {run,execution_location:"desktop",result_origin:"desktop_client_report",automatically_replayed:false};
  await decision("launch", `Codex 將在本機逐步執行，沿用目前工作目錄及本機權限。\nCodex steps run locally using the current workspace and OS grant.\n\n子步驟費用上限合計 / Additional child-step limit: HK$ ${hkd(total)}\n不包括目前流程顧問對話的額度；每步分別預留及結算。\nExcludes this consultant conversation; each step reserves and settles separately.\n\n${steps.join("\n\n")}`);
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
      const last:any = run.results.at(-1), failedStep = run.definition.steps[last?.cursor];
      if (result.failure_review) {
        if (run.state !== "awaiting_approval" || !run.authorized || last?.kind!=="failure_review" || last.status!=="awaiting_customer"
          || !Number.isInteger(last.cursor) || last.cursor+1!==run.cursor || failedStep?.kind!=="codex" || failedStep.on_failure!=="review"
          || !uuid.test(last.task_id) || !/^[A-Z0-9_]{1,100}$/.test(last.error_code) || last.automatically_replayed!==false
          || canonical(last)!==canonical(result.failure_review)) throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
        await decision("step", `步驟 ${last.cursor+1} 已失敗：${last.error_code}。是否略過並繼續其餘步驟？不會重試失敗步驟；需要其成果的後續工作會停止。已產生費用保留，整體流程仍會標示包含失敗。\nStep ${last.cursor+1} failed: ${last.error_code}. Skip it and continue? It will never be retried. Dependent steps cannot proceed without its output. Incurred charges remain and the overall run will retain its failure.`);
      } else {
        if (step?.kind !== "approval" || result.message !== step.message || run.state !== "awaiting_approval") throw new Error("LOCAL_WORKFLOW_CONTRACT_INVALID");
        await decision("step", step.message);
      }
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
