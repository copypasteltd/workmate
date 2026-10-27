import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { requireUser, audit } from "./auth.js";
import { tenantAccess } from "./access.js";
import { hash, uuid, name, Problem } from "./lib.js";
import {
  pairingProtocol,
  pairingHash,
  verifyPairing,
} from "./desktop-pairing-contract.js";

const grant = z
  .object({
    id: uuid,
    label: name,
    operations: z
      .array(z.enum(["file.list", "file.read", "file.write"]))
      .min(1)
      .max(3),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
export const desktopPairingSchema = z
  .object({
    protocol: z.literal(pairingProtocol),
    refresh_token: z.string().regex(/^[\w-]{43}$/),
    input: z
      .object({
        id: uuid,
        tenant_id: uuid,
        name,
        public_key: z.string().min(40).max(2000),
        grants: z.array(grant).max(20),
      })
      .strict(),
    signature: z.string().regex(/^[\w-]{86}$/),
  })
  .strict();
export const desktopPairingReceiptSchema = z
  .object({
    pairing_id: uuid,
    device: z
      .object({
        id: uuid,
        name,
        client: z.literal("desktop"),
        state: z.literal("active"),
        grants: z.array(grant).max(20),
      })
      .strict(),
  })
  .strict();
export const desktopPairingRetirementSchema = z
  .object({ pairing_id: uuid, status: z.enum(["retired", "unverified"]) })
  .strict();

export function registerDesktopPairings(app: FastifyInstance, db: Database) {
  app.post(
    "/v1/auth/native/device-pair",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const body = desktopPairingSchema.parse(req.body),
        b = body.input,
        p = req.principal;
      if (p.audience !== "native" || !verifyPairing("pair", body))
        throw new Problem(
          403,
          "PAIRING_PROOF_REQUIRED",
          "Pair from the authenticated Desktop installation",
        );
      const device = await db.tx(
        async (tx) => {
          await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [p.id]);
          const family = (
            await tx.query(
              `SELECT r.family_id FROM refresh_tokens r JOIN sessions s ON s.id=$3
        WHERE r.digest=$1 AND r.user_id=$2 AND r.client_id='desktop' AND r.revoked_at IS NULL
        AND s.user_id=$2 AND s.audience='native' AND s.revoked_at IS NULL AND s.expires_at>now() AND s.auth_version=$4
        AND EXISTS(SELECT 1 FROM refresh_tokens current_token WHERE current_token.session_id=s.id AND current_token.client_id='desktop' AND current_token.family_id=r.family_id AND current_token.revoked_at IS NULL)`,
              [hash(body.refresh_token), p.id, p.sessionId, p.authVersion],
            )
          ).rows[0];
          if (!family)
            throw new Problem(
              401,
              "PAIRING_SESSION_CHANGED",
              "Sign in again before pairing",
            );
          await tenantAccess(tx, p, b.tenant_id, "write");
          const previous = (
            await tx.query(
              "SELECT * FROM desktop_pairings WHERE user_id=$1 AND id=$2 FOR UPDATE",
              [p.id, b.id],
            )
          ).rows[0];
          if (previous) {
            if (
              previous.tenant_id !== b.tenant_id ||
              previous.family_id !== family.family_id ||
              previous.input_hash !== pairingHash(b) ||
              previous.public_key !== b.public_key
            )
              throw new Problem(
                409,
                "PAIRING_CONFLICT",
                "This pairing has different fixed inputs",
              );
            if (previous.state === "retired")
              throw new Problem(
                410,
                "PAIRING_RETIRED",
                "This pairing was retired; explicitly create a new pairing",
              );
            const existing = (
              await tx.query(
                "SELECT id,name,client,state,grants FROM devices WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND client='desktop'",
                [previous.device_id, b.tenant_id, p.id],
              )
            ).rows[0];
            if (!existing || existing.state !== "active")
              throw new Problem(
                410,
                "PAIRING_RETIRED",
                "This device was retired",
              );
            return existing;
          }
          if (b.grants.some((g) => Date.parse(g.expires_at) <= Date.now()))
            throw new Problem(
              400,
              "GRANT_EXPIRED",
              "Folder permission expired; explicitly grant access again",
            );
          const d = (
            await tx.query(
              "INSERT INTO devices(tenant_id,user_id,name,client,public_key,grants,last_seen_at) VALUES($1,$2,$3,'desktop',$4,$5,now()) RETURNING id,name,client,state,grants",
              [
                b.tenant_id,
                p.id,
                b.name,
                b.public_key,
                JSON.stringify(b.grants),
              ],
            )
          ).rows[0];
          await tx.query(
            "INSERT INTO desktop_pairings(user_id,id,tenant_id,family_id,input_hash,public_key,device_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,'paired')",
            [
              p.id,
              b.id,
              b.tenant_id,
              family.family_id,
              pairingHash(b),
              b.public_key,
              d.id,
            ],
          );
          await audit(
            tx,
            p,
            "device.desktop_pair",
            d.id,
            "succeeded",
            { pairing_id: b.id },
            b.tenant_id,
          );
          return d;
        },
        undefined,
        true,
      );
      reply.header("Cache-Control", "no-store");
      return desktopPairingReceiptSchema.parse({ pairing_id: b.id, device });
    },
  );
  app.post("/v1/auth/native/device-pair/retire", async (req, reply) => {
    const body = desktopPairingSchema.parse(req.body),
      b = body.input;
    let status: "retired" | "unverified" = "unverified";
    if (verifyPairing("retire", body))
      await db.tx(
        async (tx) => {
          const owner = (
            await tx.query(
              "SELECT user_id FROM refresh_tokens WHERE digest=$1 AND client_id='desktop'",
              [hash(body.refresh_token)],
            )
          ).rows[0];
          if (!owner) return;
          await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            owner.user_id,
          ]);
          const credential = (
            await tx.query(
              "SELECT * FROM refresh_tokens WHERE digest=$1 AND user_id=$2 AND client_id='desktop' FOR UPDATE",
              [hash(body.refresh_token), owner.user_id],
            )
          ).rows[0];
          if (!credential) return;
          const previous = (
            await tx.query(
              "SELECT * FROM desktop_pairings WHERE user_id=$1 AND id=$2 FOR UPDATE",
              [owner.user_id, b.id],
            )
          ).rows[0];
          if (
            previous &&
            (previous.tenant_id !== b.tenant_id ||
              previous.family_id !== credential.family_id ||
              previous.input_hash !== pairingHash(b) ||
              previous.public_key !== b.public_key)
          )
            return;
          if (!previous)
            await tx.query(
              "INSERT INTO desktop_pairings(user_id,id,tenant_id,family_id,input_hash,public_key,state) VALUES($1,$2,$3,$4,$5,$6,'retired')",
              [
                owner.user_id,
                b.id,
                b.tenant_id,
                credential.family_id,
                pairingHash(b),
                b.public_key,
              ],
            );
          else if (previous.state !== "retired") {
            await tx.query(
              "UPDATE devices SET state='revoked',grants='[]' WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND client='desktop' AND public_key=$4",
              [previous.device_id, b.tenant_id, owner.user_id, b.public_key],
            );
            await tx.query(
              "UPDATE device_commands SET state='cancelled' WHERE device_id=$1 AND tenant_id=$2 AND state IN ('pending','claimed')",
              [previous.device_id, b.tenant_id],
            );
            await tx.query(
              "UPDATE desktop_pairings SET state='retired',updated_at=now() WHERE user_id=$1 AND id=$2",
              [owner.user_id, b.id],
            );
          }
          if (!previous || previous.state !== "retired")
            await audit(
              tx,
              { id: owner.user_id, audience: "native" },
              "device.desktop_pair_retire",
              previous?.device_id,
              "succeeded",
              { pairing_id: b.id },
              previous ? b.tenant_id : undefined,
            );
          status = "retired";
        },
        undefined,
        true,
      );
    reply.header("Cache-Control", "no-store");
    return desktopPairingRetirementSchema.parse({ pairing_id: b.id, status });
  });
}
