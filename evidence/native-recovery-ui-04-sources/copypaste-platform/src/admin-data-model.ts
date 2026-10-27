import { z } from "zod";
import { uuid } from "./lib.js";

export const exportSources = ["users", "usage", "billing", "audit"] as const;
export const dataFilters = z
  .object({
    q: z.string().trim().max(160).optional(),
    tenant_id: uuid.optional(),
    project_id: uuid.optional(),
    user_id: uuid.optional(),
    state: z.enum(["active", "frozen", "closed"]).optional(),
    created_from: z.string().datetime({ offset: true }).optional(),
    created_to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.created_from ||
      !v.created_to ||
      Date.parse(v.created_from) < Date.parse(v.created_to),
    "The end must follow the start",
  );
export const dataCommand = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("export"),
      source: z.enum(exportSources),
      filters: dataFilters.default({}),
      reason: z.string().trim().min(3).max(1000),
    })
    .strict()
    .superRefine((v, ctx) => {
      for (const key of Object.keys(v.filters)) {
        if (
          (key === "state" && v.source !== "users") ||
          (v.source === "audit" && ["user_id", "project_id"].includes(key))
        )
          ctx.addIssue({
            code: "custom",
            path: ["filters", key],
            message: "This filter does not apply to the selected source",
          });
      }
    }),
  z
    .object({
      kind: z.literal("users.status"),
      ids: z
        .array(uuid)
        .min(1)
        .max(100)
        .refine(
          (v) => new Set(v).size === v.length,
          "Select each account once",
        ),
      state: z.enum(["active", "frozen"]),
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
]);
export type DataCommand = z.infer<typeof dataCommand>;
export type DataFilters = z.infer<typeof dataFilters>;
export type DataTarget = {
  id: string;
  fingerprint: string;
  version: number | null;
  row: Record<string, unknown>;
};
export const jobConfirmation = z
  .object({
    preview_id: uuid,
    definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const jobControl = z
  .object({
    expected_revision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const dataLimits = {
  exportRows: 10_000,
  batchUsers: 100,
  previewMinutes: 5,
  jobMinutes: 15,
  processItems: 30,
  attempts: 3,
} as const;

/** A leading space/control character must not turn a quoted cell into a formula. */
export function dataCsvCell(value: unknown) {
  let text =
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
