import { z } from "zod";
import type { Tx } from "./db.js";
import { canonical, Problem } from "./lib.js";
import { event } from "./tasks.js";
import { settle } from "./billing.js";
import { taskProviderBudgetReceipt } from "./provider-budgets.js";
import { questionRequest } from "./task-input-contracts.js";

async function measuredTaskUsage(tx: Tx, taskId: string) {
  // Financial readers do not inherit the model's active task scope. Bind this
  // already-authorized task only while reading its aggregate billing facts.
  const prior = (
    await tx.query("SELECT current_setting('app.task_id',true) AS id")
  ).rows[0].id;
  await tx.query("SELECT set_config('app.task_id',$1,true)", [taskId]);
  const receipt = await taskProviderBudgetReceipt(tx, taskId);
  await tx.query("SELECT set_config('app.task_id',$1,true)", [prior ?? ""]);
  return receipt;
}

// Models may describe a missing input; only a human can select its resources.
export const paidInputRequest = z
  .object({
    requests: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("file"),
              description: z.string().trim().min(1).max(2000),
            })
            .strict(),
          z
            .object({
              kind: z.literal("connection"),
              provider: z.enum(["google_ads", "ga4", "search_console", "meta"]),
              description: z.string().trim().min(1).max(2000),
            })
            .strict(),
          questionRequest,
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict();

