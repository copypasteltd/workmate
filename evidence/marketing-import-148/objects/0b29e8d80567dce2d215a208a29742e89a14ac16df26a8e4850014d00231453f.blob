import { z } from "zod";
import { uuid } from "./lib.js";

// Suggestions never select an answer or grant access. A free-text answer is
// always available, including when the specialist supplies suggested choices.
export const questionOptions = z.array(z.string().trim().min(1).max(240))
  .max(8).refine((items) => new Set(items).size === items.length, "Choices must be distinct");
export const questionRequest = z.object({
  kind: z.literal("question"),
  description: z.string().trim().min(1).max(2000),
  options: questionOptions.optional(),
}).strict();
export const questionAnswer = z.string().trim().min(1).max(4000);
export const resourceAnswer = z.object({
  resource_ids: z.array(uuid).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length),
}).strict();
export const inputAnswer = z.union([
  resourceAnswer,
  z.object({ answer: questionAnswer }).strict(),
]);
export const inputResolution = z.union([
  resourceAnswer.extend({ expected_version: z.number().int().positive() }),
  z.object({ expected_version: z.number().int().positive(), answer: questionAnswer }).strict(),
]);
export type InputSelection = z.infer<typeof inputAnswer> & { id: string; expected_version: number };
