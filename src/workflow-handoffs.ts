import { z } from "zod";
import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import { hash, Problem, uuid } from "./lib.js";
import { assertTaskContentSources, recordTaskContentRead } from "./task-content-sources.js";

const file = z.object({ asset_id: uuid, asset_version_id: uuid, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string(), version:z.number().int().positive(), mime_type: z.string(), bytes: z.string().regex(/^\d+$/) }).strict();
const binding = z.object({ step_index: z.number().int().min(0).max(7), task_id: uuid.optional(),
  result_origin: z.enum(["cloud_task", "desktop_client_report", "analytics_summary"]), files: z.array(file).max(201) }).strict();
export const workflowInputs = z.array(binding).max(8);
export const workflowReadInput = z.object({ step_index: z.number().int().min(0).max(7).optional(),
  input_name:z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).optional(),
  asset_version_id: uuid.optional(), offset: z.number().int().min(0).max(2_000_000).optional(),
  max_characters: z.number().int().min(1).max(16000).optional() }).strict();
const unavailable = () => new Problem(409, "WORKFLOW_INPUT_UNAVAILABLE", "A selected workflow result is no longer available; do not substitute another version");

/** A frozen definition selects only actual earlier producing steps. Omitted
 * input_steps preserves legacy sequential behavior; [] explicitly selects none. */
export function workflowInputIndices(definition: any, cursor: number): number[] {
  const step = definition.steps[cursor];
  return step.input_steps ?? definition.steps.slice(0, cursor)
    .flatMap((s: any, i: number) => s.kind === "approval" ? [] : [i]);
}

/** Store full text once as an actual private deliverable. The run receipt is
 * deliberately only a preview; subsequent tools read pinned, verified bytes. */
export async function captureWorkflowOutput(tx: Tx, storage: Storage, run: any, child: any) {
  await assertTaskContentSources(tx, child);
  const files = (await tx.query(`SELECT a.id AS asset_id,v.id AS asset_version_id,a.name,v.version,v.mime_type,v.bytes::text,v.sha256
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.tenant_id=$1 AND a.project_id=$2
    AND (a.private_owner IS NULL OR a.private_owner=$3) AND v.metadata->>'task_id'=$4
    AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
    ORDER BY a.id,v.version LIMIT 201`, [child.tenant_id,child.project_id,child.created_by,child.id])).rows;
  if (files.length > 200) throw new Problem(409,"WORKFLOW_OUTPUT_LIMIT","Review a step with more than 200 output versions separately");
  const previous = (await tx.query("SELECT current_setting('app.task_id',true) AS id")).rows[0].id ?? "";
  await tx.query("SELECT set_config('app.task_id','',true)");
  let output;
  try {
    output = await saveAsset(tx,storage,{tenant:child.tenant_id,project:child.project_id,user:child.created_by,
      privateOwner:child.created_by,name:`workflow-step-${run.cursor+1}-result.txt`,mime:"text/plain",
      bytes:Buffer.from(child.output ?? "","utf8"),metadata:{task_id:child.id,workflow_run_id:run.id,
        workflow_step_index:run.cursor,result_origin:child.execution_location === "desktop" ? "desktop_client_report" : "cloud_task"}});
  } finally { await tx.query("SELECT set_config('app.task_id',$1,true)",[previous]); }
  const exact = {asset_id:output.id,asset_version_id:output.version.id,name:output.name,
    version:output.version.version,mime_type:output.version.mime_type,bytes:String(output.version.bytes),sha256:output.version.sha256};
  const text = child.output ?? "";
  let previewEnd = Math.min(text.length,6000);
  // Keep the JSON receipt within its limit without splitting a Unicode pair.
  if (previewEnd > 0 && previewEnd < text.length &&
      text.charCodeAt(previewEnd-1) >= 0xd800 && text.charCodeAt(previewEnd-1) <= 0xdbff &&
      text.charCodeAt(previewEnd) >= 0xdc00 && text.charCodeAt(previewEnd) <= 0xdfff) previewEnd--;
  return {kind:"codex",cursor:run.cursor,task_id:child.id,role_key:child.role_key,status:"succeeded",
    charged_micros:String(child.charged_micros),result_origin:child.execution_location === "desktop" ? "desktop_client_report" : "cloud_task",
    output:text.slice(0,previewEnd),output_file:exact,files:[exact,...files]};
}

