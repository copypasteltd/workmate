import { z } from "zod";
import { canonical, hash, name, uuid, Problem } from "./lib.js";

export const groupMemberInput = z
  .object({
    agent_id: uuid,
    role_description: z.string().trim().min(1).max(1200),
  })
  .strict();
export const groupCreateInput = z
  .object({
    project_id: uuid,
    name,
    coordinator_agent_id: uuid,
    members: z.array(groupMemberInput).max(7),
    workspace_id: uuid.optional(),
  })
  .strict();
export const groupUpdateInput = z
  .object({
    expected_version: z.number().int().positive(),
    name: name.optional(),
    coordinator_agent_id: uuid.optional(),
    members: z.array(groupMemberInput).max(7).optional(),
    state: z.enum(["active", "archived"]).optional(),
  })
  .strict();
export const groupKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((value) => value !== "coordinator");
export const groupNodeInput = z
  .object({
    key: groupKey,
    agent_id: uuid,
    title: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(8000),
    depends_on: z.array(groupKey).max(15),
    budget_micros: z.number().int().min(1).max(1_000_000_000_000),
  })
  .strict();
export const groupRunInput = z
  .object({
    expected_version: z.number().int().positive(),
    brief: z.string().trim().min(1).max(8000),
    nodes: z.array(groupNodeInput).min(1).max(16),
    coordinator_budget_micros: z.number().int().min(1).max(1_000_000_000_000),
    max_parallelism: z.number().int().min(1).max(3),
  })
  .strict();
export type GroupRunInput = z.infer<typeof groupRunInput>;

/** Validate the complete graph before creating tasks or reserving any funds. */
export function validateGroupGraph(input: GroupRunInput, members: string[]) {
  const byKey = new Map(input.nodes.map((node) => [node.key, node]));
  if (byKey.size !== input.nodes.length)
    throw new Problem(
      422,
      "GROUP_DUPLICATE_STEP",
      "Give every team step a different key",
    );
  for (const node of input.nodes) {
    if (!members.includes(node.agent_id))
      throw new Problem(
        422,
        "GROUP_MEMBER_MISMATCH",
        "Assign each step to a member of this team version",
      );
    if (
      new Set(node.depends_on).size !== node.depends_on.length ||
      node.depends_on.some((key) => !byKey.has(key) || key === node.key)
    )
      throw new Problem(
        422,
        "GROUP_DEPENDENCY_INVALID",
        "Choose distinct dependencies from other steps in this run",
      );
  }
  const visiting = new Set<string>(),
    complete = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key))
      throw new Problem(
        422,
        "GROUP_DEPENDENCY_CYCLE",
        "Remove the circular dependency before reviewing the run",
      );
    if (complete.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)!.depends_on) visit(dependency);
    visiting.delete(key);
    complete.add(key);
  };
  for (const key of byKey.keys()) visit(key);
  const total = input.nodes.reduce(
    (sum, node) => sum + BigInt(node.budget_micros),
    BigInt(input.coordinator_budget_micros),
  );
  if (total > 1_000_000_000_000n)
    throw new Problem(
      422,
      "GROUP_BUDGET_LIMIT",
      "Reduce the total approved team budget",
    );
  const characters =
    input.brief.length +
    input.nodes.reduce((sum, node) => sum + node.prompt.length, 0);
  if (characters > 48000)
    throw new Problem(
      422,
      "GROUP_CONTEXT_LIMIT",
      "Shorten the team brief and step instructions before review",
    );
  return Number(total);
}
export const groupDefinitionHash = (definition: unknown) =>
  hash(canonical(definition));

// Team work exposes actual existing company tools. Recursive workflow creation
// and unsupported cloud execution do not become available through membership.
export const groupExecutionRoles = new Set([
  "assistant",
  "designer",
  "ad-creative",
  "ecommerce",
  "social-content",
  "illustration-ip",
  "typography-layout",
  "information-design",
  "marketing-analyst",
  "brand-visual",
  "presentation",
]);
