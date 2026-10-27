import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const uuid = z.string().uuid();
export const name = z.string().trim().min(1).max(160);
export const email = z.string().trim().toLowerCase().email().max(254);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const hmac = (key: string, v: string) =>
  createHmac("sha256", key).update(v).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(key: string, text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const out = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), out]).toString("base64");
}
export function unseal(key: string, value: string) {
  const b = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    b.subarray(0, 12),
  );
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    decipher.update(b.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export const micros = z.number().int().positive().max(1_000_000_000_000).safe();
export function publicRow(row: Record<string, unknown>) {
  const denied =
    /password|secret|token|digest|totp|auth_version|api_key|encrypted|refresh|csrf/i;
  return Object.fromEntries(
    Object.entries(row).filter(([k]) => !denied.test(k)),
  );
}