export async function requestPaidInputs(
  tx: Tx,
  task: any,
  fencing: string,
  role: any,
  args: z.infer<typeof paidInputRequest>,
  callId: string,
) {
  const t = (
    await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [task.id])
  ).rows[0];
  if (
    !t ||
    t.status !== "running" ||
    t.mode !== "execute" ||
    t.fencing_token !== fencing ||
    !t.runtime_thread ||
    !t.runtime_turn ||
    t.cancel_requested ||
    t.content_state !== "active"
  )
    throw new Problem(
      409,
      "INPUT_CHECKPOINT_UNAVAILABLE",
      "This model turn cannot open an input checkpoint",
    );
  if (
    args.requests.some(
      (d) =>
        d.kind !== "question" &&
        !role.tool_ids.includes(
          d.kind === "file" ? "asset.read" : "connector.read",
        ),
    )
  )
    throw new Problem(
      403,
      "DEPENDENCY_SCOPE_EXCEEDED",
      "This specialist cannot use the requested input type",
    );
  const old = (
    await tx.query(
      "SELECT * FROM task_input_checkpoints WHERE task_id=$1 AND fencing_token=$2",
      [t.id, fencing],
    )
  ).rows[0];
  if (old) {
    if (canonical(old.requests) !== canonical(args.requests))
      throw new Problem(
        409,
        "INPUT_ALREADY_REQUESTED",
        "Finish this turn after requesting its missing inputs",
      );
    return {
      request_id: old.id,
      status: "requested",
      instruction:
        "Finish this turn. The user will select these inputs before the same task continues.",
    };
  }
  const counts = (
    await tx.query(
      "SELECT ((SELECT count(*) FROM task_input_checkpoints WHERE task_id=$1)+(SELECT count(*) FROM task_pause_checkpoints WHERE task_id=$1))::int AS rounds,(SELECT count(*) FROM task_dependencies WHERE task_id=$1)::int AS inputs",
      [t.id],
    )
  ).rows[0];
  if (counts.rounds >= 8 || counts.inputs + args.requests.length > 32)
    throw new Problem(
      409,
      "INPUT_CHECKPOINT_LIMIT",
      "This task has reached its bounded input-request limit",
    );
  const row = (
    await tx.query(
      `INSERT INTO task_input_checkpoints(tenant_id,project_id,task_id,attempt,fencing_token,call_id,requests,runtime_thread,runtime_turn)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        t.tenant_id,
        t.project_id,
        t.id,
        t.attempt,
        fencing,
        callId,
        JSON.stringify(args.requests),
        t.runtime_thread,
        t.runtime_turn,
      ],
    )
  ).rows[0];
  await event(tx, t.tenant_id, t.id, "task.input_requested", {
    request_id: row.id,
    count: args.requests.length,
  });
  return {
    request_id: row.id,
    status: "requested",
    instruction:
      "Finish this turn now. Do not invent the missing data or repeat completed operations. The user will select these inputs before the same task continues.",
  };
}

export async function assertNoPendingInputRequest(
  tx: Tx,
  task: any,
  fencing: string,
) {
  if (
    (
      await tx.query(
        "SELECT 1 FROM task_input_checkpoints WHERE task_id=$1 AND fencing_token=$2 AND state='requested'",
        [task.id, fencing],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "INPUT_REQUEST_PENDING",
      "Finish the current turn and wait for the requested inputs before using another tool",
    );
}

/** A ready checkpoint is evidence of completed work, never permission to run. */
export async function paidInputCheckpoint(
  tx: Tx,
  task: any,
  state?: "waiting" | "queued",
) {
  let c = (
    await tx.query(
      "SELECT *, 'input' AS checkpoint_kind FROM task_input_checkpoints WHERE task_id=$1 AND attempt=$2 ORDER BY created_at DESC LIMIT 1",
      [task.id, task.attempt],
    )
  ).rows[0];
  if (!c) c=(await tx.query("SELECT *, 'pause' AS checkpoint_kind FROM task_pause_checkpoints WHERE task_id=$1 AND attempt=$2",[task.id,task.attempt])).rows[0];
  if (
    !c ||
    (state ? c.state !== state : !["waiting", "queued"].includes(c.state)) ||
    c.runtime_thread !== task.runtime_thread ||
    c.runtime_turn !== task.runtime_turn ||
    c.input_tokens !== task.input_tokens ||
    c.output_tokens !== task.output_tokens ||
    c.accrued_micros !== task.accrued_micros
  )
    return null;
  const reservation = (
    await tx.query(
      "SELECT status,amount_micros FROM reservations WHERE task_id=$1",
      [task.id],
    )
  ).rows[0];
  const actual = await measuredTaskUsage(tx, task.id);
  const uncertain = (
    await tx.query(
      "SELECT 1 FROM tool_operations WHERE task_id=$1 AND state IN('accepted','reconciling') UNION ALL SELECT 1 FROM device_commands WHERE task_id=$1 AND state IN('pending','claimed') LIMIT 1",
      [task.id],
    )
  ).rowCount;
  if (
    reservation?.status !== "reserved" ||
    reservation.amount_micros !== task.budget_micros ||
    Number(c.accrued_micros) > Number(task.budget_micros) ||
    uncertain ||
    actual.uncertain ||
    actual.violation ||
    (actual.requests &&
      (actual.knownChargeMicros !== Number(c.accrued_micros) ||
        actual.inputTokens !== Number(c.input_tokens) ||
        actual.outputTokens !== Number(c.output_tokens)))
  )
    return null;
  return c;
}

export async function queuedPaidContinuation(tx: Tx, task: any) {
  if (task.attempt === 0) return null;
  const checkpoint = await paidInputCheckpoint(tx, task, "queued");
  if (!checkpoint)
    throw new Problem(
      409,
      "INPUT_CHECKPOINT_UNAVAILABLE",
      "A completed, measured native input checkpoint is required before continuing paid work",
    );
  return checkpoint;
}
export async function consumePaidContinuation(
  tx: Tx,
  checkpoint: any,
  claimed: any,
) {
  if (!checkpoint) return;
  if (claimed.attempt !== checkpoint.attempt + 1)
    throw new Error("Paid continuation attempt mismatch");
  const table=checkpoint.checkpoint_kind === "pause" ? "task_pause_checkpoints" : "task_input_checkpoints";
  const consumed=await tx.query(`UPDATE ${table} SET state='consumed',resumed_at=now() WHERE id=$1 AND state='queued'`,[checkpoint.id]);
  if(consumed.rowCount!==1) throw new Error("Continuation checkpoint was already consumed");
}

export async function completePaidInputCheckpoint(
  tx: Tx,
  task: any,
  text: string,
  input: number,
  output: number,
  cost: number,
  native?: { thread: string; turn: string },
) {
  const checkpoint = (
    await tx.query(
      "SELECT * FROM task_input_checkpoints WHERE task_id=$1 AND fencing_token=$2 AND state='requested' FOR UPDATE",
      [task.id, task.fencing_token],
    )
  ).rows[0];
  if (!checkpoint) return false;
  if (
    !native ||
    native.thread !== checkpoint.runtime_thread ||
    native.turn !== checkpoint.runtime_turn ||
    cost > Number(task.budget_micros)
  )
    throw new Problem(
      409,
      "INPUT_CHECKPOINT_UNAVAILABLE",
      "The input request did not finish at a measured native turn boundary",
    );
  await tx.query(
    "UPDATE task_input_checkpoints SET state='waiting',input_tokens=$2,output_tokens=$3,accrued_micros=$4,ready_at=now() WHERE id=$1",
    [checkpoint.id, input, output, cost],
  );
  for (const [i, d] of checkpoint.requests.entries())
    await tx.query(
      `INSERT INTO task_dependencies(tenant_id,project_id,task_id,step_key,kind,description,required_scope,provider,checkpoint_id,question_options)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        task.tenant_id,
        task.project_id,
        task.id,
        `input-paid-${task.attempt}-${i + 1}`,
        d.kind,
        d.description,
        d.kind === "question" ? "task.answer" : d.kind === "file"
          ? "project.asset_version.read"
          : "project.connection.read:" + d.provider,
        d.provider ?? null,
        checkpoint.id,
        d.options ?? [],
      ],
    );
  await tx.query(
    "UPDATE tasks SET status='needs_input',output=$2,input_tokens=$3,output_tokens=$4,accrued_micros=$5,lease_until=NULL,capacity_wait_reason=NULL,error_code=NULL,version=version+1,updated_at=now() WHERE id=$1",
    [task.id, text, input, output, cost],
  );
  await event(tx, task.tenant_id, task.id, "task.needs_input", {
    checkpoint: "completed_model_turn",
    request_id: checkpoint.id,
    attempt: task.attempt,
  });
  await event(tx, task.tenant_id, task.id, "usage.updated", {
    amount_micros: String(cost),
    cost_state: "estimated",
  });
  if (text && task.conversation_id) {
    await tx.query(
      "INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'assistant','result',$5,$6) ON CONFLICT(conversation_id,client_message_id) DO NOTHING",
      [
        task.tenant_id,
        task.project_id,
        task.conversation_id,
        checkpoint.id,
        text,
        task.id,
      ],
    );
    await tx.query(
      "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
      [task.conversation_id],
    );
  }
  return true;
}

/** Close an idle task using its measured cumulative cost. No paid checkpoint
 * means uncertainty, rather than a zero-cost cancellation of previously paid work. */
export async function settleIdleTask(tx: Tx, task: any) {
  const checkpoint =
    task.attempt > 0 ? await paidInputCheckpoint(tx, task) : null;
  const touched =
    task.attempt > 0 ||
    !!task.runtime_thread ||
    !!(
      await tx.query("SELECT 1 FROM tool_operations WHERE task_id=$1 LIMIT 1", [
        task.id,
      ])
    ).rowCount;
  const actual = await measuredTaskUsage(tx, task.id);
  const known = !!checkpoint || !touched;
  const cost = actual.requests
    ? actual.knownChargeMicros
    : Number(checkpoint?.accrued_micros ?? task.accrued_micros ?? 0);
  await settle(
    tx,
    task.tenant_id,
    task.id,
    cost,
    task.created_by,
    !known || actual.uncertain || actual.violation,
  );
  return (
    known &&
    !actual.uncertain &&
    !actual.violation &&
    cost <= Number(task.budget_micros)
  );
}
