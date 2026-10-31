import type { FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import { z } from "zod";
import { canonical, equal, hash, hmac, Problem, seal, unseal } from "./lib.js";
import { validFederation } from "./federation-session.js";

type Operation = "challenge" | "session" | "code" | "refresh";
export function authRequestKey(req: FastifyRequest): string {
  return z.string().min(8).max(128).parse(req.headers["idempotency-key"]);
}
function keyHash(db: Database, req: FastifyRequest, operation: Operation) {
  return hmac(
    db.config.MASTER_KEY!,
    `auth-key:${operation}:${authRequestKey(req)}`,
  );
}
/** A receipt never makes a revoked credential live again. All mutations and
 * the encrypted result commit together, including refresh reuse revocation. */
export async function authRequest<T>(
  db: Database,
  req: FastifyRequest,
  operation: Operation,
  body: unknown,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const key = keyHash(db, req, operation),
    requestHash = hmac(db.config.MASTER_KEY!, canonical(body));
  return db.tx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `auth-receipt:${operation}:${key}`,
    ]);
    await tx.query(
      "DELETE FROM auth_request_receipts WHERE operation=$1 AND key_hash=$2 AND expires_at<=now()",
      [operation, key],
    );
    const receipt = (
      await tx.query(
        "SELECT * FROM auth_request_receipts WHERE operation=$1 AND key_hash=$2",
        [operation, key],
      )
    ).rows[0];
    if (receipt) {
      if (!equal(receipt.request_hash, requestHash))
        throw new Problem(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Use a new request key when changing sign-in details",
        );
      if (
        receipt.flow_hash &&
        (!req.cookies.cp_auth_flow ||
          !equal(receipt.flow_hash, hash(req.cookies.cp_auth_flow)))
      )
        throw new Problem(
          401,
          "INVALID_CODE",
          "Restart sign-in in this browser",
        );
      const result = JSON.parse(
        unseal(db.config.MASTER_KEY!, receipt.response_cipher),
      );
      if (receipt.session_id) {
        const session = (
          await tx.query(
            `SELECT s.*,u.status,u.auth_version AS current_version FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
            [receipt.session_id],
          )
        ).rows[0];
        if (
          !session ||
          session.status !== "active" ||
          session.auth_version !== session.current_version ||
          !(await validFederation(tx, session))
        )
          throw new Problem(401, "SESSION_EXPIRED", "Please sign in again");
        // Replaying a receipt returns the same credential, with its remaining
        // lifetime. A retry must not extend a native client's expiry cache.
        if (operation === "code" || operation === "refresh")
          result.expires_in = Math.max(
            1,
            Math.min(
              result.expires_in,
              Math.ceil((session.expires_at.getTime() - Date.now()) / 1000),
            ),
          );
      }
      return result as T;
    }
    const result = await work(tx);
    if (!result || (typeof result === "object" && "error" in result))
      return result;
    const value = result as Record<string, unknown>,
      credential = value.value ?? value.access_token;
    const sessionId =
      typeof credential === "string"
        ? (
            await tx.query("SELECT id FROM sessions WHERE token_hash=$1", [
              hash(credential),
            ])
          ).rows[0]?.id
        : null;
    await tx.query(
      `INSERT INTO auth_request_receipts(operation,key_hash,request_hash,flow_hash,response_cipher,session_id) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        operation,
        key,
        requestHash,
        operation === "session" && req.cookies.cp_auth_flow
          ? hash(req.cookies.cp_auth_flow)
          : null,
        seal(db.config.MASTER_KEY!, JSON.stringify(result)),
        sessionId ?? null,
      ],
    );
    return result;
  });
}

/** A failed mail attempt leaves the original challenge retryable under the same
 * key. SMTP happens after the transaction, without holding user/receipt locks. */
export async function deliverAuthChallenge(
  db: Database,
  req: FastifyRequest,
  send: () => Promise<void>,
) {
  const key = keyHash(db, req, "challenge"),
    owner = crypto.randomUUID();
  const claimed = await db.app.query(
    `UPDATE auth_request_receipts SET delivery_owner=$2,delivery_until=now()+interval '30 seconds' WHERE operation='challenge' AND key_hash=$1 AND delivered_at IS NULL AND (delivery_until IS NULL OR delivery_until<now()) RETURNING key_hash`,
    [key, owner],
  );
  if (!claimed.rowCount) return;
  try {
    await send();
    await db.app.query(
      "UPDATE auth_request_receipts SET delivered_at=now(),delivery_owner=NULL,delivery_until=NULL WHERE operation='challenge' AND key_hash=$1 AND delivery_owner=$2",
      [key, owner],
    );
  } catch (error) {
    await db.app.query(
      "UPDATE auth_request_receipts SET delivery_owner=NULL,delivery_until=NULL WHERE operation='challenge' AND key_hash=$1 AND delivery_owner=$2",
      [key, owner],
    );
    throw error;
  }
}
export async function cleanAuthReceipts(db: Database) {
  await db.app.query(
    `WITH expired AS (SELECT operation,key_hash FROM auth_request_receipts WHERE expires_at<=now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED) DELETE FROM auth_request_receipts r USING expired e WHERE r.operation=e.operation AND r.key_hash=e.key_hash`,
  );
}
