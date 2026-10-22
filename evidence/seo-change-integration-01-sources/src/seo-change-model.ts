import { z } from "zod";
import { uuid } from "./lib.js";

export const seoChangeInput = z
  .object({
    agent_id: uuid,
    expected_revision: z.number().int().min(0),
    title: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(5).max(8000),
    finding_ids: z
      .array(uuid)
      .min(1)
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each finding once",
      ),
    budget: z
      .object({
        currency: z.literal("HKD"),
        amount_micros: z
          .string()
          .regex(/^[1-9]\d{0,12}$/)
          .refine((v) => BigInt(v) <= 1000000000000n),
      })
      .strict(),
  })
  .strict();

export const seoChangeNarrative = z
  .object({
    changes: z
      .array(
        z
          .object({
            finding_id: uuid,
            rationale: z.string().trim().min(1).max(2000),
            proposed_change: z.string().trim().min(1).max(8000),
            verification: z
              .array(z.string().trim().min(1).max(2000))
              .min(1)
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
