import { z } from "zod";
import { canonical, hash, name, uuid } from "./lib.js";
import { connectorProvider } from "./connector-model.js";

const unique = <T>(values: T[]) => new Set(values).size === values.length;
const methodText = z
  .string()
  .trim()
  .min(1)
  .max(8000)
  .refine(
    (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),
    "Use printable method instructions",
  )
  .refine(
    (s) =>
      !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[\w.-]{16,}|\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{20,}/i.test(
        s,
      ),
    "Remove credentials before sharing this method",
  );
export const solutionCreate = z
  .object({
    project_id: uuid,
    name,
    instructions: methodText,
    agent_template_ids: z.array(uuid).max(6).refine(unique),
    skill_version_ids: z.array(uuid).max(60).refine(unique),
    required_assets: z
      .array(z.string().trim().min(1).max(100))
      .max(12)
      .refine(unique),
    required_connectors: z.array(connectorProvider).max(4).refine(unique),
  })
  .strict();
export const solutionPublish = z
  .object({
    expected_version: z.number().int().nonnegative(),
    validation_task_id: uuid,
  })
  .strict();
export const solutionInstall = z
  .object({ project_id: uuid, name: name.optional() })
  .strict();
export const solutionBindings = z
  .object({
    assets: z
      .array(
        z
          .object({
            requirement: z.string().trim().min(1).max(100),
            asset_version_id: uuid,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(12)
      .refine((a) => unique(a.map((v) => v.requirement))),
    connectors: z
      .array(
        z
          .object({
            provider: connectorProvider,
            connection_id: uuid,
            version: z.number().int().nonnegative(),
            auth_version: z.number().int().nonnegative(),
            account_id: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(4)
      .refine((a) => unique(a.map((v) => v.provider))),
  })
  .strict();
export const emptySolutionBindings = () => ({ assets: [], connectors: [] });
export const solutionPreview = z
  .object({
    project_id: uuid,
    installation_id: uuid.optional(),
    bindings: solutionBindings,
  })
  .strict();
export const solutionTrial = solutionPreview
  .extend({
    expected_preview_hash: z.string().regex(/^[a-f0-9]{64}$/),
    budget_micros: z.number().int().min(1000).max(100_000_000),
    brief: z.string().trim().min(1).max(4000),
    approval: z.literal(true),
  })
  .strict();
export const solutionReview = z
  .object({
    approval: z.literal(true),
    tasks: z
      .array(
        z
          .object({
            task_id: uuid,
            expected_version: z.number().int().positive(),
            expected_delivery_hash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(6)
      .refine((a) => unique(a.map((v) => v.task_id))),
    comment: z.string().trim().max(2000).default(""),
  })
  .strict();
export const solutionDigest = (value: unknown) => hash(canonical(value));
export const solutionDTO = (v: any) => ({
  id: v.id,
  project_id: v.project_id,
  version: v.version,
  definition: v.definition,
  state: v.state,
});
export type SolutionBindings = z.infer<typeof solutionBindings>;
