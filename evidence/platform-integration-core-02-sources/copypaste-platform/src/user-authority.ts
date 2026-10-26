import type { Tx } from "./db.js";
import { Problem } from "./lib.js";
import type { Principal } from "./auth.js";

/** Acquire sorted user authority locks before membership or user row locks.
 * Global account changes and grants must agree on their authorization order. */
export async function lockUserAuthorities(tx: Tx, users: string[]) {
  for (const id of [...new Set(users)].sort())
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `user-authority:${id}`,
    ]);
}
export async function currentUserAuthority(tx: Tx, p: Principal) {
  const u = (await tx.query("SELECT * FROM users WHERE id=$1", [p.id])).rows[0];
  if (!u || u.status !== "active" || u.auth_version !== p.authVersion)
    throw new Problem(
      401,
      "AUTHORIZATION_CHANGED",
      "Your account authorization changed; sign in again",
    );
  return u;
}
