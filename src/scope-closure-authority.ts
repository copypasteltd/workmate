import type {Tx} from "./db.js";
import type {Principal} from "./auth.js";
import {lockUserAuthorities,currentUserAuthority} from "./user-authority.js";
import {validFederation} from "./federation-session.js";
import {Problem} from "./lib.js";
/** Serialize irreversible acceptance/owned execution closure with logout and
 * session withdrawal. No archived tenant or private content access is granted. */
export async function lockCurrentScopeSession(tx:Tx,p:Principal) {
  await lockUserAuthorities(tx,[p.id]);
  await tx.query("SELECT id FROM users WHERE id=$1 FOR SHARE",[p.id]);
  await currentUserAuthority(tx,p);
  const session=(await tx.query("SELECT *,expires_at>clock_timestamp() AS valid FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",[p.sessionId,p.id])).rows[0];
  if(!session?.valid || session.revoked_at || session.auth_version!==p.authVersion || session.audience!==p.audience || session.token_hash!==p.sessionHash || !(await validFederation(tx,session)))
    throw new Problem(401,"SESSION_EXPIRED","Please sign in again");
}
