import { z } from "zod";
import {
  updateAppId,
  updateProtocol,
  updateMaxBytes,
} from "./desktop-update-contract.js";
const sha = z.string().regex(/^[a-f0-9]{64}$/),
  version = z
    .string()
    .regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
export const desktopReleaseSchema = z
  .object({
    version,
    minimum_version: version,
    sha256: sha,
    bytes: z.number().int().min(1).max(updateMaxBytes),
    signer_sha256: sha,
    notes: z
      .object({
        en: z.string().min(3).max(3000),
        zh: z.string().min(3).max(3000),
      })
      .strict(),
  })
  .strict();
const payload = {
  protocol: z.literal(updateProtocol),
  app_id: z.literal(updateAppId),
  channel: z.enum(["stable", "preview"]),
  platform: z.literal("windows-x64"),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
};
export const desktopUpdatePayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...payload,
      action: z.literal("install"),
      rollout_basis_points: z.number().int().min(0).max(10000),
      release: desktopReleaseSchema,
    })
    .strict(),
  z
    .object({
      ...payload,
      action: z.literal("rollback"),
      rollout_basis_points: z.literal(10000),
      release: desktopReleaseSchema,
    })
    .strict(),
  z
    .object({
      ...payload,
      action: z.literal("withdraw"),
      rollout_basis_points: z.literal(10000),
      release: z.null(),
    })
    .strict(),
]);
export const desktopUpdateEnvelopeSchema = z
  .object({
    key_id: sha,
    payload: desktopUpdatePayloadSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
