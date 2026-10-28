import { createHash, createPublicKey, verify } from "node:crypto";

export const disconnectProtocol = "copypaste.desktop-disconnect.v1";
export interface DeviceDisconnectProof {
  tenant_id: string;
  device_id: string;
  signature: string;
}
export interface DesktopDisconnectRequest {
  protocol: typeof disconnectProtocol;
  client_id: "desktop";
  request_id: string;
  refresh_token: string;
  devices: DeviceDisconnectProof[];
}
export interface DesktopDisconnectReceipt {
  ok: true;
  request_id: string;
  devices: {
    tenant_id: string;
    device_id: string;
    status: "revoked" | "unverified";
  }[];
}
/** Ordered, domain-separated fields; a proof authorizes only irreversible removal. */
export function disconnectMessage(
  request: Pick<DesktopDisconnectRequest, "request_id" | "refresh_token">,
  device: Pick<DeviceDisconnectProof, "tenant_id" | "device_id">,
) {
  return Buffer.from(
    JSON.stringify([
      disconnectProtocol,
      "desktop",
      request.request_id,
      createHash("sha256").update(request.refresh_token).digest("hex"),
      device.tenant_id,
      device.device_id,
    ]),
  );
}
export function verifyDisconnectProof(
  request: DesktopDisconnectRequest,
  device: DeviceDisconnectProof,
  publicKey: string,
) {
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(device.signature)) return false;
    const key = createPublicKey(publicKey);
    return (
      key.asymmetricKeyType === "ed25519" &&
      verify(
        null,
        disconnectMessage(request, device),
        key,
        Buffer.from(device.signature, "base64url"),
      )
    );
  } catch {
    return false;
  }
}
