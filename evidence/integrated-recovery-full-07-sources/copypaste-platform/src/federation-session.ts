import type { Tx } from "./db.js";

export async function validFederation(tx: Pick<Tx, "query">, session: any) {
  if (!session.federation_identity_id) return true;
  return !!(
    await tx.query("SELECT federated_identity_valid($1,$2,$3) AS valid", [
      session.federation_identity_id,
      session.user_id,
      session.federation_revision,
    ])
  ).rows[0]?.valid;
}

/** Scrub expired PKCE/nonce material without waiting for a user to return. */
export async function expireFederationAttempts(tx: Pick<Tx, "query">) {
  await tx.query(`WITH expired AS (
    SELECT id FROM federation_attempts WHERE expires_at<=now() AND phase NOT IN ('complete','failed')
    ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 100
  ) UPDATE federation_attempts a SET phase='failed',secrets=NULL FROM expired e WHERE a.id=e.id`);
}

export async function revokeFederatedUsers(
  tx: Tx,
  connection: string,
  user?: string,
) {
  const people = (
    await tx.query(
      "UPDATE federated_identities SET status='revoked',version=version+1 WHERE connection_id=$1 AND ($2::uuid IS NULL OR user_id=$2) RETURNING user_id",
      [connection, user ?? null],
    )
  ).rows.map((r: any) => r.user_id);
  if (!people.length) return;
  await tx.query(
    "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [people],
  );
  // Invalidate in-flight task authorization as well as browser/native credentials.
  await tx.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=ANY($1::uuid[])",
    [people],
  );
  await tx.query(
    "UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL",
    [people],
  );
  await tx.query(
    "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL",
    [people],
  );
  await tx.query(
    "UPDATE native_auth_codes SET consumed_at=now() WHERE user_id=ANY($1::uuid[]) AND consumed_at IS NULL",
    [people],
  );
}
