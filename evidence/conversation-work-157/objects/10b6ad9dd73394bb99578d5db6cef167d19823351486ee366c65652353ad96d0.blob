import type {Tx} from "./db.js";
import {Problem} from "./lib.js";
/** Serialize admission with short result commits, never with the model turn.
 * API callers may already own a source task/plan: fail fast instead of waiting
 * in the reverse task -> conversation order. Worker takes this BEFORE its task
 * and wallet locks, preventing conversation -> wallet / wallet -> conversation.
 */
export async function conversationMutation(tx:Tx,id:string,wait=false) {
  const key="conversation-commit:"+id;
  if(wait){await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);return;}
  const row=(await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[key])).rows[0];
  if(!row.locked)throw new Problem(409,"CONVERSATION_CHANGING","Another conversation update is committing; refresh and retry");
}
