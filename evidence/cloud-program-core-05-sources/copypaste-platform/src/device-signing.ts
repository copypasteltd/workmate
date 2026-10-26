import {
  createPrivateKey,
  createPublicKey,
  sign,
  createHash,
} from "node:crypto";
import { canonical } from "./lib.js";
// Domain-separated deterministic Ed25519 seed; private material stays in the service.
function privateKey(master: string) {
  const seed = createHash("sha256")
    .update("copypaste/device-command/v1\0")
    .update(Buffer.from(master, "hex"))
    .digest();
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}
export function commandPublicKey(master: string) {
  return createPublicKey(privateKey(master))
    .export({ format: "pem", type: "spki" })
    .toString();
}
export function signCommand(master: string, c: any) {
  const envelope = {
    id: c.id,
    device_id: c.device_id,
    tenant_id: c.tenant_id,
    operation: c.operation,
    payload: c.payload,
    nonce: c.nonce,
    expires_at: new Date(c.expires_at).toISOString(),
  };
  return {
    ...c,
    expires_at: envelope.expires_at,
    signature: sign(
      null,
      Buffer.from(canonical(envelope)),
      privateKey(master),
    ).toString("base64"),
  };
}
