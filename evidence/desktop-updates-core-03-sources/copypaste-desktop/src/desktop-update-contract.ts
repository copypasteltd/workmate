// Protocol v1. Keep the Desktop copy byte-identical; it must verify without a server session.
import { createHash, createPublicKey, verify } from "node:crypto";

export const updateProtocol = "copypaste-desktop-update-v1" as const;
export const updateAppId = "hk.copypaste.agent" as const;
export const updateChunkBytes = 4 * 1024 * 1024;
export const updateMaxBytes = 2 * 1024 * 1024 * 1024;
export interface DesktopRelease {
  version: string;
  minimum_version: string;
  sha256: string;
  bytes: number;
  signer_sha256: string;
  notes: { en: string; zh: string };
}
export interface UpdatePayload {
  protocol: typeof updateProtocol;
  app_id: typeof updateAppId;
  channel: "stable" | "preview";
  platform: "windows-x64";
  sequence: number;
  issued_at: string;
  expires_at: string;
  action: "install" | "rollback" | "withdraw";
  rollout_basis_points: number;
  release: DesktopRelease | null;
}
export interface UpdateEnvelope {
  key_id: string;
  payload: UpdatePayload;
  signature: string;
}
export class UpdateError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const fail = (code = "UPDATE_MANIFEST_INVALID"): never => {
  throw new UpdateError(code);
};
const object = (v: any, keys: string[]) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    fail();
};
const sha = (v: any) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function versionParts(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)
  )
    fail("UPDATE_VERSION_INVALID");
  return (value as string).split(".").map(Number);
}
export function compareVersions(a: string, b: string) {
  const x = versionParts(a),
    y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export function updateCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(updateCanonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + updateCanonical((value as any)[k]))
      .join(",") +
    "}"
  );
}
export function parseUpdateKeys(input: unknown): Record<string, string> {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 8
  )
    fail("UPDATE_TRUST_INVALID");
  for (const [id, pem] of Object.entries(value)) {
    if (!sha(id) || typeof pem !== "string" || pem.length > 1000)
      fail("UPDATE_TRUST_INVALID");
    const key = createPublicKey(pem as string);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("hex") !== id
    )
      fail("UPDATE_TRUST_INVALID");
  }
  return value;
}
export function verifyUpdateEnvelope(
  input: unknown,
  keys: Record<string, string>,
  options: { now?: number; minimumSequence?: number; channel?: string } = {},
): UpdateEnvelope {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 16000) fail();
  const e = input as UpdateEnvelope;
  object(e, ["key_id", "payload", "signature"]);
  object(e.payload, [
    "protocol",
    "app_id",
    "channel",
    "platform",
    "sequence",
    "issued_at",
    "expires_at",
    "action",
    "rollout_basis_points",
    "release",
  ]);
  const p = e.payload;
  if (
    p.protocol !== updateProtocol ||
    p.app_id !== updateAppId ||
    p.platform !== "windows-x64" ||
    !["stable", "preview"].includes(p.channel) ||
    !["install", "rollback", "withdraw"].includes(p.action) ||
    !Number.isSafeInteger(p.sequence) ||
    p.sequence < 1 ||
    !Number.isInteger(p.rollout_basis_points) ||
    p.rollout_basis_points < 0 ||
    p.rollout_basis_points > 10000
  )
    fail();
  for (const date of [p.issued_at, p.expires_at])
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString() !== date
    )
      fail();
  const now = options.now ?? Date.now(),
    issued = Date.parse(p.issued_at),
    expiry = Date.parse(p.expires_at);
  if (
    issued > now + 300000 ||
    expiry <= now ||
    expiry <= issued ||
    expiry - issued > 31 * 86400000
  )
    fail("UPDATE_MANIFEST_EXPIRED");
  if (p.sequence < (options.minimumSequence ?? 0))
    fail("UPDATE_MANIFEST_REPLAYED");
  if (options.channel && options.channel !== p.channel)
    fail("UPDATE_CHANNEL_CHANGED");
  if (p.action === "withdraw") {
    if (p.release !== null || p.rollout_basis_points !== 10000) fail();
  } else {
    const r = p.release;
    object(r, [
      "version",
      "minimum_version",
      "sha256",
      "bytes",
      "signer_sha256",
      "notes",
    ]);
    versionParts(r!.version);
    versionParts(r!.minimum_version);
    if (
      !sha(r!.sha256) ||
      !sha(r!.signer_sha256) ||
      !Number.isSafeInteger(r!.bytes) ||
      r!.bytes < 1 ||
      r!.bytes > updateMaxBytes
    )
      fail();
    object(r!.notes, ["en", "zh"]);
    if (
      [r!.notes.en, r!.notes.zh].some(
        (s) =>
          typeof s !== "string" ||
          s.trim().length < 3 ||
          s.length > 3000 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s),
      )
    )
      fail();
    if (p.action === "rollback" && p.rollout_basis_points !== 10000) fail();
  }
  if (!sha(e.key_id) || !keys[e.key_id]) fail("UPDATE_KEY_UNTRUSTED");
  if (
    typeof e.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(e.signature)
  )
    fail("UPDATE_SIGNATURE_INVALID");
  const signature = Buffer.from(e.signature, "base64url");
  if (
    signature.toString("base64url") !== e.signature ||
    !verify(
      null,
      Buffer.from(updateCanonical(p)),
      createPublicKey(keys[e.key_id]),
      signature,
    )
  )
    fail("UPDATE_SIGNATURE_INVALID");
  return structuredClone(e);
}
export function releaseForInstallation(
  e: UpdateEnvelope,
  currentVersion: string,
  installationId: string,
) {
  const p = e.payload,
    r = p.release;
  if (!r || p.action === "withdraw")
    return { eligible: false, code: "UPDATE_WITHDRAWN" };
  if (compareVersions(currentVersion, r.minimum_version) < 0)
    return { eligible: false, code: "UPDATE_MANUAL_UPGRADE_REQUIRED" };
  const direction = compareVersions(r.version, currentVersion);
  if (
    direction === 0 ||
    (direction < 0 && p.action !== "rollback") ||
    (direction > 0 && p.action === "rollback")
  )
    return { eligible: false, code: "UPDATE_CURRENT" };
  if (!/^[a-f0-9-]{36}$/.test(installationId))
    fail("UPDATE_INSTALLATION_INVALID");
  const bucket =
    createHash("sha256")
      .update(p.app_id + ":" + p.channel + ":" + installationId)
      .digest()
      .readUInt32BE(0) % 10000;
  return bucket < p.rollout_basis_points
    ? { eligible: true, code: "UPDATE_AVAILABLE" }
    : { eligible: false, code: "UPDATE_ROLLOUT_PENDING" };
}
