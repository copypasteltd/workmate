import { createHash, createPublicKey, verify } from "node:crypto";

export const pairingProtocol = "copypaste.desktop-pairing.v1" as const;
export interface PairingInput {
  id: string;
  tenant_id: string;
  name: string;
  public_key: string;
  grants: {
    id: string;
    label: string;
    operations: ("file.list" | "file.read" | "file.write")[];
    expires_at: string;
  }[];
}
export interface PairingRequest {
  protocol: typeof pairingProtocol;
  refresh_token: string;
  input: PairingInput;
  signature: string;
}
export interface PairedDevice {
  id: string;
  name: string;
  client: "desktop";
  state: "active";
  grants: PairingInput["grants"];
}
export interface PairingReceipt {
  pairing_id: string;
  device: PairedDevice;
}
export interface PairingRetirement {
  pairing_id: string;
  status: "retired" | "unverified";
}
export function pairingCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(pairingCanonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + pairingCanonical(v))
      .join(",") +
    "}"
  );
}
export const pairingHash = (input: PairingInput) =>
  createHash("sha256").update(pairingCanonical(input)).digest("hex");
export function pairingMessage(
  action: "pair" | "retire",
  request: Pick<PairingRequest, "refresh_token" | "input">,
) {
  return Buffer.from(
    JSON.stringify([
      pairingProtocol,
      action,
      createHash("sha256").update(request.refresh_token).digest("hex"),
      pairingHash(request.input),
    ]),
  );
}
export function verifyPairing(
  action: "pair" | "retire",
  request: PairingRequest,
) {
  try {
    const key = createPublicKey(request.input.public_key);
    return (
      request.protocol === pairingProtocol &&
      key.asymmetricKeyType === "ed25519" &&
      /^[\w-]{86}$/.test(request.signature) &&
      verify(
        null,
        pairingMessage(action, request),
        key,
        Buffer.from(request.signature, "base64url"),
      )
    );
  } catch {
    return false;
  }
}