export async function bindWorkflowInputs(tx: Tx, run: any, cursor: number, results: any[]) {
  const bindings = [];
  for (const index of workflowInputIndices(run.definition,cursor)) {
    const result = results.find(r => r.cursor === index && r.status === "succeeded" && ["codex","analytics.summary"].includes(r.kind));
    if (!result) throw new Problem(409,"WORKFLOW_REQUIRED_STEP_FAILED","A required predecessor did not succeed; revise the workflow instead of inventing its output");
    let files = result.files;
    // Older retained receipts can expose their real saved summary version;
    // truncated legacy text is never relabelled as a complete deliverable.
    if (!files && result.asset_version_id) files = (await tx.query(`SELECT a.id AS asset_id,v.id AS asset_version_id,a.name,v.version,v.mime_type,v.bytes::text,v.sha256
      FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3
      AND (a.private_owner IS NULL OR a.private_owner=$4) AND a.state='active' AND v.erased_at IS NULL AND a.retention_expires_at>clock_timestamp()`,
      [result.asset_version_id,run.tenant_id,run.project_id,run.private_owner])).rows;
    if (!files?.length) throw new Problem(409,"WORKFLOW_LEGACY_OUTPUT_INCOMPLETE","This older receipt has no complete saved output; review it separately");
    bindings.push({step_index:index,...(result.task_id?{task_id:result.task_id}:{}),
      result_origin:result.result_origin ?? "analytics_summary",files});
  }
  const parsed = workflowInputs.parse(bindings);
  for (const item of parsed) for (const f of item.files) {
    const checked = (await tx.query(`SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=$1 AND v.asset_id=$2 AND v.sha256=$3 AND a.tenant_id=$4 AND a.project_id=$5
      AND (a.private_owner IS NULL OR a.private_owner=$6) AND a.state='active' AND v.erased_at IS NULL
      AND a.retention_expires_at>clock_timestamp() FOR SHARE OF a`,
      [f.asset_version_id,f.asset_id,f.sha256,run.tenant_id,run.project_id,run.private_owner])).rowCount;
    if (!checked) throw unavailable();
  }
  return parsed;
}

export async function readWorkflowInputs(tx: Tx, storage: Storage, task: any, raw: unknown) {
  const input = workflowReadInput.parse(raw), bindings = workflowInputs.parse(task.input_context?.workflow_inputs ?? []);
  const named=task.input_context?.workflow_binding;
  const namedFiles=z.array(file.extend({input_name:z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)})).max(12).parse(named?.files??[]);
  if ((!bindings.length&&!named) || !(task.cloud_workflow_run_id || task.desktop_workflow_run_id)) throw unavailable();
  await assertTaskContentSources(tx,task);
  const selected = input.step_index === undefined ? bindings : bindings.filter(b=>b.step_index===input.step_index);
  if (input.step_index!==undefined&&!selected.length) throw unavailable();
  if(input.input_name && !Object.hasOwn(named?.values??{},input.input_name))throw unavailable();
  const selectedNames=input.input_name?namedFiles.filter(f=>f.input_name===input.input_name):namedFiles;
  if (!input.asset_version_id) return {untrusted_source_data:true,items:selected,...(named?{named_inputs:input.input_name?{[input.input_name]:named.values[input.input_name]}:named.values,named_files:selectedNames}:{})};
  const f = [...selected.flatMap(b=>b.files),...selectedNames].find(f=>f.asset_version_id===input.asset_version_id);
  if (!f) throw unavailable();
  const version = (await tx.query(`SELECT v.* FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=$1 AND v.sha256=$2 AND a.tenant_id=$3 AND a.project_id=$4
    AND (a.private_owner IS NULL OR a.private_owner=$5) AND a.state='active' AND v.erased_at IS NULL
    AND a.retention_expires_at>clock_timestamp()`,[f.asset_version_id,f.sha256,task.tenant_id,task.project_id,task.created_by])).rows[0];
  if (!version) throw unavailable();
  if (!["text/plain","text/markdown","text/csv","application/json"].includes(version.mime_type) || Number(version.bytes)>2_000_000)
    throw new Problem(400,"WORKFLOW_INPUT_READER_REQUIRED","Use the specialist's exact-version media reader for this file");
  const bytes = await storage.get(version.storage_key);
  if (bytes.length!==Number(version.bytes) || hash(bytes)!==f.sha256) throw unavailable();
  const text = bytes.toString("utf8"), offset = input.offset ?? 0, end = Math.min(text.length,offset+(input.max_characters ?? 8000));
  if (offset>text.length) throw new Problem(400,"WORKFLOW_INPUT_OFFSET","The page is outside this saved result");
  await recordTaskContentRead(tx,task,"asset_version",f.asset_version_id,f.asset_version_id,f.sha256);
  return {untrusted_source_data:true,asset_version_id:f.asset_version_id,sha256:f.sha256,text:text.slice(offset,end),
    offset,offset_unit:"utf16_code_units",total_characters:text.length,next_offset:end<text.length?end:null};
}

export function pendingWorkflowFailure(run: any) {
  const last = run.results.at(-1);
  return last?.kind === "failure_review" && last.status === "awaiting_customer" ? last : null;
}

/** Only a known terminal, settled failure can be reviewed. Reconciliation,
 * cancellation and changed authority always stop the whole run. Never retry. */
export async function reviewableWorkflowFailure(tx: Tx, child: any, step: any) {
  if (step?.on_failure!=="review" || child?.status!=="failed" || child.cancel_requested
    || (child.error_code && !/^[A-Z0-9_]{1,100}$/.test(child.error_code))
    || /SOURCE|AUTH|SCOPE|PERMISSION|REVOK|EXPIRE|CANCEL|RECONCIL|USAGE|FUND|BUDGET|CONTENT|BILLING|INTEGRITY/.test(child.error_code ?? "")) return false;
  await assertTaskContentSources(tx,child);
  return (await tx.query("SELECT workflow_failure_review_ready($1) AS ready",[child.id])).rows[0].ready === true;
}

export function workflowFailureReceipt(run: any, child: any) {
  return {kind:"failure_review",cursor:run.cursor,task_id:child.id,role_key:child.role_key,status:"awaiting_customer",
    error_code:child.error_code ?? "STEP_FAILED",charged_micros:String(child.charged_micros),automatically_replayed:false};
}
