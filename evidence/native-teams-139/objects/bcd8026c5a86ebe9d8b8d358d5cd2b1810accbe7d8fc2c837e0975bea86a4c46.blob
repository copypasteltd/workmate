import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { z } from "zod";
import { audit } from "./auth.js";
import { hash, uuid } from "./lib.js";
import {
  disconnectProtocol,
  verifyDisconnectProof,
  type DesktopDisconnectReceipt,
} from "./desktop-disconnect-contract.js";

export const desktopDisconnectSchema = z
  .object({
    protocol: z.literal(disconnectProtocol),
    client_id: z.literal("desktop"),
    request_id: uuid,
    refresh_token: z.string().min(40).max(100),
    devices: z
      .array(
        z
          .object({
            tenant_id: uuid,
            device_id: uuid,
            signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.devices.map((d) => d.tenant_id + ":" + d.device_id))
        .size === value.devices.length,
    "Duplicate device proof",
  );
export const desktopDisconnectReceiptSchema = z
  .object({
    ok: z.literal(true),
    request_id: uuid,
    devices: z
      .array(
        z
          .object({
            tenant_id: uuid,
            device_id: uuid,
            status: z.enum(["revoked", "unverified"]),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export function registerDesktopDisconnect(app: FastifyInstance, db: Database) {
  // A short-lived access token and active membership are deliberately unnecessary:
  // expired/removed users must still be able to retire their own installation.
  app.post("/v1/auth/native/disconnect", async (req, reply) => {
    const body = desktopDisconnectSchema.parse(req.body);
    const receipt: DesktopDisconnectReceipt = {
      ok: true,
      request_id: body.request_id,
      devices: body.devices.map((d) => ({
        tenant_id: d.tenant_id,
        device_id: d.device_id,
        status: "unverified",
      })),
    };
    await db.tx(
      async (tx) => {
        const owner = (
          await tx.query("SELECT user_id FROM refresh_tokens WHERE digest=$1", [
            hash(body.refresh_token),
          ])
        ).rows[0];
        if (!owner) return;
        // Match token refresh/logout lock order. Control access is narrowly constrained
        // by BOTH credential ownership and the device's own Ed25519 key.
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          owner.user_id,
        ]);
        const family = (
          await tx.query(
            "SELECT * FROM refresh_tokens WHERE digest=$1 FOR UPDATE",
            [hash(body.refresh_token)],
          )
        ).rows[0];
        if (!family || family.client_id !== "desktop") return;
        await tx.query(
          "UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1 AND user_id=$2",
          [family.family_id, family.user_id],
        );
        await tx.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$2 AND id IN (SELECT session_id FROM refresh_tokens WHERE family_id=$1 AND user_id=$2)",
          [family.family_id, family.user_id],
        );
        // Stable row order also prevents deadlocks between overlapping removal retries.
        for (const proof of [...body.devices].sort((a, b) =>
          (a.tenant_id + a.device_id).localeCompare(b.tenant_id + b.device_id),
        )) {
          const device = (
            await tx.query(
              "SELECT id,public_key,state FROM devices WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND client='desktop' FOR UPDATE",
              [proof.tenant_id, proof.device_id, family.user_id],
            )
          ).rows[0];
          if (!device || !verifyDisconnectProof(body, proof, device.public_key))
            continue;
          await tx.query(
            "UPDATE devices SET state='revoked',grants='[]' WHERE tenant_id=$1 AND id=$2 AND user_id=$3",
            [proof.tenant_id, proof.device_id, family.user_id],
          );
          await tx.query(
            "UPDATE device_commands SET state='cancelled' WHERE tenant_id=$1 AND device_id=$2 AND state IN ('pending','claimed')",
            [proof.tenant_id, proof.device_id],
          );
          receipt.devices.find(
            (d) =>
              d.tenant_id === proof.tenant_id &&
              d.device_id === proof.device_id,
          )!.status = "revoked";
          if (device.state !== "revoked")
            await audit(
              tx,
              { id: family.user_id, audience: "native" },
              "device.desktop_disconnect",
              device.id,
              "succeeded",
              { request_id: body.request_id },
              proof.tenant_id,
            );
        }
        if (!family.revoked_at)
          await audit(
            tx,
            { id: family.user_id, audience: "native" },
            "session.desktop_disconnect",
            family.session_id,
            "succeeded",
            {
              request_id: body.request_id,
              devices: receipt.devices.filter((d) => d.status === "revoked")
                .length,
            },
          );
      },
      undefined,
      true,
    );
    reply.header("Cache-Control", "no-store");
    return desktopDisconnectReceiptSchema.parse(receipt);
  });
}
