import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { Problem } from "./lib.js";

export async function desktopSessionFamily(
  tx: Tx,
  actor: Principal,
  required = true,
) {
  const row =
    actor.audience === "native"
      ? (
          await tx.query(
            "SELECT family_id FROM refresh_tokens WHERE session_id=$1 AND user_id=$2 AND client_id='desktop' AND revoked_at IS NULL AND expires_at>now() LIMIT 1",
            [actor.sessionId, actor.id],
          )
        ).rows[0]
      : undefined;
  if (!row && required)
    throw new Problem(
      403,
      "DESKTOP_SIGN_IN_REQUIRED",
      "A current desktop authorization is required",
    );
  return row?.family_id as string | undefined;
}
