import type {Tx} from "./db.js";
import {Problem} from "./lib.js";
import {event} from "./tasks.js";

/** Caller holds task-tool. NOWAIT avoids an inverse task/tool lock order.
 * Accepted-operation finalizers retain their existing settlement authority. */
export async function assertTaskToolNotPausing(tx:Tx,id:string) {
  let row;
  try {row=(await tx.query("SELECT pause_requested FROM tasks WHERE id=$1 FOR SHARE NOWAIT",[id])).rows[0];}
  catch(error) {
    if((error as {code?:string}).code==="55P03")
      throw new Problem(409,"TASK_CONTROL_CHANGING","Task control is changing; finish this turn and refresh");
    throw error;
  }
  if(row?.pause_requested) throw new Problem(409,"TASK_PAUSE_REQUESTED",
    "The user requested a pause. Finish this turn now; do not start further tools or repeat completed operations.");
}

/** Only after Worker validates the completed native turn, current original
 * authority, actual cumulative usage and all uncertain operations. */
export async function completeTaskPause(tx:Tx,task:any,text:string,input:number,output:number,cost:number,
  native?:{thread:string;turn:string}) {
  if(!task.pause_requested || task.execution_location!=="cloud" || !native) return false;
  if(native.thread!==task.runtime_thread || native.turn!==task.runtime_turn || cost>Number(task.budget_micros))
    throw new Problem(409,"PAUSE_CHECKPOINT_UNAVAILABLE","The task did not finish at a measured native turn boundary");
  const checkpoint=(await tx.query("INSERT INTO task_pause_checkpoints "+
    "(tenant_id,project_id,task_id,attempt,fencing_token,runtime_thread,runtime_turn,input_tokens,output_tokens,accrued_micros) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [task.tenant_id,task.project_id,task.id,task.attempt,task.fencing_token,native.thread,native.turn,input,output,cost])).rows[0];
  await tx.query("UPDATE tasks SET status='paused',output=$2,input_tokens=$3,output_tokens=$4,accrued_micros=$5,"+
    "lease_until=NULL,capacity_wait_reason=NULL,error_code=NULL,version=version+1,updated_at=now() WHERE id=$1",
    [task.id,text,input,output,cost]);
  await event(tx,task.tenant_id,task.id,"task.paused",{previous:"running",status:"paused",checkpoint:"completed_model_turn",request_id:checkpoint.id});
  await event(tx,task.tenant_id,task.id,"usage.updated",{amount_micros:String(cost),cost_state:"estimated"});
  if(text && task.conversation_id) {
    await tx.query("INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) "+
      "VALUES($1,$2,$3,$4,'assistant','result',$5,$6) ON CONFLICT(conversation_id,client_message_id) DO NOTHING",
      [task.tenant_id,task.project_id,task.conversation_id,checkpoint.id,text,task.id]);
    await tx.query("UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",[task.conversation_id]);
  }
  return true;
}

/** Metadata only; execution authority is always checked again on submission. */
export function taskControlState(task:any) {
  const cloud=task.execution_location==="cloud" && task.content_state==="active" && !task.cancel_requested;
  return {task_id:task.id,version:task.version,pause_requested:!!task.pause_requested,
    phase:task.status==="running" && task.pause_requested ? "pause_requested"
      :task.status==="paused" ? task.attempt>0 ? "paused_at_checkpoint" : "paused_before_execution"
      :task.status==="needs_input" && task.pause_requested ? "waiting_inputs_with_pause" : task.status,
    can_request_pause:cloud && ["queued","running"].includes(task.status) && !task.pause_requested,
    can_request_resume:cloud && task.status==="paused",
    budget_micros:String(task.budget_micros),accrued_micros:String(task.accrued_micros??0),
    boundary:"completed_measured_model_turn",permission_rechecked_on_submit:true};
}
